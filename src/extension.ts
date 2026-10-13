import * as vscode from "vscode";
import { ClusterData } from "./clusterData";
import { CLUSTERS_VIEW_ID, ClusterNode, ClustersView } from "./clustersView";
import { Ctun } from "./ctun";
import { JobsPanel } from "./jobsPanel";
import { logIn, logOut } from "./login";
import { createStatusBar } from "./statusBar";

export function activate(context: vscode.ExtensionContext): void {
  const data = new ClusterData(createCtun);
  const clustersView = vscode.window.createTreeView(CLUSTERS_VIEW_ID, { treeDataProvider: new ClustersView(data) });

  data.onDidChange(() => {
    clustersView.message = data.error ? `ctun failed: ${data.error.message}` : undefined;
  });
  clustersView.onDidChangeVisibility(({ visible }) => {
    if (visible) {
      void data.refresh();
    }
  });

  context.subscriptions.push(
    data,
    clustersView,
    createStatusBar(data),
    vscode.commands.registerCommand("ctun.refresh", () => data.refresh()),
    vscode.commands.registerCommand("ctun.openConfig", () => openConfig(createCtun())),
    vscode.commands.registerCommand("ctun.showJobs", () => JobsPanel.show(context.extensionUri, data)),
    vscode.commands.registerCommand("ctun.login", (cluster: string | ClusterNode) =>
      logIn(createCtun(), data, clusterName(cluster)),
    ),
    vscode.commands.registerCommand("ctun.logout", (cluster: string | ClusterNode) =>
      logOut(createCtun(), data, clusterName(cluster)),
    ),
  );
  void data.refresh();
}

export function deactivate(): void {}

function createCtun(): Ctun {
  const ctunPath = vscode.workspace.getConfiguration("ctun").get<string>("path") || "ctun";
  return new Ctun([ctunPath]);
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
