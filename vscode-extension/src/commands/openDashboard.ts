/**
 * `webfetch: Open Dashboard` + `webfetch: Providers` quick-pick.
 */

import * as vscode from "vscode";
import { getProviders } from "../lib/client";

export function registerOpenDashboard(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("webfetch.openDashboard", async () => {
      await vscode.env.openExternal(vscode.Uri.parse("https://app.getwebfetch.com"));
    }),
  );
}

export function registerProvidersCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("webfetch.providers", async () => {
      const res = await getProviders(context);
      if (!res.ok || !res.data) {
        vscode.window.showErrorMessage(
          `webfetch: could not fetch providers — ${res.error ?? "unknown"}`,
        );
        return;
      }
      const items: vscode.QuickPickItem[] = res.data.all.map((p) => ({
        label: p,
        description: res.data!.defaults.includes(p) ? "default" : "",
      }));
      await vscode.window.showQuickPick(items, {
        title: `webfetch providers (${res.data.all.length})`,
        placeHolder: "Select to copy name. Defaults marked.",
        canPickMany: false,
      });
    }),
  );
}
