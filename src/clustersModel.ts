import type { ClusterJobs } from "./clusterSummary";
import { summarize } from "./clusterSummary";
import type { ClusterStatus } from "./ctun";

export type ClusterState = "live" | "loggingIn" | "loggedOut";

/** A detail row of a live cluster; `action` makes its value a link. */
export interface ClusterDetail {
  label: string;
  value: string;
  action?: "showJobs" | "showCommands";
  tooltip?: string;
}

/** One cluster card of the Clusters view. */
export interface ClusterCard {
  name: string;
  target: string;
  state: ClusterState;
  details: ClusterDetail[];
  /** Share of the session budget used, 0–1; undefined without a limit or a measurement. */
  budgetFraction?: number;
}

/** What the Clusters webview renders; it gets nothing else. */
export interface ClustersModel {
  clusters: ClusterCard[];
  /** False until ctun first answered, so no clusters yet means "loading", not "none configured". */
  loaded: boolean;
  error?: string;
}

export interface ClustersModelInput {
  /** In the order the view shows them. */
  statuses: readonly ClusterStatus[];
  loggingIn: ReadonlySet<string>;
  jobsOf: (cluster: string) => ClusterJobs | undefined;
  loaded: boolean;
  error?: string;
}

export function buildClustersModel(input: ClustersModelInput): ClustersModel {
  return {
    clusters: input.statuses.map((status) => clusterCard(status, input)),
    loaded: input.loaded,
    error: input.error,
  };
}

function clusterCard(status: ClusterStatus, input: ClustersModelInput): ClusterCard {
  const card = { name: status.cluster, target: status.target };
  if (input.loggingIn.has(status.cluster)) {
    return { ...card, state: "loggingIn", details: [] };
  }
  if (!status.live) {
    return { ...card, state: "loggedOut", details: [] };
  }
  const clusterJobs = input.jobsOf(status.cluster);
  const summary = summarize(status, clusterJobs);
  return {
    ...card,
    state: "live",
    budgetFraction: summary.budgetFraction,
    details: [
      { label: "Session", value: summary.session },
      { label: "Budget", value: summary.budget },
      { label: "Commands", value: summary.commands, action: "showCommands" },
      { label: "Jobs", value: summary.jobs, action: "showJobs", tooltip: clusterJobs?.error ?? undefined },
    ],
  };
}
