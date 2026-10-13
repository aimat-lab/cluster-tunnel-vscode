import * as vscode from "vscode";
import type { ClusterData } from "./clusterData";
import { Ctun, CtunError } from "./ctun";

/** The login waits for a human, so allow far more than a normal call. */
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const LIVE_POLL_INTERVAL_MS = 2_000;
const LIVE_POLL_ATTEMPTS = 15;

/** Opens ctun's login window for `cluster` and waits until its tunnel is live. */
export async function logIn(ctun: Ctun, data: ClusterData, cluster: string): Promise<void> {
  data.loggingIn.add(cluster);
  data.notify();
  try {
    await ctun.run(["-t", cluster, "login", "--interactive"], { timeoutMs: LOGIN_TIMEOUT_MS });
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
