/** Separates the levels of a nested project: `htfm/multihead` is `multihead` inside `htfm`. */
export const PROJECT_SEPARATOR = "/";

/** `htfm//multihead/` → `htfm/multihead`: empty levels are dropped. */
export function normalizeProject(name: string): string {
  return segments(name).join(PROJECT_SEPARATOR);
}

/** The deepest level's name: `htfm/multihead` → `multihead`. */
export function leafName(project: string): string {
  return segments(project).at(-1) ?? project;
}

/** How many levels lie above `project`: 0 for `htfm`, 1 for `htfm/multihead`. */
export function nestingDepth(project: string): number {
  return segments(project).length - 1;
}

/** `htfm/multihead` → `["htfm", "htfm/multihead"]`. */
export function selfAndAncestors(project: string): string[] {
  const levels = segments(project);
  return levels.map((_, index) => levels.slice(0, index + 1).join(PROJECT_SEPARATOR));
}

/** The project one level up; undefined at the top. */
export function parentProject(project: string): string | undefined {
  const levels = segments(project);
  return levels.length > 1 ? levels.slice(0, -1).join(PROJECT_SEPARATOR) : undefined;
}

/** Each project of `jobCounts` and every project above it, with the jobs in it and nested below it. */
export function totalsWithNested(jobCounts: ReadonlyMap<string, number>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [project, count] of jobCounts) {
    for (const level of selfAndAncestors(project)) {
      totals.set(level, (totals.get(level) ?? 0) + count);
    }
  }
  return totals;
}

/** Projects as a tree reads top to bottom: a parent before its children, siblings by name, `last` at the end. */
export function treeOrder(projects: Iterable<string>, last: string): string[] {
  return [...projects].sort((a, b) => {
    if (a === last || b === last) {
      return a === last ? (b === last ? 0 : 1) : -1;
    }
    const levelsA = segments(a);
    const levelsB = segments(b);
    for (let index = 0; index < Math.min(levelsA.length, levelsB.length); index++) {
      const order = levelsA[index].localeCompare(levelsB[index]);
      if (order !== 0) {
        return order;
      }
    }
    return levelsA.length - levelsB.length;
  });
}

/**
 * The projects to hide so that only `project` shows, with everything nested in it:
 * every project of `known` beside `project` or beside a project above it.
 */
export function hiddenToShowOnly(project: string, known: Iterable<string>): Set<string> {
  const keptLevels = selfAndAncestors(project);
  const levelsAbove = keptLevels.slice(0, -1);
  const isBesideKeptLevel = (other: string) => {
    const parent = parentProject(other);
    return (parent === undefined || levelsAbove.includes(parent)) && !keptLevels.includes(other);
  };
  return new Set([...known].filter(isBesideKeptLevel));
}

/**
 * `hidden` after showing `project`. A hidden project above it shows again, with the
 * projects of `known` beside the path down to `project` hidden in its place.
 */
export function hiddenAfterShowing(project: string, hidden: ReadonlySet<string>, known: Iterable<string>): Set<string> {
  const knownProjects = [...known];
  const levels = selfAndAncestors(project);
  const result = new Set(hidden);
  let isBelowHidden = false;
  levels.slice(0, -1).forEach((level, index) => {
    isBelowHidden = result.delete(level) || isBelowHidden;
    if (!isBelowHidden) {
      return;
    }
    const nextLevel = levels[index + 1];
    for (const child of knownProjects.filter((other) => parentProject(other) === level && other !== nextLevel)) {
      result.add(child);
    }
  });
  result.delete(project);
  return result;
}

/** `projects` without `project` and every project nested in it. */
export function withoutNested(projects: Iterable<string>, project: string): Set<string> {
  return new Set([...projects].filter((other) => !selfAndAncestors(other).includes(project)));
}

/** `project` once `old` is renamed to `renamed`, with the projects nested in `old`; undefined if it is neither. */
export function renamedProject(project: string, old: string, renamed: string): string | undefined {
  return selfAndAncestors(project).includes(old) ? normalizeProject(renamed + project.slice(old.length)) : undefined;
}

/** `projects` with `old` and every project nested in it renamed to `renamed`. */
export function withRenamed(projects: Iterable<string>, old: string, renamed: string): Set<string> {
  return new Set([...projects].map((project) => renamedProject(project, old, renamed) ?? project));
}

/**
 * The new name of `dragged` dropped on `target` (undefined: the top level), keeping its own name;
 * undefined when it stays where it is or would land inside itself.
 */
export function droppedProject(dragged: string, target: string | undefined): string | undefined {
  if (target !== undefined && selfAndAncestors(target).includes(dragged)) {
    return undefined;
  }
  const dropped = target === undefined ? leafName(dragged) : `${target}${PROJECT_SEPARATOR}${leafName(dragged)}`;
  return dropped === dragged ? undefined : dropped;
}

/** True when `project` or a project above it is in `hidden`. */
export function isHiddenBy(project: string, hidden: ReadonlySet<string>): boolean {
  return selfAndAncestors(project).some((level) => hidden.has(level));
}

function segments(project: string): string[] {
  return project.split(PROJECT_SEPARATOR).filter((level) => level !== "");
}
