import { describe, test, expect } from "bun:test";
import { ulid, sha256Hex, constantTimeEq, requestId } from "../src/ids.ts";

describe("ids", () => {
  test("ulid is 26 chars, base32, monotonic-ish by time", () => {
    const a = ulid(1_000_000);
    const b = ulid(1_000_001);
    expect(a).toHaveLength(26);
    expect(b).toHaveLength(26);
    expect(a < b).toBe(true);
  });

  test("ulid is unique across many calls", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(ulid());
    expect(set.size).toBe(1000);
  });

  test("sha256Hex matches a known input", async () => {
    const h = await sha256Hex("hello");
    expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  test("constantTimeEq distinguishes length and content", () => {
    expect(constantTimeEq("abc", "abc")).toBe(true);
    expect(constantTimeEq("abc", "abd")).toBe(false);
    expect(constantTimeEq("ab", "abc")).toBe(false);
  });

  test("requestId is non-empty and 26 chars", () => {
    const r = requestId();
    expect(r).toHaveLength(26);
  });
});
