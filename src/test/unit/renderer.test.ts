import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { buildJobsTable, DEFAULT_FILTERS, JobsTableModel, RowExtras } from "../../jobsTable";
import { GUARDED_STATUS, JOBS_REPORT, LOGGED_OUT_STATUS } from "../fixtures/ctunOutput";

const RENDERER = fs.readFileSync(path.resolve(__dirname, "../../../media/jobsTable.js"), "utf8");

/** Loads the webview script into a DOM, posts `model`, and records what the script sends back. */
function render(model: JobsTableModel) {
  const dom = new JSDOM(`<main id="app"></main>`, { runScripts: "outside-only" });
  const sent: unknown[] = [];
  // A JSON round trip moves each message out of the jsdom realm, so deepStrictEqual compares plain objects.
  const postMessage = (message: unknown) => sent.push(JSON.parse(JSON.stringify(message)));
  Object.assign(dom.window, { acquireVsCodeApi: () => ({ postMessage }) });
  dom.window.eval(RENDERER);
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: { type: "model", model, refreshing: false } }));
  const app = dom.window.document.getElementById("app")!;
  const click = (text: string, within: Element = app) => {
    const target = [...within.querySelectorAll("button")].find((node) => node.textContent === text);
    assert.ok(target, `no button "${text}"`);
    target.click();
  };
  return { app, sent, click };
}

function model(overrides: { mode?: "jobs" | "review"; expanded?: string[]; extras?: Map<string, RowExtras> } = {}) {
  return buildJobsTable({
    statuses: [GUARDED_STATUS, LOGGED_OUT_STATUS],
    report: JOBS_REPORT,
    loggingIn: new Set(),
    filters: DEFAULT_FILTERS,
    updatedAt: undefined,
    reviews: {},
    mode: overrides.mode ?? "jobs",
    expanded: new Set(overrides.expanded ?? []),
    extras: overrides.extras ?? new Map(),
  });
}

test("renders project groups, notes and the locked cluster", () => {
  const { app } = render(model());
  const text = app.textContent ?? "";
  assert.match(text, /htfm 3 shown/);
  assert.match(text, /Unassigned submitted without --project/);
  assert.match(text, /unreviewed Rerun of job:91/);
  assert.match(text, /bwuni3 has no tunnel/);
  assert.match(text, /To review · 3/);
});

test("renders the details of an expanded job and sends its actions", () => {
  const extras = new Map<string, RowExtras>([
    [
      "haicore/101",
      {
        training: { state: "loaded", text: "epoch 31 · val/loss 0.690", url: "https://wandb.ai/e/p/runs/r" },
        changes: { state: "loaded", commits: [{ hash: "87d86d4", message: "Fix paths" }] },
      },
    ],
  ]);
  const { app, sent, click } = render(model({ expanded: ["haicore/101", "haicore/103"], extras }));
  const details = [...app.querySelectorAll(".details-row")];
  assert.strictEqual(details.length, 2);

  const first = details[0].textContent ?? "";
  assert.match(first, /Unreviewed agent draft/);
  assert.match(first, /epoch 31 · val\/loss 0.690/);
  assert.match(first, /87d86d4 on main · pushed/);
  assert.match(first, /Previous run: job 91 on haicore \(Failed\)/);
  assert.match(first, /1 commits since job 91/);
  assert.match(first, /87d86d4 Fix paths/);

  const unpushed = details[1].textContent ?? "";
  assert.match(unpushed, /not on remote/);
  assert.match(unpushed, /1 uncommitted files/);
  assert.match(unpushed, /Looking up the W&B run/);

  click("Confirm", details[0]);
  click("W&B ↗", details[0]);
  assert.deepStrictEqual(sent.slice(-2), [
    { type: "review", reviewKey: "haic/101", action: "confirm" },
    { type: "openUrl", url: "https://wandb.ai/e/p/runs/r" },
  ]);
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
  assert.match(cards[1].textContent ?? "", /✓ commit:87d86d4 checked by ctun at submit/);
  click("Discard", cards[0]);
  click("Show job", cards[1]);
  assert.deepStrictEqual(sent.slice(-2), [
    { type: "review", reviewKey: "haic/102", action: "discard" },
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
