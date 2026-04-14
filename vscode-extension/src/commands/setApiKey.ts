/**
 * `webfetch: Set API Key` — stores the key in SecretStorage.
 */

import * as vscode from "vscode";
import { setApiKey } from "../lib/settings";
import type { StatusBar } from "../lib/status";

export function registerSetApiKey(
  context: vscode.ExtensionContext,
  status: StatusBar,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("webfetch.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "webfetch API key (Bearer token)",
        placeHolder: "wf_live_…",
        password: true,
        ignoreFocusOut: true,
      });
      if (key === undefined) return;
      await setApiKey(context, key.trim());
      vscode.window.showInformationMessage(
        key.trim() ? "webfetch: API key saved." : "webfetch: API key cleared.",
      );
      await status.refresh();
    }),
  );
}
