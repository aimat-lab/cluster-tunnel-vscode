import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { test } from "node:test";
import { ensureNoteWritingFile, FetchLike, globalSkillDir, installSkill, isSkillInstalled } from "../../skill";

const CONTENTS = "https://api.github.com/repos/aimat-lab/cluster-tunnel/contents/skill";

/** GitHub's contents API with the skill at the refs in `refs`; records the URLs asked for. */
function fakeGithub(refs: string[]) {
  const urls: string[] = [];
  const fetchFn: FetchLike = async (url) => {
    urls.push(url);
    const listing = /\?ref=(.+)$/.exec(url);
    if (listing) {
      const found = refs.includes(decodeURIComponent(listing[1]));
      const entries = [
        { type: "file", name: "SKILL.md", download_url: `https://raw/${listing[1]}/SKILL.md` },
        { type: "dir", name: "assets", download_url: "" },
      ];
      return { ok: found, status: found ? 200 : 404, json: async () => entries, text: async () => "" };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => `# skill from ${url}` };
  };
  return { fetchFn, urls };
}

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "ctun-skill-"));
}

test("the global skill folder is under CLAUDE_CONFIG_DIR, else ~/.claude", () => {
  assert.strictEqual(globalSkillDir({}, "home"), path.join("home", ".claude", "skills", "cluster-tunnel"));
  assert.strictEqual(globalSkillDir({ CLAUDE_CONFIG_DIR: "cfg" }, "home"), path.join("cfg", "skills", "cluster-tunnel"));
});

test("installs the skill files at the tag of the ctun version", async () => {
  const skillDir = path.join(await tempDir(), "cluster-tunnel");
  assert.strictEqual(await isSkillInstalled(skillDir), false);
  const { fetchFn, urls } = fakeGithub(["v0.5.0", "main"]);

  assert.strictEqual(await installSkill(skillDir, "0.5.0", fetchFn), "v0.5.0");
  assert.strictEqual(urls[0], `${CONTENTS}?ref=v0.5.0`);
  assert.strictEqual(await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8"), "# skill from https://raw/v0.5.0/SKILL.md");
  assert.deepStrictEqual(await fs.readdir(skillDir), ["SKILL.md"]);
  assert.strictEqual(await isSkillInstalled(skillDir), true);
});

test("falls back to main when the version has no tag", async () => {
  const skillDir = path.join(await tempDir(), "cluster-tunnel");
  const { fetchFn } = fakeGithub(["main"]);
  assert.strictEqual(await installSkill(skillDir, "0.6.0.dev1", fetchFn), "main");
  await assert.rejects(installSkill(skillDir, "0.6.0", fakeGithub([]).fetchFn), /no skill files at v0\.6\.0 or main/);
});

test("makes the note directions from a template once and keeps the user's text after", async () => {
  const skillDir = await tempDir();
  const file = await ensureNoteWritingFile(skillDir);
  assert.strictEqual(path.basename(file), "writing-notes.local.md");
  assert.match(await fs.readFile(file, "utf8"), /^# My directions for job notes/);

  await fs.writeFile(file, "Always name the learning rate.", "utf8");
  await ensureNoteWritingFile(skillDir);
  assert.strictEqual(await fs.readFile(file, "utf8"), "Always name the learning rate.");
});
