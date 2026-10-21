import type { DetailLine } from "./addOns";
import type { ClusterJobsEntry, ClusterStatus, Job, JobRecord, JobsReport, RecordChange } from "./ctun";
import { baseState, STATE_GROUPS, StateGroupId, stateGroup } from "./jobStates";
import {
  isHiddenBy,
  leafName,
  nestingDepth,
  normalizeProject,
  PROJECT_SEPARATOR,
  selfAndAncestors,
  totalsWithNested,
  treeOrder,
} from "./projectTree";

export const SINCE_OPTIONS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
] as const;

/** The table's columns; each sorts its jobs by what it shows. */
export const COLUMNS = [
  { id: "id", label: "Cluster · ID" },
  { id: "name", label: "Job · why it runs" },
  { id: "state", label: "State" },
  { id: "start", label: "Start" },
  { id: "elapsed", label: "Elapsed / limit" },
  { id: "partition", label: "Partition · nodes" },
] as const;

export type ColumnId = (typeof COLUMNS)[number]["id"];
export type SortDirection = "ascending" | "descending";
/** The column the jobs are sorted by. */
export type JobsSort = { column: ColumnId; direction: SortDirection };
/** Newest start first; queued jobs without an estimate come before all. */
export const DEFAULT_SORT: JobsSort = { column: "start", direction: "descending" };

export const ALL_CLUSTERS = "all";
/** The project of a job whose record has none, or of a job without a record. */
export const UNASSIGNED = "unassigned";
const FINISHED_GROUPS: readonly StateGroupId[] = ["completed", "failed", "cancelled"];
const SHORT_COMMIT_LENGTH = 7;
const NOTE_PREVIEW_LENGTH = 120;
/** How Slurm prints a known time; it prints `N/A`, `Unknown` or `None` otherwise. */
const SLURM_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** What the person picked above the table. */
export interface JobsFilters {
  shownGroups: Record<StateGroupId, boolean>;
  /** One of `SINCE_OPTIONS`; the window for finished jobs. */
  since: string;
  /** A cluster name, or `ALL_CLUSTERS`. */
  cluster: string;
}

export const DEFAULT_FILTERS: JobsFilters = {
  shownGroups: { running: true, queued: true, completed: true, failed: true, cancelled: true },
  since: "24h",
  cluster: ALL_CLUSTERS,
};

/** The add-ons' lines for an expanded row; while loading, the labels of the add-ons asked. */
export type AddOnLinesState = { state: "loading"; labels: string[] } | { state: "loaded"; lines: DetailLine[] };

export type ChangesState =
  | { state: "loading" }
  | { state: "loaded"; commits: { hash: string; message: string }[] }
  | { state: "error"; text: string };

export interface RowExtras {
  addOnLines?: AddOnLinesState;
  changes?: ChangesState;
}

export interface TableInputs {
  statuses: readonly ClusterStatus[];
  report: JobsReport | undefined;
  loggingIn: ReadonlySet<string>;
  filters: JobsFilters;
  updatedAt: Date | undefined;
  mode: "jobs" | "review";
  /** Row keys (`<cluster>/<job id>`) whose details are open. */
  expanded: ReadonlySet<string>;
  extras: ReadonlyMap<string, RowExtras>;
  /** Projects whose band is folded: their jobs and nested projects are hidden. */
  collapsedProjects: ReadonlySet<string>;
  /** Sorts the jobs inside each project band. */
  sort: JobsSort;
  /** Projects whose eye is closed in the Projects view; their jobs and those nested below are left out. */
  hiddenProjects: ReadonlySet<string>;
}

/** Everything the webview renders; it has no logic of its own. */
export interface JobsTableModel {
  mode: "jobs" | "review";
  columns: { id: ColumnId; label: string; sort: SortDirection | undefined }[];
  toggles: { id: StateGroupId; label: string; count: number; pressed: boolean }[];
  since: string;
  sinceOptions: typeof SINCE_OPTIONS;
  chips: { id: string; label: string; pressed: boolean }[];
  /** One band per project in tree order, with the jobs directly in it; folded bands hide what is below. */
  groups: ProjectBand[];
  lockedClusters: { cluster: string; loggingIn: boolean }[];
  errors: { cluster: string; message: string }[];
  showEmpty: boolean;
  updatedText: string;
  pendingCount: number;
  reviewCards: ReviewCard[];
}

export interface ProjectBand {
  project: string;
  /** The deepest level's name, e.g. `multihead` for `htfm/multihead`. */
  label: string;
  depth: number;
  /** Shown jobs in the project and nested below it. */
  count: number;
  /** Why Unassigned jobs have no project; undefined for real projects. */
  note: string | undefined;
  collapsed: boolean;
  rows: JobRow[];
}

export type NoteStatus = "unreviewed" | "confirmed";

export interface NoteView {
  status: NoteStatus;
  text: string;
  preview: string;
  statusLabel: string;
}

export interface JobRow {
  key: string;
  cluster: string;
  id: string;
  name: string;
  stateLabel: string;
  /** The Slurm state as ctun printed it, e.g. `CANCELLED by 504768`. */
  state: string;
  group: StateGroupId | undefined;
  timeText: string;
  /** Elapsed share of the time limit, 0–1; undefined for an unlimited or unreadable limit. */
  progress: number | undefined;
  /** When the job started, e.g. `Oct 14, 01:53 PM`; `est. …` while queued; undefined when unknown. */
  startText: string | undefined;
  active: boolean;
  partitionNodes: string;
  note: NoteView | undefined;
  expanded: boolean;
  details: JobDetails | undefined;
}

export interface JobDetails {
  hasRecord: boolean;
  /** False for a record `ctun jobs edit` created: it has a project or note, but no submit-time facts. */
  hasFacts: boolean;
  code: { commit: string; branch: string; pushed: boolean | null; uncommitted: number | null; workdir: string } | undefined;
  from: string | undefined;
  previous: { id: string; cluster: string; stateLabel: string; sameCommit: boolean } | undefined;
  /** What `git log` needs to list the commits since the previous run; undefined when it can't. */
  changesRequest: { cluster: string; workdir: string; fromCommit: string; toCommit: string } | undefined;
  changes: ChangesState | undefined;
  addOnLines: AddOnLinesState | undefined;
  /** Each `ctun jobs edit` of the record, oldest first, e.g. `Oct 20, 04:36 PM · laptop: project htfm → htfm › mh`. */
  edits: string[];
}

export interface ReviewCard {
  rowKey: string;
  cluster: string;
  id: string;
  name: string;
  stateLabel: string;
  project: string;
  /** Undefined for a record without facts. */
  submittedText: string | undefined;
  note: string;
  /** Every marked reference; ctun refused the note if one was unknown. */
  references: string[];
}

/** The `--since` value for ctun: `0` skips `sacct` when no finished jobs are shown. */
export function effectiveSince(filters: JobsFilters): string {
  const showsFinished = FINISHED_GROUPS.some((group) => filters.shownGroups[group]);
  return showsFinished ? filters.since : "0";
}

/** The marked references in a note, as ctun checks them: `commit:<hash>` and `job:<id>`. */
export function noteReferences(note: string): string[] {
  return [...new Set(note.match(/\b(?:commit:[0-9a-fA-F]{7,40}|job:\d+(?:_\d+)?)\b/g) ?? [])];
}

/** The record's `--project` with `/` as the only level separator. */
export function projectOf(record: JobRecord | null | undefined): string {
  return normalizeProject(record?.project ?? "") || UNASSIGNED;
}

/** Jobs per project over every live cluster, for the sidebar and the project filter. */
export function projectCounts(report: JobsReport | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { job } of liveJobs(report)) {
    const project = projectOf(job.record);
    counts.set(project, (counts.get(project) ?? 0) + 1);
  }
  return counts;
}

/** Notes no human has confirmed yet, newest submission first. */
export function pendingReviews(report: JobsReport | undefined): ReviewCard[] {
  const pending = (report?.clusters ?? []).flatMap((entry) => {
    const listed = entry.jobs.flatMap((job) => (job.record ? [{ record: job.record, job: job as Job | undefined }] : []));
    const unlisted = (entry.records_without_job ?? []).map((record) => ({ record, job: undefined }));
    return [...listed, ...unlisted]
      .map(({ record, job }) => ({ entry, record, job }))
      .filter(({ record }) => record.note && !record.note_confirmed);
  });
  pending.sort((a, b) => ((a.record.submitted_at ?? "") < (b.record.submitted_at ?? "") ? 1 : -1));
  return pending.map(({ entry, record, job }) => ({
    rowKey: rowKey(entry.cluster, record.job_id),
    cluster: entry.cluster,
    id: record.job_id,
    name: record.job_name ?? job?.name ?? "job",
    stateLabel: job ? stateLabel(job) : "Not listed",
    project: projectLabel(projectOf(record)),
    submittedText: record.submitted_at ? formatTime(record.submitted_at) : undefined,
    note: record.note ?? "",
    references: noteReferences(record.note ?? ""),
  }));
}

export function buildJobsTable(inputs: TableInputs): JobsTableModel {
  const { statuses, report, filters } = inputs;
  const isInClusterFilter = (cluster: string) => filters.cluster === ALL_CLUSTERS || filters.cluster === cluster;
  const isInShownProject = ({ job }: LiveJob) => !isHiddenBy(projectOf(job.record), inputs.hiddenProjects);
  const isShown = (job: Job) => {
    const group = stateGroup(job);
    return group === undefined || filters.shownGroups[group];
  };

  const allJobs = liveJobs(report);
  const filtered = allJobs.filter((liveJob) => isInClusterFilter(liveJob.entry.cluster) && isInShownProject(liveJob));
  const records = allRecords(report);
  const rows = sorted(filtered.filter(({ job }) => isShown(job)), inputs.sort).map(({ entry, job }) =>
    toRow(entry.cluster, job, inputs, records, allJobs),
  );

  const lockedClusters = statuses
    .filter((status) => !status.live && isInClusterFilter(status.cluster))
    .map((status) => ({ cluster: status.cluster, loggingIn: inputs.loggingIn.has(status.cluster) }));
  const clusterErrors = (report?.clusters ?? []).flatMap((entry) => {
    if (!entry.live || !isInClusterFilter(entry.cluster)) {
      return [];
    }
    const messages = [entry.error, entry.records_error && `job records: ${entry.records_error}`];
    return messages.flatMap((message) => (message ? [{ cluster: entry.cluster, message }] : []));
  });
  const reviewCards = pendingReviews(report);

  return {
    mode: inputs.mode,
    columns: COLUMNS.map((column) => ({
      ...column,
      sort: inputs.sort.column === column.id ? inputs.sort.direction : undefined,
    })),
    toggles: STATE_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      count: filtered.filter(({ job }) => stateGroup(job) === group.id).length,
      pressed: filters.shownGroups[group.id],
    })),
    since: filters.since,
    sinceOptions: SINCE_OPTIONS,
    chips: [ALL_CLUSTERS, ...statuses.map((status) => status.cluster)].map((id) => ({
      id,
      label: id === ALL_CLUSTERS ? "All clusters" : id,
      pressed: filters.cluster === id,
    })),
    groups: projectBands(rows, filtered, inputs.collapsedProjects),
    lockedClusters,
    errors: clusterErrors,
    showEmpty: rows.length === 0 && lockedClusters.length === 0,
    updatedText: inputs.updatedAt ? `Updated ${inputs.updatedAt.toLocaleTimeString()}` : "Loading…",
    pendingCount: reviewCards.length,
    reviewCards,
  };
}

export function rowKey(cluster: string, jobId: string): string {
  return `${cluster}/${jobId}`;
}

/** The full path, e.g. `htfm › multihead`. */
export function projectLabel(project: string): string {
  return project === UNASSIGNED ? "Unassigned" : project.split(PROJECT_SEPARATOR).join(" › ");
}

/** The name on a project's band or option, below its parent: `multihead` for `htfm/multihead`. */
export function bandLabel(project: string): string {
  return project === UNASSIGNED ? "Unassigned" : leafName(project);
}

type LiveJob = { entry: ClusterJobsEntry; job: Job };
type ClusterRecord = { cluster: string; record: JobRecord };

function liveJobs(report: JobsReport | undefined): LiveJob[] {
  return (report?.clusters ?? []).filter((entry) => entry.live).flatMap((entry) => entry.jobs.map((job) => ({ entry, job })));
}

function allRecords(report: JobsReport | undefined): ClusterRecord[] {
  return (report?.clusters ?? []).flatMap((entry) => [
    ...entry.jobs.flatMap((job) => (job.record ? [{ cluster: entry.cluster, record: job.record }] : [])),
    ...(entry.records_without_job ?? []).map((record) => ({ cluster: entry.cluster, record })),
  ]);
}

/** Compares two jobs by what a column shows; ties keep ctun's order, since the sort is stable. */
const COMPARE_BY_COLUMN: Record<ColumnId, (a: LiveJob, b: LiveJob) => number> = {
  id: (a, b) => naturalCompare(rowKey(a.entry.cluster, a.job.jobid), rowKey(b.entry.cluster, b.job.jobid)),
  name: (a, b) => naturalCompare(a.job.name, b.job.name),
  state: (a, b) => stateRank(a.job) - stateRank(b.job) || naturalCompare(stateLabel(a.job), stateLabel(b.job)),
  start: (a, b) => compareNumbers(startEpoch(a.job), startEpoch(b.job)),
  elapsed: (a, b) => (slurmDurationSeconds(a.job.elapsed) ?? -1) - (slurmDurationSeconds(b.job.elapsed) ?? -1),
  partition: (a, b) => naturalCompare(`${a.job.partition} ${a.job.nodes}`, `${b.job.partition} ${b.job.nodes}`),
};

function sorted(jobs: LiveJob[], sort: JobsSort): LiveJob[] {
  const compare = COMPARE_BY_COLUMN[sort.column];
  const sign = sort.direction === "ascending" ? 1 : -1;
  return [...jobs].sort((a, b) => sign * compare(a, b));
}

/** When the job started or is estimated to start; a job without a time starts after all others. */
function startEpoch(job: Job): number {
  return job.start !== undefined && SLURM_TIME.test(job.start) ? Date.parse(job.start) : Number.POSITIVE_INFINITY;
}

function compareNumbers(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** `job 9` before `job 10`. */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** The state toggles' order: running, queued, completed, failed, cancelled, then states outside them. */
function stateRank(job: Job): number {
  const index = STATE_GROUPS.findIndex((group) => group.id === stateGroup(job));
  return index === -1 ? STATE_GROUPS.length : index;
}

/** Projects in tree order, with Unassigned last. */
export function sortProjects(projects: Iterable<string>): string[] {
  return treeOrder(projects, UNASSIGNED);
}

function projectBands(rows: JobRow[], filtered: LiveJob[], collapsedProjects: ReadonlySet<string>): ProjectBand[] {
  const projectByRow = new Map(filtered.map(({ entry, job }) => [rowKey(entry.cluster, job.jobid), projectOf(job.record)]));
  const rowsByProject = new Map<string, JobRow[]>();
  for (const row of rows) {
    const project = projectByRow.get(row.key) ?? UNASSIGNED;
    rowsByProject.set(project, [...(rowsByProject.get(project) ?? []), row]);
  }
  const shownCounts = totalsWithNested(new Map([...rowsByProject].map(([project, projectRows]) => [project, projectRows.length])));
  const isInFoldedProject = (project: string) => selfAndAncestors(project).slice(0, -1).some((above) => collapsedProjects.has(above));
  return sortProjects(shownCounts.keys())
    .filter((project) => !isInFoldedProject(project))
    .map((project) => {
      const collapsed = collapsedProjects.has(project);
      return {
        project,
        label: bandLabel(project),
        depth: nestingDepth(project),
        count: shownCounts.get(project) ?? 0,
        note: project === UNASSIGNED ? "no project in the job record" : undefined,
        collapsed,
        rows: collapsed ? [] : rowsByProject.get(project) ?? [],
      };
    });
}

function toRow(cluster: string, job: Job, inputs: TableInputs, records: ClusterRecord[], allJobs: LiveJob[]): JobRow {
  const group = stateGroup(job);
  const limitSeconds = slurmDurationSeconds(job.timelimit);
  const elapsedSeconds = slurmDurationSeconds(job.elapsed);
  const key = rowKey(cluster, job.jobid);
  const expanded = inputs.expanded.has(key);
  return {
    key,
    cluster,
    id: job.jobid,
    name: job.name,
    stateLabel: stateLabel(job),
    state: job.state,
    group,
    timeText: `${job.elapsed} / ${job.timelimit}`,
    progress:
      limitSeconds && elapsedSeconds !== undefined ? Math.min(1, elapsedSeconds / limitSeconds) : undefined,
    startText: startText(job, group),
    active: group === "running" || group === "queued",
    partitionNodes: `${job.partition} · ${job.nodes}`,
    note: job.record ? noteView(job.record) : undefined,
    expanded,
    details: expanded ? details(cluster, job, inputs.extras.get(key), records, allJobs) : undefined,
  };
}

function noteView(record: JobRecord): NoteView | undefined {
  const text = record.note;
  if (!text) {
    return undefined;
  }
  const status: NoteStatus = record.note_confirmed ? "confirmed" : "unreviewed";
  const statusLabels: Record<NoteStatus, string> = {
    unreviewed: "Unreviewed draft",
    confirmed: "Confirmed by you",
  };
  return {
    status,
    text,
    preview: text.length > NOTE_PREVIEW_LENGTH ? `${text.slice(0, NOTE_PREVIEW_LENGTH - 1)}…` : text,
    statusLabel: statusLabels[status],
  };
}

function details(
  cluster: string,
  job: Job,
  extras: RowExtras | undefined,
  records: ClusterRecord[],
  allJobs: LiveJob[],
): JobDetails {
  const record = job.record ?? undefined;
  const code = record?.code;
  const previous = record ? previousRun({ cluster, record }, records) : undefined;
  const previousJob = previous
    ? allJobs.find(({ entry, job: other }) => entry.cluster === previous.cluster && other.jobid === previous.record.job_id)
    : undefined;
  const sameCommit = Boolean(previous && code?.commit && previous.record.code.commit === code.commit);
  const fromCommit = previous?.record.code.commit;
  return {
    hasRecord: record !== undefined,
    hasFacts: Boolean(record?.submitted_at),
    code: code?.commit
      ? {
          commit: code.commit.slice(0, SHORT_COMMIT_LENGTH),
          branch: code.branch ?? "unknown branch",
          pushed: code.pushed ?? null,
          uncommitted: code.uncommitted?.length ?? null,
          workdir: code.workdir ?? "",
        }
      : undefined,
    from: record?.submitted_at ? `${record.submitted_from ?? "unknown machine"} · ${formatTime(record.submitted_at)}` : undefined,
    previous: previous
      ? {
          id: previous.record.job_id,
          cluster: previous.cluster,
          stateLabel: previousJob ? stateLabel(previousJob.job) : "not listed in this window",
          sameCommit,
        }
      : undefined,
    changesRequest:
      !sameCommit && fromCommit && code?.commit && code.workdir
        ? { cluster, workdir: code.workdir, fromCommit, toCommit: code.commit }
        : undefined,
    changes: extras?.changes,
    addOnLines: extras?.addOnLines,
    edits: (record?.changes ?? []).map(editText),
  };
}

/** One change of the record in a line: when, from where, and what. */
function editText(change: RecordChange): string {
  const parts = [];
  if (change.project) {
    const [before, after] = change.project.map((project) => projectLabel(normalizeProject(project ?? "") || UNASSIGNED));
    parts.push(`project ${before} → ${after}`);
  }
  if (change.note) {
    const [before, after] = change.note;
    parts.push(!before ? "note added" : !after ? "note removed" : "note changed");
  }
  if (change.note_confirmed?.[1]) {
    parts.push("note confirmed");
  }
  return `${formatTime(change.at)} · ${change.from}: ${parts.join(", ")}`;
}

/** D10: the latest earlier record with the same project and job name; a record without facts has no time to compare. */
export function previousRun(record: ClusterRecord, records: readonly ClusterRecord[]): ClusterRecord | undefined {
  const submittedAt = record.record.submitted_at;
  if (!submittedAt) {
    return undefined;
  }
  const project = projectOf(record.record);
  const earlier = records.filter(
    (other) =>
      other.record.job_id !== record.record.job_id &&
      projectOf(other.record) === project &&
      other.record.job_name === record.record.job_name &&
      other.record.submitted_at !== null &&
      other.record.submitted_at < submittedAt,
  );
  return earlier.sort((a, b) => ((a.record.submitted_at ?? "") < (b.record.submitted_at ?? "") ? 1 : -1))[0];
}

/** `PENDING` → `Queued`; any other state in sentence case: `OUT_OF_MEMORY` → `Out of memory`. */
export function stateLabel(job: Job): string {
  const state = baseState(job);
  if (state === "PENDING") {
    return "Queued";
  }
  const words = state.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The start time, or `est. …` for a queued job; undefined when ctun gave no start or Slurm has none. */
function startText(job: Job, group: StateGroupId | undefined): string | undefined {
  if (job.start === undefined) {
    return undefined;
  }
  const start = slurmTime(job.start);
  if (group === "queued") {
    return start ? `est. ${start}` : "no estimate yet";
  }
  return start;
}

/** A Slurm time in the table's format; undefined for `N/A`, `Unknown`, `None` or no time at all. */
export function slurmTime(value: string | undefined): string | undefined {
  return value !== undefined && SLURM_TIME.test(value) ? formatTime(value) : undefined;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Seconds in a Slurm duration (`D-HH:MM:SS`, `HH:MM:SS`, `MM:SS`); undefined for `UNLIMITED` and the like. */
export function slurmDurationSeconds(duration: string): number | undefined {
  const match = /^(?:(\d+)-)?(\d+)(?::(\d+))?(?::(\d+))?$/.exec(duration);
  if (!match) {
    return undefined;
  }
  const [, days, ...clockParts] = match;
  const clock = clockParts.filter((part) => part !== undefined).map(Number);
  while (clock.length < 3) {
    clock.unshift(0);
  }
  const [hours, minutes, seconds] = clock;
  return Number(days ?? 0) * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}
