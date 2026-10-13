# Cluster Tunnel for VS Code

Shows your HPC clusters and Slurm jobs in VS Code, through the
[`ctun`](https://github.com/aimat-lab/cluster-tunnel) CLI. The extension is a thin
wrapper: every value comes from `ctun status -j` and `ctun jobs --json`. It has no
SSH of its own and never sees a password or one-time passcode.

- **Clusters view** (activity bar): each configured cluster with its tunnel state,
  session start, budget used / limit, commands sent and running / queued jobs.
  Log in opens ctun's own login window; log out closes the tunnel.
- **Cluster jobs** tab: one list of the jobs on every connected cluster, filtered by
  state (Running, Queued, Completed, Failed, Cancelled), by an "Ended in" window
  (24 h, 7 d, 30 d) and by cluster. It refreshes every 60 s while it is visible.
- **Status bar**: how many clusters are connected, and their budget use.

Job records, agent notes, projects, code facts and W&B metrics are being built on
the [`dev`](https://github.com/aimat-lab/cluster-tunnel-vscode/tree/dev) branch; they need a
newer ctun.

## Requirements

- `ctun` 0.5.0 or later, configured (`ctun config --init`), on `PATH` or set in
  `ctun.path`. On Windows, ctun runs ssh inside WSL 2; see ctun's README.
- A display for ctun's login window (it is a small tkinter dialog).

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

## Commands

| Command | Where |
|---|---|
| ctun: Show Cluster Jobs | Clusters view title, the "Jobs" row |
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
