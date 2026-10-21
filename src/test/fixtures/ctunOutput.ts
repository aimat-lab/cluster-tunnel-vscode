import type { ClusterStatus, CommandLog, Job, JobRecord, JobsReport } from "../../ctun";

// Shaped like real `ctun status -j` / `ctun jobs list --json` output.

export const GUARDED_STATUS: ClusterStatus = {
  cluster: "haicore",
  target: "user@haicore.example.org",
  live: true,
  session: { session_id: "haicore-1791801399", start_epoch: 1791801399, limit: 50, unit: "job-h" },
  limit: 50,
  unit: "job-h",
  commands: { count: 24, last_epoch: 1791821683 },
  used: 18.46,
  used_error: null,
};

export const UNGUARDED_STATUS: ClusterStatus = {
  ...GUARDED_STATUS,
  session: { ...GUARDED_STATUS.session!, limit: null },
  limit: null,
  used: null,
};

export const LOGGED_OUT_STATUS: ClusterStatus = {
  cluster: "bwuni3",
  target: "user@uc3.example.org",
  live: false,
  session: null,
  limit: null,
  unit: null,
  commands: { count: 0, last_epoch: null },
  used: null,
  used_error: null,
};

export function record(jobId: string, overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    schema_version: 1,
    slurm_cluster: "haic",
    job_id: jobId,
    job_name: "train",
    project: "htfm",
    note: null,
    submitted_at: "2026-10-12T10:00:00+00:00",
    submitted_from: "laptop",
    code: {
      workdir: "/work/repo",
      commit: "87d86d4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      branch: "main",
      pushed: true,
      uncommitted: [],
    },
    command: ["./submit.sh"],
    ...overrides,
  };
}

function job(jobid: string, state: string, source: Job["source"], jobRecord: JobRecord | null = null): Job {
  return {
    source,
    jobid,
    state,
    elapsed: "1:00:00",
    timelimit: "10:30:00",
    partition: "normal",
    nodes: "1",
    name: "train",
    record: jobRecord,
  };
}

/** The run before 101: same project and job name, an older commit, submitted earlier, failed. */
export const PREVIOUS_RECORD = record("91", {
  submitted_at: "2026-10-11T09:00:00+00:00",
  code: { workdir: "/work/repo", commit: "a60bc60bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", branch: "main", pushed: true, uncommitted: [] },
});

export const JOBS: Job[] = [
  job("101", "RUNNING", "active", record("101", { note: "Rerun of job:91 after commit:87d86d4 fixed the paths." })),
  job("102", "RUNNING", "active", record("102", { job_name: "eval", note: "Evaluation of job:101.", submitted_at: "2026-10-12T11:00:00+00:00" })),
  job("103", "PENDING", "active", record("103", { project: "legacy", code: { commit: "c41e2a9ccccccccccccccccccccccccccccccccc", pushed: false, uncommitted: ["M x"], workdir: "/w", branch: "dev" } })),
  job("90", "COMPLETED", "done"),
  job("91", "FAILED", "done", PREVIOUS_RECORD),
  job("92", "TIMEOUT", "done"),
  job("93", "OUT_OF_MEMORY", "done"),
  job("94", "CANCELLED by 504768", "done"),
];

export const JOBS_REPORT: JobsReport = {
  since_minutes: 1440,
  clusters: [
    {
      cluster: "haicore",
      live: true,
      error: null,
      jobs: JOBS,
      records_without_job: [record("80", { note: "An old sweep point.", submitted_at: "2026-10-10T08:00:00+00:00" })],
      records_error: null,
    },
    { cluster: "bwuni3", live: false, error: null, jobs: [] },
  ],
};

/** The start of the session in `COMMAND_LOG`, in epoch seconds. */
export const COMMANDS_SESSION_START = 1791900000;

function slurmJob(jobid: string, state: string, elapsed: string, start = "N/A", name = "train_htfm"): Job {
  return { source: "done", jobid, state, elapsed, timelimit: "10:30:00", partition: "normal", nodes: "1", start, name };
}

/** One job per state the Commands tab tells apart. */
export const COMMANDS_REPORT: JobsReport = {
  since_minutes: 1440,
  clusters: [
    {
      cluster: "haicore",
      live: true,
      error: null,
      jobs: [
        slurmJob("4817985", "COMPLETED", "0:42", "2026-10-13T16:14:41", "smoke_test"),
        slurmJob("4817990", "FAILED", "1:05", "2026-10-13T16:15:31", "preprocess"),
        slurmJob("4818190", "CANCELLED by 504768", "0:00"),
        slurmJob("4818213", "RUNNING", "22:41", "2026-10-13T16:19:00"),
        slurmJob("4818220", "PENDING", "0:00", "2026-10-13T18:30:00", "eval"),
        slurmJob("4818221", "PENDING", "0:00", "N/A", "eval"),
        slurmJob("4818230", "TIMEOUT", "10:30:00", "2026-10-13T05:00:00"),
        slurmJob("4818240", "CANCELLED by 504768", "3:12", "2026-10-13T16:40:00"),
        slurmJob("4818250_4", "CANCELLED by 504768", "0:00"),
      ],
    },
  ],
};

const at = (seconds: number) => COMMANDS_SESSION_START + seconds;

/** Shaped like `ctun -t haicore logs --json`; `4700000` is missing from `COMMANDS_REPORT`. */
export const COMMAND_LOG: CommandLog = {
  cluster: "haicore",
  commands: [
    { epoch: at(22), command: ["sbatch", "scripts/smoke_test.sh"], job_ids: ["4817985"] },
    { epoch: at(44), command: ["squeue", "--me"] },
    { epoch: at(72), command: ["sbatch", "scripts/preprocess.sh"], job_ids: ["4817990"] },
    { epoch: at(132), command: ["sbatch", "scripts/train_htfm.sh", "--epochs", "20"], job_ids: ["4818190"] },
    { epoch: at(164), command: ["scancel", "--signal=TERM", "4818190", "4818250_4"] },
    { epoch: at(227), command: ["sbatch", "scripts/train_htfm.sh", "--epochs", "200"], job_ids: ["4818213"] },
    { epoch: at(262), command: ["sbatch", "--dependency=afterok:4818213", "scripts/eval.sh"], job_ids: ["4818220", "4818221"] },
    { epoch: at(1046), command: ["tail", "-n", "50", "runs/4818213/slurm.out"] },
    { epoch: at(1060), command: ["sbatch", "old.sh"], job_ids: ["4700000"] },
    { epoch: at(1065), command: ["sbatch", "scripts/long.sh"], job_ids: ["4818230"] },
    { epoch: at(1070), command: ["scancel", "4818240"] },
    { epoch: at(4970), command: ["bash", "-c", "echo 'it''s done' > out.txt"] },
  ],
};
