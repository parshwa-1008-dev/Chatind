import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { app } from "./app";
import { config } from "./config";
import { prisma } from "./prisma";
import { sendMessageSchema } from "./validation";
import { z } from "zod";

const server = createServer(app);
const io = new Server(server, {
  cors: { origin: config.CORS_ORIGIN, credentials: true },
  maxHttpBufferSize: 1e6,
});
app.set("io", io);

const online = new Map<string, number>();
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (typeof token !== "string") { next(new Error("Authentication required")); return; }
  try {
    const claims = jwt.verify(token, config.JWT_SECRET) as { sub: string; username: string };
    if (!claims.sub) throw new Error("Invalid token");
    socket.data.userId = claims.sub;
    next();
  } catch {
    next(new Error("Invalid or expired access token"));
  }
});

io.on("connection", (socket) => {
  const userId = socket.data.userId as string;
  socket.emit("presence:snapshot", [...online.keys()]);
  const count = (online.get(userId) || 0) + 1;
  online.set(userId, count);
  if (count === 1) io.emit("presence:update", { userId, online: true });

  socket.on("conversation:join", async (conversationId: unknown, ack?: (result: { ok: boolean; error?: string }) => void) => {
    if (typeof conversationId !== "string") { ack?.({ ok: false, error: "Invalid conversation" }); return; }
    try {
      const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
      if (!member) { ack?.({ ok: false, error: "Conversation not found" }); return; }
      await socket.join(conversationId);
      ack?.({ ok: true });
    } catch (error) {
      console.error("Could not join conversation room", error);
      ack?.({ ok: false, error: "Could not join conversation" });
    }
  });

  socket.on("message:send", async (payload: unknown, ack?: (result: { ok: boolean; message?: unknown; error?: string }) => void) => {
    try {
      const body = payload as { conversationId?: unknown; body?: unknown; replyToId?: unknown };
      const conversationId = body?.conversationId;
      if (typeof conversationId !== "string") { ack?.({ ok: false, error: "Invalid conversation" }); return; }
      const input = sendMessageSchema.parse({ body: body.body, replyToId: body.replyToId });
      const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
      if (!member) { ack?.({ ok: false, error: "Conversation not found" }); return; }
      if (input.replyToId) {
        const reply = await prisma.message.findFirst({ where: { id: input.replyToId, conversationId } });
        if (!reply) { ack?.({ ok: false, error: "Reply target is not in this conversation" }); return; }
      }
      const message = await prisma.$transaction(async (transaction) => {
        const created = await transaction.message.create({
          data: { conversationId, senderId: userId, body: input.body, replyToId: input.replyToId },
          include: { sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } }, attachments: true, reactions: true, receipts: true },
        });
        await transaction.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
        return created;
      });
      io.to(conversationId).emit("message:new", message);
      ack?.({ ok: true, message });
    } catch (error) {
      if (error instanceof z.ZodError) { ack?.({ ok: false, error: "Invalid message content" }); return; }
      console.error("Socket message failed", error);
      ack?.({ ok: false, error: "Message could not be sent" });
    }
  });

  socket.on("message:read", async (payload: unknown) => {
    const value = payload as { conversationId?: unknown; messageId?: unknown };
    if (typeof value?.conversationId !== "string" || typeof value.messageId !== "string") return;
    try {
      const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: value.conversationId, userId } } });
      if (!member) return;
      const message = await prisma.message.findFirst({ where: { id: value.messageId, conversationId: value.conversationId } });
      if (!message || message.senderId === userId) return;
      const receipt = await prisma.readReceipt.upsert({
        where: { messageId_userId: { messageId: message.id, userId } },
        create: { messageId: message.id, userId },
        update: { readAt: new Date() },
      });
      io.to(value.conversationId).emit("message:read-receipt", { messageId: message.id, userId, readAt: receipt.readAt });
    } catch (error) { console.error("Could not persist read receipt", error); }
  });

  const relayTyping = async (payload: unknown, event: string) => {
    const value = payload as { conversationId?: unknown };
    if (typeof value?.conversationId !== "string") return;
    try {
      const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: value.conversationId, userId } } });
      if (member) socket.to(value.conversationId).emit(event, { conversationId: value.conversationId, userId });
    } catch (error) { console.error("Could not relay typing state", error); }
  };
  socket.on("typing:start", (payload) => { void relayTyping(payload, "typing:start"); });
  socket.on("typing:stop", (payload) => { void relayTyping(payload, "typing:stop"); });

  socket.on("disconnect", () => {
    const remaining = (online.get(userId) || 1) - 1;
    if (remaining > 0) online.set(userId, remaining);
    else {
      online.delete(userId);
      io.emit("presence:update", { userId, online: false });
      void prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(console.error);
    }
  });
});

server.listen(config.PORT, () => console.log(`Chatind API listening on ${config.PORT}`));

async function shutdown() {
  io.close();
  await prisma.$disconnect();
  server.close(() => process.exit(0));
}
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
