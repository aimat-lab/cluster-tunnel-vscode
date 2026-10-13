import * as vscode from "vscode";
import type { ClusterData } from "./clusterData";

/** The status-bar entry: how many clusters are connected and their budget use. */
export function createStatusBar(data: ClusterData): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  item.command = "ctun.clusters.focus";
  item.tooltip = "Show the ctun clusters";
  const update = () => {
    const live = data.statuses.filter((status) => status.live);
    const budgets = live.flatMap((status) =>
      status.limit !== null && status.used !== null
        ? [`${status.cluster} ${status.used.toFixed(1)}/${status.limit} ${status.unit ?? ""}`.trim()]
        : [],
    );
    item.text = [`$(server) ctun · ${live.length} of ${data.statuses.length} connected`, ...budgets].join("   ");
    item.show();
  };
  return vscode.Disposable.from(item, data.onDidChange(update));
}
