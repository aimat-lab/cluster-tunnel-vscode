import * as assert from "assert";
import { test } from "node:test";
import { baseState, stateGroup } from "../../jobStates";
import { JOBS } from "../fixtures/ctunOutput";

test("strips the suffix of a Slurm state", () => {
  const cancelled = JOBS.find((job) => job.state.startsWith("CANCELLED"))!;
  assert.strictEqual(baseState(cancelled), "CANCELLED");
});

test("groups every fixture state under one toggle", () => {
  assert.deepStrictEqual(JOBS.map(stateGroup), [
    "running",
    "running",
    "queued",
    "completed",
    "failed",
    "failed",
    "failed",
    "cancelled",
  ]);
});
