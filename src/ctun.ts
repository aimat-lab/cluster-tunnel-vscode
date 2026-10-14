import { execFile, ExecFileException } from "child_process";

/** One row of `ctun status -j`. */
export interface ClusterStatus {
  cluster: string;
  target: string;
  live: boolean;
  session: { session_id: string; start_epoch: number; limit: number | null; unit: string } | null;
  limit: number | null;
  unit: string | null;
  commands: { count: number; last_epoch: number | null };
  used: number | null;
  used_error: string | null;
}

/** The write-once record ctun keeps on the cluster for a job it submitted. */
export interface JobRecord {
  schema_version: number;
  slurm_cluster: string | null;
  job_id: string;
  job_name: string | null;
  project: string | null;
  note: string | null;
  /** ISO 8601, UTC. */
  submitted_at: string;
  submitted_from: string;
  /** Each fact is null when ctun could not read it. */
  code: {
    workdir?: string | null;
    commit?: string | null;
    branch?: string | null;
    pushed?: boolean | null;
    uncommitted?: string[] | null;
  };
  command: string[];
}

/** One job of `ctun jobs --json`; every Slurm field is a string as Slurm prints it. */
export interface Job {
  source: "active" | "done";
  jobid: string;
  state: string;
  elapsed: string;
  timelimit: string;
  partition: string;
  nodes: string;
  /** Start time; for a pending job Slurm's estimate, or `N/A` while it has none. Absent from older ctun. */
  start?: string;
  name: string;
  /** Present when ctun keeps job records for the cluster; null when this job has none. */
  record?: JobRecord | null;
}

/** One cluster's entry in `ctun jobs --json`. */
export interface ClusterJobsEntry {
  cluster: string;
  /** Slurm's ClusterName, which jobs see as `SLURM_CLUSTER_NAME`; absent from older ctun, null when unknown. */
  slurm_cluster?: string | null;
  live: boolean;
  error: string | null;
  jobs: Job[];
  /** Records of the window whose job squeue/sacct no longer list. */
  records_without_job?: JobRecord[];
  records_error?: string | null;
}

/** The whole output of `ctun jobs --json`. */
export interface JobsReport {
  since_minutes: number;
  clusters: ClusterJobsEntry[];
}

/** One command of `ctun -t X logs --json`. */
export interface LoggedCommand {
  epoch: number;
  command: string[];
  /** The jobs the command submitted; absent when it submitted none, and from older ctun. */
  job_ids?: string[];
}

/** The output of `ctun -t X logs --json`: the commands sent this session, oldest first. */
export interface CommandLog {
  cluster: string;
  commands: LoggedCommand[];
}

/** The parts of `ctun -t X info --json` the extension uses. */
export interface ClusterInfo {
  cluster: string;
  requires_otp: boolean;
  requires_password: boolean;
  budget: { unit: string; session_limit: number | null };
}

export type CtunErrorKind =
  | "login_required"
  | "budget_exhausted"
  | "budget_guard_error"
  | "note_reference_invalid"
  | "timeout"
  | "not_found"
  | "malformed_json"
  | "failed";

/** ctun's own exit codes (`cluster_tunnel.constants.ExitCode`). */
const EXIT_CODE_KINDS: Record<number, CtunErrorKind> = {
  10: "login_required",
  11: "budget_exhausted",
  12: "budget_guard_error",
  13: "note_reference_invalid",
};

export class CtunError extends Error {
  constructor(
    readonly kind: CtunErrorKind,
    message: string,
    readonly stderr = "",
  ) {
    super(message);
    this.name = "CtunError";
  }
}

export const DEFAULT_TIMEOUT_MS = 60_000;

export interface RunOptions {
  timeoutMs?: number;
  /** Written to ctun's stdin: the only way a secret may reach ctun. */
  input?: string;
}

/**
 * Runs the ctun CLI and parses its JSON output.
 *
 * `launcher` is the command line that starts ctun, e.g. `["ctun"]`. Arguments go
 * to ctun as argv without a shell; secrets go only through `RunOptions.input`.
 */
export class Ctun {
  constructor(
    private readonly launcher: readonly string[],
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  /**
   * Every cluster's status. ctun measures budget `used` only for one targeted
   * cluster, so pass `cluster` to get it (one remote probe).
   */
  status(cluster?: string): Promise<ClusterStatus[]> {
    return this.json<ClusterStatus[]>([...target(cluster), "status", "--json"]);
  }

  /** `since` is a ctun duration such as `24h`; `0` skips finished jobs. */
  jobs(since: string): Promise<JobsReport> {
    return this.json<JobsReport>(["jobs", "--json", "--since", since]);
  }

  /** The commands sent to `cluster` this session; a local file read, no SSH. */
  logs(cluster: string): Promise<CommandLog> {
    return this.json<CommandLog>([...target(cluster), "logs", "--json"]);
  }

  /** ctun's version, e.g. `0.5.0`. */
  async version(): Promise<string> {
    return (await this.run(["--version"])).trim();
  }

  info(cluster: string): Promise<ClusterInfo> {
    return this.json<ClusterInfo>([...target(cluster), "info", "--json"]);
  }

  /** Runs ctun with `args` and returns its stdout; throws a `CtunError` on failure. */
  run(args: readonly string[], options: RunOptions = {}): Promise<string> {
    const [file, ...launcherArgs] = this.launcher;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    return new Promise((resolve, reject) => {
      const child = execFile(
        file,
        [...launcherArgs, ...args],
        { encoding: "utf8", timeout: timeoutMs, windowsHide: true },
        (error, stdout, stderr) => {
          if (!error) {
            resolve(stdout);
            return;
          }
          reject(toCtunError(error, args, timeoutMs, stderr));
        },
      );
      child.stdin?.end(options.input ?? "");
    });
  }

  private async json<T>(args: readonly string[]): Promise<T> {
    const stdout = await this.run(args);
    try {
      return JSON.parse(stdout) as T;
    } catch {
      throw new CtunError("malformed_json", `ctun ${args.join(" ")} printed no valid JSON`, stdout);
    }
  }
}

function target(cluster: string | undefined): string[] {
  return cluster === undefined ? [] : ["-t", cluster];
}

function toCtunError(
  error: ExecFileException,
  args: readonly string[],
  timeoutMs: number,
  stderr: string,
): CtunError {
  const command = `ctun ${args.join(" ")}`;
  if (error.code === "ENOENT") {
    return new CtunError("not_found", "ctun not found; set ctun.path", stderr);
  }
  if (error.killed) {
    return new CtunError("timeout", `${command} timed out after ${timeoutMs / 1000} s`, stderr);
  }
  const exitCode = typeof error.code === "number" ? error.code : undefined;
  const kind = (exitCode !== undefined && EXIT_CODE_KINDS[exitCode]) || "failed";
  return new CtunError(kind, `${command} failed (exit ${exitCode ?? "?"}): ${stderr.trim()}`, stderr);
}
