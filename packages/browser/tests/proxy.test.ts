import { describe, expect, it } from "bun:test";

import { brightdataRotatedUser } from "../src/proxy.ts";
import { formatProxy } from "../src/proxy.ts";

describe("formatProxy", () => {
  it("prepends http:// to bare host:port", () => {
    const p = formatProxy({
      kind: "custom",
      endpoint: "proxy.example.com:8080",
      user: "u",
      pass: "p",
    });
    expect(p.server).toBe("http://proxy.example.com:8080");
    expect(p.username).toBe("u");
    expect(p.password).toBe("p");
  });

  it("preserves existing scheme", () => {
    const p = formatProxy({
      kind: "brightdata",
      endpoint: "https://brd.superproxy.io:22225",
    });
    expect(p.server).toBe("https://brd.superproxy.io:22225");
  });
});

describe("brightdataRotatedUser", () => {
  it("appends a session tag", () => {
    const u = brightdataRotatedUser("brd-customer-x-zone-residential");
    expect(u).toMatch(/^brd-customer-x-zone-residential-session-rand\d+$/);
  });

  it("replaces an existing session tag", () => {
    const u = brightdataRotatedUser("brd-customer-x-zone-residential-session-rand9");
    expect(u).toMatch(/-session-rand\d+$/);
    expect(u).not.toContain("rand9-");
  });
});
