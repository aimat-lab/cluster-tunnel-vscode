import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { buildTranscript, CommandsTranscriptModel } from "../../commandsTranscript";
import { COMMAND_LOG, COMMANDS_REPORT, GUARDED_STATUS } from "../fixtures/ctunOutput";

const RENDERER = fs.readFileSync(path.resolve(__dirname, "../../../media/commands.js"), "utf8");

/** Loads the webview script into a DOM, posts `model`, and records what the script sends back. */
function render(model: CommandsTranscriptModel, error?: string) {
  const dom = new JSDOM(`<main id="app"></main>`, { runScripts: "outside-only" });
  const sent: unknown[] = [];
  // A JSON round trip moves each message out of the jsdom realm, so deepStrictEqual compares plain objects.
  const postMessage = (message: unknown) => sent.push(JSON.parse(JSON.stringify(message)));
  Object.assign(dom.window, { acquireVsCodeApi: () => ({ postMessage }), scrollTo: () => {} });
  dom.window.eval(RENDERER);
  const message = { type: "model", model, refreshing: false, error };
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: message }));
  const app = dom.window.document.getElementById("app")!;
  const click = (text: string) => {
    const target = [...app.querySelectorAll("button")].find((node) => node.textContent === text);
    assert.ok(target, `no button "${text}"`);
    target.click();
  };
  return { app, sent, click };
}

const MODEL = buildTranscript({
  cluster: "haicore",
  clusters: ["haicore", "kcist"],
  log: COMMAND_LOG,
  status: GUARDED_STATUS,
  report: COMMANDS_REPORT,
});

test("renders the header, each command, its jobs and the gaps", () => {
  const { app } = render(MODEL);
  assert.match(app.querySelector(".header")?.textContent ?? "", /^# haicore · logged in/);
  assert.strictEqual(app.querySelectorAll(".command").length, COMMAND_LOG.commands.length);
  assert.deepStrictEqual(
    [...app.querySelectorAll(".gap")].map((gap) => gap.textContent),
    ["13 min", "1 h 5 min"],
  );
  const bubbles = [...app.querySelectorAll(".bubble")].map((bubble) => bubble.textContent);
  assert.strictEqual(bubbles[0], "Submitted4817985smoke_testCompletedran 0:42");
  assert.ok(bubbles.includes("Submitted4700000state unknown"));
});

test("colours only the dot, and the word Running", () => {
  const { app } = render(MODEL);
  const states = [...app.querySelectorAll(".state")];
  assert.ok(states.some((state) => state.matches(".group-running") && state.querySelector(".dot")));
  const unknown = states.find((state) => state.textContent === "state unknown");
  assert.ok(unknown?.matches(".group-unknown"));
  assert.strictEqual(unknown?.querySelector(".dot"), null);
});

test("a listed job's ID links to Cluster jobs; an unknown one is plain text", () => {
  const { app, sent, click } = render(MODEL);
  click("4818213");
  assert.deepStrictEqual(sent.at(-1), { type: "showJob", key: "haicore/4818213" });
  assert.ok(![...app.querySelectorAll("button")].some((node) => node.textContent === "4700000"));
});

test("sends the toolbar's actions", () => {
  const { app, sent, click } = render(MODEL);
  click("Copy all");
  click("Refresh");
  const select = app.querySelector("select")!;
  select.value = "kcist";
  select.dispatchEvent(new select.ownerDocument.defaultView!.Event("change"));
  assert.deepStrictEqual(sent.slice(-3), [{ type: "copyAll" }, { type: "refresh" }, { type: "pickCluster", cluster: "kcist" }]);
});

test("shows ctun's error and the empty text", () => {
  const empty = buildTranscript({ cluster: "kcist", clusters: ["kcist"], log: { cluster: "kcist", commands: [] }, status: undefined, report: undefined });
  const { app } = render(empty, "ctun -t kcist logs --json failed");
  assert.match(app.textContent ?? "", /ctun failed: ctun -t kcist logs --json failed/);
  assert.match(app.textContent ?? "", /No commands sent to kcist this session\./);
});
