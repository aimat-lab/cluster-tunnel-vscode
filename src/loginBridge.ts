import * as crypto from "crypto";
import * as net from "net";
import * as os from "os";
import * as path from "path";

/** Names this window's bridge to `ctun login -i` (`cluster_tunnel.login_bridge`). */
export const BRIDGE_VARIABLE = "CTUN_LOGIN_BRIDGE";

/** What `ctun login -i` asks: the cluster, the session limit it would have used, its config file and how long it waits. */
export interface LoginRequest {
  cluster: string;
  session_limit: number | null;
  config: string;
  /** Seconds until ctun stops waiting for the outcome. */
  timeout: number;
}

export type LoginOutcome = { status: "live" } | { status: "cancelled" } | { status: "failed"; message: string };

/** Turns a request into an outcome; undefined sends ctun to its own popup. */
export type LoginAnswer = (request: LoginRequest) => Promise<LoginOutcome | undefined>;

export interface LoginBridge {
  /** The pipe (Windows) or Unix socket ctun connects to. */
  readonly address: string;
  close(): void;
}

/** Serves `ctun login -i` on a new local pipe: one request line in, one outcome line out. */
export function startLoginBridge(answer: LoginAnswer): Promise<LoginBridge> {
  const address = newAddress();
  const server = net.createServer((socket) => void serve(socket, answer));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(address, () => resolve({ address, close: () => server.close() }));
  });
}

async function serve(socket: net.Socket, answer: LoginAnswer): Promise<void> {
  // ctun may have exited while the human typed; nothing is left to answer then.
  socket.on("error", () => socket.destroy());
  try {
    const request = JSON.parse(await readLine(socket)) as LoginRequest;
    const outcome = await answer(request);
    socket.end(outcome === undefined ? "" : `${JSON.stringify(outcome)}\n`);
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function readLine(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      received += chunk;
      const end = received.indexOf("\n");
      if (end >= 0) {
        socket.removeAllListeners("data");
        resolve(received.slice(0, end));
      }
    });
    socket.once("end", () => reject(new Error("ctun closed the login bridge before sending a request")));
  });
}

function newAddress(): string {
  const name = `ctun-vscode-${crypto.randomBytes(8).toString("hex")}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), `${name}.sock`);
}
