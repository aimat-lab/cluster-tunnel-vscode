import * as vscode from "vscode";
import type { TrainingState } from "./jobsTable";
import { trainingSummary, WandbClient } from "./wandb";

/** The SecretStorage key of the W&B API key. */
export const WANDB_KEY_SECRET = "ctun.wandb.apiKey";

/** Looks up a job's W&B run with the key in SecretStorage and the `ctun.wandb.*` settings. */
export function trainingLookup(secrets: vscode.SecretStorage): (jobId: string) => Promise<TrainingState> {
  return async (jobId) => {
    const settings = vscode.workspace.getConfiguration("ctun.wandb");
    const project = settings.get<string>("project") ?? "";
    const apiKey = await secrets.get(WANDB_KEY_SECRET);
    if (!apiKey || !project) {
      return { state: "unavailable", text: "W&B not configured.", help: "setup" };
    }
    const entity = settings.get<string>("entity") ?? "";
    const metrics = settings.get<string[]>("metrics") ?? [];
    try {
      const run = await new WandbClient(apiKey).runForJob(entity, project, jobId, metrics);
      if (!run) {
        return { state: "unavailable", text: `No W&B run tagged slurm:${jobId}.`, help: "tagging" };
      }
      return { state: "loaded", text: trainingSummary(run), url: run.url };
    } catch (error) {
      return { state: "unavailable", text: error instanceof Error ? error.message : String(error) };
    }
  };
}

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
