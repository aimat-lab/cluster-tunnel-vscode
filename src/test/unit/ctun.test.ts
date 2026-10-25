import * as assert from "assert";
import * as path from "path";
import { afterEach, test } from "node:test";
import { Ctun, CtunError } from "../../ctun";
import { fakeCtun } from "../fixtures/launchFakeCtun";

afterEach(() => {
  delete process.env.FAKE_CTUN;
});

test("passes the arguments to ctun and parses its JSON", async () => {
  const report = await fakeCtun("echo-args").jobs("24h");
  assert.deepStrictEqual(report, ["jobs", "list", "--json", "--since", "24h"]);
});

test("passes a job edit as one option per field, so a value may start with a dash", async () => {
  const ctun = fakeCtun("echo-args");
  const moved = await ctun.editJobs("haicore", ["51319", "51322"], { project: "" });
  assert.deepStrictEqual(moved, ["-t", "haicore", "jobs", "edit", "51319", "51322", "--project="]);
  const noted = await ctun.editJobs("haicore", ["51319"], { note: "-lr halved", confirmNote: true });
  assert.deepStrictEqual(noted, ["-t", "haicore", "jobs", "edit", "51319", "--note=-lr halved", "--confirm-note"]);
});

test("lists the projects of all time", async () => {
  assert.deepStrictEqual(await fakeCtun("echo-args").projects(), ["projects", "list", "--json"]);
});

test("renames a project after `--`, so a name may start with a dash", async () => {
  assert.deepStrictEqual(await fakeCtun("echo-args").renameProject("-old", "new", 3), [
    "projects",
    "rename",
    "--json",
    "--",
    "-old",
    "new",
  ]);
});

test("sends input on stdin, not in argv", async () => {
  const secret = JSON.stringify({ password: "s3cret" });
  const output = await fakeCtun("echo-stdin").run(["-t", "haicore", "login", "--credentials-stdin"], { input: secret });
  const { args, stdin } = JSON.parse(output);
  assert.strictEqual(stdin, secret);
  assert.ok(!args.join(" ").includes("s3cret"));
});

test("maps ctun's exit code 10 to login_required", async () => {
  await assert.rejects(fakeCtun("exit:10").status(), (error: CtunError) => {
    assert.strictEqual(error.kind, "login_required");
    assert.match(error.stderr, /ctun-error: some_marker/);
    return true;
  });
});

test("maps exit code 13 to note_reference_invalid", async () => {
  await assert.rejects(fakeCtun("exit:13").status(), { kind: "note_reference_invalid" });
});

test("maps any other exit code to failed", async () => {
  await assert.rejects(fakeCtun("exit:1").status(), { kind: "failed" });
});

test("rejects malformed JSON", async () => {
  await assert.rejects(fakeCtun("garbage").status(), { kind: "malformed_json" });
});

test("kills ctun after the timeout", async () => {
  await assert.rejects(fakeCtun("hang", 300).status(), { kind: "timeout" });
});

test("reports a missing executable", async () => {
  const missing = new Ctun([path.join(__dirname, "no-such-ctun")]);
  await assert.rejects(missing.status(), { kind: "not_found" });
});
