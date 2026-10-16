import * as vscode from "vscode";
import type { AddOnRegistry } from "./addOnRegistry";
import type { ClusterData } from "./clusterData";
import type { LoginMethod } from "./login";
import { SetupCheck, SetupHealth, setupChecks } from "./setupChecks";
import { globalSkillDir, isSkillInstalled } from "./skill";

export const SETUP_VIEW_ID = "ctun.setup";

const HEALTH_ICONS: Record<Exclude<SetupHealth, "plain">, vscode.ThemeIcon> = {
  ok: new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed")),
  off: new vscode.ThemeIcon("circle-slash", new vscode.ThemeColor("disabledForeground")),
  broken: new vscode.ThemeIcon("warning", new vscode.ThemeColor("list.warningForeground")),
  checking: new vscode.ThemeIcon("loading~spin"),
};

/** The Setup sidebar: what ctun and the add-ons need, each row a click away from its fix. */
export class SetupView implements vscode.TreeDataProvider<SetupCheck> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(
    private readonly data: ClusterData,
    private readonly addOns: AddOnRegistry,
  ) {
    data.onDidChange(() => this.changed.fire());
    addOns.onDidChange(() => this.changed.fire());
    vscode.workspace.onDidChangeConfiguration((event) => event.affectsConfiguration("ctun") && this.changed.fire());
  }

  /** Checks every row again, e.g. after the skill was installed. */
  refresh(): void {
    this.changed.fire();
  }

  async getChildren(check?: SetupCheck): Promise<SetupCheck[]> {
    if (check !== undefined) {
      return check.children ?? [];
    }
    const settings = vscode.workspace.getConfiguration("ctun");
    const skillDir = globalSkillDir();
    const addOnChecks = await Promise.all(this.addOns.all().flatMap((addOn) => (addOn.setupCheck ? [addOn.setupCheck()] : [])));
    return setupChecks({
      ctunPath: settings.get<string>("path") || "ctun",
      refreshed: this.data.updatedAt !== undefined || this.data.error !== undefined,
      ctunError: this.data.error,
      clusterCount: this.data.statuses.length,
      loginMethod: settings.get<LoginMethod>("login.method") ?? "vscode",
      skill: { installed: await isSkillInstalled(skillDir), skillDir },
      addOnChecks,
    });
  }

  getTreeItem(check: SetupCheck): vscode.TreeItem {
    const item = new vscode.TreeItem(check.label, collapsibleState(check));
    item.description = check.description;
    item.tooltip = check.tooltip ?? check.description;
    item.iconPath = check.health === "plain" ? new vscode.ThemeIcon(check.icon ?? "settings") : HEALTH_ICONS[check.health];
    if (check.fix?.kind === "setting") {
      item.command = { command: "workbench.action.openSettings", title: "Open the setting", arguments: [`@id:${check.fix.id}`] };
    } else if (check.fix?.kind === "command") {
      item.command = { command: check.fix.command, title: check.label };
    }
    return item;
  }
}

/** A group opens by itself while it needs attention. */
function collapsibleState(check: SetupCheck): vscode.TreeItemCollapsibleState {
  if (!check.children) {
    return vscode.TreeItemCollapsibleState.None;
  }
  const needsAttention = check.health === "broken" || check.health === "off";
  return needsAttention ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
}
