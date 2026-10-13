import * as crypto from "crypto";
import * as vscode from "vscode";
import type { ClusterData } from "./clusterData";
import {
  ALL_CLUSTERS,
  ALL_PROJECTS,
  buildJobsTable,
  ChangesState,
  DEFAULT_FILTERS,
  effectiveSince,
  JobsFilters,
  JobsTableModel,
  RowExtras,
  TrainingState,
} from "./jobsTable";
import type { StateGroupId } from "./jobStates";
import type { ReviewStatus, ReviewStore } from "./reviews";

/** Each refresh runs `sacct` on a login node, so not more often than this. */
const AUTO_REFRESH_MS = 60_000;

/** What the panel needs from the rest of the extension. */
export interface JobsPanelServices {
  data: ClusterData;
  reviews: ReviewStore;
  /** Called after a review changed, so the badge and status bar follow. */
  onReviewsChanged: () => void;
  loadTraining: (jobId: string) => Promise<TrainingState>;
  loadChanges: (cluster: string, workdir: string, fromCommit: string, toCommit: string) => Promise<ChangesState>;
}

/** Messages the webview sends; it never gets data any other way than `postMessage`. */
type WebviewMessage =
  | { type: "ready" }
  | { type: "toggle"; group: StateGroupId }
  | { type: "pickCluster"; cluster: string }
  | { type: "pickProject"; project: string }
  | { type: "pickSince"; since: string }
  | { type: "refresh" }
  | { type: "login"; cluster: string }
  | { type: "expand"; key: string }
  | { type: "setMode"; mode: JobsTableModel["mode"] }
  | { type: "review"; reviewKey: string; action: "confirm" | "edit" | "discard" }
  | { type: "loadChanges"; key: string }
  | { type: "showJob"; key: string }
  | { type: "openUrl"; url: string };

/** The "Cluster jobs" editor tab: one list of every live cluster's jobs. */
export class JobsPanel {
  private static current: JobsPanel | undefined;

  private filters: JobsFilters = DEFAULT_FILTERS;
  private mode: JobsTableModel["mode"] = "jobs";
  private readonly expanded = new Set<string>();
  private readonly extras = new Map<string, RowExtras>();
  private refreshTimer: NodeJS.Timeout | undefined;
  private refreshing = false;
  private readonly disposables: vscode.Disposable[] = [];

  static show(extensionUri: vscode.Uri, services: JobsPanelServices): JobsPanel {
    if (JobsPanel.current) {
      JobsPanel.current.panel.reveal();
      return JobsPanel.current;
    }
    const mediaRoot = vscode.Uri.joinPath(extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("ctun.jobs", "Cluster jobs", vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [mediaRoot],
    });
    JobsPanel.current = new JobsPanel(panel, mediaRoot, services);
    return JobsPanel.current;
  }

  /** Re-renders an open panel, e.g. after a review changed elsewhere. */
  static refreshView(): void {
    JobsPanel.current?.post();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    mediaRoot: vscode.Uri,
    private readonly services: JobsPanelServices,
  ) {
    panel.iconPath = vscode.Uri.joinPath(mediaRoot, "clusters.svg");
    panel.webview.html = renderHtml(panel.webview, mediaRoot);
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => void this.handle(message)),
      panel.onDidChangeViewState(() => this.followVisibility()),
      panel.onDidDispose(() => this.dispose()),
      services.data.onDidChange(() => this.post()),
    );
    services.data.since = effectiveSince(this.filters);
    this.followVisibility();
  }

  /** Shows only `project`'s jobs (from the Projects view). */
  filterProject(project: string): void {
    this.mode = "jobs";
    this.setFilters({ ...this.filters, project });
  }

  /** Switches to the review cards. */
  showReviews(): void {
    this.mode = "review";
    this.post();
  }

  private async handle(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.post();
        return;
      case "toggle":
        this.setFilters({
          ...this.filters,
          shownGroups: { ...this.filters.shownGroups, [message.group]: !this.filters.shownGroups[message.group] },
        });
        return;
      case "pickCluster":
        this.setFilters({ ...this.filters, cluster: message.cluster });
        return;
      case "pickProject":
        this.setFilters({ ...this.filters, project: message.project });
        return;
      case "pickSince":
        this.setFilters({ ...this.filters, since: message.since });
        return;
      case "refresh":
        await this.refresh();
        return;
      case "login":
        void vscode.commands.executeCommand("ctun.login", message.cluster);
        return;
      case "expand":
        this.toggleExpanded(message.key);
        return;
      case "setMode":
        this.mode = message.mode;
        this.post();
        return;
      case "review":
        await this.review(message.reviewKey, message.action);
        return;
      case "loadChanges":
        await this.loadChanges(message.key);
        return;
      case "showJob":
        this.mode = "jobs";
        this.expanded.add(message.key);
        this.setFilters({ ...this.filters, cluster: ALL_CLUSTERS, project: ALL_PROJECTS });
        void this.loadTraining(message.key);
        return;
      case "openUrl":
        if (message.url.startsWith("https://wandb.ai/")) {
          void vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        return;
    }
  }

  /** Applies new filters; refetches only when the window ctun needs changed. */
  private setFilters(filters: JobsFilters): void {
    this.filters = filters;
    const since = effectiveSince(filters);
    if (since !== this.services.data.since) {
      this.services.data.since = since;
      void this.refresh();
    }
    this.post();
  }

  private toggleExpanded(key: string): void {
    if (this.expanded.delete(key)) {
      this.post();
      return;
    }
    this.expanded.add(key);
    this.post();
    void this.loadTraining(key);
  }

  private async review(reviewKey: string, action: "confirm" | "edit" | "discard"): Promise<void> {
    const statuses: Record<typeof action, ReviewStatus> = { confirm: "confirmed", edit: "edited", discard: "discarded" };
    let text: string | undefined;
    if (action === "edit") {
      text = await vscode.window.showInputBox({
        title: `Edit the note for job ${reviewKey.split("/")[1]}`,
        value: this.noteText(reviewKey),
        prompt: "Your text replaces the agent's draft in this view; the record on the cluster stays as written.",
      });
      if (text === undefined) {
        return;
      }
    }
    await this.services.reviews.set(reviewKey, statuses[action], text);
    this.services.onReviewsChanged();
    this.post();
  }

  private noteText(reviewKey: string): string {
    const model = this.model();
    const card = model.reviewCards.find((candidate) => candidate.reviewKey === reviewKey);
    const row = model.groups.flatMap((group) => group.rows).find((candidate) => candidate.note?.reviewKey === reviewKey);
    return card?.note ?? row?.note?.text ?? "";
  }

  private async loadTraining(key: string): Promise<void> {
    const jobId = key.split("/").slice(1).join("/");
    this.setExtras(key, { training: { state: "loading" } });
    this.setExtras(key, { training: await this.services.loadTraining(jobId) });
  }

  private async loadChanges(key: string): Promise<void> {
    const row = this.model().groups.flatMap((group) => group.rows).find((candidate) => candidate.key === key);
    const request = row?.details?.changesRequest;
    if (!request) {
      return;
    }
    this.setExtras(key, { changes: { state: "loading" } });
    const { cluster, workdir, fromCommit, toCommit } = request;
    this.setExtras(key, { changes: await this.services.loadChanges(cluster, workdir, fromCommit, toCommit) });
  }

  private setExtras(key: string, update: RowExtras): void {
    this.extras.set(key, { ...this.extras.get(key), ...update });
    this.post();
  }

  private async refresh(): Promise<void> {
    this.refreshing = true;
    this.post();
    try {
      await this.services.data.refresh();
    } finally {
      this.refreshing = false;
      this.post();
    }
  }

  /** Refreshes when the tab shows and every minute while it stays visible. */
  private followVisibility(): void {
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
    if (this.panel.visible) {
      void this.refresh();
      this.refreshTimer = setInterval(() => void this.refresh(), AUTO_REFRESH_MS);
    }
  }

  private model(): JobsTableModel {
    const { statuses, jobs, loggingIn, updatedAt } = this.services.data;
    return buildJobsTable({
      statuses,
      report: jobs,
      loggingIn,
      filters: this.filters,
      updatedAt,
      reviews: this.services.reviews.all(),
      mode: this.mode,
      expanded: this.expanded,
      extras: this.extras,
    });
  }

  private post(): void {
    void this.panel.webview.postMessage({
      type: "model",
      model: this.model(),
      refreshing: this.refreshing,
      error: this.services.data.error?.message,
    });
  }

  private dispose(): void {
    clearInterval(this.refreshTimer);
    this.disposables.forEach((disposable) => disposable.dispose());
    JobsPanel.current = undefined;
  }
}

function renderHtml(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const script = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "jobsTable.js"));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "jobsTable.css"));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${style}">
<title>Cluster jobs</title>
</head>
<body>
<main id="app" aria-busy="true"></main>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
