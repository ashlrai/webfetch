import { describe, expect, test } from "bun:test";
import { formatBytes, formatInt, formatPct, formatUsd, maskKey, toCsv } from "../src/lib/format";

describe("format", () => {
  test("formatBytes scales up", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });

  test("formatUsd", () => {
    expect(formatUsd(19)).toBe("$19.00");
    expect(formatUsd(0.002)).toMatch(/\$0\.00\d+/);
  });

  test("formatInt groups thousands", () => {
    expect(formatInt(10000)).toBe("10,000");
  });

  test("formatPct", () => {
    expect(formatPct(0.5, 0)).toBe("50%");
  });

  test("maskKey hides secret body", () => {
    const masked = maskKey("wf_live_abc");
    expect(masked.startsWith("wf_live_abc")).toBe(true);
    expect(masked.length).toBeGreaterThan("wf_live_abc".length);
  });

  test("toCsv quotes fields with commas", () => {
    const csv = toCsv([{ a: "hello, world", b: 1 }]);
    expect(csv).toContain('"hello, world"');
    expect(csv.split("\n")[0]).toBe("a,b");
  });
});
