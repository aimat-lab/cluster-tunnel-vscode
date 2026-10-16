import * as vscode from "vscode";
import type { AddOn, DetailLine, JobRef } from "./addOns";

/** The registered add-ons; fires when one is added, removed or changed. */
export class AddOnRegistry implements vscode.Disposable {
  private readonly addOns = new Map<string, AddOn>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  register(addOn: AddOn): vscode.Disposable {
    this.addOns.set(addOn.id, addOn);
    const subscription = addOn.onDidChange(() => this.changed.fire());
    this.changed.fire();
    return new vscode.Disposable(() => {
      subscription.dispose();
      this.addOns.delete(addOn.id);
      this.changed.fire();
    });
  }

  all(): AddOn[] {
    return [...this.addOns.values()];
  }

  /** The labels of the add-ons that will answer `detailLines`. */
  detailLabels(): string[] {
    return this.withDetails().map((addOn) => addOn.label);
  }

  /** Every active add-on's lines for `job`; an add-on that fails shows its error as its line. */
  async detailLines(job: JobRef): Promise<DetailLine[]> {
    const perAddOn = await Promise.all(
      this.withDetails().map(async (addOn) => {
        try {
          return await addOn.detailLines!(job);
        } catch (error) {
          return [{ label: addOn.label, text: error instanceof Error ? error.message : String(error), muted: true }];
        }
      }),
    );
    return perAddOn.flat();
  }

  dispose(): void {
    this.changed.dispose();
  }

  private withDetails(): AddOn[] {
    return this.all().filter((addOn) => addOn.active && addOn.detailLines);
  }
}
