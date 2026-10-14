import * as vscode from "vscode";
import type { AddOnRegistry } from "./addOnRegistry";
import { jobRefs } from "./addOns";
import type { ClusterData } from "./clusterData";
import type { JobsReport } from "./ctun";
import { JobProjects, RECORD_SOURCE } from "./jobsTable";
import { normalizeProject } from "./projectTree";

const SOURCE_SETTING = "ctun.projects.source";

/** Each job's project from the source `ctun.projects.source` names, looked up again when the jobs, the source or an add-on change. */
export class ProjectLookup implements JobProjects, vscode.Disposable {
  byJob: ReadonlyMap<string, string> = new Map();
  unassignedReason = "";
  sourceLabel = "";
  error: string | undefined;

  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private lookedUpReport: JobsReport | undefined;
  /** Grows with each lookup, so a slow older lookup cannot overwrite a newer one. */
  private lookupSerial = 0;
  private readonly disposables: vscode.Disposable[];

  constructor(
    private readonly data: ClusterData,
    private readonly addOns: AddOnRegistry,
  ) {
    this.disposables = [
      this.changed,
      data.onDidChange(() => data.jobs !== this.lookedUpReport && this.lookUp()),
      addOns.onDidChange(() => this.lookUp()),
      vscode.workspace.onDidChangeConfiguration((event) => event.affectsConfiguration(SOURCE_SETTING) && this.lookUp()),
    ];
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  private lookUp(): void {
    this.lookedUpReport = this.data.jobs;
    void this.load(this.data.jobs, ++this.lookupSerial);
  }

  private async load(report: JobsReport | undefined, serial: number): Promise<void> {
    const source = projectSource();
    const addOn = source === RECORD_SOURCE ? undefined : this.addOns.get(source);
    let byJob: ReadonlyMap<string, string>;
    let error: string | undefined;
    if (source === RECORD_SOURCE) {
      byJob = recordProjects(report);
    } else if (!addOn?.active || !addOn.projectsOf) {
      byJob = new Map(); // the Setup view says why
    } else {
      try {
        byJob = await addOn.projectsOf(jobRefs(report));
      } catch (failure) {
        byJob = this.byJob;
        error = failure instanceof Error ? failure.message : String(failure);
      }
    }
    if (serial !== this.lookupSerial) {
      return;
    }
    this.byJob = normalized(byJob);
    this.error = error;
    this.sourceLabel = addOn?.label ?? "ctun";
    this.unassignedReason = addOn ? `no project in ${addOn.label}` : "submitted without --project";
    this.changed.fire();
  }
}

/** `record`, or the ID of the add-on whose projects group the jobs. */
export function projectSource(): string {
  return vscode.workspace.getConfiguration().get<string>(SOURCE_SETTING) || RECORD_SOURCE;
}

/** The projects with `/` as the only level separator; a project with no name left is dropped. */
function normalized(byJob: ReadonlyMap<string, string>): Map<string, string> {
  return new Map([...byJob].flatMap(([key, project]) => (normalizeProject(project) ? [[key, normalizeProject(project)]] : [])));
}

/** The `--project` of each recorded job, by row key. */
function recordProjects(report: JobsReport | undefined): Map<string, string> {
  return new Map(jobRefs(report).flatMap((job) => (job.record?.project ? [[job.key, job.record.project]] : [])));
}
