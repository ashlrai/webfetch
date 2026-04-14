/**
 * The typed client honours USE_FIXTURES. We set the env var *before* importing
 * the module under test so `env.ts` captures the right value.
 */
import { describe, expect, test } from "bun:test";

process.env.NEXT_PUBLIC_USE_FIXTURES = "1";

const { getOverview, listKeys, createKey, getBilling, getProviders, hintForStatus } = await import(
  "../src/lib/api"
);

describe("api client (fixtures)", () => {
  test("getOverview returns a shaped payload", async () => {
    const o = await getOverview();
    expect(o.user.email).toContain("@");
    expect(o.workspace.slug.length).toBeGreaterThan(0);
    expect(o.dailySeries.length).toBe(30);
  });

  test("listKeys + createKey round-trip", async () => {
    const before = await listKeys();
    const { key, raw } = await createKey("Test CI", "workspace");
    expect(key.name).toBe("Test CI");
    expect(raw).toContain(key.prefix);
    // create doesn't mutate fixtures; length stays the same.
    const after = await listKeys();
    expect(after.length).toBe(before.length);
  });

  test("getBilling returns a subscription snapshot", async () => {
    const b = await getBilling();
    expect(b.plan).toBeTruthy();
    expect(b.status).toBeTruthy();
  });

  test("getProviders returns the 19 providers", async () => {
    const p = await getProviders();
    expect(p.length).toBe(19);
  });

  test("hintForStatus maps 401/402/429", () => {
    expect(hintForStatus(401)).toContain("Sign in");
    expect(hintForStatus(402)).toContain("Upgrade");
    expect(hintForStatus(429)).toContain("Rate");
    expect(hintForStatus(200)).toBeNull();
  });
});
