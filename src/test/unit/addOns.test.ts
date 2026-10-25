import * as assert from "assert";
import { afterEach, test } from "node:test";
import { loadChanges, parseGitLog } from "../../codeChanges";
import { fakeCtun } from "../fixtures/launchFakeCtun";

afterEach(() => {
  delete process.env.FAKE_CTUN;
});

test("parses git log lines, keeping tabs inside the subject", () => {
  assert.deepStrictEqual(parseGitLog("a60bc60\tKeep one\n\n87d86d4\tFix\tpaths\n"), [
    { hash: "a60bc60", message: "Keep one" },
    { hash: "87d86d4", message: "Fix\tpaths" },
  ]);
});

test("loads the commits between two runs through ctun run", async () => {
  const changes = await loadChanges(fakeCtun("git-log"), "haicore", "/work/repo", "a60bc60", "87d86d4");
  assert.deepStrictEqual(changes, {
    state: "loaded",
    commits: [
      { hash: "a60bc60", message: "Keep one MAGNDATA entry per formula" },
      { hash: "87d86d4", message: "Fix leftover paths\tafter the refactoring" },
    ],
  });
});

test("a failing git log becomes an error state", async () => {
  const changes = await loadChanges(fakeCtun("exit:128"), "haicore", "/work/repo", "a", "b");
  assert.strictEqual(changes.state, "error");
});
