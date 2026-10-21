import * as vscode from "vscode";
import { withoutNested } from "./projectTree";

/** Where draft projects are kept: the extension's `globalState`, which Settings Sync carries. */
export const DRAFT_PROJECTS_STATE_KEY = "ctun.draftProjects";

/**
 * Projects made in the Projects view before any job is in them. ctun knows a project
 * only through its jobs, so a draft lives here until jobs are dropped on it, and stays
 * as an empty project if they leave again.
 */
export class DraftProjects implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly memento: vscode.Memento) {}

  all(): ReadonlySet<string> {
    return new Set(this.memento.get<string[]>(DRAFT_PROJECTS_STATE_KEY) ?? []);
  }

  add(project: string): Promise<void> {
    return this.store(new Set([...this.all(), project]));
  }

  /** Removes `project` and every draft nested in it. */
  remove(project: string): Promise<void> {
    return this.store(withoutNested(this.all(), project));
  }

  dispose(): void {
    this.changed.dispose();
  }

  private async store(drafts: ReadonlySet<string>): Promise<void> {
    await this.memento.update(DRAFT_PROJECTS_STATE_KEY, [...drafts].sort());
    this.changed.fire();
  }
}
