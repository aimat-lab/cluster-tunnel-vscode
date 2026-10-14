import * as vscode from "vscode";
import type { Ctun } from "./ctun";
import { globalSkillDir, installSkill, isSkillInstalled, SKILL_DOCS_URL } from "./skill";

/** Asks whether to install ctun's skill into the global Claude folder or to open its documentation. */
export async function offerSkillInstall(ctun: Ctun, onInstalled: () => void): Promise<void> {
  const skillDir = globalSkillDir();
  const installed = await isSkillInstalled(skillDir);
  const install = {
    label: installed ? "$(cloud-download) Reinstall the skill" : "$(cloud-download) Install the skill",
    detail: `Downloads ctun's skill from GitHub, at the tag of your ctun version, into ${skillDir}.${installed ? " Overwrites its files." : ""}`,
  };
  const docs = { label: "$(link-external) Open ctun's skill documentation", detail: "What the skill does and how to install it yourself." };
  const picked = await vscode.window.showQuickPick([install, docs], { title: "cluster-tunnel skill for Claude Code" });
  if (picked === docs) {
    await vscode.env.openExternal(vscode.Uri.parse(SKILL_DOCS_URL));
    return;
  }
  if (picked !== install) {
    return;
  }
  try {
    const ref = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Installing the cluster-tunnel skill…" },
      async () => installSkill(skillDir, await ctun.version()),
    );
    onInstalled();
    void vscode.window.showInformationMessage(`Installed the cluster-tunnel skill (${ref}) in ${skillDir}. New Claude Code sessions load it.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not install the skill: ${error instanceof Error ? error.message : String(error)}`);
  }
}
