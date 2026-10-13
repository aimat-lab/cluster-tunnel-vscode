import * as assert from "assert";
import { test } from "node:test";
import type { JobsReport } from "../../ctun";
import { buildJobsTable, DEFAULT_FILTERS, effectiveSince, JobsFilters, slurmDurationSeconds, TableInputs } from "../../jobsTable";
import { GUARDED_STATUS, JOBS, JOBS_REPORT, LOGGED_OUT_STATUS } from "../fixtures/ctunOutput";

function table(overrides: Partial<Omit<TableInputs, "filters">> & { filters?: Partial<JobsFilters> } = {}) {
  const { filters, ...rest } = overrides;
  return buildJobsTable({
    statuses: [LOGGED_OUT_STATUS, GUARDED_STATUS],
    report: JOBS_REPORT,
    loggingIn: new Set(),
    updatedAt: undefined,
    ...rest,
    filters: { ...DEFAULT_FILTERS, ...filters },
  });
}

test("renders every state with its label", () => {
  const model = table();
  assert.deepStrictEqual(
    model.rows.map((row) => row.stateLabel),
    ["Running", "Running", "Queued", "Completed", "Failed", "Timeout", "Out of memory", "Cancelled"],
  );
  assert.deepStrictEqual(
    model.toggles.map((toggle) => [toggle.id, toggle.count]),
    [["running", 2], ["queued", 1], ["completed", 1], ["failed", 3], ["cancelled", 1]],
  );
});

test("a state toggle hides its jobs but keeps its count", () => {
  const model = table({ filters: { shownGroups: { ...DEFAULT_FILTERS.shownGroups, failed: false } } });
  assert.ok(model.rows.every((row) => row.group !== "failed"));
  assert.strictEqual(model.toggles.find((toggle) => toggle.id === "failed")!.count, 3);
});

test("the cluster chip combines with the toggles", () => {
  const onlyQueued = { running: false, queued: true, completed: false, failed: false, cancelled: false };
  const haicore = table({ filters: { cluster: "haicore", shownGroups: onlyQueued } });
  assert.deepStrictEqual(haicore.rows.map((row) => row.id), ["103"]);
  assert.deepStrictEqual(haicore.lockedClusters, []);

  const bwuni3 = table({ filters: { cluster: "bwuni3", shownGroups: onlyQueued } });
  assert.deepStrictEqual(bwuni3.rows, []);
  assert.deepStrictEqual(bwuni3.lockedClusters, [{ cluster: "bwuni3", loggingIn: false }]);
  assert.strictEqual(bwuni3.showEmpty, false);
});

test("the window goes to ctun unless no finished job is shown", () => {
  assert.strictEqual(effectiveSince({ ...DEFAULT_FILTERS, since: "7d" }), "7d");
  const activeOnly = { running: true, queued: true, completed: false, failed: false, cancelled: false };
  assert.strictEqual(effectiveSince({ ...DEFAULT_FILTERS, since: "7d", shownGroups: activeOnly }), "0");
});

test("shows the empty state and per-cluster errors", () => {
  const report: JobsReport = {
    since_minutes: 1440,
    clusters: [{ cluster: "haicore", live: true, error: "squeue failed", jobs: [] }],
  };
  const model = table({ statuses: [GUARDED_STATUS], report });
  assert.strictEqual(model.showEmpty, true);
  assert.deepStrictEqual(model.errors, [{ cluster: "haicore", message: "squeue failed" }]);
});

test("computes the elapsed share of the time limit", () => {
  const running = table().rows[0];
  assert.strictEqual(running.progress, 3600 / (10.5 * 3600));
  assert.strictEqual(running.active, true);
  assert.strictEqual(running.key, "haicore/101");
  assert.strictEqual(JOBS.length, table().rows.length);
});

test("parses Slurm durations", () => {
  assert.strictEqual(slurmDurationSeconds("0:00"), 0);
  assert.strictEqual(slurmDurationSeconds("30:00"), 1800);
  assert.strictEqual(slurmDurationSeconds("10:30:00"), 37800);
  assert.strictEqual(slurmDurationSeconds("2-01:00:00"), 176400);
  assert.strictEqual(slurmDurationSeconds("UNLIMITED"), undefined);
});
