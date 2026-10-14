import * as vscode from "vscode";
import { hiddenAfterShowing, hiddenToShowOnly, selfAndAncestors } from "./projectTree";

/** Where hidden projects are kept: the extension's `globalState`, which Settings Sync carries. */
export const HIDDEN_PROJECTS_STATE_KEY = "ctun.hiddenProjects";

/** The projects whose eye is closed in the Projects view; hiding one hides every project below it. */
export class HiddenProjects implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly memento: vscode.Memento) {}

  all(): ReadonlySet<string> {
    return new Set(this.memento.get<string[]>(HIDDEN_PROJECTS_STATE_KEY) ?? []);
  }

  hide(project: string): Promise<void> {
    return this.store(new Set([...this.all(), project]));
  }

  /** Shows `project`, also when a project above it is hidden; the others there stay hidden. */
  show(project: string, known: Iterable<string>): Promise<void> {
    return this.store(hiddenAfterShowing(project, this.all(), known));
  }

  /** Shows `project` even if a project above it was hidden. */
  reveal(project: string): Promise<void> {
    const levels = new Set(selfAndAncestors(project));
    return this.store(new Set([...this.all()].filter((hidden) => !levels.has(hidden))));
  }

  /** Hides every project of `known` but `project` and those nested in it, which all show again. */
  showOnly(project: string, known: Iterable<string>): Promise<void> {
    return this.store(hiddenToShowOnly(project, known));
  }

  showAll(): Promise<void> {
    return this.store(new Set());
  }

  dispose(): void {
    this.changed.dispose();
  }

  private async store(hidden: ReadonlySet<string>): Promise<void> {
    await this.memento.update(HIDDEN_PROJECTS_STATE_KEY, [...hidden].sort());
    this.changed.fire();
  }
}
