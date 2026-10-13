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
- Projects: the table is grouped by the job record's `--project`, a project filter,
  and a Projects view with counts. Jobs without one count as Unassigned.
- Agent notes: the note under each job name, Confirm / Edit / Discard (kept in
  `globalState`, synced by Settings Sync), a "To review" mode with cards, the
  activity-bar badge and the status-bar count.
- Job details: commit, pushed or not, uncommitted files, submitting machine, the
  previous run of the same job and the commits since it.
- W&B: the job's run found by its `slurm:<job id>` tag, with epoch, chosen metrics
  and a link; the API key lives in SecretStorage.
- Native login (`ctun.login.method: vscode`): budget, OTP and password in VS Code
  input boxes, passed to `ctun login --credentials-stdin`.
