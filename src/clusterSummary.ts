import type { ClusterStatus, Job } from "./ctun";
import { activeCounts } from "./jobStates";

const BUDGET_BAR_SEGMENTS = 10;

/** The detail lines the Clusters view shows under a live cluster. */
export interface ClusterSummary {
  session: string;
  budget: string;
  /** Share of the session limit used, 0–1; undefined without a limit or a measurement. */
  budgetFraction: number | undefined;
  commands: string;
  jobs: string;
}

/** The jobs ctun reported for one cluster, or the error it hit fetching them. */
export interface ClusterJobs {
  jobs: Job[];
  error: string | null;
}

export function summarize(status: ClusterStatus, clusterJobs: ClusterJobs | undefined): ClusterSummary {
  const fraction = budgetFraction(status);
  return {
    session: status.session ? `since ${formatEpoch(status.session.start_epoch)}` : "none",
    budget: budgetText(status),
    budgetFraction: fraction,
    commands: `${status.commands.count} sent this session`,
    jobs: jobsText(clusterJobs),
  };
}

/** A text bar such as `▰▰▰▱▱▱▱▱▱▱` for a fraction between 0 and 1. */
export function textBar(fraction: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * BUDGET_BAR_SEGMENTS);
  return "▰".repeat(filled) + "▱".repeat(BUDGET_BAR_SEGMENTS - filled);
}

function budgetFraction(status: ClusterStatus): number | undefined {
  if (status.limit === null || status.used === null || status.limit <= 0) {
    return undefined;
  }
  return status.used / status.limit;
}

function budgetText(status: ClusterStatus): string {
  const unit = status.unit ?? "units";
  if (status.limit === null) {
    return "no limit";
  }
  if (status.used_error !== null) {
    return `unknown of ${status.limit} ${unit}: ${status.used_error}`;
  }
  if (status.used === null) {
    return `? / ${status.limit} ${unit}`;
  }
  return `${status.used.toFixed(1)} / ${status.limit} ${unit}`;
}

function jobsText(clusterJobs: ClusterJobs | undefined): string {
  if (clusterJobs === undefined) {
    return "…";
  }
  if (clusterJobs.error !== null) {
    return "could not list jobs";
  }
  const { running, queued } = activeCounts(clusterJobs.jobs);
  return `${running} running · ${queued} queued`;
}

function formatEpoch(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
