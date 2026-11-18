import { afterEach, describe, expect, it, vi } from "vitest";
import { api, getAccessToken, setAccessToken } from "./api";

afterEach(() => {
  setAccessToken(null);
  vi.unstubAllGlobals();
});

describe("web API client", () => {
  it("sends the in-memory access token and includes refresh cookies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ value: 7 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setAccessToken("access-token");

    await expect(api<{ value: number }>("/auth/me")).resolves.toEqual({ value: 7 });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer access-token");
    expect(init.credentials).toBe("include");
  });

  it("rotates an expired access token and retries the original request once", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: "rotated-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api<{ value: string }>("/auth/me")).resolves.toEqual({ value: "ok" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getAccessToken()).toBe("rotated-token");
    const [, retry] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(new Headers(retry.headers).get("Authorization")).toBe("Bearer rotated-token");
  });

  it("surfaces API errors to the interface", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Database unavailable" }), { status: 503 }),
    ));

    await expect(api("/auth/login", { method: "POST", body: "{}" })).rejects.toThrow("Database unavailable");
  });
});
