import type { JobRef } from "../../addOns";
import type { TaggedRun } from "./client";

type TaggedJob = Pick<JobRef, "jobId" | "slurmCluster">;

/**
 * The tags that link a run to `job`, preferred first: `slurm:<ClusterName>:<job id>`,
 * then the older `slurm:<job id>`, which cannot tell clusters apart.
 */
export function jobTags(job: TaggedJob): string[] {
  const bareTag = `slurm:${job.jobId}`;
  return job.slurmCluster ? [`slurm:${job.slurmCluster}:${job.jobId}`, bareTag] : [bareTag];
}

/** The run tagged with `job`'s most specific tag. */
export function runForJob<Run extends Pick<TaggedRun, "tags">>(job: TaggedJob, runs: readonly Run[]): Run | undefined {
  for (const tag of jobTags(job)) {
    const run = runs.find((candidate) => candidate.tags.includes(tag));
    if (run) {
      return run;
    }
  }
  return undefined;
}

/** The project of each job that has a tagged run, by `JobRef.key`. */
export function projectsByJob(jobs: readonly JobRef[], runs: readonly TaggedRun[]): Map<string, string> {
  return new Map(
    jobs.flatMap((job) => {
      const run = runForJob(job, runs);
      return run ? [[job.key, run.project]] : [];
    }),
  );
}

/** `epoch 31 · val/loss 0.691 · val/mae_T_trans 38.3`; `running, no metrics yet` without either. */
export function trainingSummary(run: Pick<TaggedRun, "state" | "summary">, metricNames: readonly string[]): string {
  const parts = typeof run.summary.epoch === "number" ? [`epoch ${run.summary.epoch}`] : [];
  for (const name of metricNames) {
    const value = run.summary[name];
    if (typeof value === "number") {
      parts.push(`${name} ${formatMetric(value)}`);
    }
  }
  return parts.join(" · ") || `${run.state}, no metrics yet`;
}

function formatMetric(value: number): string {
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toPrecision(3);
}
