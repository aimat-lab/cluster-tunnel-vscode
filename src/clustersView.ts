import * as vscode from "vscode";
import type { ClusterData } from "./clusterData";
import type { ClusterStatus } from "./ctun";
import { summarize, textBar } from "./clusterSummary";

/** A cluster entry; inline menu commands receive it as their argument. */
export interface ClusterNode {
  kind: "cluster";
  status: ClusterStatus;
}

type Node = ClusterNode | { kind: "detail"; item: vscode.TreeItem };

/** The Clusters sidebar: one expandable entry per configured cluster. */
export class ClustersView implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly data: ClusterData) {
    data.onDidChange(() => this.changed.fire());
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return node.kind === "cluster" ? this.clusterItem(node.status) : node.item;
  }

  getChildren(node?: Node): Node[] {
    if (node === undefined) {
      return this.data.statuses.map((status) => ({ kind: "cluster", status }));
    }
    if (node.kind === "detail") {
      return [];
    }
    return this.detailItems(node.status).map((item) => ({ kind: "detail", item }));
  }

  private clusterItem(status: ClusterStatus): vscode.TreeItem {
    const item = new vscode.TreeItem(status.cluster, vscode.TreeItemCollapsibleState.Expanded);
    item.id = status.cluster;
    item.tooltip = status.target;
    if (this.data.loggingIn.has(status.cluster)) {
      item.description = "logging in";
      item.iconPath = new vscode.ThemeIcon("loading~spin");
      item.contextValue = "cluster-loggingIn";
    } else if (status.live) {
      item.description = "connected";
      item.iconPath = new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("testing.iconPassed"));
      item.contextValue = "cluster-live";
    } else {
      item.description = "logged out";
      item.iconPath = new vscode.ThemeIcon("circle-outline");
      item.contextValue = "cluster-down";
    }
    return item;
  }

  private detailItems(status: ClusterStatus): vscode.TreeItem[] {
    if (this.data.loggingIn.has(status.cluster)) {
      return [plainItem("Waiting for the ctun login window…")];
    }
    if (!status.live) {
      const loginHint = plainItem("No tunnel. Log in to see jobs and budget.");
      loginHint.command = { command: "ctun.login", title: "Log in", arguments: [status.cluster] };
      return [loginHint];
    }
    const clusterJobs = this.data.jobsOf(status.cluster);
    const summary = summarize(status, clusterJobs);
    const budgetBar = summary.budgetFraction === undefined ? "" : `  ${textBar(summary.budgetFraction)}`;
    const jobs = detailItem("Jobs", summary.jobs);
    jobs.tooltip = clusterJobs?.error ?? undefined;
    jobs.command = { command: "ctun.showJobs", title: "Show cluster jobs" };
    return [
      detailItem("Session", summary.session),
      detailItem("Budget", summary.budget + budgetBar),
      detailItem("Commands", summary.commands),
      jobs,
    ];
  }
}

function detailItem(label: string, description: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label);
  item.description = description;
  item.tooltip = description;
  return item;
}

function plainItem(label: string): vscode.TreeItem {
  return new vscode.TreeItem(label);
}
