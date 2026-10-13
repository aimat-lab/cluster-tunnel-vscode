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
      return { state: "unavailable", text: "W&B not configured" };
    }
    const entity = settings.get<string>("entity") ?? "";
    const metrics = settings.get<string[]>("metrics") ?? [];
    try {
      const run = await new WandbClient(apiKey).runForJob(entity, project, jobId, metrics);
      if (!run) {
        return { state: "unavailable", text: `No W&B run tagged slurm:${jobId}` };
      }
      return { state: "loaded", text: trainingSummary(run), url: run.url };
    } catch (error) {
      return { state: "unavailable", text: error instanceof Error ? error.message : String(error) };
    }
  };
}

export async function setWandbKey(secrets: vscode.SecretStorage): Promise<void> {
  const apiKey = await vscode.window.showInputBox({
    title: "W&B API key",
    prompt: "From wandb.ai/authorize. Stored in VS Code's SecretStorage, never in settings.",
    password: true,
    ignoreFocusOut: true,
  });
  if (apiKey) {
    await secrets.store(WANDB_KEY_SECRET, apiKey.trim());
  }
}
