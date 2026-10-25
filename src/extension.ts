import * as vscode from "vscode";
import { AddOnRegistry } from "./addOnRegistry";
import { registerWandbAddOn } from "./addons/wandb";
import { ClusterData } from "./clusterData";
import { CLUSTERS_VIEW_ID, ClusterNode, ClustersView } from "./clustersView";
import { loadChanges } from "./codeChanges";
import { CommandsPanel, CommandsPanelServices } from "./commandsPanel";
import { Ctun } from "./ctun";
import { JobsPanel, JobsPanelServices } from "./jobsPanel";
import { pendingReviews, projectLabel } from "./jobsTable";
import { normalizeProject, PROJECT_SEPARATOR } from "./projectTree";
import { LoginMethod, logIn, logOut } from "./login";
import { BRIDGE_VARIABLE, LoginAnswer, startLoginBridge } from "./loginBridge";
import { DRAFT_PROJECTS_STATE_KEY, DraftProjects } from "./draftProjects";
import { HIDDEN_PROJECTS_STATE_KEY, HiddenProjects } from "./hiddenProjects";
import { askRenamedProject, ProjectRenameServices, renameProject } from "./projectRename";
import { DRAFT_PROJECT_INFO, ProjectsView } from "./projectsView";
import { SETUP_VIEW_ID, SetupView } from "./setupView";
import { offerSkillInstall } from "./skillCommand";
import { createStatusBar } from "./statusBar";

export function activate(context: vscode.ExtensionContext): void {
  const data = new ClusterData(createCtun);
  const addOns = new AddOnRegistry();
  const hiddenProjects = new HiddenProjects(context.globalState);
  const draftProjects = new DraftProjects(context.globalState);
  // Hidden and draft projects live in globalState, which Settings Sync carries to the user's other machines.
  context.globalState.setKeysForSync([HIDDEN_PROJECTS_STATE_KEY, DRAFT_PROJECTS_STATE_KEY]);
  const pendingCount = () => pendingReviews(data.jobs).length;

  const clustersView = vscode.window.createTreeView(CLUSTERS_VIEW_ID, { treeDataProvider: new ClustersView(data) });
  const renameServices: ProjectRenameServices = {
    data,
    draftProjects,
    hiddenProjects,
    ctun: createCtun,
    knownProjects: () => projectTree.knownProjects(),
    jobCount: (project) => projectTree.jobCount(project),
  };
  const projectTree = new ProjectsView(
    data,
    hiddenProjects,
    draftProjects,
    async (keys, project) => JobsPanel.open?.moveJobs(keys, project),
    (project, renamed) => renameProject(renameServices, project, renamed),
  );
  const projectsView = vscode.window.createTreeView("ctun.projects", {
    treeDataProvider: projectTree,
    dragAndDropController: projectTree,
  });
  const setup = new SetupView(data, addOns, createCtun);
  const setupView = vscode.window.createTreeView(SETUP_VIEW_ID, { treeDataProvider: setup });
  data.onDidChange(() => {
    clustersView.message = data.error ? `ctun failed: ${data.error.message}` : undefined;
  });
  clustersView.onDidChangeVisibility(({ visible }) => {
    if (visible) {
      void data.refreshIfStale();
    }
  });

  const services: JobsPanelServices = {
    data,
    hiddenProjects,
    addOns,
    ctun: createCtun,
    knownProjects: () => projectTree.knownProjects(),
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
    addOns,
    hiddenProjects,
    draftProjects,
    clustersView,
    projectsView,
    setupView,
    createStatusBar(data, pendingCount),
    vscode.commands.registerCommand("ctun.refresh", () => data.refreshWithProjects()),
    vscode.commands.registerCommand("ctun.openConfig", () => openConfig(createCtun())),
    vscode.commands.registerCommand("ctun.installSkill", () => offerSkillInstall(createCtun(), () => setup.refresh())),
    vscode.commands.registerCommand("ctun.showJobs", showJobs),
    vscode.commands.registerCommand("ctun.showCommands", showCommands),
    vscode.commands.registerCommand("ctun.showReviews", () => showJobs().showReviews()),
    vscode.commands.registerCommand("ctun.moveToProject", (row: JobRowContext) => JobsPanel.open?.moveToProject(row.jobKey)),
    vscode.commands.registerCommand("ctun.editNote", (row: JobRowContext) => JobsPanel.open?.editNote(row.jobKey)),
    vscode.commands.registerCommand("ctun.hideProject", (project: string) => hiddenProjects.hide(project)),
    vscode.commands.registerCommand("ctun.showProject", (project: string) =>
      hiddenProjects.show(project, projectTree.knownProjects()),
    ),
    vscode.commands.registerCommand("ctun.showAllProjects", () => hiddenProjects.showAll()),
    vscode.commands.registerCommand("ctun.newProject", async () => {
      const parent = projectTree.parentForNewProject(projectsView.selection[0]);
      const project = await askNewProject(parent, projectTree.knownProjects());
      if (project !== undefined) {
        await draftProjects.add(project);
        await projectsView.reveal(project, { select: true, expand: true });
      }
    }),
    vscode.commands.registerCommand("ctun.renameProject", async (project: string) => {
      const renamed = await askRenamedProject(project);
      if (renamed !== undefined) {
        await renameProject(renameServices, project, renamed);
      }
    }),
    vscode.commands.registerCommand("ctun.deleteDraftProject", (project: string) => draftProjects.remove(project)),
    vscode.commands.registerCommand("ctun.aboutDraftProjects", () =>
      vscode.window.showInformationMessage("A draft project has no jobs yet", { modal: true, detail: DRAFT_PROJECT_INFO }),
    ),
    vscode.commands.registerCommand("ctun.showOnlyProject", async (project: string) => {
      await hiddenProjects.showOnly(project, projectTree.knownProjects());
      showJobs();
    }),
    vscode.commands.registerCommand("ctun.login", (cluster: string | ClusterNode) =>
      logIn(createCtun(), data, clusterName(cluster), loginMethod()),
    ),
    vscode.commands.registerCommand("ctun.logout", (cluster: string | ClusterNode) =>
      logOut(createCtun(), data, clusterName(cluster)),
    ),
  );
  registerWandbAddOn(context, addOns);
  void announceLoginBridge(context, (request) => {
    if (loginMethod() !== "vscode") {
      return Promise.resolve(undefined);
    }
    const deadline = Date.now() + request.timeout * 1000;
    return logIn(createCtun(request.config), data, request.cluster, "vscode", request.session_limit, deadline);
  });
  void data.refresh();
}

/**
 * Lets `ctun login -i` from agents and terminals of this window ask here instead of popping up a window.
 *
 * Agents started by other extensions inherit this extension host's `process.env`;
 * integrated terminals get the variable through the environment variable collection.
 */
async function announceLoginBridge(context: vscode.ExtensionContext, answer: LoginAnswer): Promise<void> {
  const bridge = await startLoginBridge(answer);
  process.env[BRIDGE_VARIABLE] = bridge.address;
  const terminals = context.environmentVariableCollection;
  terminals.persistent = false;
  terminals.description = "Lets `ctun login -i` ask for the password and OTP in this window.";
  terminals.replace(BRIDGE_VARIABLE, bridge.address);
  context.subscriptions.push({
    dispose: () => {
      delete process.env[BRIDGE_VARIABLE];
      bridge.close();
    },
  });
}

export function deactivate(): void {}

/** Asks for the new project's name below `parent`; returns its full path, or undefined when cancelled. */
async function askNewProject(parent: string | undefined, known: readonly string[]): Promise<string | undefined> {
  const fullPath = (name: string) => normalizeProject(parent === undefined ? name : `${parent}${PROJECT_SEPARATOR}${name}`);
  const name = await vscode.window.showInputBox({
    title: parent === undefined ? "New project" : `New project in ${projectLabel(parent)}`,
    prompt: "A / nests it further, e.g. sweeps/lr.",
    validateInput: (value) => {
      if (!normalizeProject(value)) {
        return "Give the project a name.";
      }
      return known.includes(fullPath(value)) ? `${projectLabel(fullPath(value))} already exists.` : undefined;
    },
  });
  return name === undefined ? undefined : fullPath(name);
}

/** What a right-click on a job row passes to the commands of its context menu (`data-vscode-context` in the webview). */
interface JobRowContext {
  jobKey: string;
}

/** `configPath` makes every call use that config file instead of ctun's default. */
function createCtun(configPath?: string): Ctun {
  const ctunPath = vscode.workspace.getConfiguration("ctun").get<string>("path") || "ctun";
  return new Ctun(configPath === undefined ? [ctunPath] : [ctunPath, "--config", configPath]);
}

function loginMethod(): LoginMethod {
  return vscode.workspace.getConfiguration("ctun").get<LoginMethod>("login.method") ?? "vscode";
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
