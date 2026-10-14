import type { CtunErrorKind } from "./ctun";
import { RECORD_SOURCE } from "./jobsTable";
import type { LoginMethod } from "./login";

/** `off`: an optional feature nobody set up; `broken`: needs fixing before it works; `plain`: a preference or a link, with no state to check. */
export type SetupHealth = "ok" | "off" | "broken" | "checking" | "plain";

/** What a click on a setup row does. */
export type SetupFix = { kind: "setting"; id: string } | { kind: "command"; command: string };

export interface SetupCheck {
  label: string;
  health: SetupHealth;
  description: string;
  tooltip?: string;
  /** The codicon of a `plain` row; the other rows show their health. */
  icon?: string;
  fix?: SetupFix;
  children?: SetupCheck[];
}

export interface SetupInputs {
  ctunPath: string;
  /** False until the first refresh finished. */
  refreshed: boolean;
  ctunError: { kind: CtunErrorKind; message: string } | undefined;
  clusterCount: number;
  loginMethod: LoginMethod;
  /** Whether ctun's skill is in the global Claude folder `skillDir`. */
  skill: { installed: boolean; skillDir: string };
  /** `ctun.projects.source`, and the add-on it names, if registered. */
  projects: { source: string; addOn: { label: string; active: boolean } | undefined };
  /** One row per registered add-on. */
  addOnChecks: SetupCheck[];
}

const LOGIN_METHOD_LABELS: Record<LoginMethod, string> = {
  vscode: "VS Code input boxes",
  window: "ctun's login window",
};

/** The rows of the Setup view, top to bottom. */
export function setupChecks(inputs: SetupInputs): SetupCheck[] {
  return [ctunCheck(inputs), clustersCheck(inputs), loginMethodCheck(inputs), skillCheck(inputs.skill), projectsCheck(inputs.projects), ...inputs.addOnChecks];
}

function ctunCheck({ ctunPath, refreshed, ctunError }: SetupInputs): SetupCheck {
  const fix: SetupFix = { kind: "setting", id: "ctun.path" };
  if (ctunError?.kind === "not_found") {
    return { label: "ctun", health: "broken", description: `not found at ${ctunPath}`, fix };
  }
  if (ctunError) {
    return { label: "ctun", health: "broken", description: "fails", tooltip: ctunError.message, fix };
  }
  if (!refreshed) {
    return { label: "ctun", health: "checking", description: "checking…", fix };
  }
  return { label: "ctun", health: "ok", description: ctunPath, fix };
}

function clustersCheck({ refreshed, ctunError, clusterCount }: SetupInputs): SetupCheck {
  const fix: SetupFix = { kind: "command", command: "ctun.openConfig" };
  if (!refreshed || ctunError) {
    return { label: "Clusters", health: "checking", description: "needs a working ctun", fix };
  }
  if (clusterCount === 0) {
    return { label: "Clusters", health: "broken", description: "none in the ctun config", fix };
  }
  return { label: "Clusters", health: "ok", description: `${clusterCount} configured`, fix };
}

function loginMethodCheck({ loginMethod }: SetupInputs): SetupCheck {
  return {
    label: "Login",
    health: "plain",
    icon: "key",
    description: LOGIN_METHOD_LABELS[loginMethod],
    fix: { kind: "setting", id: "ctun.login.method" },
  };
}

/** The skill is optional: ctun works without Claude Code, so a missing one is grey, not amber. */
function skillCheck({ installed, skillDir }: SetupInputs["skill"]): SetupCheck {
  return {
    label: "Claude skill",
    health: installed ? "ok" : "off",
    description: installed ? "installed" : "not installed",
    tooltip: skillDir,
    fix: { kind: "command", command: "ctun.installSkill" },
  };
}

function projectsCheck({ source, addOn }: SetupInputs["projects"]): SetupCheck {
  const fix: SetupFix = { kind: "setting", id: "ctun.projects.source" };
  if (source === RECORD_SOURCE) {
    return { label: "Projects", health: "plain", icon: "folder", description: "from ctun's --project", fix };
  }
  if (!addOn) {
    return { label: "Projects", health: "broken", description: `no add-on "${source}"`, fix };
  }
  if (!addOn.active) {
    return { label: "Projects", health: "broken", description: `${addOn.label} add-on is off`, fix };
  }
  return { label: "Projects", health: "ok", description: `from ${addOn.label}`, fix };
}
