import * as crypto from "crypto";
import * as vscode from "vscode";
import type { ClusterData } from "./clusterData";
import { buildJobsTable, DEFAULT_FILTERS, effectiveSince, JobsFilters, JobsTableModel } from "./jobsTable";
import type { StateGroupId } from "./jobStates";

/** Each refresh runs `sacct` on a login node, so not more often than this. */
const AUTO_REFRESH_MS = 60_000;

/** Messages the webview sends; it never gets data any other way than `postMessage`. */
type WebviewMessage =
  | { type: "ready" }
  | { type: "toggle"; group: StateGroupId }
  | { type: "pickCluster"; cluster: string }
  | { type: "pickSince"; since: string }
  | { type: "refresh" }
  | { type: "login"; cluster: string };

/** The "Cluster jobs" editor tab: one list of every live cluster's jobs. */
export class JobsPanel {
  private static current: JobsPanel | undefined;

  private filters: JobsFilters = DEFAULT_FILTERS;
  private refreshTimer: NodeJS.Timeout | undefined;
  private refreshing = false;
  private readonly disposables: vscode.Disposable[] = [];

  static show(extensionUri: vscode.Uri, data: ClusterData): JobsPanel {
    if (JobsPanel.current) {
      JobsPanel.current.panel.reveal();
      return JobsPanel.current;
    }
    const mediaRoot = vscode.Uri.joinPath(extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("ctun.jobs", "Cluster jobs", vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [mediaRoot],
    });
    JobsPanel.current = new JobsPanel(panel, mediaRoot, data);
    return JobsPanel.current;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    mediaRoot: vscode.Uri,
    private readonly data: ClusterData,
  ) {
    panel.iconPath = vscode.Uri.joinPath(mediaRoot, "clusters.svg");
    panel.webview.html = renderHtml(panel.webview, mediaRoot);
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => void this.handle(message)),
      panel.onDidChangeViewState(() => this.followVisibility()),
      panel.onDidDispose(() => this.dispose()),
      data.onDidChange(() => this.post()),
    );
    data.since = effectiveSince(this.filters);
    this.followVisibility();
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
      case "pickSince":
        this.setFilters({ ...this.filters, since: message.since });
        return;
      case "refresh":
        await this.refresh();
        return;
      case "login":
        void vscode.commands.executeCommand("ctun.login", message.cluster);
        return;
    }
  }

  /** Applies new filters; refetches only when the window ctun needs changed. */
  private setFilters(filters: JobsFilters): void {
    this.filters = filters;
    const since = effectiveSince(filters);
    if (since !== this.data.since) {
      this.data.since = since;
      void this.refresh();
    }
    this.post();
  }

  private async refresh(): Promise<void> {
    this.refreshing = true;
    this.post();
    try {
      await this.data.refresh();
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
    const { statuses, jobs, loggingIn, updatedAt } = this.data;
    return buildJobsTable({ statuses, report: jobs, loggingIn, filters: this.filters, updatedAt });
  }

  private post(): void {
    void this.panel.webview.postMessage({
      type: "model",
      model: this.model(),
      refreshing: this.refreshing,
      error: this.data.error?.message,
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
