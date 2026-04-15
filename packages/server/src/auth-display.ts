/**
 * Minimal HTML page served at GET /auth/display that shows the current token
 * and a "Copy token" button. Used as a UX shortcut so the user doesn't need
 * to tail the server stdout to find the token.
 *
 * The page itself is NOT protected by the Bearer check (it only exposes the
 * same token that the server already wrote to ~/.webfetch/server.token on
 * boot; binding is 127.0.0.1 only). If you're running on a shared host
 * you should pass --no-open and skip this page.
 */

export function renderAuthDisplay(token: string, port: number): string {
  const safe = escapeHtml(token);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>webfetch server token</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, sans-serif; }
  body { min-height: 100vh; display: grid; place-items: center; background: #0b0d10; color: #eceff3; }
  main { max-width: 560px; padding: 32px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; letter-spacing: .01em; }
  p { color: #9aa3af; margin: 0 0 20px; font-size: 13px; line-height: 1.5; }
  code { display: block; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
         background: #14181d; border: 1px solid #1f252d; border-radius: 8px; padding: 12px;
         word-break: break-all; user-select: all; margin-bottom: 16px; }
  button { width: 100%; padding: 14px; border-radius: 8px; border: 0;
           background: #3b82f6; color: white; font-weight: 600; font-size: 14px;
           cursor: pointer; }
  button:active { background: #2563eb; }
  .ok { color: #34d399; font-size: 12px; margin-top: 10px; height: 14px; }
  .meta { margin-top: 24px; font-size: 11px; color: #6b7280; }
</style>
</head>
<body>
<main>
  <h1>webfetch server token</h1>
  <p>Paste this into the webfetch extension options, or keep this tab open and click the button below. The server is bound to <strong>127.0.0.1:${port}</strong>.</p>
  <code id="tok">${safe}</code>
  <button id="copy">Copy token</button>
  <div class="ok" id="ok"></div>
  <div class="meta">Token is also written to <code style="display:inline;border:0;padding:0;background:transparent">~/.webfetch/server.token</code>.</div>
</main>
<script>
  const btn = document.getElementById("copy");
  const ok = document.getElementById("ok");
  const tok = ${JSON.stringify(token)};
  btn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(tok); ok.textContent = "Copied to clipboard."; }
    catch { ok.textContent = "Clipboard blocked — select the token above manually."; }
  });
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

export function tryOpenBrowser(url: string): void {
  try {
    const cmd =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    Bun.spawn([cmd, ...args], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // best-effort — ignore failures
  }
}
