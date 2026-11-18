import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import multer from "multer";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { config } from "./config";
import { prisma } from "./prisma";
import { authenticate, createAccessToken, createRefreshToken, digestToken, hashPassword, verifyPassword, type AuthRequest } from "./auth";
import { createConversationSchema, loginSchema, registerSchema, sendMessageSchema } from "./validation";
import { createDownloadUrl, removeUpload, storeUpload } from "./storage";

export const app = express();
const cookieOptions = {
  httpOnly: true,
  secure: config.NODE_ENV === "production",
  sameSite: config.COOKIE_SAME_SITE,
  path: "/api/auth",
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 },
});

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api", (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && req.cookies?.refreshToken) {
    const origin = req.header("origin");
    if (origin && origin !== config.CORS_ORIGIN) {
      res.status(403).json({ error: "Origin is not allowed" });
      return;
    }
  }
  next();
});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const existing = await prisma.user.findFirst({ where: { OR: [{ username: input.username.toLowerCase() }, { email: input.email.toLowerCase() }] } });
    if (existing) { res.status(409).json({ error: "Username or email is already in use" }); return; }
    const user = await prisma.user.create({
      data: { ...input, username: input.username.toLowerCase(), email: input.email.toLowerCase(), passwordHash: await hashPassword(input.password) },
      select: { id: true, username: true, displayName: true, email: true, avatarUrl: true, about: true },
    });
    const accessToken = await issueSession(user, res);
    res.status(201).json({ user, accessToken });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findFirst({ where: { OR: [{ username: input.username.toLowerCase() }, { email: input.username.toLowerCase() }] } });
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) { res.status(401).json({ error: "Invalid username/email or password" }); return; }
    const accessToken = await issueSession(user, res);
    res.json({ user: publicUser(user), accessToken });
  } catch (error) { next(error); }
});

app.post("/api/auth/refresh", async (req, res, next) => {
  const token = req.cookies?.refreshToken as string | undefined;
  if (!token) { res.status(401).json({ error: "Refresh token required" }); return; }
  let claims: { sub: string };
  try {
    claims = jwt.verify(token, config.REFRESH_TOKEN_SECRET) as { sub: string };
    if (!claims.sub) throw new Error("Missing subject");
  } catch {
    res.clearCookie("refreshToken", cookieOptions).status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }
  try {
    const session = await prisma.session.findUnique({ where: { tokenHash: digestToken(token) }, include: { user: true } });
    if (!session || session.userId !== claims.sub || session.expiresAt <= new Date()) {
      res.clearCookie("refreshToken", cookieOptions).status(401).json({ error: "Invalid or expired refresh token" });
      return;
    }
    await prisma.session.delete({ where: { id: session.id } });
    const accessToken = await issueSession(session.user, res);
    res.json({ user: publicUser(session.user), accessToken });
  } catch (error) { next(error); }
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken as string | undefined;
    if (token) await prisma.session.deleteMany({ where: { tokenHash: digestToken(token) } });
    res.clearCookie("refreshToken", cookieOptions).status(204).end();
  } catch (error) { next(error); }
});

app.get("/api/auth/me", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: { id: true, username: true, displayName: true, email: true, avatarUrl: true, about: true, lastSeenAt: true } });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json({ user });
  } catch (error) { next(error); }
});

app.patch("/api/users/me", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const input = z.object({ displayName: z.string().trim().min(1).max(80).optional(), about: z.string().trim().max(140).optional(), phone: z.string().trim().max(32).nullable().optional() }).parse(req.body);
    const user = await prisma.user.update({ where: { id: req.user!.sub }, data: input, select: { id: true, username: true, displayName: true, email: true, avatarUrl: true, about: true, phone: true } });
    res.json({ user });
  } catch (error) { next(error); }
});

app.get("/api/users", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const search = z.string().trim().min(1).max(80).parse(req.query.search);
    const users = await prisma.user.findMany({
      where: { id: { not: req.user!.sub }, OR: [{ username: { contains: search, mode: "insensitive" } }, { displayName: { contains: search, mode: "insensitive" } }] },
      select: { id: true, username: true, displayName: true, avatarUrl: true, about: true },
      take: 20,
    });
    res.json({ users });
  } catch (error) { next(error); }
});

app.get("/api/conversations", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { members: { some: { userId: req.user!.sub } } },
      include: {
        members: { include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true, lastSeenAt: true } } } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, include: { sender: { select: { id: true, displayName: true } } } },
      },
      orderBy: { updatedAt: "desc" },
    });
    res.json({ conversations });
  } catch (error) { next(error); }
});

app.post("/api/conversations", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const input = createConversationSchema.parse(req.body);
    const memberIds = [...new Set([req.user!.sub, ...input.memberIds])];
    if (input.type === "DIRECT" && memberIds.length !== 2) { res.status(400).json({ error: "Direct chats require exactly two distinct users" }); return; }
    const existingUsers = await prisma.user.count({ where: { id: { in: memberIds } } });
    if (existingUsers !== memberIds.length) { res.status(404).json({ error: "One or more users do not exist" }); return; }
    if (input.type === "DIRECT") {
      const current = await prisma.conversation.findFirst({
        where: { type: "DIRECT", AND: memberIds.map(userId => ({ members: { some: { userId } } })) },
        include: {
          members: { include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } },
          messages: { orderBy: { createdAt: "desc" }, take: 1, include: { sender: { select: { id: true, displayName: true } } } },
        },
      });
      if (current && current.members.length === 2) { res.json({ conversation: current }); return; }
    }
    const conversation = await prisma.conversation.create({
      data: {
        type: input.type,
        title: input.type === "GROUP" ? input.title : null,
        members: { create: memberIds.map((userId, index) => ({ userId, role: input.type === "GROUP" && index === 0 ? "ADMIN" : "MEMBER" })) },
      },
      include: {
        members: { include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, include: { sender: { select: { id: true, displayName: true } } } },
      },
    });
    res.status(201).json({ conversation });
  } catch (error) { next(error); }
});

app.get("/api/conversations/:id/messages", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const conversationId = z.string().min(1).parse(req.params.id);
    const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId: req.user!.sub } } });
    if (!member) { res.status(404).json({ error: "Conversation not found" }); return; }
    const before = req.query.before ? new Date(String(req.query.before)) : undefined;
    const messages = await prisma.message.findMany({
      where: { conversationId, ...(before ? { createdAt: { lt: before } } : {}) },
      include: { sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } }, attachments: true, reactions: true, receipts: { select: { userId: true, readAt: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const withDownloadUrls = await Promise.all(messages.map(async (message) => ({
      ...message,
      attachments: await Promise.all(message.attachments.map(async (attachment) => ({
        ...attachment,
        url: await createDownloadUrl(attachment.storageKey),
      }))),
    })));
    res.json({ messages: withDownloadUrls.reverse() });
  } catch (error) { next(error); }
});

app.post("/api/conversations/:id/messages", authenticate, async (req: AuthRequest, res, next) => {
  try {
    const conversationId = z.string().min(1).parse(req.params.id);
    const input = sendMessageSchema.parse(req.body);
    const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId: req.user!.sub } } });
    if (!member) { res.status(404).json({ error: "Conversation not found" }); return; }
    if (input.replyToId) {
      const reply = await prisma.message.findFirst({ where: { id: input.replyToId, conversationId } });
      if (!reply) { res.status(400).json({ error: "Reply target is not in this conversation" }); return; }
    }
    const message = await prisma.$transaction(async (transaction) => {
      const created = await transaction.message.create({
        data: { conversationId, senderId: req.user!.sub, body: input.body, type: input.type, replyToId: input.replyToId },
        include: { sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } }, attachments: true, reactions: true, receipts: true },
      });
      await transaction.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      return created;
    });
    req.app.get("io").to(conversationId).emit("message:new", message);
    res.status(201).json({ message });
  } catch (error) { next(error); }
});

app.post("/api/uploads", authenticate, upload.single("file"), async (req: AuthRequest, res, next) => {
  try {
    const file = req.file;
    const conversationId = z.string().min(1).parse(req.body.conversationId);
    if (!file) { res.status(400).json({ error: "File is required" }); return; }
    const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId: req.user!.sub } } });
    if (!member) { res.status(404).json({ error: "Conversation not found" }); return; }
    const stored = await storeUpload(file);
    try {
      const type = file.mimetype.startsWith("image/") ? "IMAGE" : file.mimetype.startsWith("video/") ? "VIDEO" : file.mimetype.startsWith("audio/") ? "AUDIO" : "DOCUMENT";
      const message = await prisma.$transaction(async (transaction) => {
        const created = await transaction.message.create({
          data: {
            conversationId,
            senderId: req.user!.sub,
            body: file.originalname.slice(0, 1000),
            type,
            attachments: { create: { storageKey: stored.key, url: `s3://${config.STORAGE_BUCKET}/${stored.key}`, contentType: file.mimetype, size: file.size, originalName: file.originalname } },
          },
          include: { sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } }, attachments: true, reactions: true, receipts: true },
        });
        await transaction.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
        return created;
      });
      const responseMessage = {
        ...message,
        attachments: await Promise.all(message.attachments.map(async (attachment) => ({
          ...attachment,
          url: stored.url,
        }))),
      };
      req.app.get("io").to(conversationId).emit("message:new", responseMessage);
      res.status(201).json({ message: responseMessage });
    } catch (error) {
      await removeUpload(stored.key).catch((cleanupError: unknown) => console.error("Could not remove orphaned upload", cleanupError));
      throw error;
    }
  } catch (error) { next(error); }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid request", details: error.flatten() }); return; }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { res.status(409).json({ error: "A record with these details already exists" }); return; }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") { res.status(404).json({ error: "The requested record was not found" }); return; }
  const errorCode = error instanceof Error && "code" in error ? String(error.code) : "";
  if (["ECONNREFUSED", "P1001", "P1002"].includes(errorCode)) {
    console.error("Database connection is unavailable", error);
    res.status(503).json({ error: "Database unavailable. Start PostgreSQL and apply the database migrations." });
    return;
  }
  if (error instanceof multer.MulterError) { res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "File exceeds upload limit" : error.message }); return; }
  if (error instanceof SyntaxError && "body" in error) { res.status(400).json({ error: "Malformed JSON request" }); return; }
  if (error instanceof Error && (error.message === "Unsupported attachment type" || error.message === "Attachment exceeds the upload limit")) {
    res.status(400).json({ error: error.message }); return;
  }
  if (error instanceof Error && error.message === "File content does not match the declared type") { res.status(400).json({ error: error.message }); return; }
  if (error instanceof Error && error.message === "Object storage is not configured") { res.status(503).json({ error: error.message }); return; }
  console.error("Request failed", error);
  res.status(500).json({ error: "Internal server error" });
});

async function issueSession(user: { id: string; username: string }, res: express.Response): Promise<string> {
  const refreshToken = createRefreshToken(user.id);
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { userId: user.id, tokenHash: digestToken(refreshToken), expiresAt } });
  res.cookie("refreshToken", refreshToken, { ...cookieOptions, maxAge: config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000 });
  return createAccessToken({ sub: user.id, username: user.username });
}

function publicUser(user: { id: string; username: string; displayName: string; email: string; avatarUrl: string | null; about: string }) {
  return { id: user.id, username: user.username, displayName: user.displayName, email: user.email, avatarUrl: user.avatarUrl, about: user.about };
}
