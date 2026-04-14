/**
 * `webfetch: Insert licensed image...` — editor-context command for markdown.
 *
 * Uses the text around the cursor as a seed query when available
 * (e.g. the alt text of an empty `![caption]()` the user just typed).
 */

import * as vscode from "vscode";
import type { WebfetchViewProvider } from "../panel/WebfetchViewProvider";

export function registerInsertImage(
  context: vscode.ExtensionContext,
  panel: WebfetchViewProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("webfetch.insertImage", async () => {
      const editor = vscode.window.activeTextEditor;
      let seed = "";
      if (editor) {
        const line = editor.document.lineAt(editor.selection.active.line).text;
        const match = line.match(/!\[([^\]]*)\]/);
        if (match) seed = match[1];
        if (!seed) {
          const sel = editor.document.getText(editor.selection);
          if (sel && sel.length < 120) seed = sel;
        }
      }
      await panel.focusSearch(seed || undefined);
    }),
  );
}
