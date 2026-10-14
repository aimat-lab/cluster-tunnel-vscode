import type { SetupCheck } from "../../setupChecks";

export const ENABLE_COMMAND = "ctun.addons.wandb.enable";

/** The W&B row of the Setup view: one grey row while off, else the key, entity and tagging guide. */
export function wandbSetupCheck({ enabled, hasKey, entity }: { enabled: boolean; hasKey: boolean; entity: string }): SetupCheck {
  if (!enabled) {
    return {
      label: "W&B",
      health: "off",
      description: "add-on off",
      tooltip: "Turn on the W&B add-on: projects and training metrics from runs tagged with their Slurm job",
      fix: { kind: "command", command: ENABLE_COMMAND },
    };
  }
  const children: SetupCheck[] = [
    {
      label: "API key",
      health: hasKey ? "ok" : "broken",
      description: hasKey ? "stored" : "missing",
      fix: { kind: "command", command: "ctun.setWandbKey" },
    },
    {
      label: "Entity",
      health: "plain",
      icon: "account",
      description: entity || "the key's own",
      fix: { kind: "setting", id: "ctun.addons.wandb.entity" },
    },
    {
      label: "Tag runs in the training script",
      health: "plain",
      icon: "book",
      description: "how to",
      fix: { kind: "command", command: "ctun.showWandbGuide" },
    },
  ];
  if (!hasKey) {
    return { label: "W&B", health: "broken", description: "API key missing", children };
  }
  return { label: "W&B", health: "ok", description: entity || "the key's own entity", children };
}
