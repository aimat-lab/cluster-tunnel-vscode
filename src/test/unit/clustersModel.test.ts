import * as assert from "assert";
import { test } from "node:test";
import { buildClustersModel } from "../../clustersModel";
import { GUARDED_STATUS, JOBS, LOGGED_OUT_STATUS } from "../fixtures/ctunOutput";

const jobsOf = () => ({ jobs: JOBS, error: null });

test("a live cluster lists its details; a logged-out one has none", () => {
  const model = buildClustersModel({ statuses: [GUARDED_STATUS, LOGGED_OUT_STATUS], loggingIn: new Set(), jobsOf, loaded: true });
  const [live, loggedOut] = model.clusters;
  assert.strictEqual(live.state, "live");
  assert.deepStrictEqual(
    live.details.map((detail) => [detail.label, detail.action]),
    [["Session", undefined], ["Budget", undefined], ["Commands", "showCommands"], ["Jobs", "showJobs"]],
  );
  assert.ok(Math.abs(live.budgetFraction! - 0.3692) < 0.001);
  assert.deepStrictEqual([loggedOut.state, loggedOut.details], ["loggedOut", []]);
});

test("a cluster whose login is running shows as logging in, even while live", () => {
  const model = buildClustersModel({ statuses: [GUARDED_STATUS], loggingIn: new Set(["haicore"]), jobsOf, loaded: true });
  assert.strictEqual(model.clusters[0].state, "loggingIn");
});
