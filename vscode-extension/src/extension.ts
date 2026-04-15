/**
 * Extension entry point.
 *
 * Wires up:
 *  - The side-panel webview provider
 *  - Command palette commands (search, insertImage, providers, setApiKey, openDashboard)
 *  - Status bar indicator (refreshed on activation and when settings change)
 *  - Inline code action in markdown that suggests "Search webfetch for this alt text"
 *    when the cursor is inside an empty `![alt]()` image placeholder.
 */

import * as vscode from "vscode";
import { registerInsertImage } from "./commands/insertImage";
import { registerOpenDashboard, registerProvidersCommand } from "./commands/openDashboard";
import { registerSearch } from "./commands/search";
import { registerSetApiKey } from "./commands/setApiKey";
import { StatusBar } from "./lib/status";
import { WebfetchViewProvider } from "./panel/WebfetchViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const status = new StatusBar(context);
  const panel = new WebfetchViewProvider(context, status);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WebfetchViewProvider.viewType, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  registerSearch(context, panel);
  registerInsertImage(context, panel);
  registerSetApiKey(context, status);
  registerOpenDashboard(context);
  registerProvidersCommand(context);

  // Markdown code-action that routes to the panel when the user types `![alt]()`.
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: "markdown" },
      new MarkdownImageLightbulb(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Refactor] },
    ),
  );

  // Refresh the status indicator when the user changes settings or the key.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((ev) => {
      if (ev.affectsConfiguration("webfetch")) void status.refresh();
    }),
  );
  context.secrets.onDidChange(() => {
    void status.refresh();
  });

  void status.refresh();
}

export function deactivate(): void {
  // Nothing to clean up beyond disposables registered via `context.subscriptions`.
}

/**
 * Offers a lightbulb on markdown lines containing an empty image link
 * (e.g. `![alt]()`). Selecting it opens the side panel pre-seeded with the
 * alt text, mirroring what `webfetch.insertImage` does from the context menu.
 */
class MarkdownImageLightbulb implements vscode.CodeActionProvider {
  private static readonly pattern = /!\[([^\]]*)\]\(\s*\)/g;

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] | undefined {
    const line = document.lineAt(range.start.line).text;
    MarkdownImageLightbulb.pattern.lastIndex = 0;
    const m = MarkdownImageLightbulb.pattern.exec(line);
    if (!m) return;
    const col = range.start.character;
    const start = line.indexOf(m[0]);
    if (col < start || col > start + m[0].length) return;
    const action = new vscode.CodeAction(
      `webfetch: search for "${m[1] || "image"}"`,
      vscode.CodeActionKind.QuickFix,
    );
    action.command = {
      command: "webfetch.insertImage",
      title: "webfetch: insert licensed image",
    };
    action.isPreferred = true;
    return [action];
  }
}
