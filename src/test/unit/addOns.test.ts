import * as assert from "assert";
import { afterEach, test } from "node:test";
import { loadChanges, parseGitLog } from "../../codeChanges";
import { REVIEWS_STATE_KEY, ReviewMemento, reviewKey, ReviewStore } from "../../reviews";
import { record } from "../fixtures/ctunOutput";
import { fakeCtun } from "../fixtures/launchFakeCtun";

afterEach(() => {
  delete process.env.FAKE_CTUN;
});

class MemoryMemento implements ReviewMemento {
  readonly values = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

test("reviews are stored under one key per Slurm cluster and job", async () => {
  const memento = new MemoryMemento();
  const store = new ReviewStore(memento);
  const key = reviewKey(record("101"), "haicore");
  assert.strictEqual(key, "haic/101");
  assert.strictEqual(reviewKey(record("5", { slurm_cluster: null }), "haicore"), "haicore/5");

  await store.set(key, "edited", "Better text.");
  await store.set("haic/102", "discarded");
  assert.deepStrictEqual(store.get(key)?.text, "Better text.");
  assert.strictEqual(store.get("haic/102")?.status, "discarded");
  assert.deepStrictEqual(Object.keys(memento.values.get(REVIEWS_STATE_KEY) as object), ["haic/101", "haic/102"]);
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
