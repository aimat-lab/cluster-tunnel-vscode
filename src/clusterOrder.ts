import type * as vscode from "vscode";

/** Where the cluster order is kept: the extension's `globalState`, which Settings Sync carries. */
export const CLUSTER_ORDER_STATE_KEY = "ctun.clusterOrder";

/** `clusters` in the stored `order`; clusters the order doesn't know yet keep ctun's order after the known ones. */
export function inOrder(clusters: readonly string[], order: readonly string[]): string[] {
  const rank = (cluster: string) => {
    const index = order.indexOf(cluster);
    return index === -1 ? order.length : index;
  };
  return [...clusters].sort((first, second) => rank(first) - rank(second));
}

/** `clusters` with `moved` taken out and put right before `before`, or at the end without one. */
export function movedBefore(clusters: readonly string[], moved: string, before: string | undefined): string[] {
  const rest = clusters.filter((cluster) => cluster !== moved);
  const index = before === undefined ? -1 : rest.indexOf(before);
  return index === -1 ? [...rest, moved] : [...rest.slice(0, index), moved, ...rest.slice(index)];
}

/** The order the user dragged the clusters into in the Clusters view. */
export class ClusterOrder {
  constructor(private readonly memento: vscode.Memento) {}

  sorted(clusters: readonly string[]): string[] {
    return inOrder(clusters, this.memento.get<string[]>(CLUSTER_ORDER_STATE_KEY) ?? []);
  }

  /** Moves `moved` before `before` (or to the end) among the `clusters` shown now. */
  move(clusters: readonly string[], moved: string, before: string | undefined): Thenable<void> {
    return this.memento.update(CLUSTER_ORDER_STATE_KEY, movedBefore(this.sorted(clusters), moved, before));
  }
}
