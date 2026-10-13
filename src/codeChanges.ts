import { Ctun, CtunError } from "./ctun";
import type { ChangesState } from "./jobsTable";

const COMMIT_LIST_TIMEOUT_MS = 30_000;

/**
 * Lists the commits between two runs (D10) with `git log` in the job's working
 * directory on the cluster, through `ctun run`.
 */
export async function loadChanges(
  ctun: Ctun,
  cluster: string,
  workdir: string,
  fromCommit: string,
  toCommit: string,
): Promise<ChangesState> {
  const gitLog = ["git", "-C", workdir, "log", "--reverse", "--format=%h%x09%s", `${fromCommit}..${toCommit}`];
  try {
    const output = await ctun.run(["-t", cluster, "run", "--", ...gitLog], { timeoutMs: COMMIT_LIST_TIMEOUT_MS });
    return { state: "loaded", commits: parseGitLog(output) };
  } catch (error) {
    if (!(error instanceof CtunError)) {
      throw error;
    }
    return { state: "error", text: `git log failed: ${error.stderr.trim() || error.message}` };
  }
}

/** Parses `git log --format=%h%x09%s` output: one `<hash>\t<subject>` per line. */
export function parseGitLog(output: string): { hash: string; message: string }[] {
  return output
    .split("\n")
    .filter((line) => line.includes("\t"))
    .map((line) => {
      const [hash, ...subject] = line.split("\t");
      return { hash: hash.trim(), message: subject.join("\t").trim() };
    });
}
