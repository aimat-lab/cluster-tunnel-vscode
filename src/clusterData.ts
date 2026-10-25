import * as vscode from "vscode";
import { ClusterStatus, Ctun, CtunError, JobsReport, ProjectsReport } from "./ctun";
import type { ClusterJobs } from "./clusterSummary";
import { CLUSTERS_VIEW_ID } from "./clustersView";

/** Data this young is shown as it is when a view comes back into sight; Refresh still reloads it. */
const FRESH_FOR_MS = 15_000;

/**
 * The latest cluster statuses and jobs from ctun, shared by every view.
 *
 * One refresh runs `ctun status -j`, a targeted `status` per live guarded
 * cluster (for its budget use) and one `ctun jobs list --json` over all clusters.
 * `ctun projects list --json` reads every record, and projects rarely change, so
 * it runs only on the first refresh and on `refreshWithProjects`.
 */
export class ClusterData implements vscode.Disposable {
  statuses: ClusterStatus[] = [];
  jobs: JobsReport | undefined;
  /** Every project of all time, for the Projects view; the jobs are only those of the `since` window. */
  projects: ProjectsReport | undefined;
  /** The error of the last refresh, if it failed as a whole. */
  error: CtunError | undefined;
  updatedAt: Date | undefined;
  /** The finished-jobs window passed to `ctun jobs list --since`. */
  since = "24h";
  /** Clusters whose login window is open. */
  readonly loggingIn = new Set<string>();

  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private pendingRefresh: Promise<void> | undefined;
  /** Set by `refreshWithProjects`: the next refresh also reloads the projects. */
  private projectsWanted = false;

  constructor(private readonly ctun: () => Ctun) {}

  /** Refreshes from ctun under a progress bar on the Clusters view; a call during a running refresh joins it. */
  refresh(): Promise<void> {
    this.pendingRefresh ??= this.loadWithProgress().finally(() => {
      this.pendingRefresh = undefined;
    });
    return this.pendingRefresh;
  }

  /** Refreshes the projects too, e.g. after an edit or on the Refresh button; waits for a running refresh first. */
  async refreshWithProjects(): Promise<void> {
    await this.pendingRefresh;
    this.projectsWanted = true;
    await this.refresh();
  }

  /** Refreshes unless the last refresh is younger than `FRESH_FOR_MS`, e.g. when a tab comes back into view. */
  refreshIfStale(): Promise<void> {
    const isFresh = this.updatedAt !== undefined && Date.now() - this.updatedAt.getTime() < FRESH_FOR_MS;
    return isFresh ? Promise.resolve() : this.refresh();
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
    const loadsProjects = this.projects === undefined || this.projectsWanted;
    this.projectsWanted = false;
    try {
      await Promise.all([this.loadStatuses(ctun), this.loadJobs(ctun), ...(loadsProjects ? [this.loadProjects(ctun)] : [])]);
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

  /** Shows the overview as soon as it arrives, then each budget use as its probe answers. */
  private async loadStatuses(ctun: Ctun): Promise<void> {
    const overview = await ctun.status();
    this.statuses = overview.map((status) => this.withLastMeasurement(status));
    this.changed.fire();
    const isGuardedAndLive = (status: ClusterStatus) => status.live && status.limit !== null;
    this.statuses = await Promise.all(
      overview.map(async (status) => {
        if (!isGuardedAndLive(status)) {
          return status;
        }
        const [measured] = await ctun.status(status.cluster);
        return measured ?? status;
      }),
    );
  }

  private async loadProjects(ctun: Ctun): Promise<void> {
    this.projects = await ctun.projects();
    this.changed.fire();
  }

  private async loadJobs(ctun: Ctun): Promise<void> {
    this.jobs = await ctun.jobs(this.since);
    this.changed.fire();
  }

  /** The overview has no budget use; keep the last one of the same session until the new probe answers. */
  private withLastMeasurement(status: ClusterStatus): ClusterStatus {
    const last = this.statuses.find((candidate) => candidate.cluster === status.cluster);
    const sameSession = last?.session && last.session.session_id === status.session?.session_id;
    return sameSession ? { ...status, used: last.used, used_error: last.used_error } : status;
  }
}
