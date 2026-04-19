import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SESSION_COOKIE } from "../src/auth.ts";
import type { EmailDispatcher } from "../src/email.ts";
import { renderInviteBodies, sendInviteEmail } from "../src/email.ts";
import { app } from "../src/index.ts";
import { makeEnv, makeExecCtx, seedWorkspaceWithKey } from "./harness.ts";

const cookie = (t: string) => `${SESSION_COOKIE}=${encodeURIComponent(t)}`;

const setStub = (d: EmailDispatcher | undefined) => {
  (globalThis as { __webfetchEmail?: EmailDispatcher }).__webfetchEmail = d;
};

describe("email — invite delivery", () => {
  beforeEach(() => setStub(undefined));
  afterEach(() => setStub(undefined));

  test("renderInviteBodies includes accept URL + escapes HTML", () => {
    const { html, text } = renderInviteBodies({
      to: "x@y.dev",
      inviterName: "Ada <hi>",
      workspaceName: "Acme & Co",
      acceptUrl: "https://app.test/invite/abc",
    });
    expect(text).toContain("https://app.test/invite/abc");
    expect(text).toContain("Acme & Co");
    expect(html).toContain("Acme &amp; Co");
    expect(html).toContain("Ada &lt;hi&gt;");
    expect(html).toContain("https://app.test/invite/abc");
  });

  test("sendInviteEmail returns skipped when SENDGRID_API_KEY is absent", async () => {
    const { env } = makeEnv();
    const res = await sendInviteEmail(env, {
      to: "x@y.dev",
      inviterName: "Ada",
      workspaceName: "Acme",
      acceptUrl: "https://app.test/invite/abc",
    });
    expect("skipped" in res && res.skipped).toBe("no-email-provider");
  });

  test("sendInviteEmail dispatches with the expected payload shape", async () => {
    const sent: unknown[] = [];
    setStub({
      async send(payload) {
        sent.push(payload);
        return { ok: true, id: "msg_abc123" };
      },
    });
    const { env } = makeEnv({ SENDGRID_API_KEY: "SG.test_key" });
    const res = await sendInviteEmail(env, {
      to: "x@y.dev",
      inviterName: "Ada",
      workspaceName: "Acme",
      acceptUrl: "https://app.test/invite/abc",
    });
    expect("ok" in res && res.ok).toBe(true);
    if ("ok" in res && res.ok) expect(res.id).toBe("msg_abc123");
    expect(sent).toHaveLength(1);
    const p = sent[0] as { to: string; subject: string; html: string; text: string; from: string };
    expect(p.to).toBe("x@y.dev");
    expect(p.subject).toContain("Acme");
    expect(p.subject).toContain("Ada");
    expect(p.html).toContain("https://app.test/invite/abc");
    expect(p.text).toContain("https://app.test/invite/abc");
    expect(p.from).toContain("@");
  });

  test("sendInviteEmail surfaces dispatcher errors as non-fatal failure result", async () => {
    setStub({
      async send() {
        return { ok: false, error: "boom" };
      },
    });
    const { env } = makeEnv({ SENDGRID_API_KEY: "SG.test_key" });
    const res = await sendInviteEmail(env, {
      to: "x@y.dev",
      inviterName: "Ada",
      workspaceName: "Acme",
      acceptUrl: "https://app.test/invite/abc",
    });
    expect("ok" in res && res.ok).toBeFalsy();
    if ("error" in res) expect(res.error).toContain("boom");
  });

  test("invite endpoint stays 201 + persists row when email provider fails", async () => {
    setStub({
      async send() {
        return { ok: false, error: "simulated provider outage" };
      },
    });
    const { env } = makeEnv({ SENDGRID_API_KEY: "SG.test_key" });
    const { sessionToken, workspaceId } = await seedWorkspaceWithKey(env);
    const res = await app.fetch(
      new Request(`http://x/v1/workspaces/${workspaceId}/invite`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie(sessionToken) },
        body: JSON.stringify({ email: "fail@test.dev", role: "member" }),
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { acceptUrl: string; emailDelivery: { status: string } };
    };
    expect(body.data.acceptUrl).toContain("/invite/");
    expect(body.data.emailDelivery.status).toBe("failed");
    const row = await env.DB.prepare("SELECT email FROM invitations WHERE workspace_id = ?1")
      .bind(workspaceId)
      .first<{ email: string }>();
    expect(row?.email).toBe("fail@test.dev");
  });

  test("invite endpoint reports emailDelivery.sent on success", async () => {
    setStub({
      async send() {
        return { ok: true, id: "msg_ok_1" };
      },
    });
    const { env } = makeEnv({ SENDGRID_API_KEY: "SG.test_key" });
    const { sessionToken, workspaceId } = await seedWorkspaceWithKey(env);
    const res = await app.fetch(
      new Request(`http://x/v1/workspaces/${workspaceId}/invite`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie(sessionToken) },
        body: JSON.stringify({ email: "ok@test.dev", role: "member" }),
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { emailDelivery: { status: string; id?: string } } };
    expect(body.data.emailDelivery.status).toBe("sent");
    expect(body.data.emailDelivery.id).toBe("msg_ok_1");
  });
});
