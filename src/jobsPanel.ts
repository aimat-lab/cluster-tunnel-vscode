import * as crypto from "crypto";
import * as vscode from "vscode";
import type { AddOnRegistry } from "./addOnRegistry";
import { DetailLine, JobRef, jobRefs } from "./addOns";
import type { ClusterData } from "./clusterData";
import { Ctun, CtunError, JobEdit } from "./ctun";
import {
  ALL_CLUSTERS,
  buildJobsTable,
  ChangesState,
  ColumnId,
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  effectiveSince,
  JobsFilters,
  JobsSort,
  JobsTableModel,
  projectLabel,
  projectOf,
  RowExtras,
  sortProjects,
  UNASSIGNED,
} from "./jobsTable";
import { StateGroupId, stateGroup } from "./jobStates";
import type { HiddenProjects } from "./hiddenProjects";
import { normalizeProject, selfAndAncestors } from "./projectTree";

/** Each refresh runs `sacct` on a login node, so not more often than this. */
const AUTO_REFRESH_MS = 60_000;

/** What the panel needs from the rest of the extension. */
export interface JobsPanelServices {
  data: ClusterData;
  hiddenProjects: HiddenProjects;
  addOns: AddOnRegistry;
  ctun: () => Ctun;
  /** Every project of all time and every draft, for Move to Project. */
  knownProjects: () => string[];
  loadChanges: (cluster: string, workdir: string, fromCommit: string, toCommit: string) => Promise<ChangesState>;
}

/** Messages the webview sends; it never gets data any other way than `postMessage`. */
type WebviewMessage =
  | { type: "ready" }
  | { type: "toggle"; group: StateGroupId }
  | { type: "pickCluster"; cluster: string }
  | { type: "toggleProject"; project: string }
  | { type: "sort"; column: ColumnId }
  | { type: "pickSince"; since: string }
  | { type: "refresh" }
  | { type: "login"; cluster: string }
  | { type: "expand"; key: string }
  | { type: "select"; key: string; extend: "toggle" | "range" }
  | { type: "clearSelection" }
  | { type: "moveToProject" }
  | { type: "dropOnProject"; keys: string[]; project: string }
  | { type: "setMode"; mode: JobsTableModel["mode"] }
  | { type: "review"; key: string; action: "confirm" | "edit" | "discard" }
  | { type: "loadChanges"; key: string }
  | { type: "showJob"; key: string }
  | { type: "openUrl"; url: string }
  | { type: "runCommand"; command: string };

/** The "Cluster jobs" editor tab: one list of every live cluster's jobs. */
export class JobsPanel {
  private static current: JobsPanel | undefined;

  private filters: JobsFilters = DEFAULT_FILTERS;
  private mode: JobsTableModel["mode"] = "jobs";
  private readonly expanded = new Set<string>();
  private readonly selected = new Set<string>();
  /** The row a Shift-click selects from: the last one clicked or Ctrl-clicked. */
  private selectionAnchor: string | undefined;
  /** Folded project bands; kept while the tab is open. */
  private readonly collapsedProjects = new Set<string>();
  /** Kept while the tab is open. */
  private sort = DEFAULT_SORT;
  private readonly extras = new Map<string, RowExtras>();
  private refreshTimer: NodeJS.Timeout | undefined;
  private refreshing = false;
  /** The row the webview scrolls to; `serial` grows with each request, so the same row can be revealed again. */
  private reveal: { key: string; serial: number } | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static show(extensionUri: vscode.Uri, services: JobsPanelServices): JobsPanel {
    if (JobsPanel.current) {
      JobsPanel.current.panel.reveal();
      return JobsPanel.current;
    }
    const mediaRoot = vscode.Uri.joinPath(extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("ctun.jobs", "Cluster jobs", vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [mediaRoot],
    });
    JobsPanel.current = new JobsPanel(panel, mediaRoot, services);
    return JobsPanel.current;
  }

  /** The open panel, for the commands of its rows' context menu. */
  static get open(): JobsPanel | undefined {
    return JobsPanel.current;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    mediaRoot: vscode.Uri,
    private readonly services: JobsPanelServices,
  ) {
    panel.iconPath = vscode.Uri.joinPath(mediaRoot, "clusters.svg");
    panel.webview.html = renderHtml(panel.webview, mediaRoot);
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => void this.handle(message)),
      panel.onDidChangeViewState(() => this.followVisibility()),
      panel.onDidDispose(() => this.dispose()),
      services.data.onDidChange(() => this.post()),
      services.hiddenProjects.onDidChange(() => this.post()),
      services.addOns.onDidChange(() => this.reloadAddOnLines()),
    );
    services.data.since = effectiveSince(this.filters);
    this.followVisibility();
  }

  /** Switches to the review cards. */
  showReviews(): void {
    this.mode = "review";
    this.post();
  }

  /** Opens one job's details and scrolls to it; no filter, state toggle or hidden project hides it. */
  revealJob(key: string): void {
    this.mode = "jobs";
    this.expanded.add(key);
    this.reveal = { key, serial: (this.reveal?.serial ?? 0) + 1 };
    const project = this.projectOfRow(key);
    for (const level of selfAndAncestors(project)) {
      this.collapsedProjects.delete(level);
    }
    void this.services.hiddenProjects.reveal(project);
    const group = this.groupOf(key);
    const shownGroups = group ? { ...this.filters.shownGroups, [group]: true } : this.filters.shownGroups;
    this.setFilters({ ...this.filters, shownGroups, cluster: ALL_CLUSTERS });
    void this.loadAddOnLines(key);
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
      case "toggleProject":
        if (!this.collapsedProjects.delete(message.project)) {
          this.collapsedProjects.add(message.project);
        }
        this.post();
        return;
      case "sort":
        this.sort = nextSort(this.sort, message.column);
        this.post();
        return;
      case "pickSince":
        this.setFilters({ ...this.filters, since: message.since });
        return;
      case "refresh":
        await this.refresh("withProjects");
        return;
      case "login":
        void vscode.commands.executeCommand("ctun.login", message.cluster);
        return;
      case "expand":
        this.selected.clear();
        this.selectionAnchor = message.key;
        this.toggleExpanded(message.key);
        return;
      case "setMode":
        this.mode = message.mode;
        this.post();
        return;
      case "select":
        this.select(message.key, message.extend);
        return;
      case "clearSelection":
        this.selected.clear();
        this.post();
        return;
      case "moveToProject":
        await this.moveToProject();
        return;
      case "dropOnProject":
        await this.moveJobs(message.keys, message.project);
        return;
      case "review":
        await this.review(message.key, message.action);
        return;
      case "loadChanges":
        await this.loadChanges(message.key);
        return;
      case "showJob":
        this.revealJob(message.key);
        return;
      case "openUrl":
        if (this.shownAddOnLines().some((line) => line.link?.url === message.url)) {
          void vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        return;
      case "runCommand":
        if (this.shownAddOnLines().some((line) => line.help?.command === message.command)) {
          void vscode.commands.executeCommand(message.command);
        }
        return;
    }
  }

  /** Applies new filters; refetches only when the window ctun needs changed. */
  private setFilters(filters: JobsFilters): void {
    this.filters = filters;
    const since = effectiveSince(filters);
    if (since !== this.services.data.since) {
      this.services.data.since = since;
      void this.refresh();
    }
    this.post();
  }

  private toggleExpanded(key: string): void {
    if (this.expanded.delete(key)) {
      this.post();
      return;
    }
    this.expanded.add(key);
    this.post();
    void this.loadAddOnLines(key);
  }

  /** Ctrl-click toggles one row; Shift-click selects the shown rows from the anchor to `key` and closes their details. */
  private select(key: string, extend: "toggle" | "range"): void {
    const shownKeys = this.shownRowKeys();
    const anchorIndex = this.selectionAnchor === undefined ? -1 : shownKeys.indexOf(this.selectionAnchor);
    if (extend === "range" && anchorIndex !== -1) {
      const keyIndex = shownKeys.indexOf(key);
      this.selected.clear();
      for (const shown of shownKeys.slice(Math.min(anchorIndex, keyIndex), Math.max(anchorIndex, keyIndex) + 1)) {
        this.selected.add(shown);
        this.expanded.delete(shown);
      }
    } else {
      if (!this.selected.delete(key)) {
        this.selected.add(key);
      }
      this.selectionAnchor = key;
    }
    this.post();
  }

  /**
   * Asks for a project and moves the jobs there: the selected ones, or only
   * `clickedKey` when its row was right-clicked outside the selection.
   */
  async moveToProject(clickedKey?: string): Promise<void> {
    const selectedKeys = this.selectedShownKeys();
    const isOutsideSelection = clickedKey !== undefined && !selectedKeys.includes(clickedKey);
    const keys = isOutsideSelection ? [clickedKey] : selectedKeys;
    const project = await this.pickProject(keys.length);
    if (project !== undefined) {
      await this.moveJobs(keys, project);
    }
  }

  /** Moves the jobs `keys` to `project` (`UNASSIGNED` clears it); the selection is cleared once they moved. */
  async moveJobs(keys: readonly string[], project: string): Promise<void> {
    const jobs = this.jobsOf(keys);
    if (jobs.length === 0) {
      return;
    }
    const edit = { project: project === UNASSIGNED ? "" : project };
    if (await this.edit(jobs, edit, `Moving ${countText(jobs.length)} to ${projectLabel(project)}…`)) {
      this.selected.clear();
    }
  }

  /** Asks for the job's note and stores it as confirmed, since a human wrote it; an empty note removes it. */
  async editNote(key: string): Promise<void> {
    const [job] = this.jobsOf([key]);
    if (!job) {
      return;
    }
    const text = await vscode.window.showInputBox({
      title: `Note for job ${job.jobId}`,
      value: job.record?.note ?? "",
      prompt: "Saved in the job's record on the cluster, as confirmed. Leave it empty to remove the note.",
    });
    if (text === undefined) {
      return;
    }
    const edit: JobEdit = text.trim() ? { note: text, confirmNote: true } : { note: "" };
    await this.edit([job], edit, `Saving the note of job ${job.jobId}…`);
  }

  private async review(key: string, action: "confirm" | "edit" | "discard"): Promise<void> {
    if (action === "edit") {
      await this.editNote(key);
      return;
    }
    const edit: JobEdit = action === "confirm" ? { confirmNote: true } : { note: "" };
    await this.edit(this.jobsOf([key]), edit, action === "confirm" ? "Confirming the note…" : "Removing the note…");
  }

  /** Quick pick of the known projects, Unassigned and a new one; undefined when cancelled. */
  private async pickProject(jobCount: number): Promise<string | undefined> {
    const projectItems = sortProjects(new Set([...this.services.knownProjects(), UNASSIGNED])).map((project) => ({
      label: projectLabel(project),
      project,
    }));
    const newProjectItem = { label: "$(add) New project…", project: undefined };
    const picked = await vscode.window.showQuickPick([newProjectItem, ...projectItems], {
      title: `Move ${countText(jobCount)} to project`,
    });
    if (picked !== newProjectItem) {
      return picked?.project;
    }
    const name = await vscode.window.showInputBox({
      title: `Move ${countText(jobCount)} to a new project`,
      prompt: "A / nests it, e.g. htfm/multihead.",
      validateInput: (value) => (normalizeProject(value) ? undefined : "Give the project a name."),
    });
    return name === undefined ? undefined : normalizeProject(name);
  }

  /** Runs one `ctun jobs edit` per cluster, then reloads all jobs; shows ctun's error and returns false if one fails. */
  private async edit(jobs: readonly JobRef[], edit: JobEdit, progressTitle: string): Promise<boolean> {
    const ctun = this.services.ctun();
    const jobIdsByCluster = new Map<string, string[]>();
    for (const job of jobs) {
      jobIdsByCluster.set(job.cluster, [...(jobIdsByCluster.get(job.cluster) ?? []), job.jobId]);
    }
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: progressTitle }, async () => {
        for (const [cluster, jobIds] of jobIdsByCluster) {
          await ctun.editJobs(cluster, jobIds, edit);
        }
      });
      return true;
    } catch (error) {
      if (!(error instanceof CtunError)) {
        throw error;
      }
      void vscode.window.showErrorMessage(error.message);
      return false;
    } finally {
      await this.refresh("withProjects");
    }
  }

  private jobsOf(keys: readonly string[]): JobRef[] {
    return jobRefs(this.services.data.jobs).filter((job) => keys.includes(job.key));
  }

  private shownRowKeys(): string[] {
    return this.model().groups.flatMap((band) => band.rows.map((row) => row.key));
  }

  private selectedShownKeys(): string[] {
    return this.shownRowKeys().filter((key) => this.selected.has(key));
  }

  private projectOfRow(key: string): string {
    return projectOf(jobRefs(this.services.data.jobs).find((job) => job.key === key)?.record);
  }

  private groupOf(key: string): StateGroupId | undefined {
    const [cluster, ...jobIdParts] = key.split("/");
    const jobId = jobIdParts.join("/");
    const job = this.services.data.jobsOf(cluster)?.jobs.find((candidate) => candidate.jobid === jobId);
    return job && stateGroup(job);
  }

  private async loadAddOnLines(key: string): Promise<void> {
    const { addOns, data } = this.services;
    const job = jobRefs(data.jobs).find((candidate) => candidate.key === key);
    const labels = addOns.detailLabels();
    if (!job || labels.length === 0) {
      this.setExtras(key, { addOnLines: undefined });
      return;
    }
    this.setExtras(key, { addOnLines: { state: "loading", labels } });
    this.setExtras(key, { addOnLines: { state: "loaded", lines: await addOns.detailLines(job) } });
  }

  /** The add-on lines on screen; the webview may only open their links and run their commands. */
  private shownAddOnLines(): DetailLine[] {
    return [...this.extras.values()].flatMap(({ addOnLines }) => (addOnLines?.state === "loaded" ? addOnLines.lines : []));
  }

  private async loadChanges(key: string): Promise<void> {
    const row = this.model().groups.flatMap((group) => group.rows).find((candidate) => candidate.key === key);
    const request = row?.details?.changesRequest;
    if (!request) {
      return;
    }
    this.setExtras(key, { changes: { state: "loading" } });
    const { cluster, workdir, fromCommit, toCommit } = request;
    this.setExtras(key, { changes: await this.services.loadChanges(cluster, workdir, fromCommit, toCommit) });
  }

  /** An add-on changed, e.g. its key or settings: the open rows ask again. */
  private reloadAddOnLines(): void {
    for (const key of this.expanded) {
      void this.loadAddOnLines(key);
    }
  }

  private setExtras(key: string, update: RowExtras): void {
    this.extras.set(key, { ...this.extras.get(key), ...update });
    this.post();
  }

  /** `ifStale` when the tab shows again, `jobs` for the timer and a new window, `withProjects` for Refresh and after an edit. */
  private async refresh(scope: "ifStale" | "jobs" | "withProjects" = "jobs"): Promise<void> {
    const { data } = this.services;
    const loads = { ifStale: () => data.refreshIfStale(), jobs: () => data.refresh(), withProjects: () => data.refreshWithProjects() };
    this.refreshing = true;
    this.post();
    try {
      await loads[scope]();
    } finally {
      this.refreshing = false;
      this.post();
    }
  }

  /** Refreshes when the tab shows, unless the data is fresh, and every minute while it stays visible. */
  private followVisibility(): void {
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
    if (this.panel.visible) {
      void this.refresh("ifStale");
      this.refreshTimer = setInterval(() => void this.refresh(), AUTO_REFRESH_MS);
    }
  }

  private model(): JobsTableModel {
    const { statuses, jobs, loggingIn, updatedAt } = this.services.data;
    return buildJobsTable({
      statuses,
      report: jobs,
      loggingIn,
      filters: this.filters,
      updatedAt,
      mode: this.mode,
      expanded: this.expanded,
      selected: this.selected,
      extras: this.extras,
      collapsedProjects: this.collapsedProjects,
      sort: this.sort,
      hiddenProjects: this.services.hiddenProjects.all(),
    });
  }

  private post(): void {
    void this.panel.webview.postMessage({
      type: "model",
      model: this.model(),
      refreshing: this.refreshing,
      error: this.services.data.error?.message,
      reveal: this.reveal,
    });
  }

  private dispose(): void {
    clearInterval(this.refreshTimer);
    this.disposables.forEach((disposable) => disposable.dispose());
    JobsPanel.current = undefined;
  }
}

/** `1 job`, `3 jobs`. */
function countText(jobCount: number): string {
  return jobCount === 1 ? "1 job" : `${jobCount} jobs`;
}

/** A click on a column sorts it ascending, then descending, then back to the default sort. */
function nextSort(current: JobsSort, column: ColumnId): JobsSort {
  if (current.column !== column) {
    return { column, direction: "ascending" };
  }
  if (current.direction === "ascending") {
    return { column, direction: "descending" };
  }
  const isDefault = column === DEFAULT_SORT.column && current.direction === DEFAULT_SORT.direction;
  return isDefault ? { column, direction: "ascending" } : DEFAULT_SORT;
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
