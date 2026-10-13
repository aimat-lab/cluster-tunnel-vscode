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
  assert.deepStrictEqual(report, ["jobs", "--json", "--since", "24h"]);
});

test("maps ctun's exit code 10 to login_required", async () => {
  await assert.rejects(fakeCtun("exit:10").status(), (error: CtunError) => {
    assert.strictEqual(error.kind, "login_required");
    assert.match(error.stderr, /ctun-error: some_marker/);
    return true;
  });
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
