import { z } from "zod";

export const registerSchema = z.object({
  username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(128),
  displayName: z.string().trim().min(1).max(80),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});

export const createConversationSchema = z.object({
  type: z.enum(["DIRECT", "GROUP"]),
  title: z.string().trim().min(1).max(80).optional(),
  memberIds: z.array(z.string().min(1)).min(1).max(99),
}).superRefine((value, ctx) => {
  if (value.type === "GROUP" && !value.title) ctx.addIssue({ code: "custom", path: ["title"], message: "Group title is required" });
  if (value.type === "DIRECT" && value.memberIds.length !== 1) ctx.addIssue({ code: "custom", path: ["memberIds"], message: "Direct chats require one other member" });
});

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  type: z.enum(["TEXT", "IMAGE", "VIDEO", "AUDIO", "DOCUMENT"]).default("TEXT"),
  replyToId: z.string().optional(),
});
