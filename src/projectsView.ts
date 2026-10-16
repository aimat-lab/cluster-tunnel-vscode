import * as vscode from "vscode";
import type { ClusterData } from "./clusterData";
import type { HiddenProjects } from "./hiddenProjects";
import { bandLabel, projectCounts, projectLabel, sortProjects } from "./jobsTable";
import { isHiddenBy, parentProject, totalsWithNested } from "./projectTree";

/** The "All projects" row; `\0` is never part of a project name. */
const ALL_PROJECTS = "\0all";

/**
 * The Projects tree under Clusters: job counts per project, nested ones included.
 * An eye hides a project and everything below it in the job list; a click on a
 * name shows only that project and those below it in the job list; "All projects"
 * shows every project again.
 */
export class ProjectsView implements vscode.TreeDataProvider<string> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(
    private readonly data: ClusterData,
    private readonly hiddenProjects: HiddenProjects,
  ) {
    data.onDidChange(() => this.changed.fire());
    hiddenProjects.onDidChange(() => this.changed.fire());
  }

  getChildren(element?: string): string[] {
    if (this.data.jobs === undefined || element === ALL_PROJECTS) {
      return [];
    }
    const children = sortProjects(this.totals().keys()).filter((project) => parentProject(project) === element);
    return element === undefined ? [ALL_PROJECTS, ...children] : children;
  }

  getTreeItem(element: string): vscode.TreeItem {
    return element === ALL_PROJECTS ? this.allProjectsItem() : this.projectItem(element);
  }

  private allProjectsItem(): vscode.TreeItem {
    const item = new vscode.TreeItem("All projects");
    const allJobs = [...projectCounts(this.data.jobs).values()].reduce((sum, count) => sum + count, 0);
    item.description = String(allJobs);
    item.iconPath = new vscode.ThemeIcon("list-flat");
    item.tooltip = "Show every project";
    item.command = { command: "ctun.showAllProjects", title: "Show every project" };
    return item;
  }

  /** A project with its eye: `contextValue` picks which eye the inline menu shows. */
  private projectItem(project: string): vscode.TreeItem {
    const totals = this.totals();
    const hasChildren = [...totals.keys()].some((other) => parentProject(other) === project);
    const item = new vscode.TreeItem(
      bandLabel(project),
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    item.id = project; // keeps a project open across refreshes
    item.tooltip = `Show only ${projectLabel(project)}`;
    item.command = { command: "ctun.showOnlyProject", title: "Show only this project", arguments: [project] };
    item.description = String(totals.get(project) ?? 0);
    item.iconPath = new vscode.ThemeIcon("folder");
    item.contextValue = isHiddenBy(project, this.hiddenProjects.all()) ? "project-hidden" : "project-shown";
    return item;
  }

  /** Every project with jobs in the report, and every project above one. */
  knownProjects(): string[] {
    return [...this.totals().keys()];
  }

  /** Jobs per project, counting those in nested projects too. */
  private totals(): Map<string, number> {
    return totalsWithNested(projectCounts(this.data.jobs));
  }
}
