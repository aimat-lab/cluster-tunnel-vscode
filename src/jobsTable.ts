import type { ClusterJobsEntry, ClusterStatus, Job, JobRecord, JobsReport } from "./ctun";
import { baseState, STATE_GROUPS, StateGroupId, stateGroup } from "./jobStates";
import { Review, reviewKey } from "./reviews";

export const SINCE_OPTIONS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
] as const;

export const ALL_CLUSTERS = "all";
export const ALL_PROJECTS = "all";
/** The project of a job submitted without `--project`, or without a record. */
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
  /** A project name, `UNASSIGNED`, or `ALL_PROJECTS`. */
  project: string;
}

export const DEFAULT_FILTERS: JobsFilters = {
  shownGroups: { running: true, queued: true, completed: true, failed: true, cancelled: true },
  since: "24h",
  cluster: ALL_CLUSTERS,
  project: ALL_PROJECTS,
};

/** Where an unavailable Training line points the user: the Setup view, or the guide to tagging runs. */
export type TrainingHelp = "setup" | "tagging";

/** Results the panel loads on demand for an expanded row. */
export type TrainingState =
  | { state: "loading" }
  | { state: "unavailable"; text: string; help?: TrainingHelp }
  | { state: "loaded"; text: string; url: string };

export type ChangesState =
  | { state: "loading" }
  | { state: "loaded"; commits: { hash: string; message: string }[] }
  | { state: "error"; text: string };

export interface RowExtras {
  training?: TrainingState;
  changes?: ChangesState;
}

export interface TableInputs {
  statuses: readonly ClusterStatus[];
  report: JobsReport | undefined;
  loggingIn: ReadonlySet<string>;
  filters: JobsFilters;
  updatedAt: Date | undefined;
  reviews: Readonly<Record<string, Review>>;
  mode: "jobs" | "review";
  /** Row keys (`<cluster>/<job id>`) whose details are open. */
  expanded: ReadonlySet<string>;
  extras: ReadonlyMap<string, RowExtras>;
}

/** Everything the webview renders; it has no logic of its own. */
export interface JobsTableModel {
  mode: "jobs" | "review";
  toggles: { id: StateGroupId; label: string; count: number; pressed: boolean }[];
  since: string;
  sinceOptions: typeof SINCE_OPTIONS;
  chips: { id: string; label: string; pressed: boolean }[];
  projects: { id: string; label: string; count: number; selected: boolean }[];
  groups: { project: string; label: string; subtitle: string; rows: JobRow[] }[];
  lockedClusters: { cluster: string; loggingIn: boolean }[];
  errors: { cluster: string; message: string }[];
  showEmpty: boolean;
  updatedText: string;
  pendingCount: number;
  reviewCards: ReviewCard[];
}

export type NoteStatus = "unreviewed" | Review["status"];

export interface NoteView {
  reviewKey: string;
  status: NoteStatus;
  /** The edited text for an edited note, else the agent's. */
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
  /** When the job started or, if queued, is estimated to start; undefined when unknown. */
  startText: string | undefined;
  active: boolean;
  partitionNodes: string;
  note: NoteView | undefined;
  expanded: boolean;
  details: JobDetails | undefined;
}

export interface JobDetails {
  hasRecord: boolean;
  code: { commit: string; branch: string; pushed: boolean | null; uncommitted: number | null; workdir: string } | undefined;
  from: string | undefined;
  previous: { id: string; cluster: string; stateLabel: string; sameCommit: boolean } | undefined;
  /** What `git log` needs to list the commits since the previous run; undefined when it can't. */
  changesRequest: { cluster: string; workdir: string; fromCommit: string; toCommit: string } | undefined;
  changes: ChangesState | undefined;
  training: TrainingState | undefined;
}

export interface ReviewCard {
  rowKey: string;
  reviewKey: string;
  cluster: string;
  id: string;
  name: string;
  stateLabel: string;
  project: string;
  submittedText: string;
  note: string;
  /** Every marked reference; ctun refused the submission if one was unknown. */
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

export function projectOf(record: JobRecord | null | undefined): string {
  return record?.project || UNASSIGNED;
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

/** Notes no human has confirmed, edited or discarded yet, newest first. */
export function pendingReviews(report: JobsReport | undefined, reviews: Readonly<Record<string, Review>>): ReviewCard[] {
  const pending = (report?.clusters ?? []).flatMap((entry) => {
    const listed = entry.jobs.flatMap((job) => (job.record ? [{ record: job.record, job: job as Job | undefined }] : []));
    const unlisted = (entry.records_without_job ?? []).map((record) => ({ record, job: undefined }));
    return [...listed, ...unlisted]
      .map(({ record, job }) => ({ entry, record, job, key: reviewKey(record, entry.cluster) }))
      .filter(({ record, key }) => record.note && !reviews[key]);
  });
  pending.sort((a, b) => (a.record.submitted_at < b.record.submitted_at ? 1 : -1));
  return pending.map(({ entry, record, job, key }) => ({
    rowKey: rowKey(entry.cluster, record.job_id),
    reviewKey: key,
    cluster: entry.cluster,
    id: record.job_id,
    name: record.job_name ?? job?.name ?? "job",
    stateLabel: job ? stateLabel(job) : "Not listed",
    project: projectLabel(projectOf(record)),
    submittedText: formatTime(record.submitted_at),
    note: record.note ?? "",
    references: noteReferences(record.note ?? ""),
  }));
}

export function buildJobsTable(inputs: TableInputs): JobsTableModel {
  const { statuses, report, filters } = inputs;
  const isInClusterFilter = (cluster: string) => filters.cluster === ALL_CLUSTERS || filters.cluster === cluster;
  const isInProjectFilter = (job: Job) => filters.project === ALL_PROJECTS || filters.project === projectOf(job.record);
  const isShown = (job: Job) => {
    const group = stateGroup(job);
    return group === undefined || filters.shownGroups[group];
  };

  const allJobs = liveJobs(report);
  const filtered = allJobs.filter(({ entry, job }) => isInClusterFilter(entry.cluster) && isInProjectFilter(job));
  const records = allRecords(report);
  const rows = filtered
    .filter(({ job }) => isShown(job))
    .map(({ entry, job }) => toRow(entry.cluster, job, inputs, records, allJobs));

  const lockedClusters = statuses
    .filter((status) => !status.live && isInClusterFilter(status.cluster))
    .map((status) => ({ cluster: status.cluster, loggingIn: inputs.loggingIn.has(status.cluster) }));
  const counts = projectCounts(report);
  const reviewCards = pendingReviews(report, inputs.reviews);

  return {
    mode: inputs.mode,
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
    projects: [
      { id: ALL_PROJECTS, label: "All projects", count: allJobs.length, selected: filters.project === ALL_PROJECTS },
      ...sortProjects([...counts.keys()]).map((project) => ({
        id: project,
        label: projectLabel(project),
        count: counts.get(project) ?? 0,
        selected: filters.project === project,
      })),
    ],
    groups: groupByProject(rows, filtered),
    lockedClusters,
    errors: (report?.clusters ?? []).flatMap((entry) => {
      if (!entry.live || !isInClusterFilter(entry.cluster)) {
        return [];
      }
      const messages = [entry.error, entry.records_error && `job records: ${entry.records_error}`];
      return messages.flatMap((message) => (message ? [{ cluster: entry.cluster, message }] : []));
    }),
    showEmpty: rows.length === 0 && lockedClusters.length === 0,
    updatedText: inputs.updatedAt ? `Updated ${inputs.updatedAt.toLocaleTimeString()}` : "Loading…",
    pendingCount: reviewCards.length,
    reviewCards,
  };
}

export function rowKey(cluster: string, jobId: string): string {
  return `${cluster}/${jobId}`;
}

export function projectLabel(project: string): string {
  return project === UNASSIGNED ? "Unassigned" : project;
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

/** Projects by name, with Unassigned last. */
export function sortProjects(projects: string[]): string[] {
  return projects.sort((a, b) => (a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b)));
}

function groupByProject(rows: JobRow[], filtered: LiveJob[]): JobsTableModel["groups"] {
  const projectByRow = new Map(filtered.map(({ entry, job }) => [rowKey(entry.cluster, job.jobid), projectOf(job.record)]));
  const groups = new Map<string, JobRow[]>();
  for (const row of rows) {
    const project = projectByRow.get(row.key) ?? UNASSIGNED;
    groups.set(project, [...(groups.get(project) ?? []), row]);
  }
  return sortProjects([...groups.keys()]).map((project) => {
    const projectRows = groups.get(project) ?? [];
    return {
      project,
      label: projectLabel(project),
      subtitle: project === UNASSIGNED ? "submitted without --project" : `${projectRows.length} shown`,
      rows: projectRows,
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
    note: job.record ? noteView(job.record, cluster, inputs.reviews) : undefined,
    expanded,
    details: expanded ? details(cluster, job, inputs.extras.get(key), records, allJobs) : undefined,
  };
}

function noteView(record: JobRecord, cluster: string, reviews: Readonly<Record<string, Review>>): NoteView | undefined {
  if (!record.note) {
    return undefined;
  }
  const key = reviewKey(record, cluster);
  const review = reviews[key];
  const text = review?.status === "edited" && review.text !== undefined ? review.text : record.note;
  const status: NoteStatus = review?.status ?? "unreviewed";
  const statusLabels: Record<NoteStatus, string> = {
    unreviewed: "Unreviewed agent draft",
    confirmed: "Confirmed by you",
    edited: "Edited by you",
    discarded: "Discarded by you",
  };
  return {
    reviewKey: key,
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
  const previous = record ? previousRun(record, records) : undefined;
  const previousJob = previous
    ? allJobs.find(({ entry, job: other }) => entry.cluster === previous.cluster && other.jobid === previous.record.job_id)
    : undefined;
  const sameCommit = Boolean(previous && code?.commit && previous.record.code.commit === code.commit);
  const fromCommit = previous?.record.code.commit;
  return {
    hasRecord: record !== undefined,
    code: code?.commit
      ? {
          commit: code.commit.slice(0, SHORT_COMMIT_LENGTH),
          branch: code.branch ?? "unknown branch",
          pushed: code.pushed ?? null,
          uncommitted: code.uncommitted?.length ?? null,
          workdir: code.workdir ?? "",
        }
      : undefined,
    from: record ? `${record.submitted_from} · ${formatTime(record.submitted_at)}` : undefined,
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
    training: extras?.training,
  };
}

/** D10: the latest earlier record with the same project and job name. */
export function previousRun(record: JobRecord, records: readonly ClusterRecord[]): ClusterRecord | undefined {
  return records
    .filter(
      (other) =>
        other.record.job_id !== record.job_id &&
        other.record.project === record.project &&
        other.record.job_name === record.job_name &&
        other.record.submitted_at < record.submitted_at,
    )
    .sort((a, b) => (a.record.submitted_at < b.record.submitted_at ? 1 : -1))[0];
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

/** `Started …`, or `Est. start …` for a queued job; undefined when ctun gave no start or Slurm has none. */
function startText(job: Job, group: StateGroupId | undefined): string | undefined {
  if (job.start === undefined) {
    return undefined;
  }
  const start = slurmTime(job.start);
  if (group === "queued") {
    return start ? `Est. start ${start}` : "No start estimate yet";
  }
  return start ? `Started ${start}` : undefined;
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
