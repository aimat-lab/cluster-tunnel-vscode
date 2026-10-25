import * as assert from "assert";
import { test } from "node:test";
import { jobRefs } from "../../addOns";
import type { JobsReport } from "../../ctun";
import {
  allTimeProjectCounts,
  buildJobsTable,
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  effectiveSince,
  JobRow,
  JobsFilters,
  JobsSort,
  noteReferences,
  pendingReviews,
  RowExtras,
  slurmDurationSeconds,
  TableInputs,
  UNASSIGNED,
} from "../../jobsTable";
import { DEFAULT_COLUMN_LAYOUT } from "../../columnLayout";
import { GUARDED_STATUS, JOBS, JOBS_REPORT, LOGGED_OUT_STATUS, recordWithoutFacts, reportWith } from "../fixtures/ctunOutput";

const STATUSES = [LOGGED_OUT_STATUS, GUARDED_STATUS];

function table(overrides: Partial<Omit<TableInputs, "filters">> & { filters?: Partial<JobsFilters> } = {}) {
  const { filters, ...rest } = overrides;
  return buildJobsTable({
    statuses: STATUSES,
    report: JOBS_REPORT,
    loggingIn: new Set(),
    updatedAt: undefined,
    mode: "jobs",
    expanded: new Set(),
    selected: new Set(),
    extras: new Map<string, RowExtras>(),
    collapsedProjects: new Set(),
    sort: DEFAULT_SORT,
    hiddenProjects: new Set(),
    knownProjects: [],
    columnLayout: DEFAULT_COLUMN_LAYOUT,
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
});

/** `JOBS_REPORT` with the recorded jobs moved to `projectByJobId`. */
function withProjects(projectByJobId: Record<string, string>): JobsReport {
  const [haicore, ...others] = JOBS_REPORT.clusters;
  const jobs = haicore.jobs.map((job) =>
    job.record && projectByJobId[job.jobid] ? { ...job, record: { ...job.record, project: projectByJobId[job.jobid] } } : job,
  );
  return { ...JOBS_REPORT, clusters: [{ ...haicore, jobs }, ...others] };
}

/** 101 in htfm, 102 in htfm/eval, 91 in htfm/eval/old, 103 in legacy. */
const NESTED = withProjects({ "101": "htfm", "102": "htfm/eval", "91": "htfm/eval/old" });

test("nested projects become indented bands, each counting the jobs below it", () => {
  const model = table({ report: NESTED });
  assert.deepStrictEqual(
    model.groups.map((band) => [band.project, band.label, band.depth, band.count, band.rows.map((row) => row.id)]),
    [
      ["htfm", "htfm", 0, 3, ["101"]],
      ["htfm/eval", "eval", 1, 2, ["102"]],
      ["htfm/eval/old", "old", 2, 1, ["91"]],
      ["legacy", "legacy", 0, 1, ["103"]],
      ["unassigned", "Unassigned", 0, 4, ["90", "92", "93", "94"]],
    ],
  );
});

test("a project's empty levels are dropped", () => {
  const model = table({ report: withProjects({ "102": "htfm//eval/" }) });
  assert.deepStrictEqual(model.groups.map((band) => band.project), ["htfm", "htfm/eval", "legacy", "unassigned"]);
});

test("a hidden project leaves out its jobs and those of the projects nested in it", () => {
  const shownIds = (hidden: string[]) => rows(table({ report: NESTED, hiddenProjects: new Set(hidden) })).map((row) => row.id);
  assert.deepStrictEqual(shownIds(["htfm/eval"]), ["101", "103", "90", "92", "93", "94"]);
  assert.deepStrictEqual(shownIds(["htfm/eva"]), ["101", "102", "91", "103", "90", "92", "93", "94"]);
  assert.deepStrictEqual(shownIds(["htfm", UNASSIGNED]), ["103"]);
});

test("a sorted column orders the jobs inside each band and marks its header", () => {
  const ids = (sort: JobsSort) =>
    table({ sort }).groups.map((band) => [band.label, band.rows.map((row) => row.id)]);
  assert.deepStrictEqual(ids({ column: "id", direction: "ascending" }), [
    ["htfm", ["91", "101", "102"]],
    ["legacy", ["103"]],
    ["Unassigned", ["90", "92", "93", "94"]],
  ]);
  assert.deepStrictEqual(ids({ column: "state", direction: "descending" }), [
    ["htfm", ["91", "101", "102"]],
    ["legacy", ["103"]],
    ["Unassigned", ["94", "92", "93", "90"]],
  ]);
  const model = table({ sort: { column: "elapsed", direction: "descending" } });
  assert.deepStrictEqual(
    model.columns.map((column) => [column.id, column.sort]),
    [["id", undefined], ["name", undefined], ["note", undefined], ["state", undefined], ["start", undefined], ["elapsed", "descending"], ["partition", undefined]],
  );
});

test("a folded band hides its jobs and the projects nested in it, but keeps its count", () => {
  const model = table({ report: NESTED, collapsedProjects: new Set(["htfm/eval"]) });
  assert.deepStrictEqual(
    model.groups.map((band) => [band.project, band.collapsed, band.count, band.rows.length]),
    [
      ["htfm", false, 3, 1],
      ["htfm/eval", true, 2, 0],
      ["legacy", false, 1, 1],
      ["unassigned", false, 4, 4],
    ],
  );
});

test("hidden projects combine with the state toggles and the cluster chip", () => {
  const onlyFailed = { running: false, queued: false, completed: false, failed: true, cancelled: false };
  const htfmFailed = table({
    filters: { shownGroups: onlyFailed, cluster: "haicore" },
    hiddenProjects: new Set(["legacy", UNASSIGNED]),
  });
  assert.deepStrictEqual(rows(htfmFailed).map((row) => row.id), ["91"]);
  assert.strictEqual(htfmFailed.toggles.find((toggle) => toggle.id === "running")!.count, 2);
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

/** `JOBS_REPORT` with job 102's note confirmed in its record. */
const CONFIRMED_102 = reportWith(
  JOBS.map((job) => (job.jobid === "102" ? { ...job, record: { ...job.record!, note_confirmed: true } } : job)),
);

test("a note is an unreviewed draft until its record says it is confirmed", () => {
  const note = (report = JOBS_REPORT, id = "101") => rows(table({ report })).find((row) => row.id === id)!.note;
  assert.strictEqual(note()?.status, "unreviewed");
  assert.deepStrictEqual([note(CONFIRMED_102, "102")?.status, note(CONFIRMED_102, "102")?.statusLabel], ["confirmed", "Confirmed by you"]);
  assert.strictEqual(note(JOBS_REPORT, "103"), undefined);
});

test("pending reviews include records without a listed job and skip confirmed ones", () => {
  const all = pendingReviews(JOBS_REPORT);
  assert.deepStrictEqual(all.map((card) => card.id), ["102", "101", "80"]);
  assert.deepStrictEqual(all.find((card) => card.id === "101")!.references, ["job:91", "commit:87d86d4"]);
  assert.strictEqual(all.find((card) => card.id === "80")!.stateLabel, "Not listed");

  assert.deepStrictEqual(pendingReviews(CONFIRMED_102).map((card) => card.id), ["101", "80"]);
  assert.strictEqual(table().pendingCount, 3);
});

test("a record without facts gives a project but no code, submitter or previous run", () => {
  const plainSbatch = { ...JOBS.find((job) => job.jobid === "90")!, record: { ...recordWithoutFacts("90", "htfm"), note: "Baseline." } };
  const report = reportWith(JOBS.map((job) => (job.jobid === "90" ? plainSbatch : job)));
  const row = rows(table({ report, expanded: new Set(["haicore/90"]) })).find((candidate) => candidate.id === "90")!;
  assert.deepStrictEqual(
    [row.details!.hasRecord, row.details!.hasFacts, row.details!.code, row.details!.from, row.details!.previous],
    [true, false, undefined, undefined, undefined],
  );
  assert.match(row.details!.edits[0], / · laptop: project Unassigned → htfm$/);
  assert.strictEqual(table({ report }).groups.find((band) => band.project === "htfm")!.count, 4);
  assert.strictEqual(pendingReviews(report).find((card) => card.id === "90")!.submittedText, undefined);
});

test("an edit log line names each changed field", () => {
  const changes = [{ at: "2026-10-20T14:36:00+00:00", from: "desk", project: ["htfm", "htfm/mh"], note: ["a", "b"], note_confirmed: [false, true] }];
  const edited = { ...JOBS[0], record: { ...JOBS[0].record!, changes } } as (typeof JOBS)[number];
  const report = reportWith([edited, ...JOBS.slice(1)]);
  const details = rows(table({ report, expanded: new Set(["haicore/101"]) })).find((row) => row.id === "101")!.details!;
  assert.match(details.edits[0], / · desk: project htfm → htfm › mh, note changed, note confirmed$/);
});

test("marks selected rows and counts only the shown ones", () => {
  const selected = new Set(["haicore/101", "haicore/90"]);
  const model = table({ selected, filters: { shownGroups: { ...DEFAULT_FILTERS.shownGroups, completed: false } } });
  assert.deepStrictEqual(rows(model).filter((row) => row.selected).map((row) => row.id), ["101"]);
  assert.strictEqual(model.selectedCount, 1);
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
  assert.match(startOf("101", starts) ?? "", /^\S/);
  assert.doesNotMatch(startOf("101", starts) ?? "", /^est\./);
  assert.match(startOf("103", starts) ?? "", /^est\. \S/);
  assert.strictEqual(startOf("103", {}), "no estimate yet");
  assert.strictEqual(startOf("94", starts), undefined);
});

test("by default the newest start comes first, after queued jobs without an estimate", () => {
  const starts: Record<string, string> = { "101": "2026-10-13T14:02:11", "102": "2026-10-12T09:00:00", "91": "2026-10-11T10:00:00" };
  const jobs = JOBS.map((job) => ({ ...job, start: starts[job.jobid] ?? "N/A" }));
  const report: JobsReport = { ...JOBS_REPORT, clusters: [{ ...JOBS_REPORT.clusters[0], jobs }] };
  const model = table({ report });
  assert.deepStrictEqual(model.groups[0].rows.map((row) => row.id), ["101", "102", "91"]);
  assert.strictEqual(model.columns.find((column) => column.id === "start")!.sort, "descending");
});

test("sorting by start puts jobs without a start time last", () => {
  const starts: Record<string, string> = { "101": "2026-10-13T14:02:11", "102": "2026-10-12T09:00:00", "91": "N/A" };
  const jobs = JOBS.map((job) => ({ ...job, start: starts[job.jobid] ?? "N/A" }));
  const report: JobsReport = { ...JOBS_REPORT, clusters: [{ ...JOBS_REPORT.clusters[0], jobs }] };
  const htfm = table({ report, sort: { column: "start", direction: "ascending" } }).groups[0];
  assert.deepStrictEqual(htfm.rows.map((row) => row.id), ["102", "101", "91"]);
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

test("every known project is a drop target in tree order, with Unassigned last", () => {
  const { dropTargets } = table({ knownProjects: ["zeta", "htfm/multihead", "htfm"] });
  assert.deepStrictEqual(dropTargets, [
    { project: "htfm", label: "htfm", depth: 0 },
    { project: "htfm/multihead", label: "multihead", depth: 1 },
    { project: "zeta", label: "zeta", depth: 0 },
    { project: UNASSIGNED, label: "Unassigned", depth: 0 },
  ]);
});

test("the Projects view counts named projects of all time and Unassigned in the window", () => {
  const projects = {
    clusters: [
      { cluster: "haicore", live: true, job_records: true, error: null, projects: [{ project: "htfm", jobs: 40 }, { project: "old//sweep", jobs: 2 }] },
      { cluster: "kcist", live: true, job_records: true, error: null, projects: [{ project: "htfm", jobs: 5 }] },
    ],
  };
  assert.deepStrictEqual(
    [...allTimeProjectCounts(projects, JOBS_REPORT)],
    [["htfm", 45], ["old/sweep", 2], [UNASSIGNED, 4]],
  );
});
