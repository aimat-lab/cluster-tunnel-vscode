import * as assert from "assert";
import { test } from "node:test";
import { jobRefs } from "../../addOns";
import type { JobsReport } from "../../ctun";
import {
  buildJobsTable,
  DEFAULT_FILTERS,
  effectiveSince,
  JobRow,
  JobsFilters,
  noteReferences,
  pendingReviews,
  RowExtras,
  slurmDurationSeconds,
  TableInputs,
  UNASSIGNED,
} from "../../jobsTable";
import type { Review } from "../../reviews";
import { GUARDED_STATUS, JOBS, JOBS_REPORT, LOGGED_OUT_STATUS } from "../fixtures/ctunOutput";
import { JOB_PROJECTS } from "../fixtures/jobProjects";

const STATUSES = [LOGGED_OUT_STATUS, GUARDED_STATUS];

function table(overrides: Partial<Omit<TableInputs, "filters">> & { filters?: Partial<JobsFilters> } = {}) {
  const { filters, ...rest } = overrides;
  return buildJobsTable({
    statuses: STATUSES,
    report: JOBS_REPORT,
    projects: JOB_PROJECTS,
    loggingIn: new Set(),
    updatedAt: undefined,
    reviews: {},
    mode: "jobs",
    expanded: new Set(),
    extras: new Map<string, RowExtras>(),
    ...rest,
    filters: { ...DEFAULT_FILTERS, ...filters },
  });
}

function rows(model: ReturnType<typeof table>): JobRow[] {
  return model.groups.flatMap((group) => group.rows);
}

test("renders every state with its label", () => {
  const model = table();
  assert.deepStrictEqual(
    rows(model).map((row) => [row.id, row.stateLabel]),
    [
      ["101", "Running"],
      ["102", "Running"],
      ["91", "Failed"],
      ["103", "Queued"],
      ["90", "Completed"],
      ["92", "Timeout"],
      ["93", "Out of memory"],
      ["94", "Cancelled"],
    ],
  );
  assert.deepStrictEqual(
    model.toggles.map((toggle) => [toggle.id, toggle.count]),
    [["running", 2], ["queued", 1], ["completed", 1], ["failed", 3], ["cancelled", 1]],
  );
});

test("groups rows by project with Unassigned last", () => {
  const model = table();
  assert.deepStrictEqual(
    model.groups.map((group) => [group.label, group.rows.length]),
    [["htfm", 3], ["legacy", 1], ["Unassigned", 4]],
  );
  assert.deepStrictEqual(
    model.projects.map((project) => [project.label, project.count]),
    [["All projects", 8], ["htfm", 3], ["legacy", 1], ["Unassigned", 4]],
  );
});

test("a job's project comes from the active source, not from its record", () => {
  const byJob = new Map([["haicore/90", "htfm"], ["haicore/101", "htfm"]]);
  const projects = { byJob, unassignedReason: "no project in W&B", sourceLabel: "W&B", error: undefined };
  const model = table({ projects });
  assert.deepStrictEqual(
    model.groups.map((group) => [group.label, group.subtitle, group.rows.map((row) => row.id)]),
    [
      ["htfm", "2 shown", ["101", "90"]],
      ["Unassigned", "no project in W&B", ["102", "103", "91", "92", "93", "94"]],
    ],
  );
});

test("a failed project lookup shows as an error of its source", () => {
  const projects = { ...JOB_PROJECTS, sourceLabel: "W&B", error: "W&B rejected the API key" };
  assert.deepStrictEqual(table({ projects }).errors, [{ cluster: "W&B", message: "projects: W&B rejected the API key" }]);
});

test("the project filter combines with the state toggles and the cluster chip", () => {
  const onlyFailed = { running: false, queued: false, completed: false, failed: true, cancelled: false };
  const htfmFailed = table({ filters: { project: "htfm", shownGroups: onlyFailed, cluster: "haicore" } });
  assert.deepStrictEqual(rows(htfmFailed).map((row) => row.id), ["91"]);
  assert.strictEqual(htfmFailed.toggles.find((toggle) => toggle.id === "running")!.count, 2);

  const unassigned = table({ filters: { project: UNASSIGNED } });
  assert.deepStrictEqual(rows(unassigned).map((row) => row.id), ["90", "92", "93", "94"]);
});

test("a state toggle hides its jobs but keeps its count", () => {
  const model = table({ filters: { shownGroups: { ...DEFAULT_FILTERS.shownGroups, failed: false } } });
  assert.ok(rows(model).every((row) => row.group !== "failed"));
  assert.strictEqual(model.toggles.find((toggle) => toggle.id === "failed")!.count, 3);
});

test("the cluster chip shows a logged-out cluster as locked", () => {
  const bwuni3 = table({ filters: { cluster: "bwuni3" } });
  assert.deepStrictEqual(rows(bwuni3), []);
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
    clusters: [{ cluster: "haicore", live: true, error: "squeue failed", jobs: [], records_error: "scontrol failed" }],
  };
  const model = table({ statuses: [GUARDED_STATUS], report });
  assert.strictEqual(model.showEmpty, true);
  assert.deepStrictEqual(model.errors, [
    { cluster: "haicore", message: "squeue failed" },
    { cluster: "haicore", message: "job records: scontrol failed" },
  ]);
});

test("a note is an unreviewed draft until reviewed; an edit replaces its text", () => {
  const unreviewed = rows(table()).find((row) => row.id === "101")!;
  assert.strictEqual(unreviewed.note?.status, "unreviewed");
  assert.strictEqual(unreviewed.note?.reviewKey, "haic/101");

  const reviews: Record<string, Review> = {
    "haic/101": { status: "edited", text: "Rerun with fixed paths.", at: "2026-10-12T12:00:00Z" },
    "haic/102": { status: "discarded", at: "2026-10-12T12:00:00Z" },
  };
  const reviewed = rows(table({ reviews }));
  assert.strictEqual(reviewed.find((row) => row.id === "101")!.note?.text, "Rerun with fixed paths.");
  assert.strictEqual(reviewed.find((row) => row.id === "102")!.note?.status, "discarded");
  assert.strictEqual(rows(table()).find((row) => row.id === "103")!.note, undefined);
});

test("pending reviews include records without a listed job and skip reviewed ones", () => {
  const all = pendingReviews(JOBS_REPORT, {}, JOB_PROJECTS);
  assert.deepStrictEqual(all.map((card) => card.id), ["102", "101", "80"]);
  assert.deepStrictEqual(all.find((card) => card.id === "101")!.references, ["job:91", "commit:87d86d4"]);
  assert.strictEqual(all.find((card) => card.id === "80")!.stateLabel, "Not listed");

  const afterConfirm = pendingReviews(JOBS_REPORT, { "haic/102": { status: "confirmed", at: "x" } }, JOB_PROJECTS);
  assert.deepStrictEqual(afterConfirm.map((card) => card.id), ["101", "80"]);
  assert.strictEqual(table().pendingCount, 3);
});

test("details show the code facts, the submitter and the previous run", () => {
  const model = table({ expanded: new Set(["haicore/101", "haicore/103"]) });
  const details = rows(model).find((row) => row.id === "101")!.details!;
  assert.deepStrictEqual(details.code, { commit: "87d86d4", branch: "main", pushed: true, uncommitted: 0, workdir: "/work/repo" });
  assert.match(details.from!, /^laptop · /);
  assert.deepStrictEqual(details.previous, { id: "91", cluster: "haicore", stateLabel: "Failed", sameCommit: false });
  assert.deepStrictEqual(details.changesRequest, {
    cluster: "haicore",
    workdir: "/work/repo",
    fromCommit: "a60bc60bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    toCommit: "87d86d4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  const unpushed = rows(model).find((row) => row.id === "103")!.details!;
  assert.strictEqual(unpushed.code?.pushed, false);
  assert.strictEqual(unpushed.code?.uncommitted, 1);
  assert.strictEqual(unpushed.previous, undefined);
  assert.strictEqual(rows(model).find((row) => row.id === "102")!.details, undefined);
});

test("details carry the add-on lines and the commit list", () => {
  const training = { label: "Training", text: "epoch 31 · val/loss 0.690", link: { label: "W&B", url: "https://wandb.ai/e/p/runs/r" } };
  const extras = new Map<string, RowExtras>([
    [
      "haicore/101",
      {
        addOnLines: { state: "loaded", lines: [training] },
        changes: { state: "loaded", commits: [{ hash: "87d86d4", message: "Fix paths" }] },
      },
    ],
  ]);
  const details = rows(table({ expanded: new Set(["haicore/101"]), extras })).find((row) => row.id === "101")!.details!;
  assert.deepStrictEqual(details.addOnLines, { state: "loaded", lines: [training] });
  assert.deepStrictEqual(details.changes, { state: "loaded", commits: [{ hash: "87d86d4", message: "Fix paths" }] });
});

test("finds the marked references in a note", () => {
  assert.deepStrictEqual(noteReferences("job:7 then commit:abcdef1, job:7 again, commit:zz"), ["job:7", "commit:abcdef1"]);
});

test("computes the elapsed share of the time limit", () => {
  const running = rows(table()).find((row) => row.id === "101")!;
  assert.strictEqual(running.progress, 3600 / (10.5 * 3600));
  assert.strictEqual(running.active, true);
  assert.strictEqual(JOBS.length, rows(table()).length);
});

test("parses Slurm durations", () => {
  assert.strictEqual(slurmDurationSeconds("0:00"), 0);
  assert.strictEqual(slurmDurationSeconds("30:00"), 1800);
  assert.strictEqual(slurmDurationSeconds("10:30:00"), 37800);
  assert.strictEqual(slurmDurationSeconds("2-01:00:00"), 176400);
  assert.strictEqual(slurmDurationSeconds("UNLIMITED"), undefined);
});

test("shows when a job started, or Slurm's estimate while it is queued", () => {
  const startOf = (id: string, starts: Record<string, string>) => {
    const jobs = JOBS.map((job) => ({ ...job, start: starts[job.jobid] ?? "N/A" }));
    const report: JobsReport = { ...JOBS_REPORT, clusters: [{ ...JOBS_REPORT.clusters[0], jobs }] };
    return rows(table({ report })).find((row) => row.id === id)!.startText;
  };
  const starts = { "101": "2026-10-13T14:02:11", "103": "2026-10-14T09:30:00", "94": "None" };
  assert.match(startOf("101", starts) ?? "", /^Started \S/);
  assert.match(startOf("103", starts) ?? "", /^Est\. start \S/);
  assert.strictEqual(startOf("103", {}), "No start estimate yet");
  assert.strictEqual(startOf("94", starts), undefined);
});

test("shows no start when ctun does not report one", () => {
  assert.ok(rows(table()).every((row) => row.startText === undefined));
});

test("add-ons see every listed and recorded job with its Slurm cluster", () => {
  const report: JobsReport = { ...JOBS_REPORT, clusters: [{ ...JOBS_REPORT.clusters[0], slurm_cluster: "haic" }] };
  const refs = jobRefs(report);
  assert.deepStrictEqual(refs.map((job) => job.key), [...JOBS.map((job) => `haicore/${job.jobid}`), "haicore/80"]);
  assert.deepStrictEqual(refs.at(-1), {
    key: "haicore/80",
    cluster: "haicore",
    slurmCluster: "haic",
    jobId: "80",
    name: "train",
    state: undefined,
    record: JOBS_REPORT.clusters[0].records_without_job![0],
  });
  assert.ok(jobRefs(JOBS_REPORT).every((job) => job.slurmCluster === null));
});
