import * as vscode from "vscode";
import type { ClusterData } from "./clusterData";
import { ClusterInfo, Ctun, CtunError } from "./ctun";

/** The login waits for a human, so allow far more than a normal call. */
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const LIVE_POLL_INTERVAL_MS = 2_000;
const LIVE_POLL_ATTEMPTS = 15;

/** `ctun.login.method`: ctun's own login window, or VS Code's input boxes. */
export type LoginMethod = "window" | "vscode";

interface Credentials {
  password: string;
  otp: string | null;
  limit: number | null;
}

/** Logs in to `cluster` and waits until its tunnel is live. */
export async function logIn(ctun: Ctun, data: ClusterData, cluster: string, method: LoginMethod): Promise<void> {
  let credentials: Credentials | undefined;
  if (method === "vscode") {
    try {
      credentials = await askCredentials(cluster, await ctun.info(cluster));
    } catch (error) {
      showCtunError(`Login to ${cluster} failed`, error);
      return;
    }
    if (credentials === undefined) {
      return;
    }
  }
  data.loggingIn.add(cluster);
  data.notify();
  try {
    if (credentials) {
      // The secrets go to ctun on stdin only, never in argv or the environment.
      await ctun.run(["-t", cluster, "login", "--credentials-stdin"], {
        input: JSON.stringify(credentials),
        timeoutMs: LOGIN_TIMEOUT_MS,
      });
    } else {
      await ctun.run(["-t", cluster, "login", "--interactive"], { timeoutMs: LOGIN_TIMEOUT_MS });
    }
    const live = await waitUntilLive(ctun, cluster);
    if (live) {
      void vscode.window.showInformationMessage(`ctun: ${cluster} connected.`);
    } else {
      void vscode.window.showWarningMessage(`ctun: the login finished, but ${cluster} is not live.`);
    }
  } catch (error) {
    showCtunError(`Login to ${cluster} failed`, error);
  } finally {
    data.loggingIn.delete(cluster);
    await data.refresh();
  }
}

export async function logOut(ctun: Ctun, data: ClusterData, cluster: string): Promise<void> {
  try {
    await ctun.run(["-t", cluster, "logout"]);
  } catch (error) {
    showCtunError(`Logout from ${cluster} failed`, error);
  }
  await data.refresh();
}

/** Asks for the session budget, then the OTP and the password the cluster needs; undefined if cancelled. */
async function askCredentials(cluster: string, info: ClusterInfo): Promise<Credentials | undefined> {
  const steps = 1 + Number(info.requires_otp) + Number(info.requires_password);
  const title = (step: number) => `Log in to ${cluster} (${step}/${steps})`;

  const limitText = await vscode.window.showInputBox({
    title: title(1),
    prompt: `Session budget in ${info.budget.unit}. ctun blocks sbatch, srun and salloc once the session reaches it. Leave empty for no limit.`,
    value: info.budget.session_limit === null ? "" : String(info.budget.session_limit),
    ignoreFocusOut: true,
    validateInput: (text) => (text.trim() === "" || Number(text) > 0 ? undefined : "Enter a number above 0, or leave it empty."),
  });
  if (limitText === undefined) {
    return undefined;
  }

  let step = 1;
  const askSecret = async (prompt: string) =>
    vscode.window.showInputBox({
      title: title(++step),
      prompt: `${prompt} Goes straight to ssh; never stored or logged.`,
      password: true,
      ignoreFocusOut: true,
    });
  const otp = info.requires_otp ? await askSecret("One-time password (OTP).") : null;
  if (otp === undefined) {
    return undefined;
  }
  const password = info.requires_password ? await askSecret("Service password.") : "";
  if (password === undefined) {
    return undefined;
  }
  return { password, otp, limit: limitText.trim() === "" ? null : Number(limitText) };
}

async function waitUntilLive(ctun: Ctun, cluster: string): Promise<boolean> {
  for (let attempt = 0; attempt < LIVE_POLL_ATTEMPTS; attempt++) {
    const [status] = await ctun.status(cluster);
    if (status?.live) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, LIVE_POLL_INTERVAL_MS));
  }
  return false;
}

function showCtunError(headline: string, error: unknown): void {
  if (!(error instanceof CtunError)) {
    throw error;
  }
  void vscode.window.showErrorMessage(`${headline}: ${error.message}`);
}
