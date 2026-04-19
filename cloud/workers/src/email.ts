/**
 * Outbound email — SendGrid adapter (raw fetch, no SDK).
 *
 * SendGrid offers a free tier (100 emails/day) which is plenty for invite-grade
 * traffic at launch. We hit `POST /v3/mail/send` directly so the bundle stays
 * small (no `@sendgrid/mail` dep) and Workers cold-starts stay fast.
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

export interface EmailPayload {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface EmailDispatcher {
  send(payload: EmailPayload): Promise<EmailResult>;
}

declare global {
  // eslint-disable-next-line no-var
  var __webfetchEmail: EmailDispatcher | undefined;
}

export async function sendInviteEmail(env: Env, input: SendInviteEmailInput): Promise<EmailResult> {
  const dispatcher = resolveDispatcher(env);
  if (!dispatcher) {
    console.warn("[email] SENDGRID_API_KEY not set; skipping invite delivery", {
      to: input.to,
      workspace: input.workspaceName,
    });
    return { skipped: "no-email-provider" };
  }
  const from = env.EMAIL_FROM || "webfetch <support@ashlr.ai>";
  const subject = `${input.inviterName} invited you to ${input.workspaceName} on webfetch`;
  const { html, text } = renderInviteBodies(input);
  return dispatcher.send({ from, to: input.to, subject, html, text, replyTo: env.REPLY_TO });
}

function resolveDispatcher(env: Env): EmailDispatcher | null {
  if (globalThis.__webfetchEmail) return globalThis.__webfetchEmail;
  if (!env.SENDGRID_API_KEY) return null;
  return sendgridDispatcher(env.SENDGRID_API_KEY);
}

function sendgridDispatcher(apiKey: string): EmailDispatcher {
  return {
    async send(payload) {
      try {
        const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: payload.to }] }],
            from: parseFromAddress(payload.from),
            ...(payload.replyTo ? { reply_to: parseFromAddress(payload.replyTo) } : {}),
            subject: payload.subject,
            content: [
              { type: "text/plain", value: payload.text },
              { type: "text/html", value: payload.html },
            ],
          }),
        });
        if (res.status === 202) {
          return { ok: true, id: res.headers.get("x-message-id") ?? "sendgrid_accepted" };
        }
        const body = await res.text();
        return { ok: false, error: `sendgrid_${res.status}: ${body.slice(0, 200)}` };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  };
}

// SendGrid wants `from` as `{ email, name? }`. EMAIL_FROM is stored in the
// human-readable "Name <addr@host>" form (RFC 5322); parse it.
function parseFromAddress(value: string): { email: string; name?: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (m) {
    const name = (m[1] ?? "").trim();
    const email = m[2] ?? "";
    return name ? { email, name } : { email };
  }
  return { email: value.trim() };
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

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render plain-text + HTML welcome bodies. Side-effect free for tests. */
export function renderWelcomeBodies(input: { name?: string }): { html: string; text: string } {
  const greeting = input.name ? `Hey ${input.name},` : "Hey,";
  const safeGreeting = input.name ? `Hey ${escapeHtml(input.name)},` : "Hey,";
  const text = [
    greeting,
    "",
    "Your free webfetch account is live.",
    "",
    "What you get on the free tier:",
    "  • 100 fetches/day",
    "  • 24 licensed content providers",
    "  • All content fully licensed — no legal grey areas",
    "",
    "Docs:      https://getwebfetch.com/docs",
    "Dashboard: https://app.getwebfetch.com",
    "",
    "Every response includes an attribution header pointing back to the original source. That's the deal that keeps the content flowing.",
    "",
    "— the webfetch team",
  ].join("\n");

  const html = `<!doctype html><html><body style="font-family: -apple-system, system-ui, sans-serif; color: #111; max-width: 560px; margin: 0 auto; padding: 24px;">
<p>${safeGreeting}</p>
<p>Your free webfetch account is live.</p>
<p><strong>What you get on the free tier:</strong></p>
<ul style="padding-left: 20px;">
  <li>100 fetches/day</li>
  <li>24 licensed content providers</li>
  <li>All content fully licensed — no legal grey areas</li>
</ul>
<p>
  <a href="https://app.getwebfetch.com" style="display:inline-block; padding: 10px 16px; background:#111; color:#fff; text-decoration:none; border-radius:6px;">Open dashboard</a>
</p>
<p style="color:#555; font-size: 13px;">Explore the docs at <a href="https://getwebfetch.com/docs">https://getwebfetch.com/docs</a>.</p>
<p style="color:#888; font-size: 12px;">Every response includes an attribution header pointing back to the original source. That's the deal that keeps the content flowing.</p>
<p style="color:#888; font-size: 12px;">— the webfetch team</p>
</body></html>`;
  return { html, text };
}

export async function sendWelcomeEmail(
  env: Env,
  input: { to: string; name?: string },
): Promise<EmailResult> {
  const dispatcher = resolveDispatcher(env);
  if (!dispatcher) {
    console.warn("[email] SENDGRID_API_KEY not set; skipping welcome delivery", { to: input.to });
    return { skipped: "no-email-provider" };
  }
  const from = env.EMAIL_FROM || "webfetch <support@ashlr.ai>";
  const subject = "Welcome to webfetch — your free tier is live";
  const { html, text } = renderWelcomeBodies(input);
  return dispatcher.send({ from, to: input.to, subject, html, text, replyTo: env.REPLY_TO });
}
