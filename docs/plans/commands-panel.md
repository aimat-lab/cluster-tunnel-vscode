# Plan: the Commands panel (option E)

Status: built 2026-10-13 (Parts 1 and 2); the Gate is open. Branches: `feat/vscode-extension`
(cluster-tunnel) and `dev` (cluster-tunnel-vscode).

References:

- **Mockup** <https://claude.ai/artifact/VSi89YUN9TKZYeowa8qmLt>, artboard
  **E · Transcript (B) with the jobs it submitted (D)**. This plan builds E.
  The other artboards are history; G (console) and H (compact tag) are not in
  this plan.
- **Main plan** `cluster-tunnel/docs/plans/job-records-and-vscode-extension.md`
  (in the ctun repo, branch `feat/vscode-extension`): its rules (one task at a
  time, "Done when", no commit or push without the user) apply here too.

## What it is

An editor tab "Commands · `<cluster>`", full width, next to the "Cluster jobs" tab
in the same tab bar (no split screen). It shows
the commands sent to one cluster this session as a console transcript:

```text
# kcist · logged in Oct 13, 16:14:18 · budget 100 jobh
16:15:30  $  sbatch scripts/preprocess.sh
              [Submitted 4817990 preprocess ● Failed  ran 1:05]
16:17:02  $  scancel 4818190
              [Cancelled 4818190 train_htfm ● Cancelled  never started]
───────────────────────────── 13 min ─────────────────────────────
16:31:44  $  tail -n 50 runs/4818213/slurm.out
```

Under each `sbatch` and `scancel` line, a grey rounded rectangle names the job.
A click on the job ID shows that job's details in "Cluster jobs".

## Decisions

Do not re-open these without the user.

| # | Decision |
| --- | --- |
| P1 | **Own full-width editor tab** in the active editor group (`ViewColumn.Active`, as "Cluster jobs" opens), one cluster at a time, switched with a select. No split screen and no side bar: the user wants a main panel of its own. |
| P2 | **All data comes from ctun**, as in the main plan's D1: `ctun -t <cluster> logs --json` (a local file read, no SSH), plus the `status` and `jobs --json` data that `ClusterData` already holds. The panel itself never runs a remote command. |
| P3 | **ctun stores the job IDs a command submitted in its log entry.** `ctun run` already reads `Submitted batch job <N>` for job records. Why not match a log entry to a job record by command text and time: that is a guess, and it fails for jobs without a record. `scancel` lines need no ctun change: the extension reads the job IDs from the command's own arguments. |
| P4 | **The log entry is written before the run, as today; the job IDs follow in a second line** that names the entry. Why not write the whole entry after the run: the count in `status` would lag during a long command, and a crash would lose the command. Why not rewrite the file: two parallel `ctun run` would race. |
| P5 | **Colour only in a small dot**, from the user's scheme: running green, queued amber, completed blue, failed red, cancelled grey. The word "Running" may be green too; every other text stays grey. In the webview the colours come from VS Code theme variables, with the scheme's values as fallbacks, so light themes work. |
| P6 | **The rectangle shows only what `ctun jobs` knows:** verb, job ID, job name, state, and one detail: running → `started 16:19 · 22:41 / 10:30:00`; queued → `est. start 18:30` or `no start estimate yet`; completed, failed, timeout → `ran 1:05`; cancelled → `never started` or `ran 1:05`. The mockup's "exit 1 after …", "waits for …" and "was queued 32 s" need fields that `ctun jobs` lacks (exit code, pending reason, submit time); they are out of this plan. |
| P7 | **A job the report does not list** (outside the "Ended in" window, or `ctun jobs` failed) shows its ID and "state unknown", no dot colour. The panel does not widen the window itself. |
| P8 | A gap of **5 minutes or more** between two commands gets a divider line with the gap, e.g. `13 min`. |
| P9 | **Refresh:** the log when the tab shows, on Refresh, and every 10 s while visible (a local file read). Job states follow `ClusterData`, refreshed every 60 s while the tab is visible, as "Cluster jobs" does. |

## Part 1: ctun (repo: cluster-tunnel)

- **`cmdlog.py`:**
  - `record(name, command)` gives each entry an `id` (12 hex characters) and
    returns it.
  - New `record_jobs(name, entry_id, job_ids)` appends
    `{"jobs_of": <id>, "job_ids": [...]}`.
  - `entries()` merges each `jobs_of` line into its entry as `job_ids`.
    Entries without an `id` (old logs) stay as they are.
  - `summary()` counts only command lines.
- **`cli/execution.py`:** capture the output whenever `--tty` is off, also
  when `job_records` is off, so job IDs work on every cluster. After the run,
  call `record_jobs` with `records.submitted_job_ids(output)` if there is any.
  The output itself is still not stored (see the main plan, "the agent's
  output in the command log").
- **`ctun logs --json`:** each command may carry `job_ids`. `ctun logs` (text)
  appends `→ job 4818213` to such a line.
- **Tests** (mocked `ssh`, no cluster): an entry with job IDs, an entry
  without, a `jobs_of` line for an unknown id (ignored), an old entry without
  `id`, `summary()` not counting `jobs_of` lines, and `run` writing the IDs
  for `Submitted batch job 4818213`.
- **Docs:** `skill/reference.md` (`logs`), `CHANGELOG.md` `[Unreleased]`.
- **Done when:** all tests pass, and `ruff` finds nothing new in the changed
  files.

## Part 2: extension (repo: cluster-tunnel-vscode)

- **`src/ctun.ts`:** `logs(cluster)` → `CommandLog { cluster, commands:
  LoggedCommand[] }`, with `LoggedCommand { epoch, command: string[],
  job_ids?: string[] }`. `job_ids` is optional, so an older ctun still works
  (no rectangles under `sbatch`).
- **`src/commandsTranscript.ts`:** a pure function, like `jobsTable.ts`, from
  the log, the cluster's status and the jobs report to the panel model:
  - the header: login time, budget limit and unit;
  - one line per command: time, the command joined with POSIX quoting (like
    `shlex.join`), the gap before it (P8);
  - the jobs of the line: from `job_ids` (verb "Submitted") or from the
    numeric arguments of `scancel` (verb "Cancelled"; `123_4` array IDs too);
    each with its row key, name, state group, dot and detail (P6, P7).

  It reuses `stateGroup`, `slurmDurationSeconds` and the date format of
  `jobsTable.ts`; export them rather than copy them.
- **`src/commandsPanel.ts`:** the webview tab, built like `JobsPanel`: one
  instance, the cluster select, Copy all (the commands, one per line), Refresh,
  the timers of P9, and the same strict CSP.
- **`media/commands.js`, `media/commands.css`:** the transcript. Mono font
  from `--vscode-editor-font-family`; the dot colours of P5.
- **Job link:** the webview posts `showJob` with the row key. The extension
  calls a new `JobsPanel.revealJob(key)`: it does what the panel's own
  `showJob` message does today, and also turns on the job's state toggle, so a
  filter cannot hide the row. "Cluster jobs" comes to the front as its own
  tab, in whichever group it is open; it never opens as a split.
- **Open it:** a new command `ctun.showCommands` (cluster argument, else a
  quick pick of the live clusters), and a click on the "Commands" row in the
  Clusters view.
- **Tests:** `commandsTranscript.test.ts` with fixtures for every state, a
  job missing from the report, a `scancel` with options, a command without
  `job_ids`, the gap rule, and quoting; a renderer test for `commands.js` as
  `renderer.test.ts` does for the table.
- **Docs:** `README.md` (feature list), `CHANGELOG.md`.
- **Done when:** `npm test` and the typecheck pass; the panel shows the
  fixture data in the Extension Development Host.

## Gate (user)

Run it on a real cluster: let the agent submit and cancel a small job, then
check the rectangles, the colours and the link. **Submitting spends compute:
ask the user before this step.** Then ask whether to commit.

## Not in this plan

- The console to type commands (option G).
- Storing the agent's output, and keeping the log beyond one session: see the
  main plan's two "Proposed" sections.
- Exit code, pending reason and queue time in the rectangle (P6): they first
  need new fields in `ctun jobs` (the main plan's "Richer job columns").
- Telling the agent's commands from the user's own.
