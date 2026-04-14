import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { app } from "../src/index.ts";
import { makeEnv, makeExecCtx, seedWorkspaceWithKey } from "./harness.ts";
import { sendInviteEmail, renderInviteBodies } from "../src/email.ts";
import { SESSION_COOKIE } from "../src/auth.ts";

const cookie = (t: string) => `${SESSION_COOKIE}=${encodeURIComponent(t)}`;

describe("email — invite delivery", () => {
  beforeEach(() => {
    delete (globalThis as { __webfetchResend?: unknown }).__webfetchResend;
  });
  afterEach(() => {
    delete (globalThis as { __webfetchResend?: unknown }).__webfetchResend;
  });

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

  test("sendInviteEmail returns skipped when RESEND_API_KEY is absent", async () => {
    const { env } = makeEnv();
    const res = await sendInviteEmail(env, {
      to: "x@y.dev",
      inviterName: "Ada",
      workspaceName: "Acme",
      acceptUrl: "https://app.test/invite/abc",
    });
    expect("skipped" in res && res.skipped).toBe("no-email-provider");
  });

  test("sendInviteEmail calls Resend with correct payload", async () => {
    const sent: unknown[] = [];
    (globalThis as { __webfetchResend?: unknown }).__webfetchResend = {
      emails: {
        async send(payload: unknown) {
          sent.push(payload);
          return { data: { id: "re_abc123" }, error: null };
        },
      },
    };
    const { env } = makeEnv({ RESEND_API_KEY: "re_test_key" });
    const res = await sendInviteEmail(env, {
      to: "x@y.dev",
      inviterName: "Ada",
      workspaceName: "Acme",
      acceptUrl: "https://app.test/invite/abc",
    });
    expect("ok" in res && res.ok).toBe(true);
    if ("ok" in res && res.ok) expect(res.id).toBe("re_abc123");
    expect(sent).toHaveLength(1);
    const p = sent[0] as { to: string; subject: string; html: string; text: string; from: string };
    expect(p.to).toBe("x@y.dev");
    expect(p.subject).toContain("Acme");
    expect(p.subject).toContain("Ada");
    expect(p.html).toContain("https://app.test/invite/abc");
    expect(p.text).toContain("https://app.test/invite/abc");
    expect(p.from).toContain("@");
  });

  test("sendInviteEmail surfaces provider errors as non-fatal failure result", async () => {
    (globalThis as { __webfetchResend?: unknown }).__webfetchResend = {
      emails: {
        async send() {
          throw new Error("boom");
        },
      },
    };
    const { env } = makeEnv({ RESEND_API_KEY: "re_test_key" });
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
    (globalThis as { __webfetchResend?: unknown }).__webfetchResend = {
      emails: {
        async send() {
          throw new Error("simulated provider outage");
        },
      },
    };
    const { env } = makeEnv({ RESEND_API_KEY: "re_test_key" });
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
    const body = await res.json() as { data: { acceptUrl: string; emailDelivery: { status: string } } };
    expect(body.data.acceptUrl).toContain("/invite/");
    expect(body.data.emailDelivery.status).toBe("failed");
    const row = await env.DB.prepare(
      `SELECT email FROM invitations WHERE workspace_id = ?1`,
    ).bind(workspaceId).first<{ email: string }>();
    expect(row?.email).toBe("fail@test.dev");
  });

  test("invite endpoint reports emailDelivery.sent on success", async () => {
    (globalThis as { __webfetchResend?: unknown }).__webfetchResend = {
      emails: {
        async send() {
          return { data: { id: "re_ok_1" }, error: null };
        },
      },
    };
    const { env } = makeEnv({ RESEND_API_KEY: "re_test_key" });
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
    const body = await res.json() as { data: { emailDelivery: { status: string; id?: string } } };
    expect(body.data.emailDelivery.status).toBe("sent");
    expect(body.data.emailDelivery.id).toBe("re_ok_1");
  });
});
