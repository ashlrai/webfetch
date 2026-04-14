/**
 * Outbound email — Resend adapter.
 *
 * Resend offers a free tier (100 emails/day, 3000/mo) which is plenty for
 * invite-grade traffic at launch. The SDK is imported lazily so unit tests
 * (which never set `RESEND_API_KEY`) don't pull the dependency.
 *
 * Failure policy: every send call is non-fatal. Callers must treat email
 * delivery as best-effort — the source-of-truth row (e.g. an `invitations`
 * record) is already persisted. If the provider is missing, we return
 * `{ skipped: "no-email-provider" }` so callers can surface a "pending
 * delivery" hint in the dashboard.
 */

import type { Env } from "./env.ts";

export interface SendInviteEmailInput {
  to: string;
  inviterName: string;
  workspaceName: string;
  acceptUrl: string;
}

export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string }
  | { skipped: "no-email-provider" };

/**
 * Optional injection seam used by tests. Production calls hit Resend via the
 * lazy import in `realResendClient`. Tests set `globalThis.__webfetchResend`
 * to a stub before invoking `sendInviteEmail`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResendLike = { emails: { send: (payload: any) => Promise<{ data?: { id: string } | null; error?: { message: string } | null }> } };

declare global {
  // eslint-disable-next-line no-var
  var __webfetchResend: ResendLike | undefined;
}

export async function sendInviteEmail(env: Env, input: SendInviteEmailInput): Promise<EmailResult> {
  if (!env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set; skipping invite delivery", {
      to: input.to,
      workspace: input.workspaceName,
    });
    return { skipped: "no-email-provider" };
  }
  const from = env.EMAIL_FROM || "webfetch <invites@webfetch.dev>";
  const subject = `${input.inviterName} invited you to ${input.workspaceName} on webfetch`;
  const { html, text } = renderInviteBodies(input);

  let client: ResendLike;
  try {
    client = await loadResend(env);
  } catch (e) {
    return { ok: false, error: `resend load failed: ${(e as Error).message}` };
  }

  try {
    const res = await client.emails.send({ from, to: input.to, subject, html, text });
    if (res.error) return { ok: false, error: res.error.message };
    return { ok: true, id: res.data?.id ?? "unknown" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function loadResend(env: Env): Promise<ResendLike> {
  if (globalThis.__webfetchResend) return globalThis.__webfetchResend;
  // Indirect specifier so TypeScript doesn't require the `resend` package at
  // typecheck time — it's an optional peer dep, only resolved at runtime when
  // RESEND_API_KEY is configured.
  const specifier = "resend";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(/* @vite-ignore */ specifier);
  const Resend = mod.Resend ?? mod.default ?? mod;
  return new Resend(env.RESEND_API_KEY) as ResendLike;
}

/** Render plain-text + HTML invite bodies. Kept side-effect free for tests. */
export function renderInviteBodies(input: SendInviteEmailInput): { html: string; text: string } {
  const { inviterName, workspaceName, acceptUrl } = input;
  const text = [
    `${inviterName} invited you to join the "${workspaceName}" workspace on webfetch.`,
    "",
    "Accept the invitation by opening the link below:",
    acceptUrl,
    "",
    "This invitation expires in 7 days. If you weren't expecting it, you can safely ignore this email.",
    "",
    "— The webfetch team",
  ].join("\n");

  const safeWorkspace = escapeHtml(workspaceName);
  const safeInviter = escapeHtml(inviterName);
  const safeUrl = escapeHtml(acceptUrl);
  const html = `<!doctype html><html><body style="font-family: -apple-system, system-ui, sans-serif; color: #111; max-width: 560px; margin: 0 auto; padding: 24px;">
<p>${safeInviter} invited you to join the <strong>${safeWorkspace}</strong> workspace on webfetch.</p>
<p><a href="${safeUrl}" style="display:inline-block; padding: 10px 16px; background:#111; color:#fff; text-decoration:none; border-radius:6px;">Accept invitation</a></p>
<p style="color:#555; font-size: 13px;">Or paste this URL into your browser:<br><a href="${safeUrl}">${safeUrl}</a></p>
<p style="color:#888; font-size: 12px;">This invitation expires in 7 days. If you weren't expecting it, you can safely ignore this email.</p>
<p style="color:#888; font-size: 12px;">— The webfetch team</p>
</body></html>`;
  return { html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
