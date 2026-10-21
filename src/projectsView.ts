import * as vscode from "vscode";
import type { ClusterData } from "./clusterData";
import type { DraftProjects } from "./draftProjects";
import type { HiddenProjects } from "./hiddenProjects";
import { allTimeProjectCounts, bandLabel, jobKeysIn, projectLabel, sortProjects, UNASSIGNED } from "./jobsTable";
import { isHiddenBy, parentProject, totalsWithNested } from "./projectTree";

/** The "All projects" row; `\0` is never part of a project name. */
const ALL_PROJECTS = "\0all";

/** Why a project without jobs is only a draft; shown by the draft's (i) and in its tooltip. */
export const DRAFT_PROJECT_INFO =
  "ctun stores a job's project in that job's record on the cluster, so a project exists only through its jobs. " +
  "Until you drop jobs on it, this draft lives only in VS Code: Settings Sync carries it to your other machines, " +
  "but ctun and agents don't see it. Once a job is in it, it is a normal project. Delete an unused draft with its trash icon.";

/** What the "Cluster jobs" tab puts in a drag of job rows: their row keys as a JSON list. */
export const JOBS_DRAG_MIME = "application/vnd.ctun.jobs";

/**
 * The Projects tree under Clusters: every project of all time with its job count,
 * nested ones included.
 * An eye hides a project and everything below it in the job list; a click on a
 * name shows only that project and those below it in the job list; "All projects"
 * shows every project again. Draft projects, made here before any job is in them,
 * show with 0 jobs.
 */
export class ProjectsView implements vscode.TreeDataProvider<string>, vscode.TreeDragAndDropController<string> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  /** `text/plain` too: a drag from a webview may reach the tree with only that type. */
  readonly dropMimeTypes = [JOBS_DRAG_MIME, "text/plain"];
  readonly dragMimeTypes = [];

  constructor(
    private readonly data: ClusterData,
    private readonly hiddenProjects: HiddenProjects,
    private readonly draftProjects: DraftProjects,
    private readonly moveJobs: (keys: string[], project: string) => Promise<void>,
  ) {
    data.onDidChange(() => this.changed.fire());
    hiddenProjects.onDidChange(() => this.changed.fire());
    draftProjects.onDidChange(() => this.changed.fire());
  }

  /** The project a new one goes into: the selected project, or none for the top level. */
  parentForNewProject(selected: string | undefined): string | undefined {
    return selected === ALL_PROJECTS || selected === UNASSIGNED ? undefined : selected;
  }

  getParent(element: string): string | undefined {
    return element === ALL_PROJECTS ? undefined : parentProject(element);
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
    const totals = this.totals();
    const topLevel = [...totals.keys()].filter((project) => parentProject(project) === undefined);
    item.description = String(topLevel.reduce((sum, project) => sum + (totals.get(project) ?? 0), 0));
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
    item.command = { command: "ctun.showOnlyProject", title: "Show only this project", arguments: [project] };
    const jobCount = totals.get(project) ?? 0;
    if (jobCount === 0) {
      item.description = "draft · no jobs yet";
      item.tooltip = `Draft project ${projectLabel(project)}. ${DRAFT_PROJECT_INFO}`;
      item.iconPath = new vscode.ThemeIcon("folder", new vscode.ThemeColor("disabledForeground"));
      item.contextValue = "project-draft";
      return item;
    }
    item.tooltip =
      project === UNASSIGNED
        ? `${jobCount} jobs without a project in the "Ended in" window. Show only them.`
        : `${jobCount} jobs of all time. Show only ${projectLabel(project)}; the table lists the jobs of the "Ended in" window.`;
    item.description = String(jobCount);
    item.iconPath = new vscode.ThemeIcon("folder");
    item.contextValue = isHiddenBy(project, this.hiddenProjects.all()) ? "project-hidden" : "project-shown";
    return item;
  }

  /** Job rows dragged from the "Cluster jobs" tab onto a project move there. */
  async handleDrop(target: string | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const dragged = await (dataTransfer.get(JOBS_DRAG_MIME) ?? dataTransfer.get("text/plain"))?.asString();
    const keys = dragged === undefined ? undefined : jobKeysIn(dragged);
    if (target === undefined || target === ALL_PROJECTS || keys === undefined) {
      return;
    }
    await this.moveJobs(keys, target);
  }

  /** Every project with jobs in the report, and every project above one. */
  knownProjects(): string[] {
    return [...this.totals().keys()];
  }

  /** Jobs per project of all time, counting those in nested projects too; drafts and the projects above them count 0. */
  private totals(): Map<string, number> {
    const jobCounts = allTimeProjectCounts(this.data.projects, this.data.jobs);
    for (const draft of this.draftProjects.all()) {
      jobCounts.set(draft, jobCounts.get(draft) ?? 0);
    }
    return totalsWithNested(jobCounts);
  }
}
