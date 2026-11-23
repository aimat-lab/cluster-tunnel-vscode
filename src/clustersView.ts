import * as vscode from "vscode";
import type { ClusterData } from "./clusterData";
import type { ClusterOrder } from "./clusterOrder";
import { buildClustersModel, ClustersModel } from "./clustersModel";
import { webviewHtml } from "./webviewHtml";

export const CLUSTERS_VIEW_ID = "ctun.clusters";

/** Messages the webview sends; it never gets data any other way than `postMessage`. */
type WebviewMessage =
  | { type: "ready" }
  | { type: "login"; cluster: string }
  | { type: "logout"; cluster: string }
  | { type: "showJobs" }
  | { type: "showCommands"; cluster: string }
  | { type: "move"; cluster: string; before: string | null };

/** The Clusters sidebar: one card per configured cluster, with its Log in button, in the order the user dragged them into. */
export class ClustersView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly data: ClusterData,
    private readonly order: ClusterOrder,
  ) {
    data.onDidChange(() => this.post());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };
    view.webview.html = webviewHtml(view.webview, mediaRoot, "clusters", "Clusters");
    view.webview.onDidReceiveMessage((message: WebviewMessage) => void this.handle(message));
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        void this.data.refreshIfStale();
      }
    });
    view.onDidDispose(() => (this.view = undefined));
    this.view = view;
  }

  private async handle(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.post();
        return;
      case "login":
        await vscode.commands.executeCommand("ctun.login", message.cluster);
        return;
      case "logout":
        await vscode.commands.executeCommand("ctun.logout", message.cluster);
        return;
      case "showJobs":
        await vscode.commands.executeCommand("ctun.showJobs");
        return;
      case "showCommands":
        await vscode.commands.executeCommand("ctun.showCommands", message.cluster);
        return;
      case "move":
        await this.order.move(this.clusterNames(), message.cluster, message.before ?? undefined);
        this.post();
        return;
    }
  }

  private clusterNames(): string[] {
    return this.data.statuses.map((status) => status.cluster);
  }

  private model(): ClustersModel {
    const { data } = this;
    const byName = new Map(data.statuses.map((status) => [status.cluster, status]));
    return buildClustersModel({
      statuses: this.order.sorted(this.clusterNames()).map((cluster) => byName.get(cluster)!),
      loggingIn: data.loggingIn,
      jobsOf: (cluster) => data.jobsOf(cluster),
      loaded: data.updatedAt !== undefined || data.error !== undefined,
      error: data.error ? `ctun failed: ${data.error.message}` : undefined,
    });
  }

  private post(): void {
    void this.view?.webview.postMessage({ type: "model", model: this.model() });
  }
}
