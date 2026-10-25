import * as vscode from "vscode";
import type { Ctun } from "./ctun";
import { ensureNoteWritingFile, globalSkillDir, installSkill, isSkillInstalled, SKILL_DOCS_URL } from "./skill";

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
  if (picked === install) {
    await installWithProgress(ctun, skillDir, onInstalled);
  }
}

/**
 * Opens the user's directions for job notes in an editor, made from a template the first time.
 * Agents find them through ctun's skill, so a missing skill is offered for install first.
 */
export async function customizeNoteWriting(ctun: Ctun, onInstalled: () => void): Promise<void> {
  const skillDir = globalSkillDir();
  if (!(await isSkillInstalled(skillDir))) {
    const install = "Install the Skill";
    const picked = await vscode.window.showInformationMessage(
      "Agents read your note directions through ctun's Claude Code skill, which is not installed.",
      install,
    );
    if (picked !== install || !(await installWithProgress(ctun, skillDir, onInstalled))) {
      return;
    }
  }
  try {
    await vscode.window.showTextDocument(vscode.Uri.file(await ensureNoteWritingFile(skillDir)));
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not open the note directions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Installs the skill into `skillDir` under a progress notification; false when it failed. */
async function installWithProgress(ctun: Ctun, skillDir: string, onInstalled: () => void): Promise<boolean> {
  try {
    const ref = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Installing the cluster-tunnel skill…" },
      async () => installSkill(skillDir, await ctun.version()),
    );
    onInstalled();
    void vscode.window.showInformationMessage(`Installed the cluster-tunnel skill (${ref}) in ${skillDir}. New Claude Code sessions load it.`);
    return true;
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not install the skill: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
