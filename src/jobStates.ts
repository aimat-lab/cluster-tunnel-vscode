import type { Job } from "./ctun";

export type StateGroupId = "running" | "queued" | "completed" | "failed" | "cancelled";

/** The table's state toggles, each covering the Slurm base states it groups. */
export const STATE_GROUPS: readonly { id: StateGroupId; label: string; states: readonly string[] }[] = [
  { id: "running", label: "Running", states: ["RUNNING", "CONFIGURING", "COMPLETING"] },
  { id: "queued", label: "Queued", states: ["PENDING", "REQUEUED", "SUSPENDED"] },
  { id: "completed", label: "Completed", states: ["COMPLETED"] },
  {
    id: "failed",
    label: "Failed",
    states: ["FAILED", "TIMEOUT", "OUT_OF_MEMORY", "NODE_FAIL", "BOOT_FAIL", "DEADLINE", "PREEMPTED"],
  },
  { id: "cancelled", label: "Cancelled", states: ["CANCELLED"] },
];

/** The Slurm state without its suffix: `CANCELLED by 504768` → `CANCELLED`. */
export function baseState(job: Job): string {
  return job.state.split(" ")[0];
}

/** The toggle group a job belongs to, or undefined for a state no toggle covers. */
export function stateGroup(job: Job): StateGroupId | undefined {
  const state = baseState(job);
  return STATE_GROUPS.find((group) => group.states.includes(state))?.id;
}

/** Counts a cluster's running and queued jobs. */
export function activeCounts(jobs: readonly Job[]): { running: number; queued: number } {
  return {
    running: jobs.filter((job) => stateGroup(job) === "running").length,
    queued: jobs.filter((job) => stateGroup(job) === "queued").length,
  };
}
