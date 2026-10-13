import * as assert from "assert";
import { test } from "node:test";
import { buildTranscript, shellJoin, TranscriptInputs, TranscriptJob } from "../../commandsTranscript";
import type { CommandLog } from "../../ctun";
import { COMMAND_LOG, COMMANDS_REPORT, GUARDED_STATUS, UNGUARDED_STATUS } from "../fixtures/ctunOutput";

function transcript(overrides: Partial<TranscriptInputs> = {}) {
  return buildTranscript({
    cluster: "haicore",
    clusters: ["haicore", "kcist"],
    log: COMMAND_LOG,
    status: GUARDED_STATUS,
    report: COMMANDS_REPORT,
    ...overrides,
  });
}

function jobsOfLine(index: number): TranscriptJob[] {
  return transcript().lines[index].jobs;
}

/** The parts of a job the rectangle shows, minus the locale-dependent times. */
function summary(job: TranscriptJob) {
  return [job.verb, job.id, job.name, job.group, job.stateLabel, job.detail];
}

test("names the jobs of finished submissions with how long they ran", () => {
  assert.deepStrictEqual(summary(jobsOfLine(0)[0]), ["Submitted", "4817985", "smoke_test", "completed", "Completed", "ran 0:42"]);
  assert.deepStrictEqual(summary(jobsOfLine(2)[0]), ["Submitted", "4817990", "preprocess", "failed", "Failed", "ran 1:05"]);
  assert.deepStrictEqual(summary(jobsOfLine(9)[0]), ["Submitted", "4818230", "train_htfm", "failed", "Timeout", "ran 10:30:00"]);
});

test("a cancelled job either never started or ran", () => {
  assert.deepStrictEqual(summary(jobsOfLine(3)[0]).slice(3), ["cancelled", "Cancelled", "never started"]);
  assert.deepStrictEqual(summary(jobsOfLine(10)[0]), ["Cancelled", "4818240", "train_htfm", "cancelled", "Cancelled", "ran 3:12"]);
});

test("a running job shows its start and its elapsed time against the limit", () => {
  const [running] = jobsOfLine(5);
  assert.strictEqual(running.group, "running");
  assert.match(running.detail ?? "", /^started \S.* · 22:41 \/ 10:30:00$/);
});

test("a queued job shows Slurm's start estimate, or that it has none", () => {
  const [estimated, unestimated] = jobsOfLine(6);
  assert.strictEqual(estimated.stateLabel, "Queued");
  assert.match(estimated.detail ?? "", /^est\. start \S/);
  assert.strictEqual(unestimated.detail, "no start estimate yet");
});

test("links each listed job to its row in Cluster jobs", () => {
  assert.strictEqual(jobsOfLine(5)[0].key, "haicore/4818213");
});

test("a job the report does not list shows its ID and state unknown", () => {
  assert.deepStrictEqual(jobsOfLine(8), [
    { key: undefined, verb: "Submitted", id: "4700000", name: undefined, group: undefined, stateLabel: "state unknown", detail: undefined },
  ]);
  const withoutReport = transcript({ report: undefined }).lines[0].jobs[0];
  assert.strictEqual(withoutReport.stateLabel, "state unknown");
});

test("reads the cancelled jobs from scancel's arguments, past its options", () => {
  assert.deepStrictEqual(
    jobsOfLine(4).map((job) => [job.verb, job.id, job.detail]),
    [
      ["Cancelled", "4818190", "never started"],
      ["Cancelled", "4818250_4", "never started"],
    ],
  );
});

test("a command without job_ids has no jobs, as with an older ctun", () => {
  assert.deepStrictEqual(jobsOfLine(1), []);
  const olderCtun: CommandLog = { cluster: "haicore", commands: [{ epoch: 1, command: ["sbatch", "train.sh"] }] };
  assert.deepStrictEqual(transcript({ log: olderCtun }).lines[0].jobs, []);
});

test("divides commands five minutes or more apart, with the gap", () => {
  assert.deepStrictEqual(
    transcript().lines.flatMap((line, index) => (line.gapText ? [[index, line.gapText]] : [])),
    [
      [7, "13 min"],
      [11, "1 h 5 min"],
    ],
  );
});

test("quotes the command like shlex.join", () => {
  assert.strictEqual(transcript().lines[11].command, `bash -c 'echo '"'"'it'"'"''"'"'s done'"'"' > out.txt'`);
  assert.strictEqual(shellJoin(["sbatch", "--dependency=afterok:1", "a b.sh", ""]), "sbatch --dependency=afterok:1 'a b.sh' ''");
});

test("the header names the cluster, the login and the budget; the counts sum up the jobs", () => {
  const model = transcript();
  assert.match(model.headerText, /^# haicore · logged in \S.* · budget 50 job-h$/);
  assert.strictEqual(model.countsText, "12 commands · 8 jobs submitted · 3 cancelled");
  assert.match(transcript({ status: UNGUARDED_STATUS }).headerText, / · no budget limit$/);
  assert.strictEqual(transcript({ status: undefined }).headerText, "# haicore");
});

test("offers the clusters and says when nothing was sent", () => {
  const empty = transcript({ log: { cluster: "haicore", commands: [] } });
  assert.deepStrictEqual(empty.clusterOptions, [
    { id: "haicore", selected: true },
    { id: "kcist", selected: false },
  ]);
  assert.strictEqual(empty.emptyText, "No commands sent to haicore this session.");
  assert.strictEqual(transcript({ log: undefined }).emptyText, undefined);
});
