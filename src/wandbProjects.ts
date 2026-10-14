import * as vscode from "vscode";
import type { ClusterData } from "./clusterData";
import type { JobsReport } from "./ctun";
import { JobProjects, listedJobIds } from "./jobsTable";
import { WANDB_KEY_SECRET } from "./training";
import { WandbClient } from "./wandb";

/** The W&B project of each listed job, looked up again when ctun's job list, the W&B key or the entity changes. */
export class WandbProjects implements JobProjects, vscode.Disposable {
  byJob: ReadonlyMap<string, string> = new Map();
  error: string | undefined;

  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private lookedUpReport: JobsReport | undefined;
  /** Grows with each lookup, so a slow older lookup cannot overwrite a newer one. */
  private lookupSerial = 0;
  private pendingLookup: Promise<void> = Promise.resolve();
  /** Kept per key, so the key's own entity is asked for only once. */
  private client: { apiKey: string; client: WandbClient } | undefined;
  private readonly disposables: vscode.Disposable[];

  constructor(
    private readonly data: ClusterData,
    private readonly secrets: vscode.SecretStorage,
  ) {
    this.disposables = [
      this.changed,
      data.onDidChange(() => data.jobs !== this.lookedUpReport && this.lookUp()),
      secrets.onDidChange(({ key }) => key === WANDB_KEY_SECRET && this.lookUp()),
      vscode.workspace.onDidChangeConfiguration((event) => event.affectsConfiguration("ctun.wandb.entity") && this.lookUp()),
    ];
  }

  /** The job's project once the running lookup finished; undefined when no run carries its tag. */
  async projectOf(jobId: string): Promise<string | undefined> {
    await this.pendingLookup;
    return this.byJob.get(jobId);
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  private lookUp(): void {
    this.lookedUpReport = this.data.jobs;
    this.pendingLookup = this.load(this.data.jobs, ++this.lookupSerial);
  }

  private async load(report: JobsReport | undefined, serial: number): Promise<void> {
    let byJob: ReadonlyMap<string, string>;
    let error: string | undefined;
    try {
      const client = await this.clientForStoredKey();
      const entity = vscode.workspace.getConfiguration("ctun.wandb").get<string>("entity") ?? "";
      byJob = client ? await client.projectsOfJobs(entity, listedJobIds(report)) : new Map();
    } catch (failure) {
      byJob = this.byJob;
      error = failure instanceof Error ? failure.message : String(failure);
    }
    if (serial !== this.lookupSerial) {
      return;
    }
    this.byJob = byJob;
    this.error = error;
    this.changed.fire();
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
