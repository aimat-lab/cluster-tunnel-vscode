import * as assert from "assert";
import { test } from "node:test";
import { summarize, textBar } from "../../clusterSummary";
import { GUARDED_STATUS, JOBS, UNGUARDED_STATUS } from "../fixtures/ctunOutput";

test("summarizes a guarded cluster with its budget use and job counts", () => {
  const summary = summarize(GUARDED_STATUS, { jobs: JOBS, error: null });
  assert.strictEqual(summary.budget, "18.5 / 50 job-h");
  assert.ok(Math.abs(summary.budgetFraction! - 0.3692) < 0.001);
  assert.strictEqual(summary.commands, "24 sent this session");
  assert.strictEqual(summary.jobs, "2 running · 1 queued");
  assert.match(summary.session, /^since /);
});

test("shows no limit and no bar for an unguarded cluster", () => {
  const summary = summarize(UNGUARDED_STATUS, { jobs: [], error: null });
  assert.strictEqual(summary.budget, "no limit");
  assert.strictEqual(summary.budgetFraction, undefined);
});

test("reports a budget probe error", () => {
  const summary = summarize({ ...GUARDED_STATUS, used: null, used_error: "sacct failed" }, undefined);
  assert.strictEqual(summary.budget, "unknown of 50 job-h: sacct failed");
  assert.strictEqual(summary.jobs, "…");
});

test("reports a jobs error", () => {
  const summary = summarize(GUARDED_STATUS, { jobs: [], error: "squeue: command not found" });
  assert.strictEqual(summary.jobs, "could not list jobs");
});

test("draws a ten-segment text bar, clamped to full", () => {
  assert.strictEqual(textBar(0.3), "▰▰▰▱▱▱▱▱▱▱");
  assert.strictEqual(textBar(1.7), "▰▰▰▰▰▰▰▰▰▰");
});
