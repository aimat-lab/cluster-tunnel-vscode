import * as vscode from "vscode";
import { ClusterData } from "./clusterData";
import { CLUSTERS_VIEW_ID, ClusterNode, ClustersView } from "./clustersView";
import { loadChanges } from "./codeChanges";
import { CommandsPanel, CommandsPanelServices } from "./commandsPanel";
import { Ctun } from "./ctun";
import { JobsPanel, JobsPanelServices } from "./jobsPanel";
import { pendingReviews } from "./jobsTable";
import { LoginMethod, logIn, logOut } from "./login";
import { ProjectsView } from "./projectsView";
import { REVIEWS_STATE_KEY, ReviewStore } from "./reviews";
import { createStatusBar } from "./statusBar";
import { setWandbKey, trainingLookup, WANDB_KEY_SECRET } from "./training";

export function activate(context: vscode.ExtensionContext): void {
  const data = new ClusterData(createCtun);
  const reviews = new ReviewStore(context.globalState);
  // D8: reviews live in globalState, which Settings Sync carries to the user's other machines.
  context.globalState.setKeysForSync([REVIEWS_STATE_KEY]);
  const reviewsChanged = new vscode.EventEmitter<void>();
  const pendingCount = () => pendingReviews(data.jobs, reviews.all()).length;

  const clustersView = vscode.window.createTreeView(CLUSTERS_VIEW_ID, { treeDataProvider: new ClustersView(data) });
  const projectsView = vscode.window.createTreeView("ctun.projects", { treeDataProvider: new ProjectsView(data) });
  const updateBadge = () => {
    const pending = pendingCount();
    clustersView.badge = pending > 0 ? { value: pending, tooltip: `${pending} agent notes to review` } : undefined;
  };

  data.onDidChange(() => {
    clustersView.message = data.error ? `ctun failed: ${data.error.message}` : undefined;
    updateBadge();
  });
  reviewsChanged.event(() => {
    updateBadge();
    JobsPanel.refreshView();
  });
  clustersView.onDidChangeVisibility(({ visible }) => {
    if (visible) {
      void data.refreshIfStale();
    }
  });

  const services: JobsPanelServices = {
    data,
    reviews,
    onReviewsChanged: () => reviewsChanged.fire(),
    loadTraining: trainingLookup(context.secrets),
    loadChanges: (cluster, workdir, fromCommit, toCommit) => loadChanges(createCtun(), cluster, workdir, fromCommit, toCommit),
  };
  const showJobs = () => JobsPanel.show(context.extensionUri, services);
  const commandsServices: CommandsPanelServices = {
    data,
    ctun: createCtun,
    revealJob: (key) => showJobs().revealJob(key),
  };
  const showCommands = async (cluster?: string) => {
    const picked = cluster ?? (await pickLiveCluster(data));
    if (picked !== undefined) {
      CommandsPanel.show(context.extensionUri, commandsServices, picked);
    }
  };

  context.subscriptions.push(
    data,
    clustersView,
    projectsView,
    reviewsChanged,
    createStatusBar(data, pendingCount, reviewsChanged.event),
    vscode.commands.registerCommand("ctun.refresh", () => data.refresh()),
    vscode.commands.registerCommand("ctun.openConfig", () => openConfig(createCtun())),
    vscode.commands.registerCommand("ctun.showJobs", showJobs),
    vscode.commands.registerCommand("ctun.showCommands", showCommands),
    vscode.commands.registerCommand("ctun.showReviews", () => showJobs().showReviews()),
    vscode.commands.registerCommand("ctun.filterProject", (project: string) => showJobs().filterProject(project)),
    vscode.commands.registerCommand("ctun.login", (cluster: string | ClusterNode) =>
      logIn(createCtun(), data, clusterName(cluster), loginMethod()),
    ),
    vscode.commands.registerCommand("ctun.logout", (cluster: string | ClusterNode) =>
      logOut(createCtun(), data, clusterName(cluster)),
    ),
    vscode.commands.registerCommand("ctun.setWandbKey", () => setWandbKey(context.secrets)),
    vscode.commands.registerCommand("ctun.clearWandbKey", () => context.secrets.delete(WANDB_KEY_SECRET)),
  );
  void data.refresh();
}

export function deactivate(): void {}

function createCtun(): Ctun {
  const ctunPath = vscode.workspace.getConfiguration("ctun").get<string>("path") || "ctun";
  return new Ctun([ctunPath]);
}

function loginMethod(): LoginMethod {
  return vscode.workspace.getConfiguration("ctun").get<LoginMethod>("login.method") ?? "window";
}

/** Asks which live cluster to show; a single one needs no asking. */
async function pickLiveCluster(data: ClusterData): Promise<string | undefined> {
  const live = data.statuses.filter((status) => status.live).map((status) => status.cluster);
  if (live.length === 0) {
    void vscode.window.showInformationMessage("No cluster is connected. Log in to one first.");
    return undefined;
  }
  if (live.length === 1) {
    return live[0];
  }
  return vscode.window.showQuickPick(live, { title: "Show the commands sent to which cluster?" });
}

/** The tree's login hint passes a name; its inline buttons pass the node. */
function clusterName(cluster: string | ClusterNode): string {
  return typeof cluster === "string" ? cluster : cluster.status.cluster;
}

async function openConfig(ctun: Ctun): Promise<void> {
  const configPath = (await ctun.run(["config", "--path"])).trim();
  try {
    await vscode.window.showTextDocument(vscode.Uri.file(configPath));
  } catch {
    void vscode.window.showErrorMessage(`No ctun config at ${configPath}. Create one with \`ctun config --init\`.`);
  }
}
