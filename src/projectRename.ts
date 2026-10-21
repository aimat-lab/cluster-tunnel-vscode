import * as vscode from "vscode";
import type { ClusterData } from "./clusterData";
import { Ctun, CtunError, ProjectRenameReport } from "./ctun";
import type { DraftProjects } from "./draftProjects";
import type { HiddenProjects } from "./hiddenProjects";
import { projectLabel } from "./jobsTable";
import { normalizeProject } from "./projectTree";

export interface ProjectRenameServices {
  data: ClusterData;
  draftProjects: DraftProjects;
  hiddenProjects: HiddenProjects;
  ctun: () => Ctun;
  knownProjects: () => string[];
  /** The jobs of all time in a project and the projects nested in it. */
  jobCount: (project: string) => number;
}

/** Asks for the new full name of `project`, starting from the current one; undefined when cancelled or unchanged. */
export async function askRenamedProject(project: string): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    title: `Rename ${projectLabel(project)}`,
    value: project,
    prompt: "The full name; a / nests it, e.g. archive/htfm.",
    validateInput: (value) => (normalizeProject(value) ? undefined : "Give the project a name."),
  });
  const renamed = name === undefined ? undefined : normalizeProject(name);
  return renamed === project ? undefined : renamed;
}

/**
 * After the user's yes, renames `project` and the projects nested in it to `renamed`:
 * in the job records on every live cluster, in the drafts and in the hidden projects.
 */
export async function renameProject(services: ProjectRenameServices, project: string, renamed: string): Promise<void> {
  const jobCount = services.jobCount(project);
  const joinsExisting = services.knownProjects().includes(renamed);
  const confirmed = await vscode.window.showWarningMessage(
    `Rename ${projectLabel(project)} to ${projectLabel(renamed)}?`,
    { modal: true, detail: confirmationDetail(jobCount, joinsExisting, renamed) },
    "Rename",
  );
  if (confirmed !== "Rename") {
    return;
  }
  if (jobCount > 0 && !(await renameInRecords(services, project, renamed, jobCount))) {
    return;
  }
  await services.draftProjects.rename(project, renamed);
  await services.hiddenProjects.rename(project, renamed);
}

function confirmationDetail(jobCount: number, joinsExisting: boolean, renamed: string): string {
  const records =
    jobCount === 0
      ? "It is a draft without jobs, so only VS Code changes."
      : `This changes the project in the records of its ${jobCount} jobs, and of the projects nested in it, on every connected cluster.`;
  return joinsExisting ? `${records} The jobs join the existing ${projectLabel(renamed)}.` : records;
}

/** Runs `ctun projects rename`; warns about the clusters it skipped. Returns false, after showing ctun's error, if it failed. */
async function renameInRecords(
  services: ProjectRenameServices,
  project: string,
  renamed: string,
  jobCount: number,
): Promise<boolean> {
  try {
    const report = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Renaming ${projectLabel(project)}…` },
      () => services.ctun().renameProject(project, renamed, jobCount),
    );
    warnAboutSkippedClusters(report, project);
    return true;
  } catch (error) {
    if (!(error instanceof CtunError)) {
      throw error;
    }
    void vscode.window.showErrorMessage(error.message);
    return false;
  } finally {
    await services.data.refreshWithProjects();
  }
}

function warnAboutSkippedClusters(report: ProjectRenameReport, project: string): void {
  const skipped = report.clusters
    .filter((entry) => entry.job_records && (!entry.live || entry.error !== null))
    .map((entry) => (entry.live ? `${entry.cluster} (${entry.error})` : `${entry.cluster} (tunnel down)`));
  if (skipped.length > 0) {
    void vscode.window.showWarningMessage(
      `Jobs on ${skipped.join(", ")} keep the project ${projectLabel(project)}. Log in there and rename it again.`,
    );
  }
}
