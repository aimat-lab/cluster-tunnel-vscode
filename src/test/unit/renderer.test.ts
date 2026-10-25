import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { buildJobsTable, DEFAULT_FILTERS, DEFAULT_SORT, JobsSort, JobsTableModel, RowExtras } from "../../jobsTable";
import { ColumnLayout, DEFAULT_COLUMN_LAYOUT } from "../../columnLayout";
import { GUARDED_STATUS, JOBS_REPORT, LOGGED_OUT_STATUS } from "../fixtures/ctunOutput";

const RENDERER = fs.readFileSync(path.resolve(__dirname, "../../../media/jobsTable.js"), "utf8");

/** Loads the webview script into a DOM, posts `model`, and records what the script sends back. */
function render(model: JobsTableModel) {
  const dom = new JSDOM(`<main id="app"></main>`, { runScripts: "outside-only" });
  const sent: unknown[] = [];
  // A JSON round trip moves each message out of the jsdom realm, so deepStrictEqual compares plain objects.
  const postMessage = (message: unknown) => sent.push(JSON.parse(JSON.stringify(message)));
  Object.assign(dom.window, { acquireVsCodeApi: () => ({ postMessage }), scrollTo: () => {} });
  // jsdom does no layout, so it has no scrolling.
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.eval(RENDERER);
  const post = (posted: JobsTableModel) =>
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: { type: "model", model: posted, refreshing: false } }));
  post(model);
  const app = dom.window.document.getElementById("app")!;
  const click = (text: string, within: Element = app) => {
    const target = [...within.querySelectorAll("button")].find((node) => node.textContent === text);
    assert.ok(target, `no button "${text}"`);
    target.click();
  };
  return { app, sent, click, post };
}

function model(
  overrides: {
    mode?: "jobs" | "review";
    expanded?: string[];
    extras?: Map<string, RowExtras>;
    collapsed?: string[];
    sort?: JobsSort;
    selected?: string[];
    columnLayout?: ColumnLayout;
  } = {},
) {
  return buildJobsTable({
    statuses: [GUARDED_STATUS, LOGGED_OUT_STATUS],
    report: JOBS_REPORT,
    loggingIn: new Set(),
    filters: DEFAULT_FILTERS,
    updatedAt: undefined,
    mode: overrides.mode ?? "jobs",
    expanded: new Set(overrides.expanded ?? []),
    selected: new Set(overrides.selected ?? []),
    extras: overrides.extras ?? new Map(),
    collapsedProjects: new Set(overrides.collapsed ?? []),
    hiddenProjects: new Set(),
    knownProjects: ["htfm", "htfm/draft", "legacy"],
    columnLayout: overrides.columnLayout ?? DEFAULT_COLUMN_LAYOUT,
    sort: overrides.sort ?? DEFAULT_SORT,
  });
}

test("renders project groups, notes and the locked cluster", () => {
  const { app } = render(model());
  assert.strictEqual(app.querySelector("select#project"), null);
  const text = app.textContent ?? "";
  assert.match(text, /htfm3/);
  assert.match(text, /Unassigned4no project in the job record/);
  assert.match(text, /Rerun of job:91/);
  assert.doesNotMatch(text, /unreviewed/i);
  assert.match(text, /bwuni3 has no tunnel/);
  assert.match(text, /3 notes to review/);
});

test("a folded project band hides its jobs and asks the extension to unfold", () => {
  const { app, sent } = render(model({ collapsed: ["htfm"] }));
  const shownJobs = [...app.querySelectorAll<HTMLElement>(".job")].map((row) => row.dataset.rowKey);
  assert.ok(!shownJobs.includes("haicore/101"));
  const unfold = app.querySelector<HTMLButtonElement>('[aria-label="Unfold htfm"]')!;
  assert.strictEqual(unfold.getAttribute("aria-expanded"), "false");
  unfold.click();
  assert.deepStrictEqual(sent.at(-1), { type: "toggleProject", project: "htfm" });
});

test("a click on a job row or Enter on it toggles its details", () => {
  const { app, sent } = render(model({ expanded: ["haicore/101"] }));
  const row = (key: string) => [...app.querySelectorAll<HTMLElement>(".job")].find((node) => node.dataset.rowKey === key)!;
  assert.strictEqual(row("haicore/101").getAttribute("aria-expanded"), "true");
  row("haicore/102").click();
  row("haicore/101").dispatchEvent(new app.ownerDocument.defaultView!.KeyboardEvent("keydown", { key: "Enter" }));
  assert.deepStrictEqual(sent.slice(-2), [
    { type: "expand", key: "haicore/102" },
    { type: "expand", key: "haicore/101" },
  ]);
  assert.strictEqual(app.querySelectorAll(".job button").length, 0);
});

test("Ctrl- and Shift-click select rows; the bar moves or clears them", () => {
  const { app, sent, click } = render(model({ selected: ["haicore/101", "haicore/102"] }));
  const row = (key: string) => [...app.querySelectorAll<HTMLElement>(".job")].find((node) => node.dataset.rowKey === key)!;
  const MouseEvent = app.ownerDocument.defaultView!.MouseEvent;
  row("haicore/103").dispatchEvent(new MouseEvent("click", { ctrlKey: true, bubbles: true }));
  row("haicore/90").dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true }));
  assert.deepStrictEqual(sent.slice(-2), [
    { type: "select", key: "haicore/103", extend: "toggle" },
    { type: "select", key: "haicore/90", extend: "range" },
  ]);

  assert.strictEqual(row("haicore/101").getAttribute("aria-selected"), "true");
  assert.deepStrictEqual(JSON.parse(row("haicore/101").dataset.vscodeContext!), {
    webviewSection: "job",
    jobKey: "haicore/101",
    preventDefaultContextMenuItems: true,
  });
  const bar = app.querySelector(".selection-bar")!;
  assert.match(bar.textContent ?? "", /^2 selected/);
  click("Move to project…", bar);
  click("Clear", bar);
  assert.deepStrictEqual(sent.slice(-2), [{ type: "moveToProject" }, { type: "clearSelection" }]);
  assert.strictEqual(render(model()).app.querySelector(".selection-bar"), null);
});

test("a selected row drags the selection, another row only itself, and a project band takes the dropped jobs", () => {
  const { app, sent } = render(model({ selected: ["haicore/101", "haicore/102"] }));
  const row = (key: string) => [...app.querySelectorAll<HTMLElement>(".job")].find((node) => node.dataset.rowKey === key)!;
  assert.deepStrictEqual([row("haicore/101").draggable, row("haicore/103").draggable], [true, true]);

  const window = app.ownerDocument.defaultView!;
  const carried = new Map<string, string>();
  const dataTransfer = {
    types: ["application/vnd.ctun.jobs"],
    effectAllowed: "",
    setData: (type: string, value: string) => carried.set(type, value),
    getData: (type: string) => carried.get(type) ?? "",
    setDragImage: () => {},
  };
  const dragEvent = (type: string) => Object.assign(new window.Event(type, { bubbles: true, cancelable: true }), { dataTransfer });
  row("haicore/103").dispatchEvent(dragEvent("dragstart"));
  assert.deepStrictEqual(JSON.parse(carried.get("application/vnd.ctun.jobs")!), ["haicore/103"]);
  row("haicore/101").dispatchEvent(dragEvent("dragstart"));
  assert.deepStrictEqual(JSON.parse(carried.get("application/vnd.ctun.jobs")!), ["haicore/101", "haicore/102"]);

  const legacyBand = [...app.querySelectorAll(".group-row")].find((band) => band.textContent?.startsWith("legacy"))!;
  const dragover = dragEvent("dragover");
  legacyBand.dispatchEvent(dragover);
  assert.ok(dragover.defaultPrevented);
  legacyBand.dispatchEvent(dragEvent("drop"));
  assert.deepStrictEqual(sent.at(-1), { type: "dropOnProject", keys: ["haicore/101", "haicore/102"], project: "legacy" });
});

test("a drag folds the table into one band per known project and unfolds it after", async () => {
  const { app, post } = render(model());
  const window = app.ownerDocument.defaultView!;
  const dataTransfer = { types: [], effectAllowed: "", setData: () => {}, getData: () => "", setDragImage: () => {} };
  const dragEvent = (type: string) => Object.assign(new window.Event(type, { bubbles: true }), { dataTransfer });
  const row = app.querySelector<HTMLElement>(".job")!;
  const targets = () => [...app.querySelectorAll(".drop-targets .group-row")].map((band) => band.textContent);

  row.dispatchEvent(dragEvent("dragstart"));
  await new Promise((resolve) => setTimeout(resolve));
  assert.ok(app.classList.contains("dragging-jobs"));
  assert.deepStrictEqual(targets(), ["htfm", "draft", "legacy", "Unassigned"]);

  const sortedColumn = () => app.querySelector("[role=columnheader][aria-sort]")?.textContent;
  const sortedBefore = sortedColumn();
  post(model({ sort: { column: "state", direction: "descending" } }));
  assert.strictEqual(sortedColumn(), sortedBefore, "a model during the drag waits for its end");
  row.dispatchEvent(dragEvent("dragend"));
  assert.ok(!app.classList.contains("dragging-jobs"));
  assert.match(sortedColumn() ?? "", /^State/);
});

test("a column header sorts by its column and shows the direction", () => {
  const { app, sent, click } = render(model({ sort: { column: "state", direction: "descending" } }));
  const sortedHeader = app.querySelector("[role=columnheader][aria-sort]")!;
  assert.strictEqual(sortedHeader.getAttribute("aria-sort"), "descending");
  assert.strictEqual(sortedHeader.textContent, "State↓");
  click("Partition");
  assert.deepStrictEqual(sent.at(-1), { type: "sort", column: "partition" });
});

test("renders the details of an expanded job and sends its actions", () => {
  const extras = new Map<string, RowExtras>([
    [
      "haicore/101",
      {
        addOnLines: {
          state: "loaded",
          lines: [{ label: "Training", text: "epoch 31 · val/loss 0.690", link: { label: "W&B", url: "https://wandb.ai/e/p/runs/r" } }],
        },
        changes: { state: "loaded", commits: [{ hash: "87d86d4", message: "Fix paths" }] },
      },
    ],
  ]);
  const { app, sent, click } = render(model({ expanded: ["haicore/101", "haicore/103"], extras }));
  const details = [...app.querySelectorAll(".details-row")];
  assert.strictEqual(details.length, 2);

  const first = details[0].textContent ?? "";
  assert.match(first, /Draft by the agent/);
  assert.match(first, /epoch 31 · val\/loss 0.690/);
  assert.match(first, /87d86d4 on main · pushed/);
  assert.match(first, /Previous run: job 91 on haicore \(Failed\)/);
  assert.match(first, /1 commits since job 91/);
  assert.match(first, /87d86d4 Fix paths/);

  const unpushed = details[1].textContent ?? "";
  assert.match(unpushed, /not on remote/);
  assert.match(unpushed, /1 uncommitted files/);
  assert.doesNotMatch(unpushed, /Training/);

  click("Confirm", details[0]);
  click("Customize note writing…", details[0]);
  click("W&B ↗", details[0]);
  assert.deepStrictEqual(sent.slice(-3), [
    { type: "review", key: "haicore/101", action: "confirm" },
    { type: "customizeNoteWriting" },
    { type: "openUrl", url: "https://wandb.ai/e/p/runs/r" },
  ]);
});

test("shows the add-ons loading, then a muted line with its help command", () => {
  const help = { label: "How to tag runs", command: "ctun.showWandbGuide" };
  const extras = new Map<string, RowExtras>([
    ["haicore/101", { addOnLines: { state: "loading", labels: ["Training"] } }],
    ["haicore/103", { addOnLines: { state: "loaded", lines: [{ label: "Training", text: "No W&B run tagged slurm:haic:103.", muted: true, help }] } }],
  ]);
  const { app, sent, click } = render(model({ expanded: ["haicore/101", "haicore/103"], extras }));
  const details = [...app.querySelectorAll(".details-row")];
  assert.match(details[0].textContent ?? "", /TrainingLoading…/);
  click("How to tag runs", details[1]);
  assert.deepStrictEqual(sent.at(-1), { type: "runCommand", command: "ctun.showWandbGuide" });
});

test("offers to load the commit list before it is loaded", () => {
  const { sent, click } = render(model({ expanded: ["haicore/101"] }));
  click("Show commits since job 91");
  assert.deepStrictEqual(sent.at(-1), { type: "loadChanges", key: "haicore/101" });
});

test("renders the review cards with their checked references", () => {
  const { app, sent, click } = render(model({ mode: "review" }));
  const cards = [...app.querySelectorAll(".review-card")];
  assert.deepStrictEqual(
    cards.map((card) => card.querySelector(".muted.small")?.textContent?.split(" · ")[0]),
    ["Job 102 on haicore", "Job 101 on haicore", "Job 80 on haicore"],
  );
  assert.match(cards[1].textContent ?? "", /✓ commit:87d86d4 checked by ctun/);
  click("Discard", cards[0]);
  click("Show job", cards[1]);
  assert.deepStrictEqual(sent.slice(-2), [
    { type: "review", key: "haicore/102", action: "discard" },
    { type: "showJob", key: "haicore/101" },
  ]);
});

test("scrolls once to the row another tab revealed", () => {
  const dom = new JSDOM(`<main id="app"></main>`, { runScripts: "outside-only" });
  Object.assign(dom.window, { acquireVsCodeApi: () => ({ postMessage: () => {} }) });
  const scrolled: string[] = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
    scrolled.push(this.dataset.rowKey ?? "");
  };
  dom.window.eval(RENDERER);
  const post = (reveal: unknown) =>
    dom.window.dispatchEvent(
      new dom.window.MessageEvent("message", { data: { type: "model", model: model({ expanded: ["haicore/94"] }), refreshing: false, reveal } }),
    );
  post({ key: "haicore/94", serial: 1 });
  post({ key: "haicore/94", serial: 1 });
  post({ key: "haicore/94", serial: 2 });
  assert.deepStrictEqual(scrolled, ["haicore/94", "haicore/94"]);
});

test("the columns follow the layout, and their headers resize, move and hide them", () => {
  const layout = { ...DEFAULT_COLUMN_LAYOUT, hidden: ["note" as const] };
  const { app, sent } = render(model({ columnLayout: layout }));
  const window = app.ownerDocument.defaultView!;
  const headers = () => [...app.querySelectorAll<HTMLElement>("[role=columnheader]")];
  assert.deepStrictEqual(headers().map((header) => header.dataset.column), ["id", "name", "state", "start", "elapsed", "partition"]);
  const grid = app.querySelector<HTMLElement>(".grid")!;
  assert.match(grid.style.getPropertyValue("--columns"), /minmax\(0, 1fr\)$/, "without Note an empty track takes the rest");
  const job = app.querySelector(".job")!;
  assert.strictEqual(job.children.length, 7, "six cells and the empty one");

  const state = headers().find((header) => header.dataset.column === "state")!;
  const handle = state.querySelector<HTMLElement>(".resize-handle")!;
  Object.assign(handle, { setPointerCapture: () => {} });
  const pointer = (type: string, clientX: number) => Object.assign(new window.Event(type, { bubbles: true }), { clientX, pointerId: 1 });
  handle.dispatchEvent(pointer("pointerdown", 100));
  handle.dispatchEvent(pointer("pointermove", 140));
  assert.match(grid.style.getPropertyValue("--columns"), / 160px /, "the width follows the drag before it is stored");
  handle.dispatchEvent(pointer("pointerup", 140));
  assert.deepStrictEqual(sent.at(-1), { type: "setColumnWidth", column: "state", width: 160 });

  const carried = new Map<string, string>([["application/vnd.ctun.column", "partition"]]);
  const dataTransfer = { types: [...carried.keys()], getData: (type: string) => carried.get(type) ?? "" };
  const dragEvent = (type: string) => Object.assign(new window.Event(type, { bubbles: true, cancelable: true }), { dataTransfer, clientX: 0 });
  const name = headers().find((header) => header.dataset.column === "name")!;
  const over = dragEvent("dragover");
  name.dispatchEvent(over);
  assert.ok(over.defaultPrevented);
  name.dispatchEvent(dragEvent("drop"));
  assert.deepStrictEqual(sent.at(-1), { type: "moveColumn", column: "partition", target: "name" });

  state.dispatchEvent(Object.assign(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }), {}));
  const menu = app.ownerDocument.querySelector(".column-menu")!;
  const noteBox = [...menu.querySelectorAll("label")].find((label) => label.textContent === "Note")!.querySelector("input")!;
  assert.strictEqual(noteBox.checked, false);
  noteBox.dispatchEvent(new window.Event("change"));
  assert.deepStrictEqual(sent.at(-1), { type: "toggleColumn", column: "note" });
  assert.strictEqual([...menu.querySelectorAll("label")].find((label) => label.textContent?.startsWith("ID"))!.querySelector("input")!.disabled, true);
});
