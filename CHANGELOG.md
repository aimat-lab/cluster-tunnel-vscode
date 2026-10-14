# Changelog

All notable changes to the ctun VS Code extension. The format follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Clusters view from `ctun status -j`: status, session start, budget used / limit,
  commands sent, running and queued jobs; log in (ctun's login window) and log out.
- "Cluster jobs" tab from `ctun jobs --json`: one list filtered by state toggles,
  an "Ended in" window and cluster chips; refreshes every 60 s while visible.
- Status-bar entry with the connected clusters and their budget use.
- Projects: the table is grouped by each job's W&B project, the project of the
  run tagged `slurm:<job id>` in any project of the entity; a project filter, and a
  Projects view with counts. Jobs without a tagged run count as Unassigned, and a
  tag added later in W&B moves an old job into its project. The record's
  `--project` is no longer used, and `ctun.wandb.project` is gone.
- Agent notes: the note under each job name, Confirm / Edit / Discard (kept in
  `globalState`, synced by Settings Sync), a "To review" mode with cards, the
  activity-bar badge and the status-bar count.
- Job details: commit, pushed or not, uncommitted files, submitting machine, the
  previous run of the same job and the commits since it.
- W&B: the job's run found by its `slurm:<job id>` tag, with epoch, chosen metrics
  and a link; the API key lives in SecretStorage.
- Native login (`ctun.login.method: vscode`): budget, OTP and password in VS Code
  input boxes, passed to `ctun login --credentials-stdin`.
- `ctun login -i` from an agent or terminal of a VS Code window asks in that
  window's input boxes, not ctun's popup. The extension serves a local pipe per
  window and names it in `CTUN_VSCODE_LOGIN`; it logs in itself and returns only
  the outcome, so the secrets never reach the agent's process. The native login is
  now the default, and the extension activates on startup.
- "Commands · <cluster>" tab from `ctun logs --json`: the commands sent this
  session as a transcript, the jobs each `sbatch` submitted and each `scancel`
  named with their state, and a link to the job in "Cluster jobs". Refreshes the
  log every 10 s and the job states every 60 s while visible.
- "Cluster jobs" scrolls to a job that another tab shows, and turns on its state
  toggle.
- The Clusters view shows the tunnels as soon as `ctun status` answers, before
  the budget probes and `ctun jobs`. A view or tab that comes back into sight
  reloads only data older than 15 s; Refresh always reloads.
