import type { ClusterStatus, Job, JobsReport } from "./ctun";
import { baseState, STATE_GROUPS, StateGroupId, stateGroup } from "./jobStates";

export const SINCE_OPTIONS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
] as const;

export const ALL_CLUSTERS = "all";
const FINISHED_GROUPS: readonly StateGroupId[] = ["completed", "failed", "cancelled"];

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

export interface TableInputs {
  statuses: readonly ClusterStatus[];
  report: JobsReport | undefined;
  loggingIn: ReadonlySet<string>;
  filters: JobsFilters;
  updatedAt: Date | undefined;
}

/** Everything the webview renders; it has no logic of its own. */
export interface JobsTableModel {
  toggles: { id: StateGroupId; label: string; count: number; pressed: boolean }[];
  since: string;
  sinceOptions: typeof SINCE_OPTIONS;
  chips: { id: string; label: string; pressed: boolean }[];
  rows: JobRow[];
  lockedClusters: { cluster: string; loggingIn: boolean }[];
  errors: { cluster: string; message: string }[];
  showEmpty: boolean;
  updatedText: string;
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
  active: boolean;
  partitionNodes: string;
}

/** The `--since` value for ctun: `0` skips `sacct` when no finished jobs are shown. */
export function effectiveSince(filters: JobsFilters): string {
  const showsFinished = FINISHED_GROUPS.some((group) => filters.shownGroups[group]);
  return showsFinished ? filters.since : "0";
}

export function buildJobsTable(inputs: TableInputs): JobsTableModel {
  const { statuses, report, filters } = inputs;
  const isInClusterFilter = (cluster: string) => filters.cluster === ALL_CLUSTERS || filters.cluster === cluster;
  const liveEntries = (report?.clusters ?? []).filter((entry) => entry.live && isInClusterFilter(entry.cluster));
  const jobs = liveEntries.flatMap((entry) => entry.jobs.map((job) => ({ cluster: entry.cluster, job })));
  const isShown = (job: Job) => {
    const group = stateGroup(job);
    return group === undefined || filters.shownGroups[group];
  };

  const rows = jobs.filter(({ job }) => isShown(job)).map(({ cluster, job }) => toRow(cluster, job));
  const lockedClusters = statuses
    .filter((status) => !status.live && isInClusterFilter(status.cluster))
    .map((status) => ({ cluster: status.cluster, loggingIn: inputs.loggingIn.has(status.cluster) }));

  return {
    toggles: STATE_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      count: jobs.filter(({ job }) => stateGroup(job) === group.id).length,
      pressed: filters.shownGroups[group.id],
    })),
    since: filters.since,
    sinceOptions: SINCE_OPTIONS,
    chips: [ALL_CLUSTERS, ...statuses.map((status) => status.cluster)].map((id) => ({
      id,
      label: id === ALL_CLUSTERS ? "All clusters" : id,
      pressed: filters.cluster === id,
    })),
    rows,
    lockedClusters,
    errors: liveEntries.flatMap((entry) => (entry.error ? [{ cluster: entry.cluster, message: entry.error }] : [])),
    showEmpty: rows.length === 0 && lockedClusters.length === 0,
    updatedText: inputs.updatedAt ? `Updated ${inputs.updatedAt.toLocaleTimeString()}` : "Loading…",
  };
}

export function rowKey(cluster: string, jobId: string): string {
  return `${cluster}/${jobId}`;
}

function toRow(cluster: string, job: Job): JobRow {
  const group = stateGroup(job);
  const limitSeconds = slurmDurationSeconds(job.timelimit);
  const elapsedSeconds = slurmDurationSeconds(job.elapsed);
  return {
    key: rowKey(cluster, job.jobid),
    cluster,
    id: job.jobid,
    name: job.name,
    stateLabel: stateLabel(job),
    state: job.state,
    group,
    timeText: `${job.elapsed} / ${job.timelimit}`,
    progress:
      limitSeconds && elapsedSeconds !== undefined ? Math.min(1, elapsedSeconds / limitSeconds) : undefined,
    active: group === "running" || group === "queued",
    partitionNodes: `${job.partition} · ${job.nodes}`,
  };
}

/** `PENDING` → `Queued`; any other state in sentence case: `OUT_OF_MEMORY` → `Out of memory`. */
function stateLabel(job: Job): string {
  const state = baseState(job);
  if (state === "PENDING") {
    return "Queued";
  }
  const words = state.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
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
