import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./app";

describe("HTTP boundary", () => {
  it("reports service health without opening a database connection", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("rejects conversation access without a valid access token", async () => {
    const response = await request(app).get("/api/conversations");
    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/authentication required/i);
  });
});
