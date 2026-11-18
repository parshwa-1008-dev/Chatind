import { describe, expect, it } from "vitest";
import { createConversationSchema, registerSchema, sendMessageSchema } from "./validation";

describe("request validation", () => {
  it("normalizes whitespace in registration fields and rejects unsafe usernames", () => {
    expect(registerSchema.safeParse({ username: "maya_1", email: "maya@example.test", password: "A-long-password!", displayName: " Maya " }).success).toBe(true);
    expect(registerSchema.safeParse({ username: "bad name", email: "maya@example.test", password: "A-long-password!", displayName: "Maya" }).success).toBe(false);
  });

  it("requires a title for group conversations and exactly one peer for direct chats", () => {
    expect(createConversationSchema.safeParse({ type: "GROUP", memberIds: ["user2"] }).success).toBe(false);
    expect(createConversationSchema.safeParse({ type: "DIRECT", memberIds: ["user2", "user3"] }).success).toBe(false);
    expect(createConversationSchema.safeParse({ type: "DIRECT", memberIds: ["user2"] }).success).toBe(true);
  });

  it("rejects empty or oversized messages", () => {
    expect(sendMessageSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ body: "hello" }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ body: "x".repeat(10001) }).success).toBe(false);
  });
});
