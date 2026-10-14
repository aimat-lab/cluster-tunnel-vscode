import * as vscode from "vscode";
import type { AddOnRegistry } from "../../addOnRegistry";
import type { AddOn, DetailLine, JobRef } from "../../addOns";
import type { SetupCheck } from "../../setupChecks";
import { setWandbKey, showWandbGuide, WANDB_KEY_SECRET } from "./apiKey";
import { WandbClient } from "./client";
import { ENABLE_COMMAND, wandbSetupCheck } from "./setup";
import { jobTags, projectsByJob, runForJob, trainingSummary } from "./tags";

const SETTINGS = "ctun.addons.wandb";
const DETAIL_LABEL = "Training";

/** Registers the W&B add-on and its commands. */
export function registerWandbAddOn(context: vscode.ExtensionContext, addOns: AddOnRegistry): void {
  const addOn = new WandbAddOn(context.secrets);
  context.subscriptions.push(
    addOn,
    addOns.register(addOn),
    vscode.commands.registerCommand(ENABLE_COMMAND, () =>
      vscode.workspace.getConfiguration(SETTINGS).update("enabled", true, vscode.ConfigurationTarget.Global),
    ),
    vscode.commands.registerCommand("ctun.setWandbKey", () => setWandbKey(context.secrets)),
    vscode.commands.registerCommand("ctun.clearWandbKey", () => context.secrets.delete(WANDB_KEY_SECRET)),
    vscode.commands.registerCommand("ctun.showWandbGuide", () => showWandbGuide(context.extensionUri)),
  );
}

/** Projects and training metrics from the W&B runs tagged with their Slurm job (D11). */
class WandbAddOn implements AddOn, vscode.Disposable {
  readonly id = "wandb";
  readonly label = "W&B";

  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  /** Kept per key, so the key's own entity is asked for only once. */
  private client: { apiKey: string; client: WandbClient } | undefined;
  private readonly disposables: vscode.Disposable[];

  constructor(private readonly secrets: vscode.SecretStorage) {
    this.disposables = [
      this.changed,
      secrets.onDidChange(({ key }) => key === WANDB_KEY_SECRET && this.changed.fire()),
      vscode.workspace.onDidChangeConfiguration((event) => event.affectsConfiguration(SETTINGS) && this.changed.fire()),
    ];
  }

  get active(): boolean {
    return settings().get<boolean>("enabled") ?? false;
  }

  async projectsOf(jobs: readonly JobRef[]): Promise<ReadonlyMap<string, string>> {
    const client = await this.clientForStoredKey();
    if (!client) {
      throw new Error("no API key; run ctun: Set W&B API Key");
    }
    const tags = [...new Set(jobs.flatMap(jobTags))];
    return projectsByJob(jobs, await client.taggedRuns(entity(), tags, false));
  }

  async detailLines(job: JobRef): Promise<DetailLine[]> {
    const client = await this.clientForStoredKey();
    if (!client) {
      const help = { label: "Set W&B key", command: "ctun.setWandbKey" };
      return [{ label: DETAIL_LABEL, text: "No W&B API key.", muted: true, help }];
    }
    const run = runForJob(job, await client.taggedRuns(entity(), jobTags(job), true));
    if (!run) {
      const help = { label: "How to tag runs", command: "ctun.showWandbGuide" };
      return [{ label: DETAIL_LABEL, text: `No W&B run tagged ${jobTags(job)[0]}.`, muted: true, help }];
    }
    const metrics = settings().get<string[]>("metrics") ?? [];
    return [{ label: DETAIL_LABEL, text: trainingSummary(run, metrics), link: { label: "W&B", url: run.url } }];
  }

  async setupCheck(): Promise<SetupCheck> {
    const hasKey = (await this.secrets.get(WANDB_KEY_SECRET)) !== undefined;
    return wandbSetupCheck({ enabled: this.active, hasKey, entity: entity() });
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  private async clientForStoredKey(): Promise<WandbClient | undefined> {
    const apiKey = await this.secrets.get(WANDB_KEY_SECRET);
    if (!apiKey) {
      return undefined;
    }
    if (this.client?.apiKey !== apiKey) {
      this.client = { apiKey, client: new WandbClient(apiKey) };
    }
    return this.client.client;
  }
}

function settings(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SETTINGS);
}

/** The W&B user or team whose projects are searched; empty means the key's own. */
function entity(): string {
  return settings().get<string>("entity") ?? "";
}
