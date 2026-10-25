# Changelog

All notable changes to the ctun VS Code extension. The format follows
[Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] - 2026-10-25

### Added

- Clusters view from `ctun status -j`: status, session start, budget used / limit,
  commands sent, running and queued jobs; log in (ctun's login window) and log out.
- "Cluster jobs" tab from `ctun jobs list --json`: one list filtered by state toggles,
  an "Ended in" window (7 days by default, up to all time) and cluster chips;
  refreshes every 60 s while visible, an all-time list only on Refresh.
- Status-bar entry with the connected clusters and their budget use.
- Every column of the job list sorts on a click of its header (ascending,
  descending, back to the default), inside each project band. By default the
  newest start comes first. The start time (or Slurm's
  estimate for a queued job) has its own Start column, apart from Elapsed / limit.
  A click on a job row opens its details; the Details button is gone.
- Projects: the table is grouped by project, and a Projects view shows the
  counts. Its eyes hide projects from the table, a project's eye also hiding the
  ones nested in it; hidden projects are kept in `globalState`. The project is the job
  record's `--project`; jobs without one count as Unassigned. A `/` nests projects (`htfm/multihead`): the table shows one
  indented band per level with a fold arrow and the jobs below it, the Projects
  view is a tree; a click on a name opens the job list with only that project
  and the ones below it.
- Setup view: a "Claude skill" row shows whether ctun's skill is in the global
  Claude folder (`~/.claude`, or `CLAUDE_CONFIG_DIR`). A click offers to install
  it from GitHub at the tag of the installed ctun (or `main`), or to open its
  documentation.
- Add-ons: an internal interface through which a library adds lines in a
  job's details and a Setup row; each add-on is off by default.
- Agent notes: the note under each job name, Confirm / Edit / Discard, a "To
  review" mode with cards, and their count on its button and in the status
  bar's tooltip; the job rows don't mark them. A
  review is stored in the job's record through `ctun jobs edit`
  (`--confirm-note`, `--note`), so every machine and agent sees it.
  **Customize note writing…** opens the user's own note directions,
  `writing-notes.local.md` in ctun's installed skill, made from a template once.
- Editing jobs: Ctrl/Shift-click selects rows; a row, or the selection by one of
  its rows, drags onto a project: while it drags, the table folds into one band
  per known project; **Move to project…** (to an
  existing, Unassigned or new project) and **Edit Note…** run `ctun jobs edit`,
  from the selection bar or a row's context menu. A job's details list the
  record's edits; a record that `jobs edit` made without facts says so.
- Projects view: it lists every project of all time from `ctun projects list`,
  with all-time job counts, not only those of the "Ended in" window; Unassigned
  still counts the window's jobs.
- Projects view: **New Project…** in its title bar makes an empty draft project
  inside the selected one, to drop jobs on. Drafts are kept in `globalState`. A
  project without jobs is marked "draft", with an (i) that explains why and a
  trash icon that deletes it.
- Projects view: drag a project onto another to nest it there, or onto "All
  projects" to move it to the top; **Rename Project…** in its context menu
  renames it. After a confirmation, both run `ctun projects rename`, so every
  job of the project and of those nested in it follows, also outside the
  "Ended in" window. Drafts and hidden projects follow too.
- Setup view: the ctun row shows ctun's version and marks one older than 0.9.0.
- Job details: commit, pushed or not, uncommitted files, submitting machine, the
  previous run of the same job and the commits since it.
- W&B add-on (`ctun.addons.wandb.enabled`): the job's run found by its tag
  `slurm:<ClusterName>:<job id>` (or the older `slurm:<job id>`) in any project
  of the entity, with epoch, chosen metrics and a link. The API key lives in
  SecretStorage.
- Native login (`ctun.login.method: vscode`): budget, OTP and password in VS Code
  input boxes, passed to `ctun login --credentials-stdin`.
- `ctun login -i` from an agent or terminal of a VS Code window asks in that
  window's input boxes, not ctun's popup. The extension serves a local pipe per
  window and names it in `CTUN_LOGIN_BRIDGE` (ctun 0.9.0 or newer); it logs in
  itself, with the config file of the ctun that asked and within that ctun's
  timeout, and returns only the outcome, so the secrets never reach the agent's
  process. The native login is
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
