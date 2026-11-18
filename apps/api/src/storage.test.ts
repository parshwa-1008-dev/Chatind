import { describe, expect, it } from "vitest";
import { validateFileBytes } from "./storage";

describe("attachment signature validation", () => {
  it("accepts a PDF signature and rejects content-type spoofing", () => {
    expect(() => validateFileBytes("application/pdf", Buffer.from("%PDF-1.7"))).not.toThrow();
    expect(() => validateFileBytes("application/pdf", Buffer.from("<html>"))).toThrow(/does not match/i);
  });

  it("accepts valid PNG headers and rejects unknown upload types", () => {
    expect(() => validateFileBytes("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).not.toThrow();
    expect(() => validateFileBytes("application/x-msdownload", Buffer.from("MZ"))).toThrow(/does not match/i);
  });
});
