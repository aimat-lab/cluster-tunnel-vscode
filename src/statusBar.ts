import * as vscode from "vscode";
import type { ClusterData } from "./clusterData";

/** The status-bar entry: connected clusters, their budget use, and notes waiting for review. */
export function createStatusBar(
  data: ClusterData,
  pendingReviews: () => number,
  onReviewsChanged: vscode.Event<void>,
): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  const update = () => {
    const live = data.statuses.filter((status) => status.live);
    const budgets = live.flatMap((status) =>
      status.limit !== null && status.used !== null
        ? [`${status.cluster} ${status.used.toFixed(1)}/${status.limit} ${status.unit ?? ""}`.trim()]
        : [],
    );
    const pending = pendingReviews();
    const reviewText = pending > 0 ? [`$(comment-unresolved) ${pending} to review`] : [];
    item.text = [`$(server) ctun · ${live.length} of ${data.statuses.length} connected`, ...reviewText, ...budgets].join("   ");
    item.command = pending > 0 ? "ctun.showReviews" : "ctun.clusters.focus";
    item.tooltip = pending > 0 ? "Review the agent's notes" : "Show the ctun clusters";
    item.show();
  };
  return vscode.Disposable.from(item, data.onDidChange(update), onReviewsChanged(update));
}
