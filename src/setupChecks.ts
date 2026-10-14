import type { CtunErrorKind } from "./ctun";
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
  wandb: { hasKey: boolean; project: string; entity: string };
}

const LOGIN_METHOD_LABELS: Record<LoginMethod, string> = {
  vscode: "VS Code input boxes",
  window: "ctun's login window",
};

/** The rows of the Setup view, top to bottom. */
export function setupChecks(inputs: SetupInputs): SetupCheck[] {
  return [ctunCheck(inputs), clustersCheck(inputs), loginMethodCheck(inputs), wandbCheck(inputs.wandb)];
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

function wandbCheck({ hasKey, project, entity }: SetupInputs["wandb"]): SetupCheck {
  const isHalfSetUp = hasKey !== Boolean(project);
  const missing: SetupHealth = isHalfSetUp ? "broken" : "off";
  const children: SetupCheck[] = [
    {
      label: "API key",
      health: hasKey ? "ok" : missing,
      description: hasKey ? "stored" : "missing",
      fix: { kind: "command", command: "ctun.setWandbKey" },
    },
    {
      label: "Project",
      health: project ? "ok" : missing,
      description: project || "not set",
      fix: { kind: "setting", id: "ctun.wandb.project" },
    },
    {
      label: "Entity",
      health: "plain",
      icon: "account",
      description: entity || "the key's own",
      fix: { kind: "setting", id: "ctun.wandb.entity" },
    },
    {
      label: "Tag runs in the training script",
      health: "plain",
      icon: "book",
      description: "how to",
      fix: { kind: "command", command: "ctun.showWandbGuide" },
    },
  ];
  if (hasKey && project) {
    return { label: "W&B", health: "ok", description: project, children };
  }
  if (isHalfSetUp) {
    return { label: "W&B", health: "broken", description: hasKey ? "project missing" : "API key missing", children };
  }
  return { label: "W&B", health: "off", description: "off; set a key and project to show runs", children };
}
