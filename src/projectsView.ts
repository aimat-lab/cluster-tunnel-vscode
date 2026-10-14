import * as vscode from "vscode";
import type { ClusterData } from "./clusterData";
import { ALL_PROJECTS, projectCounts, projectLabel, sortProjects } from "./jobsTable";
import type { WandbProjects } from "./wandbProjects";

/** The Projects list under Clusters: job counts per W&B project, a click filters the table. */
export class ProjectsView implements vscode.TreeDataProvider<string> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(
    private readonly data: ClusterData,
    private readonly projects: WandbProjects,
  ) {
    data.onDidChange(() => this.changed.fire());
    projects.onDidChange(() => this.changed.fire());
  }

  getChildren(element?: string): string[] {
    if (element !== undefined || this.data.jobs === undefined) {
      return [];
    }
    return [ALL_PROJECTS, ...sortProjects([...projectCounts(this.data.jobs, this.projects).keys()])];
  }

  getTreeItem(project: string): vscode.TreeItem {
    const counts = projectCounts(this.data.jobs, this.projects);
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const item = new vscode.TreeItem(project === ALL_PROJECTS ? "All projects" : projectLabel(project));
    item.description = String(project === ALL_PROJECTS ? total : counts.get(project) ?? 0);
    item.iconPath = new vscode.ThemeIcon(project === ALL_PROJECTS ? "list-flat" : "folder");
    item.command = { command: "ctun.filterProject", title: "Show this project's jobs", arguments: [project] };
    return item;
  }
}
