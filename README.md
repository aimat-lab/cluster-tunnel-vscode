# Cluster Tunnel for VS Code

Shows your HPC clusters and Slurm jobs in VS Code, through the
[`ctun`](https://github.com/aimat-lab/cluster-tunnel) CLI. The extension is a thin
wrapper: every cluster value comes from `ctun` (`status -j`, `jobs --json`, `run`),
and only optional add-ons such as W&B talk to other services, with your key. It has no SSH
of its own. A password or OTP passes through it only with the VS Code login,
straight to ctun's stdin.

- **Clusters view** (activity bar): each configured cluster with its tunnel state,
  session start, budget used / limit, commands sent and running / queued jobs.
  Log in asks for the budget, OTP and password in VS Code input boxes, or opens
  ctun's own login window (`ctun.login.method`); log out closes the tunnel.
  `ctun login -i` run by an agent or in a terminal of the window asks there too.
  Below it, **Projects** lists the jobs per project; a click filters the table.
  `ctun.projects.source` picks where projects come from: the `--project` of
  ctun's job record (default), or an add-on such as W&B. Jobs the source names
  no project for are Unassigned.
- **Setup view** (below Projects): whether ctun is found, how many clusters its
  config has, the login method, whether ctun's Claude Code skill is in your global
  Claude folder (`~/.claude/skills/cluster-tunnel`, or under `CLAUDE_CONFIG_DIR`),
  the project source, and one row per add-on. A click on the skill row offers to
  download the skill from GitHub, at the tag of your ctun version, or opens its
  documentation. Green is
  fine, amber needs fixing, grey is an optional feature that is off. A click
  opens the setting or runs the command that fixes the row.
- **Cluster jobs** tab: one list of the jobs on every connected cluster, grouped by
  project and filtered by state (Running, Queued, Completed, Failed, Cancelled), by
  an "Ended in" window (24 h, 7 d, 30 d), by cluster and by project. It refreshes
  every 60 s while it is visible. **Details** on a row shows:
  - the agent's **note**, an unreviewed draft until you confirm, edit or discard it;
  - **Code**: the commit at submit time, whether it was pushed, uncommitted files;
  - **From**: the machine and time of the submission;
  - **Changes**: the previous run of the same project and job name, and the
    commits between the two (`git log` on the cluster, loaded on request);
  - the lines of each add-on that is on, e.g. W&B's **Training**.
- **Commands** tab (`Commands · <cluster>`): the commands sent to one cluster this
  session, as a console transcript from `ctun logs --json`, with a divider where
  five minutes or more passed. Under each `sbatch` and `scancel`, a box names the
  job with its state and run time; a click on the job ID opens it in "Cluster
  jobs". Copy all copies the commands, one per line. Open it from the
  "Commands" row of a cluster or with **ctun: Show Commands Sent**.
- **To review**: all notes no one has reviewed yet, as cards. Reviews stay in VS
  Code (Settings Sync carries them to your other machines); the record on the
  cluster never changes, and the agent has no command for reviews. The activity
  bar badge and the status bar show how many wait.
- **Status bar**: connected clusters, notes to review, and budget use.

## Add-ons

Add-ons bring in other libraries. Each one is off until you turn it on, and the
core asks it for three things only: a project per job, lines in a job's
details, and a row in the Setup view. The core draws them; an add-on never
touches the table. The interface is in `src/addOns.ts`; it is internal for now.

- **W&B** (`ctun.addons.wandb.enabled`): a **Training** line with the epoch and
  metrics of the job's W&B run and a link to it, and W&B projects for
  `ctun.projects.source: wandb`. A run is found by its tag
  `slurm:<ClusterName>:<job id>`, or the older `slurm:<job id>`, in the
  entity's first 100 projects. Tagging a run in W&B later moves an old job into
  its project. Your training script adds the tag:
  [docs/wandb-tagging.md](docs/wandb-tagging.md), also **ctun: How to Tag W&B
  Runs**.

Notes and code facts come from the job records that `ctun run` writes
on the cluster (ctun with job records; see its `reference.md`). Jobs submitted
without them show only the Slurm columns.

## Requirements

- `ctun` with job records (newer than 0.5.0) for notes, projects and code facts, and
  for the jobs under each command in the Commands tab; 0.5.0 shows the Slurm columns
  and the bare commands only. W&B's cluster tags need a ctun whose `jobs --json`
  reports `slurm_cluster`; an older one matches only `slurm:<job id>`. Configured (`ctun config --init`), on `PATH` or set in
  `ctun.path`. On Windows, ctun runs ssh inside WSL 2; see ctun's README.
- For the `window` login method: a display for ctun's login window (a small
  tkinter dialog).

## Install

The extension is not on the Marketplace yet. Install the `.vsix` file:

```bash
code --install-extension cluster-tunnel-vscode-0.0.1.vsix
```

or, in VS Code: Extensions view → `…` → **Install from VSIX…**.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `ctun.path` | `ctun` | The `ctun` executable. Use an absolute path if VS Code does not find it on `PATH`, e.g. `C:\Users\<you>\.local\bin\ctun.exe`. |
| `ctun.login.method` | `vscode` | `vscode`: VS Code input boxes for budget, OTP and password; the secrets reach ctun on stdin only (`ctun login --credentials-stdin`). `window`: ctun's login window. Applies to **Log in** and to `ctun login -i` from agents and terminals of the window. |
| `ctun.projects.source` | `record` | Where projects come from: `record` (ctun's `--project`) or `wandb` (the W&B add-on). |
| `ctun.addons.wandb.enabled` | `false` | Turns on the W&B add-on. |
| `ctun.addons.wandb.entity` | empty | W&B user or team whose projects are searched for tagged runs; empty means the API key's own. Only its first 100 projects are searched. |
| `ctun.addons.wandb.metrics` | `val/loss`, `val/mae_T_trans` | Summary metrics shown per run. |

The W&B API key goes in VS Code's SecretStorage: run **ctun: Set W&B API Key**.

## Commands

| Command | Where |
|---|---|
| ctun: Show Cluster Jobs | Clusters view title, the "Jobs" row |
| ctun: Show Commands Sent | the "Commands" row, Command Palette |
| ctun: Review Agent Notes | status bar, "To review" button |
| ctun: Install the Claude Code Skill | Setup view, Command Palette |
| ctun: Turn On the W&B Add-on | Setup view, Command Palette |
| ctun: Set / Remove W&B API Key | Setup view, Command Palette |
| ctun: How to Tag W&B Runs | Setup view, a job's Training line, Command Palette |
| ctun: Refresh | Clusters view title |
| ctun: Open ctun Config | Clusters view title |
| Log in / Log out | the icon on a cluster's row |

## Development

```bash
npm install
npm test            # compile + unit tests (fixture JSON, no cluster)
npm run test:host   # starts a downloaded VS Code and activates the extension
npm run package     # builds cluster-tunnel-vscode-<version>.vsix
```

Press F5 with this folder open to start an Extension Development Host.

Branches: `main` holds what works with the released ctun and is what gets
published; `dev` adds the features that need ctun changes not released yet.
Publishing is described in [PUBLISHING.md](PUBLISHING.md).
