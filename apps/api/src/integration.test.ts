import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("./storage", () => ({
  storeUpload: vi.fn(async () => ({ key: "integration-test.pdf", url: "https://storage.example.test/signed-upload" })),
  createDownloadUrl: vi.fn(async () => "https://storage.example.test/signed-download"),
  removeUpload: vi.fn(async () => undefined),
}));

import { app } from "./app";
import { prisma } from "./prisma";

type TestAccount = { id: string; username: string; accessToken: string };

const enabled = process.env.RUN_DB_INTEGRATION === "true";
describe.skipIf(!enabled)("PostgreSQL API integration", () => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const accounts: TestAccount[] = [];

  beforeAll(async () => {
    for (const [index, displayName] of ["Avery", "Blair", "Casey"].entries()) {
      const username = `test${suffix}${index}`;
      const response = await request(app).post("/api/auth/register").send({
        username,
        email: `${username}@example.test`,
        password: "IntegrationPassword123!",
        displayName,
      });
      expect(response.status).toBe(201);
      accounts.push({ id: response.body.user.id, username, accessToken: response.body.accessToken });
    }
  });

  afterAll(async () => {
    if (accounts.length) await prisma.user.deleteMany({ where: { id: { in: accounts.map((account) => account.id) } } });
  });

  it("registers and logs in, creates direct/group chats, enforces membership, sends messages and uploads", async () => {
    const [avery, blair, casey] = accounts;
    const login = await request(app).post("/api/auth/login").send({
      username: avery.username,
      password: "IntegrationPassword123!",
    });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeTruthy();

    const direct = await request(app).post("/api/conversations")
      .set("Authorization", `Bearer ${avery.accessToken}`)
      .send({ type: "DIRECT", memberIds: [blair.id] });
    expect(direct.status).toBe(201);
    const directId = direct.body.conversation.id as string;

    const sent = await request(app).post(`/api/conversations/${directId}/messages`)
      .set("Authorization", `Bearer ${avery.accessToken}`)
      .send({ body: "Integration message" });
    expect(sent.status).toBe(201);

    const received = await request(app).get(`/api/conversations/${directId}/messages`)
      .set("Authorization", `Bearer ${blair.accessToken}`);
    expect(received.status).toBe(200);
    expect(received.body.messages.map((message: { body: string }) => message.body)).toContain("Integration message");

    const denied = await request(app).get(`/api/conversations/${directId}/messages`)
      .set("Authorization", `Bearer ${casey.accessToken}`);
    expect(denied.status).toBe(404);

    const group = await request(app).post("/api/conversations")
      .set("Authorization", `Bearer ${avery.accessToken}`)
      .send({ type: "GROUP", title: "Integration group", memberIds: [blair.id, casey.id] });
    expect(group.status).toBe(201);
    expect(group.body.conversation.members).toHaveLength(3);

    const upload = await request(app).post("/api/uploads")
      .set("Authorization", `Bearer ${avery.accessToken}`)
      .field("conversationId", directId)
      .attach("file", Buffer.from("%PDF-1.7\n"), { filename: "note.pdf", contentType: "application/pdf" });
    expect(upload.status).toBe(201);
    expect(upload.body.message.attachments[0].url).toBe("https://storage.example.test/signed-download");
  });
});
