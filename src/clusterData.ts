import * as vscode from "vscode";
import { ClusterStatus, Ctun, CtunError, JobsReport } from "./ctun";
import type { ClusterJobs } from "./clusterSummary";
import { CLUSTERS_VIEW_ID } from "./clustersView";

/**
 * The latest cluster statuses and jobs from ctun, shared by every view.
 *
 * One refresh runs `ctun status -j`, a targeted `status` per live guarded
 * cluster (for its budget use) and one `ctun jobs --json` over all clusters.
 */
export class ClusterData implements vscode.Disposable {
  statuses: ClusterStatus[] = [];
  jobs: JobsReport | undefined;
  /** The error of the last refresh, if it failed as a whole. */
  error: CtunError | undefined;
  updatedAt: Date | undefined;
  /** The finished-jobs window passed to `ctun jobs --since`. */
  since = "24h";
  /** Clusters whose login window is open. */
  readonly loggingIn = new Set<string>();

  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private pendingRefresh: Promise<void> | undefined;

  constructor(private readonly ctun: () => Ctun) {}

  /** Refreshes from ctun under a progress bar on the Clusters view; a call during a running refresh joins it. */
  refresh(): Promise<void> {
    this.pendingRefresh ??= this.loadWithProgress().finally(() => {
      this.pendingRefresh = undefined;
    });
    return this.pendingRefresh;
  }

  private async loadWithProgress(): Promise<void> {
    await vscode.window.withProgress({ location: { viewId: CLUSTERS_VIEW_ID } }, () => this.load());
  }

  jobsOf(cluster: string): ClusterJobs | undefined {
    return this.jobs?.clusters.find((entry) => entry.cluster === cluster);
  }

  /** Tells the views that something outside a refresh changed, e.g. `loggingIn`. */
  notify(): void {
    this.changed.fire();
  }

  dispose(): void {
    this.changed.dispose();
  }

  private async load(): Promise<void> {
    const ctun = this.ctun();
    try {
      const [statuses, jobs] = await Promise.all([this.loadStatuses(ctun), ctun.jobs(this.since)]);
      this.statuses = statuses;
      this.jobs = jobs;
      this.error = undefined;
      this.updatedAt = new Date();
    } catch (error) {
      if (!(error instanceof CtunError)) {
        throw error;
      }
      this.error = error;
    }
    this.changed.fire();
  }

  private async loadStatuses(ctun: Ctun): Promise<ClusterStatus[]> {
    const overview = await ctun.status();
    const isGuardedAndLive = (status: ClusterStatus) => status.live && status.limit !== null;
    return Promise.all(
      overview.map(async (status) => {
        if (!isGuardedAndLive(status)) {
          return status;
        }
        const [measured] = await ctun.status(status.cluster);
        return measured ?? status;
      }),
    );
  }
}
