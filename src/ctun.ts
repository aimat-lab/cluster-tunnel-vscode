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

/** One job of `ctun jobs --json`; every field is a string as Slurm prints it. */
export interface Job {
  source: "active" | "done";
  jobid: string;
  state: string;
  elapsed: string;
  timelimit: string;
  partition: string;
  nodes: string;
  name: string;
}

/** One cluster's entry in `ctun jobs --json`. */
export interface ClusterJobsEntry {
  cluster: string;
  live: boolean;
  error: string | null;
  jobs: Job[];
}

/** The whole output of `ctun jobs --json`. */
export interface JobsReport {
  since_minutes: number;
  clusters: ClusterJobsEntry[];
}

export type CtunErrorKind =
  | "login_required"
  | "budget_exhausted"
  | "budget_guard_error"
  | "timeout"
  | "not_found"
  | "malformed_json"
  | "failed";

/** ctun's own exit codes (`cluster_tunnel.constants.ExitCode`). */
const EXIT_CODE_KINDS: Record<number, CtunErrorKind> = {
  10: "login_required",
  11: "budget_exhausted",
  12: "budget_guard_error",
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
}

/**
 * Runs the ctun CLI and parses its JSON output.
 *
 * `launcher` is the command line that starts ctun, e.g. `["ctun"]`. Arguments go
 * to ctun as argv without a shell. No method takes a secret.
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

  /** Runs ctun with `args` and returns its stdout; throws a `CtunError` on failure. */
  run(args: readonly string[], options: RunOptions = {}): Promise<string> {
    const [file, ...launcherArgs] = this.launcher;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    return new Promise((resolve, reject) => {
      execFile(
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
