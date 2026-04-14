/**
 * `webfetch: Search` — prompts for a query, focuses the side panel, runs it.
 */

import * as vscode from "vscode";
import type { WebfetchViewProvider } from "../panel/WebfetchViewProvider";

export function registerSearch(
  context: vscode.ExtensionContext,
  panel: WebfetchViewProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("webfetch.search", async () => {
      const query = await vscode.window.showInputBox({
        prompt: "webfetch: search licensed images",
        placeHolder: "e.g. 'portrait of a jazz saxophonist'",
      });
      if (query === undefined) return;
      await panel.focusSearch(query);
    }),
  );
}
