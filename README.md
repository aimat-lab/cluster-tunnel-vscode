# Cluster Tunnel for VS Code

Shows your HPC clusters and Slurm jobs in VS Code, through the
[`ctun`](https://github.com/aimat-lab/cluster-tunnel) CLI. The extension is a thin
wrapper: every cluster value comes from `ctun` (`status -j`, `jobs --json`, `run`),
and only the optional W&B line talks to the W&B API, with your key. It has no SSH
of its own. A password or OTP passes through it only with the VS Code login,
straight to ctun's stdin.

- **Clusters view** (activity bar): each configured cluster with its tunnel state,
  session start, budget used / limit, commands sent and running / queued jobs.
  Log in asks for the budget, OTP and password in VS Code input boxes, or opens
  ctun's own login window (`ctun.login.method`); log out closes the tunnel.
  `ctun login -i` run by an agent or in a terminal of the window asks there too.
  Below it, **Projects** lists the jobs per `--project`; a click filters the table.
- **Cluster jobs** tab: one list of the jobs on every connected cluster, grouped by
  project and filtered by state (Running, Queued, Completed, Failed, Cancelled), by
  an "Ended in" window (24 h, 7 d, 30 d), by cluster and by project. It refreshes
  every 60 s while it is visible. **Details** on a row shows:
  - the agent's **note**, an unreviewed draft until you confirm, edit or discard it;
  - **Training**: epoch and metrics of the job's W&B run (found by its
    `slurm:<job id>` tag) and a link to it;
  - **Code**: the commit at submit time, whether it was pushed, uncommitted files;
  - **From**: the machine and time of the submission;
  - **Changes**: the previous run of the same project and job name, and the
    commits between the two (`git log` on the cluster, loaded on request).
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

Notes, projects and code facts come from the job records that `ctun run` writes
on the cluster (ctun with job records; see its `reference.md`). Jobs submitted
without them show only the Slurm columns.

## Requirements

- `ctun` with job records (newer than 0.5.0) for notes, projects and code facts, and
  for the jobs under each command in the Commands tab; 0.5.0 shows the Slurm columns
  and the bare commands only. Configured (`ctun config --init`), on `PATH` or set in
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
| `ctun.wandb.project` | empty | W&B project of the runs, e.g. `htfm_multihead`. Empty turns the Training line off. |
| `ctun.wandb.entity` | empty | W&B user or team; empty means the API key's own. |
| `ctun.wandb.metrics` | `val/loss`, `val/mae_T_trans` | Summary metrics shown per run. |

The W&B API key goes in VS Code's SecretStorage: run **ctun: Set W&B API Key**.

## Commands

| Command | Where |
|---|---|
| ctun: Show Cluster Jobs | Clusters view title, the "Jobs" row |
| ctun: Show Commands Sent | the "Commands" row, Command Palette |
| ctun: Review Agent Notes | status bar, "To review" button |
| ctun: Set / Remove W&B API Key | Command Palette |
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
