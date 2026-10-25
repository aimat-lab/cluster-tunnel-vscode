import * as assert from "assert";
import * as net from "net";
import { test } from "node:test";
import { LoginAnswer, LoginOutcome, LoginRequest, startLoginBridge } from "../../loginBridge";

/** Sends one request line to the bridge as ctun does; returns everything it answered. */
function ask(address: string, request: LoginRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(address, () => socket.write(`${JSON.stringify(request)}\n`));
    let reply = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => (reply += chunk));
    socket.on("end", () => resolve(reply));
    socket.on("error", reject);
  });
}

async function withBridge(answer: LoginAnswer, use: (address: string) => Promise<void>): Promise<void> {
  const bridge = await startLoginBridge(answer);
  try {
    await use(bridge.address);
  } finally {
    bridge.close();
  }
}

test("passes ctun's request to the answer and returns its outcome as one line", async () => {
  const received: LoginRequest[] = [];
  const answer = async (request: LoginRequest): Promise<LoginOutcome> => {
    received.push(request);
    return { status: "live" };
  };
  await withBridge(answer, async (address) => {
    const reply = await ask(address, { cluster: "haicore", session_limit: 20, config: "/home/u/.config/ctun/config.yaml", timeout: 120 });
    assert.strictEqual(reply, '{"status":"live"}\n');
  });
  assert.deepStrictEqual(received, [{ cluster: "haicore", session_limit: 20, config: "/home/u/.config/ctun/config.yaml", timeout: 120 }]);
});

test("closes without a reply when the answer declines, so ctun opens its popup", async () => {
  await withBridge(async () => undefined, async (address) => {
    assert.strictEqual(await ask(address, { cluster: "haicore", session_limit: null, config: "/home/u/.config/ctun/config.yaml", timeout: 120 }), "");
  });
});

test("each bridge gets its own address", async () => {
  const first = await startLoginBridge(async () => undefined);
  const second = await startLoginBridge(async () => undefined);
  assert.notStrictEqual(first.address, second.address);
  first.close();
  second.close();
});
