import * as vscode from "vscode";
import { WandbClient } from "./client";

/** The SecretStorage key of the W&B API key. */
export const WANDB_KEY_SECRET = "ctun.wandb.apiKey";

/** Opens the guide to tagging W&B runs with their Slurm job ID, shipped with the extension. */
export async function showWandbGuide(extensionUri: vscode.Uri): Promise<void> {
  await vscode.commands.executeCommand("markdown.showPreview", vscode.Uri.joinPath(extensionUri, "docs", "wandb-tagging.md"));
}

/** W&B's User Settings page, whose API Keys section creates keys. */
const WANDB_SETTINGS_URL = "https://wandb.ai/settings";
const CREATE_KEY_STEPS = "Under API Keys, click New key, name it, and copy it: W&B shows the full key only once.";

/** Asks for a W&B API key, checks it with W&B, and stores it in SecretStorage. */
export async function setWandbKey(secrets: vscode.SecretStorage): Promise<void> {
  const createKey = { label: "$(link-external) Create a key on wandb.ai", detail: `Opens User Settings. ${CREATE_KEY_STEPS}` };
  const haveKey = { label: "$(clippy) I have a key copied" };
  const picked = await vscode.window.showQuickPick([createKey, haveKey], { title: "W&B API key (1/2)" });
  if (picked === undefined) {
    return;
  }
  if (picked === createKey) {
    await openWandbSettings();
  }
  const entity = await askForCheckedKey(secrets);
  if (entity !== undefined) {
    void vscode.window.showInformationMessage(`Stored the W&B key of ${entity}.`);
  }
}

/** Shows the key input until W&B accepts a key or the user cancels; returns the key's entity. */
function askForCheckedKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  const input = vscode.window.createInputBox();
  input.title = "W&B API key (2/2)";
  input.prompt = `Paste the key from wandb.ai → User Settings. ${CREATE_KEY_STEPS} It is checked with W&B, then stored in VS Code's SecretStorage.`;
  input.password = true;
  input.ignoreFocusOut = true;
  const openSettingsButton = { iconPath: new vscode.ThemeIcon("link-external"), tooltip: "Open W&B User Settings" };
  input.buttons = [openSettingsButton];

  return new Promise((resolve) => {
    let entity: string | undefined;
    input.onDidTriggerButton(() => void openWandbSettings());
    input.onDidChangeValue(() => (input.validationMessage = undefined));
    input.onDidAccept(async () => {
      const apiKey = input.value.trim();
      if (!apiKey) {
        return;
      }
      input.busy = true;
      input.enabled = false;
      try {
        entity = await new WandbClient(apiKey).ownEntity();
        await secrets.store(WANDB_KEY_SECRET, apiKey);
        input.hide();
      } catch (error) {
        input.validationMessage = error instanceof Error ? error.message : String(error);
      } finally {
        input.busy = false;
        input.enabled = true;
      }
    });
    input.onDidHide(() => {
      input.dispose();
      resolve(entity);
    });
    input.show();
  });
}

async function openWandbSettings(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(WANDB_SETTINGS_URL));
}
