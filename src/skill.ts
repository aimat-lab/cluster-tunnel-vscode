import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

/** ctun's agent skill on GitHub; its README has the install steps. */
export const SKILL_DOCS_URL = "https://github.com/aimat-lab/cluster-tunnel/tree/main/skill";
const SKILL_CONTENTS_URL = "https://api.github.com/repos/aimat-lab/cluster-tunnel/contents/skill";
const SKILL_NAME = "cluster-tunnel";
const SKILL_ENTRY = "SKILL.md";
const HTTP_NOT_FOUND = 404;

export type FetchLike = (url: string, init?: { headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** Where Claude Code looks for the skill: `<CLAUDE_CONFIG_DIR or ~/.claude>/skills/cluster-tunnel`. */
export function globalSkillDir(env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string {
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(homeDir, ".claude");
  return path.join(configDir, "skills", SKILL_NAME);
}

/** True when the skill's entry file is there; a folder without it does not count. */
export async function isSkillInstalled(skillDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(skillDir, SKILL_ENTRY));
    return true;
  } catch {
    return false;
  }
}

/**
 * Downloads ctun's `skill/` at the tag of `ctunVersion` into `skillDir`, or from `main`
 * when that tag does not exist (a development install). Returns the ref it used.
 */
export async function installSkill(skillDir: string, ctunVersion: string, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<string> {
  const tag = `v${ctunVersion}`;
  let ref = tag;
  let files = await listSkillFiles(ref, fetchFn);
  if (files === undefined) {
    ref = "main";
    files = await listSkillFiles(ref, fetchFn);
  }
  if (files === undefined || files.length === 0) {
    throw new Error(`no skill files at ${tag} or main`);
  }
  await fs.mkdir(skillDir, { recursive: true });
  for (const file of files) {
    const response = await fetchFn(file.download_url, { headers: {} });
    if (!response.ok) {
      throw new Error(`downloading ${file.name} failed: HTTP ${response.status}`);
    }
    await fs.writeFile(path.join(skillDir, file.name), await response.text(), "utf8");
  }
  return ref;
}

interface GithubEntry {
  type: string;
  name: string;
  download_url: string;
}

/** The files of `skill/` at `ref`; undefined when the ref does not exist. */
async function listSkillFiles(ref: string, fetchFn: FetchLike): Promise<GithubEntry[] | undefined> {
  const response = await fetchFn(`${SKILL_CONTENTS_URL}?ref=${encodeURIComponent(ref)}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (response.status === HTTP_NOT_FOUND) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`GitHub answered HTTP ${response.status}`);
  }
  const entries = (await response.json()) as GithubEntry[];
  return entries.filter((entry) => entry.type === "file");
}
