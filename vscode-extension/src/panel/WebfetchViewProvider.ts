/**
 * Side-panel webview. Owns the search UI and brokers all REST traffic so the
 * API key never leaves the extension host. Messages in both directions are
 * typed via `WebviewOutbound` / `WebviewInbound` in ../types.ts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  buildMarkdownInsertion,
  buildXmpSidecar,
  mimeToExt,
  slugForFilename,
} from "../lib/attribution";
import { fetchImageBytes, getProviders, search } from "../lib/client";
import { loadSettings } from "../lib/settings";
import { StatusBar } from "../lib/status";
import type { ImageCandidate, InitialConfig, WebviewInbound, WebviewOutbound } from "../types";

export class WebfetchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "webfetch.sidePanel";

  private view?: vscode.WebviewView;
  private pendingFocus?: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly status: StatusBar,
  ) {}

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "out"),
        vscode.Uri.joinPath(this.context.extensionUri, "src", "panel"),
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    };
    webviewView.webview.html = await this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewOutbound) => {
      try {
        await this.onMessage(msg);
      } catch (e: any) {
        vscode.window.showErrorMessage(`webfetch: ${e?.message ?? "internal error"}`);
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) void this.pushHello();
    });
  }

  /** Focus the panel and pre-fill the search field. */
  async focusSearch(query?: string): Promise<void> {
    this.pendingFocus = query;
    await vscode.commands.executeCommand("webfetch.sidePanel.focus");
    if (this.view) {
      this.post({ type: "focusSearch", query });
    }
  }

  private async onMessage(msg: WebviewOutbound): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.pushHello();
        if (this.pendingFocus !== undefined) {
          this.post({ type: "focusSearch", query: this.pendingFocus });
          this.pendingFocus = undefined;
        }
        return;
      case "search": {
        const res = await search(this.context, {
          query: msg.query,
          licensePolicy: msg.policy,
          providers: msg.providers.length ? msg.providers : undefined,
        });
        if (res.ok && res.data) {
          this.post({ type: "searchResult", result: res.data });
          this.status.setReady();
        } else {
          this.post({ type: "searchError", error: res.error ?? "search failed" });
          if (res.status === 401 || res.status === 403) this.status.setNeedsKey();
          else if (res.status !== 0) this.status.setOffline(res.error ?? "unknown");
        }
        return;
      }
      case "download":
      case "insert": {
        await this.downloadAndInsert(msg.candidate, msg.alt, msg.type === "insert");
        return;
      }
      case "openExternal":
        await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        return;
      case "setApiKey":
        await vscode.commands.executeCommand("webfetch.setApiKey");
        return;
      case "openDashboard":
        await vscode.commands.executeCommand("webfetch.openDashboard");
        return;
      case "refreshProviders": {
        const r = await getProviders(this.context);
        if (r.ok && r.data) this.post({ type: "providers", providers: r.data });
        return;
      }
      case "dragStart":
        // Drag bytes are handled by the drop controller in extension.ts; this
        // message is informational (analytics hook).
        return;
    }
  }

  private async pushHello(): Promise<void> {
    const s = await loadSettings(this.context);
    let all: string[] = [];
    if (s.apiKey) {
      const pr = await getProviders(this.context);
      if (pr.ok && pr.data) all = pr.data.all;
    }
    const config: InitialConfig = {
      baseUrl: s.baseUrl,
      hasApiKey: !!s.apiKey,
      defaultLicense: s.defaultLicense,
      defaultProviders: s.defaultProviders,
      allProviders: all,
    };
    this.post({ type: "hello", config });
  }

  private post(msg: WebviewInbound): void {
    this.view?.webview.postMessage(msg);
  }

  /**
   * Download the image into the workspace's output dir (creating it if
   * needed), optionally write an XMP sidecar, and optionally insert an
   * `![alt](path)` snippet at the active editor's cursor.
   */
  private async downloadAndInsert(
    candidate: ImageCandidate,
    altOverride: string | undefined,
    insertAtCursor: boolean,
  ): Promise<void> {
    const s = await loadSettings(this.context);
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      vscode.window.showWarningMessage("webfetch: open a workspace folder before saving images.");
      return;
    }
    const outDir = path.isAbsolute(s.outputDir)
      ? s.outputDir
      : path.join(folder.uri.fsPath, s.outputDir);
    await fs.mkdir(outDir, { recursive: true });

    const { bytes, mime } = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `webfetch: downloading ${candidate.source}…`,
      },
      async () => fetchImageBytes(candidate.url),
    );
    const ext = mimeToExt(candidate.mime ?? mime, candidate.url);
    const base = slugForFilename(candidate.title ?? candidate.author ?? "image");
    const unique = shortHash(candidate.url);
    const filename = `${base}-${unique}${ext}`;
    const filePath = path.join(outDir, filename);
    await fs.writeFile(filePath, bytes);

    if (s.writeXmpSidecar) {
      await fs.writeFile(`${filePath}.xmp`, buildXmpSidecar(candidate), "utf8");
    }

    const relativePath = path.relative(folder.uri.fsPath, filePath).replace(/\\/g, "/");

    if (insertAtCursor) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const snippetPath = relativeToEditor(editor, filePath) ?? relativePath;
        const snippet = buildMarkdownInsertion(candidate, {
          relativePath: snippetPath,
          alt: altOverride ?? candidate.title ?? "",
          attributionStyle: s.attributionStyle,
        });
        await editor.edit((edit) => edit.insert(editor.selection.active, snippet));
      } else {
        await vscode.env.clipboard.writeText(
          buildMarkdownInsertion(candidate, {
            relativePath,
            alt: altOverride ?? candidate.title ?? "",
            attributionStyle: s.attributionStyle,
          }),
        );
        vscode.window.showInformationMessage(
          "webfetch: no active editor — markdown snippet copied to clipboard.",
        );
      }
    }

    this.post({ type: "inserted", relativePath, license: candidate.license });
    vscode.window.setStatusBarMessage(
      `webfetch: saved ${relativePath} (${candidate.license})`,
      4000,
    );
  }

  private async renderHtml(webview: vscode.Webview): Promise<string> {
    const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, "src", "panel", "webview.html");
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "src", "panel", "webview.css"),
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "out", "panel", "webview.js"),
    );
    const nonce = makeNonce();
    let html: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(htmlPath);
      html = new TextDecoder().decode(bytes);
    } catch {
      html = FALLBACK_HTML;
    }
    return html
      .replace(/\{\{cspSource\}\}/g, webview.cspSource)
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{css\}\}/g, cssUri.toString())
      .replace(/\{\{js\}\}/g, jsUri.toString());
  }
}

function makeNonce(): string {
  // SECURITY (SA-009): Previously used Math.random() which is not a CSPRNG and
  // predictable CSP nonces weaken the script-src protection. Use Web Crypto
  // (available in Node 18+ / VS Code's electron runtime).
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(32);
  const g: { getRandomValues?: (u: Uint8Array) => Uint8Array } =
    (globalThis.crypto as unknown as { getRandomValues?: (u: Uint8Array) => Uint8Array }) ?? {};
  if (typeof g.getRandomValues === "function") {
    g.getRandomValues(bytes);
  } else {
    // Fallback: still better than Math.random — combine high-entropy time + PID.
    for (let i = 0; i < 32; i++) bytes[i] = (Date.now() ^ (i * 2654435761)) & 0xff;
  }
  let s = "";
  for (let i = 0; i < 32; i++) s += chars.charAt(bytes[i]! % chars.length);
  return s;
}

function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 7);
}

function relativeToEditor(editor: vscode.TextEditor, absPath: string): string | undefined {
  const doc = editor.document;
  if (doc.isUntitled) return undefined;
  const rel = path.relative(path.dirname(doc.uri.fsPath), absPath).replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

const FALLBACK_HTML =
  "<!doctype html><html><body><p>webfetch panel failed to load.</p></body></html>";
