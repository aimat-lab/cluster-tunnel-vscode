import type * as vscode from "vscode";
import type { JobRecord, JobsReport } from "./ctun";
import { rowKey } from "./jobsTable";
import type { SetupCheck } from "./setupChecks";

/** A job as add-ons see it: listed by Slurm, or only recorded by ctun. */
export interface JobRef {
  /** `<cluster>/<job id>`, the key of the job's row. */
  key: string;
  /** The cluster's name in the ctun config. */
  cluster: string;
  /** Slurm's ClusterName, which the job sees as `SLURM_CLUSTER_NAME`; null when ctun did not report it. */
  slurmCluster: string | null;
  jobId: string;
  name: string;
  /** The Slurm state; undefined for a recorded job Slurm no longer lists. */
  state: string | undefined;
  record: JobRecord | null;
}

/** One line in a job's details, e.g. `Training  epoch 31 · val/loss 0.691  W&B ↗`. */
export interface DetailLine {
  label: string;
  text: string;
  /** Shown muted: nothing found, or the add-on is not set up. */
  muted?: boolean;
  link?: { label: string; url: string };
  /** A command that helps when the line found nothing. */
  help?: { label: string; command: string };
}

/** What a library such as W&B adds to the core. Every part is optional. */
export interface AddOn {
  readonly id: string;
  readonly label: string;
  /** False while the add-on is switched off; the core then asks it for nothing but its Setup row. */
  readonly active: boolean;
  /** Fires when the add-on's answers may have changed, e.g. its key or settings. */
  readonly onDidChange: vscode.Event<void>;
  /** Lines for one job's details; called when they open. */
  detailLines?(job: JobRef): Promise<DetailLine[]>;
  setupCheck?(): Promise<SetupCheck>;
}

/** Every job of the report as add-ons see it: the listed ones, then those only recorded. */
export function jobRefs(report: JobsReport | undefined): JobRef[] {
  return (report?.clusters ?? []).flatMap((entry) => {
    const slurmCluster = entry.slurm_cluster ?? null;
    const listed = entry.jobs.map((job) => ({
      key: rowKey(entry.cluster, job.jobid),
      cluster: entry.cluster,
      slurmCluster,
      jobId: job.jobid,
      name: job.name,
      state: job.state as string | undefined,
      record: job.record ?? null,
    }));
    const recorded = (entry.records_without_job ?? []).map((record) => ({
      key: rowKey(entry.cluster, record.job_id),
      cluster: entry.cluster,
      slurmCluster,
      jobId: record.job_id,
      name: record.job_name ?? "",
      state: undefined,
      record,
    }));
    return [...listed, ...recorded];
  });
}
