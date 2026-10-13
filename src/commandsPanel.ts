import * as crypto from "crypto";
import * as vscode from "vscode";
import type { ClusterData } from "./clusterData";
import { buildTranscript, CommandsTranscriptModel, shellJoin } from "./commandsTranscript";
import { CommandLog, Ctun, CtunError } from "./ctun";

/** P9: `ctun logs` only reads a local file, so it may run this often. */
const LOG_REFRESH_MS = 10_000;
/** Job states need `sacct` on a login node, so not more often than "Cluster jobs" asks. */
const JOBS_REFRESH_MS = 60_000;

/** What the panel needs from the rest of the extension. */
export interface CommandsPanelServices {
  data: ClusterData;
  ctun: () => Ctun;
  /** Shows one job's details in "Cluster jobs". */
  revealJob: (key: string) => void;
}

/** Messages the webview sends; it never gets data any other way than `postMessage`. */
type WebviewMessage =
  | { type: "ready" }
  | { type: "pickCluster"; cluster: string }
  | { type: "refresh" }
  | { type: "copyAll" }
  | { type: "showJob"; key: string };

/** The "Commands · <cluster>" editor tab: the commands sent to one cluster this session. */
export class CommandsPanel {
  private static current: CommandsPanel | undefined;

  private log: CommandLog | undefined;
  private logError: CtunError | undefined;
  private refreshing = false;
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  static show(extensionUri: vscode.Uri, services: CommandsPanelServices, cluster: string): CommandsPanel {
    if (CommandsPanel.current) {
      CommandsPanel.current.panel.reveal();
      CommandsPanel.current.setCluster(cluster);
      return CommandsPanel.current;
    }
    const mediaRoot = vscode.Uri.joinPath(extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("ctun.commands", titleOf(cluster), vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [mediaRoot],
    });
    CommandsPanel.current = new CommandsPanel(panel, mediaRoot, services, cluster);
    return CommandsPanel.current;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    mediaRoot: vscode.Uri,
    private readonly services: CommandsPanelServices,
    private cluster: string,
  ) {
    panel.iconPath = vscode.Uri.joinPath(mediaRoot, "clusters.svg");
    panel.webview.html = renderHtml(panel.webview, mediaRoot);
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => void this.handle(message)),
      panel.onDidChangeViewState(() => this.followVisibility()),
      panel.onDidDispose(() => this.dispose()),
      services.data.onDidChange(() => this.post()),
    );
    this.followVisibility();
  }

  private setCluster(cluster: string): void {
    if (cluster === this.cluster) {
      return;
    }
    this.cluster = cluster;
    this.panel.title = titleOf(cluster);
    this.log = undefined;
    this.logError = undefined;
    this.post();
    void this.loadLog();
  }

  private async handle(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.post();
        return;
      case "pickCluster":
        this.setCluster(message.cluster);
        return;
      case "refresh":
        await this.refresh();
        return;
      case "copyAll":
        await vscode.env.clipboard.writeText((this.log?.commands ?? []).map((command) => shellJoin(command.command)).join("\n"));
        return;
      case "showJob":
        this.services.revealJob(message.key);
        return;
    }
  }

  private async refresh(onlyIfStale = false): Promise<void> {
    this.refreshing = true;
    this.post();
    const { data } = this.services;
    try {
      await Promise.all([this.loadLog(), onlyIfStale ? data.refreshIfStale() : data.refresh()]);
    } finally {
      this.refreshing = false;
      this.post();
    }
  }

  private async loadLog(): Promise<void> {
    const cluster = this.cluster;
    let log: CommandLog | undefined;
    let error: CtunError | undefined;
    try {
      log = await this.services.ctun().logs(cluster);
    } catch (caught) {
      if (!(caught instanceof CtunError)) {
        throw caught;
      }
      error = caught;
    }
    if (cluster !== this.cluster) {
      return;
    }
    this.log = log;
    this.logError = error;
    this.post();
  }

  /**
   * P9: reads the log when the tab shows, and the job states unless they are fresh;
   * then the log every 10 s and the job states every minute while it stays visible.
   */
  private followVisibility(): void {
    this.timers.splice(0).forEach((timer) => clearInterval(timer));
    if (!this.panel.visible) {
      return;
    }
    void this.refresh(true);
    this.timers.push(
      setInterval(() => void this.loadLog(), LOG_REFRESH_MS),
      setInterval(() => void this.services.data.refresh(), JOBS_REFRESH_MS),
    );
  }

  private model(): CommandsTranscriptModel {
    const { statuses, jobs } = this.services.data;
    const liveClusters = statuses.filter((status) => status.live).map((status) => status.cluster);
    return buildTranscript({
      cluster: this.cluster,
      clusters: liveClusters.includes(this.cluster) ? liveClusters : [this.cluster, ...liveClusters],
      log: this.log,
      status: statuses.find((status) => status.cluster === this.cluster),
      report: jobs,
    });
  }

  private post(): void {
    void this.panel.webview.postMessage({
      type: "model",
      model: this.model(),
      refreshing: this.refreshing,
      error: this.logError?.message,
    });
  }

  private dispose(): void {
    this.timers.forEach((timer) => clearInterval(timer));
    this.disposables.forEach((disposable) => disposable.dispose());
    CommandsPanel.current = undefined;
  }
}

function titleOf(cluster: string): string {
  return `Commands · ${cluster}`;
}

function renderHtml(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const script = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "commands.js"));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "commands.css"));
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
<title>Commands</title>
</head>
<body>
<main id="app" aria-busy="true"></main>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
