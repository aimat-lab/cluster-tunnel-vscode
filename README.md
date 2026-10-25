# Cluster Tunnel for VS Code

Shows your HPC clusters and Slurm jobs in VS Code, through the
[`ctun`](https://github.com/aimat-lab/cluster-tunnel) CLI. The extension is a thin
wrapper: every cluster value comes from `ctun` (`status -j`, `jobs list --json`, `run`),
and only optional add-ons such as W&B talk to other services, with your key. It has no SSH
of its own. A password or OTP passes through it only with the VS Code login,
straight to ctun's stdin.

- **Clusters view** (activity bar): each configured cluster with its tunnel state,
  session start, budget used / limit, commands sent and running / queued jobs.
  Log in asks for the budget, OTP and password in VS Code input boxes, or opens
  ctun's own login window (`ctun.login.method`); log out closes the tunnel.
  `ctun login -i` run by an agent or in a terminal of the window asks there too.
  Below it, **Projects** lists every project in ctun's job records, of all time
  (`ctun projects list`), with its number of jobs; Unassigned counts the jobs of
  the "Ended in" window. The eye next to a project
  hides its jobs, and those of every project below it, in the job list; hidden
  projects stay hidden across restarts (Settings Sync carries them). Opening the
  eye of a project below a hidden one shows just that project. A click on a name
  opens the job list with only that project and every project below it; the
  arrow opens or closes its subprojects; **All projects** shows every project again.
  A `/` nests projects:
  `--project htfm/multihead` is `multihead` inside `htfm`, and the view is a tree
  whose counts include the nested projects. Jobs submitted without `--project`
  are Unassigned.
- **Setup view** (below Projects): whether ctun is found, how many clusters its
  config has, the login method, whether ctun's Claude Code skill is in your global
  Claude folder (`~/.claude/skills/cluster-tunnel`, or under `CLAUDE_CONFIG_DIR`),
  and one row per add-on. A click on the skill row offers to
  download the skill from GitHub, at the tag of your ctun version, or opens its
  documentation. Green is
  fine, amber needs fixing, grey is an optional feature that is off. A click
  opens the setting or runs the command that fixes the row.
- **Cluster jobs** tab: one list of the jobs on every connected cluster, grouped by
  project in indented bands (nested projects below their parent; a click on the
  arrow folds a band) and filtered by state (Running, Queued, Completed, Failed,
  Cancelled), by an "Ended in" window (24 h, 7 d, 30 d), by cluster and by the
  eyes in the Projects view. It refreshes
  every 60 s while it is visible. A click on a column header sorts the jobs inside
  each project by it (ascending, descending, then back to the default: newest start
  first). A click
  on a row, or Enter, opens its details:
  - the agent's **note**, an unreviewed draft until you confirm, edit or discard it;
  - **Record**, when the job has none, or one made by `ctun jobs edit` without
    submit-time facts;
  - **Code**: the commit at submit time, whether it was pushed, uncommitted files;
  - **From**: the machine and time of the submission;
  - **Changes**: the previous run of the same project and job name, and the
    commits between the two (`git log` on the cluster, loaded on request);
  - the lines of each add-on that is on, e.g. W&B's **Training**;
  - **Edits**: each `ctun jobs edit` of the record, with time and machine.

  Ctrl-click (Cmd-click on macOS) selects a row. Shift-click selects every row
  from the last one clicked and closes their details. Drag the selection onto a
  project in the Projects view, or onto a project band in the table, to move it
  there. To drop on a project that has no jobs yet, make it first with the
  **New Project…** button in the Projects view's title bar: it goes into the
  selected project, or at the top level. While it has no jobs it is marked
  "draft": ctun stores a job's project in the job's record, so a project without
  jobs exists only in VS Code (Settings Sync carries it), and ctun and agents
  don't see it. Its (i) explains this, and its trash icon deletes it. Drag a
  project onto another to nest it there, or onto **All projects** to move it to
  the top level; a right-click offers **Rename Project…**. After your yes, both
  run `ctun projects rename`, which changes the project of all its jobs, of all
  time, and of the projects nested in it, on every connected cluster. A bar also offers **Move to project…**: an existing project, Unassigned, or a new one (a
  `/` nests it). A right-click on a row offers **Move to Project…** (for the
  selection, or that row alone) and **Edit Note…**. Each change runs one
  `ctun -t <cluster> jobs edit` per cluster and reloads the jobs. It is stored in the
  job's record on the cluster, so every machine and agent sees it.
- **Commands** tab (`Commands · <cluster>`): the commands sent to one cluster this
  session, as a console transcript from `ctun logs --json`, with a divider where
  five minutes or more passed. Under each `sbatch` and `scancel`, a box names the
  job with its state and run time; a click on the job ID opens it in "Cluster
  jobs". Copy all copies the commands, one per line. Open it from the
  "Commands" row of a cluster or with **ctun: Show Commands Sent**.
- **To review**: all notes no one has confirmed yet, as cards. Your review is
  stored in the job's record, so every machine and agent sees it: Confirm runs
  `ctun jobs edit <id> --confirm-note`, Edit `--note <text> --confirm-note`, and
  Discard `--note ""`. A note changed later is unconfirmed again, and the record's
  edit log keeps the old text. The activity bar badge and the status bar show how
  many wait.
- **Status bar**: connected clusters, notes to review, and budget use.

## Add-ons

Add-ons bring in other libraries. Each one is off until you turn it on, and the
core asks it for two things only: lines in a job's details, and a row in the
Setup view. The core draws them; an add-on never
touches the table. The interface is in `src/addOns.ts`; it is internal for now.

- **W&B** (`ctun.addons.wandb.enabled`): a **Training** line with the epoch and
  metrics of the job's W&B run and a link to it. A run is found by its tag
  `slurm:<ClusterName>:<job id>`, or the older `slurm:<job id>`, in the
  entity's first 100 projects. The job's project stays its ctun `--project`; keep
  your W&B project names in line with it yourself. Your training script adds the tag:
  [docs/wandb-tagging.md](docs/wandb-tagging.md), also **ctun: How to Tag W&B
  Runs**.

Notes and code facts come from the job records that `ctun run` writes
on the cluster (ctun with job records; see its `reference.md`). Jobs submitted
without them show only the Slurm columns.

## Requirements

- `ctun` 0.9.0 or newer, with `ctun jobs list`, `ctun jobs edit` and `ctun projects list`; the Setup view
  marks an older one. Until 0.9.0 is released, install it from the fork:
  `uv tool install git+https://github.com/Luguza/cluster-tunnel@feat/vscode-extension`. Configured (`ctun config --init`), on `PATH` or set in
  `ctun.path`. On Windows, ctun runs ssh inside WSL 2; see ctun's README.
- For the `window` login method: a display for ctun's login window (a small
  tkinter dialog).

## Install

The extension is not on the Marketplace yet. Install the `.vsix` file:

```bash
code --install-extension cluster-tunnel-0.1.0.vsix
```

or, in VS Code: Extensions view → `…` → **Install from VSIX…**.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `ctun.path` | `ctun` | The `ctun` executable. Use an absolute path if VS Code does not find it on `PATH`, e.g. `C:\Users\<you>\.local\bin\ctun.exe`. |
| `ctun.login.method` | `vscode` | `vscode`: VS Code input boxes for budget, OTP and password; the secrets reach ctun on stdin only (`ctun login --credentials-stdin`). `window`: ctun's login window. Applies to **Log in** and to `ctun login -i` from agents and terminals of the window. |
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
| Move to Project… / Edit Note… | right-click on a job row; the selection bar |
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
npm run package     # builds cluster-tunnel-<version>.vsix
```

Press F5 with this folder open to start an Extension Development Host.

Branches: `main` holds what works with the released ctun and is what gets
published; `dev` adds the features that need ctun changes not released yet.
Publishing is described in [PUBLISHING.md](PUBLISHING.md).
