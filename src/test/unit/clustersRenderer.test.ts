import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { buildClustersModel, ClustersModel } from "../../clustersModel";
import { GUARDED_STATUS, JOBS, LOGGED_OUT_STATUS } from "../fixtures/ctunOutput";

const RENDERER = fs.readFileSync(path.resolve(__dirname, "../../../media/clusters.js"), "utf8");

/** Loads the webview script into a DOM, posts `model`, and records what the script sends back. */
function render(model: ClustersModel) {
  const dom = new JSDOM(`<main id="app"></main>`, { runScripts: "outside-only" });
  const sent: unknown[] = [];
  // A JSON round trip moves each message out of the jsdom realm, so deepStrictEqual compares plain objects.
  const postMessage = (message: unknown) => sent.push(JSON.parse(JSON.stringify(message)));
  Object.assign(dom.window, { acquireVsCodeApi: () => ({ postMessage }) });
  dom.window.eval(RENDERER);
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: { type: "model", model } }));
  const app = dom.window.document.getElementById("app")!;
  const card = (cluster: string) => app.querySelector<HTMLElement>(`[data-cluster="${cluster}"]`)!;
  return { window: dom.window, app, sent, card };
}

const KCIST = { ...LOGGED_OUT_STATUS, cluster: "kcist" };
const MODEL = buildClustersModel({
  statuses: [GUARDED_STATUS, LOGGED_OUT_STATUS, KCIST],
  loggingIn: new Set(["kcist"]),
  jobsOf: () => ({ jobs: JOBS, error: null }),
  loaded: true,
});

test("a logged-out cluster gets a Log in button; one logging in gets it disabled", () => {
  const { sent, card } = render(MODEL);
  const login = card("bwuni3").querySelector("button")!;
  assert.strictEqual(login.textContent, "Log in");
  login.click();
  assert.deepStrictEqual(sent.at(-1), { type: "login", cluster: "bwuni3" });
  const waiting = card("kcist").querySelector("button")!;
  assert.deepStrictEqual([waiting.textContent, waiting.disabled], ["Logging in…", true]);
});

test("a live cluster shows its details, a budget bar, Log out and links", () => {
  const { sent, card } = render(MODEL);
  const haicore = card("haicore");
  assert.deepStrictEqual([...haicore.querySelectorAll("dt")].map((term) => term.textContent), ["Session", "Budget", "Commands", "Jobs"]);
  assert.strictEqual(haicore.querySelector<HTMLElement>(".fill")!.style.width, "37%");
  const buttons = [...haicore.querySelectorAll("button")];
  buttons.find((button) => button.textContent === "Log out")!.click();
  buttons.find((button) => button.textContent === "24 sent this session")!.click();
  assert.deepStrictEqual(sent.slice(-2), [
    { type: "logout", cluster: "haicore" },
    { type: "showCommands", cluster: "haicore" },
  ]);
});

test("dropping a cluster on the upper half of another moves it before that one", () => {
  const { window, sent, card } = render(MODEL);
  card("kcist").dispatchEvent(new window.MouseEvent("dragstart"));
  const drop = new window.MouseEvent("drop", { clientY: 0, cancelable: true });
  card("haicore").dispatchEvent(drop);
  assert.ok(drop.defaultPrevented);
  assert.deepStrictEqual(sent.at(-1), { type: "move", cluster: "kcist", before: "haicore" });
});

test("a cluster dragged over anything but another card shows the no-drop cursor", () => {
  const { window, app, card } = render(MODEL);
  card("kcist").dispatchEvent(new window.MouseEvent("dragstart"));
  const dataTransfer = { dropEffect: "move" };
  const dragover = Object.assign(new window.Event("dragover", { bubbles: true, cancelable: true }), { dataTransfer });
  app.dispatchEvent(dragover);
  assert.deepStrictEqual([dragover.defaultPrevented, dataTransfer.dropEffect], [true, "none"]);
});

test("Alt+Up and Alt+Down move the focused cluster", () => {
  const { window, sent, card } = render(MODEL);
  const press = (cluster: string, key: string) =>
    card(cluster).dispatchEvent(new window.KeyboardEvent("keydown", { key, altKey: true, cancelable: true }));
  press("bwuni3", "ArrowUp");
  press("haicore", "ArrowDown");
  press("bwuni3", "ArrowDown");
  assert.deepStrictEqual(sent.slice(-3), [
    { type: "move", cluster: "bwuni3", before: "haicore" },
    { type: "move", cluster: "haicore", before: "kcist" },
    { type: "move", cluster: "bwuni3", before: null },
  ]);
});

test("says when there are no clusters, and shows ctun's error", () => {
  const { app } = render({ clusters: [], loaded: true, error: "ctun failed: boom" });
  assert.strictEqual(app.textContent, "ctun failed: boomNo clusters in your ctun config.");
});
