import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { buildJobsTable, DEFAULT_FILTERS, JobsTableModel } from "../../jobsTable";
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
  const click = (text: string) => {
    const target = [...app.querySelectorAll("button")].find((node) => node.textContent === text);
    assert.ok(target, `no button "${text}"`);
    target.click();
  };
  return { app, sent, click };
}

const MODEL = buildJobsTable({
  statuses: [GUARDED_STATUS, LOGGED_OUT_STATUS],
  report: JOBS_REPORT,
  loggingIn: new Set(),
  filters: DEFAULT_FILTERS,
  updatedAt: undefined,
});

test("renders a row per job and the locked cluster", () => {
  const { app } = render(MODEL);
  assert.strictEqual(app.querySelectorAll("tr.job").length, 8);
  const text = app.textContent ?? "";
  assert.match(text, /Out of memory/);
  assert.match(text, /bwuni3 has no tunnel/);
});

test("sends the filter and login clicks to the extension", () => {
  const { sent, click } = render(MODEL);
  click("haicore");
  click("Log in to bwuni3");
  assert.deepStrictEqual(sent.slice(-2), [
    { type: "pickCluster", cluster: "haicore" },
    { type: "login", cluster: "bwuni3" },
  ]);
});
