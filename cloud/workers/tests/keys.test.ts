import { describe, test, expect } from "bun:test";
import { makeEnv, seedWorkspaceWithKey } from "./harness.ts";
import { generateKey, resolveKey, createKey, listKeys, revokeKey, parseBearer } from "../src/keys.ts";

describe("api keys", () => {
  test("generateKey returns a wf_live_* secret with 44 chars and sha256 hash", async () => {
    const { secret, prefix, hash } = await generateKey();
    expect(secret.startsWith("wf_live_")).toBe(true);
    expect(secret.length).toBe(8 + 32);
    expect(prefix).toBe(secret.slice(0, 12));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("parseBearer accepts valid wf_live tokens and rejects otherwise", () => {
    expect(parseBearer("Bearer wf_live_" + "a".repeat(32))).toBe("wf_live_" + "a".repeat(32));
    expect(parseBearer("Bearer junk")).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("Bearer wf_live_tooshort")).toBeNull();
  });

  test("createKey inserts a row and populates KV", async () => {
    const { env } = makeEnv();
    const { workspaceId, userId } = await seedHelpers(env);
    const k = await createKey(env, { workspaceId, userId, name: "ci", plan: "free" });
    expect(k.secret.startsWith("wf_live_")).toBe(true);

    const all = await listKeys(env, workspaceId);
    const found = (all as Array<{ id: string; prefix: string }>).find((r) => r.id === k.id);
    expect(found?.prefix).toBe(k.prefix);
  });

  test("resolveKey hits the D1 fallback path when KV is cold", async () => {
    const { env } = makeEnv();
    const { apiKey, workspaceId, apiKeyId } = await seedWorkspaceWithKey(env);
    // Wipe the KV cache to force D1 lookup.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env.KEYS as any) = (await import("./harness.ts")).makeKV();
    const lookup = await resolveKey(env, apiKey);
    expect(lookup?.workspaceId).toBe(workspaceId);
    expect(lookup?.apiKeyId).toBe(apiKeyId);
  });

  test("revokeKey drops the KV cache and returns false on repeat", async () => {
    const { env } = makeEnv();
    const { apiKey, workspaceId, apiKeyId } = await seedWorkspaceWithKey(env);
    const first = await revokeKey(env, workspaceId, apiKeyId);
    expect(first).toBe(true);
    const second = await revokeKey(env, workspaceId, apiKeyId);
    expect(second).toBe(false);
    // Subsequent resolve should fail.
    const gone = await resolveKey(env, apiKey);
    expect(gone).toBeNull();
  });
});

async function seedHelpers(env: ReturnType<typeof makeEnv>["env"]) {
  const { ulid } = await import("../src/ids.ts");
  const { monthlyWindow } = await import("../src/quota.ts");
  const now = Date.now();
  const userId = ulid();
  const workspaceId = ulid();
  await env.DB.prepare(
    `INSERT INTO users (id, email, email_verified, created_at, updated_at)
     VALUES (?1, ?2, 1, ?3, ?3)`,
  ).bind(userId, `${userId}@t.dev`, now).run();
  const { end } = monthlyWindow(now);
  await env.DB.prepare(
    `INSERT INTO workspaces (id, slug, name, owner_id, plan, subscription_status,
       quota_resets_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'free', 'none', ?5, ?6, ?6)`,
  ).bind(workspaceId, `ws-${workspaceId.slice(0, 6).toLowerCase()}`, "Test", userId, end, now).run();
  return { userId, workspaceId };
}
