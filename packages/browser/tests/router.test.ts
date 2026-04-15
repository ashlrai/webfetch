import { describe, expect, it } from "bun:test";

import { pickStack } from "../src/index.ts";

describe("router.pickStack", () => {
  it("respects explicit opts.stack", async () => {
    const id = await pickStack(
      { userConsent: true, stack: "camoufox" },
      { env: {}, hasModule: async () => false },
    );
    expect(id).toBe("camoufox");
  });

  it("prefers brightdata when env credentials present", async () => {
    const id = await pickStack(
      { userConsent: true },
      {
        env: {
          BRIGHTDATA_CUSTOMER: "cust1",
          BRIGHTDATA_PASSWORD: "pw1",
        },
        hasModule: async () => true,
      },
    );
    expect(id).toBe("brightdata");
  });

  it("falls back to rebrowser when installed and no brightdata env", async () => {
    const id = await pickStack(
      { userConsent: true },
      {
        env: {},
        hasModule: async (n) => n === "rebrowser-playwright",
      },
    );
    expect(id).toBe("rebrowser");
  });

  it("falls back to vanilla when only playwright is installed", async () => {
    const id = await pickStack(
      { userConsent: true },
      {
        env: {},
        hasModule: async (n) => n === "playwright",
      },
    );
    expect(id).toBe("vanilla");
  });

  it("throws when no stack is available", async () => {
    await expect(
      pickStack({ userConsent: true }, { env: {}, hasModule: async () => false }),
    ).rejects.toThrow(/playwright/);
  });
});
