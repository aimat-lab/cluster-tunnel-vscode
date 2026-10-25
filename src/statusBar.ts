import * as vscode from "vscode";
import type { ClusterData } from "./clusterData";

/** The status-bar entry: connected clusters and their budget use; its tooltip names the notes waiting for review. */
export function createStatusBar(data: ClusterData, pendingReviews: () => number): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  const update = () => {
    const live = data.statuses.filter((status) => status.live);
    const budgets = live.flatMap((status) =>
      status.limit !== null && status.used !== null
        ? [`${status.cluster} ${status.used.toFixed(1)}/${status.limit} ${status.unit ?? ""}`.trim()]
        : [],
    );
    const pending = pendingReviews();
    item.text = [`$(server) ctun · ${live.length} of ${data.statuses.length} connected`, ...budgets].join("   ");
    item.command = "ctun.clusters.focus";
    item.tooltip = pending > 0 ? `Show the ctun clusters · ${pending} agent notes to review` : "Show the ctun clusters";
    item.show();
  };
  return vscode.Disposable.from(item, data.onDidChange(update));
}
