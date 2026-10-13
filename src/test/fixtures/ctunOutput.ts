import type { ClusterStatus, Job, JobsReport } from "../../ctun";

// Shaped like real `ctun status -j` / `ctun jobs --json` output (ctun 0.5.0).

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

function job(jobid: string, state: string, source: Job["source"]): Job {
  return { source, jobid, state, elapsed: "1:00:00", timelimit: "10:30:00", partition: "normal", nodes: "1", name: "train" };
}

export const JOBS: Job[] = [
  job("101", "RUNNING", "active"),
  job("102", "RUNNING", "active"),
  job("103", "PENDING", "active"),
  job("90", "COMPLETED", "done"),
  job("91", "FAILED", "done"),
  job("92", "TIMEOUT", "done"),
  job("93", "OUT_OF_MEMORY", "done"),
  job("94", "CANCELLED by 504768", "done"),
];

export const JOBS_REPORT: JobsReport = {
  since_minutes: 1440,
  clusters: [
    { cluster: "haicore", live: true, error: null, jobs: JOBS },
    { cluster: "bwuni3", live: false, error: null, jobs: [] },
  ],
};
