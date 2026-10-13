import type { ClusterStatus, CommandLog, Job, JobsReport, LoggedCommand } from "./ctun";
import { rowKey, slurmDurationSeconds, slurmTime, stateLabel } from "./jobsTable";
import { StateGroupId, stateGroup } from "./jobStates";

/** P8: a pause between two commands at least this long gets a divider. */
const GAP_DIVIDER_SECONDS = 5 * 60;
/** A job ID as `scancel` takes it: `4818190`, or an array task such as `4818190_4`. */
const JOB_ID_ARGUMENT = /^\d+(?:_\d+)?$/;
/** Characters `shlex.quote` leaves unquoted. */
const SHELL_SAFE = /^[\w@%+=:,./-]+$/;

export interface TranscriptInputs {
  cluster: string;
  /** The clusters the select offers. */
  clusters: readonly string[];
  log: CommandLog | undefined;
  status: ClusterStatus | undefined;
  report: JobsReport | undefined;
}

/** Everything the Commands webview renders; it has no logic of its own. */
export interface CommandsTranscriptModel {
  cluster: string;
  clusterOptions: { id: string; selected: boolean }[];
  /** `# kcist · logged in Oct 13, 16:14:18 · budget 100 jobh` */
  headerText: string;
  countsText: string;
  lines: TranscriptLine[];
  emptyText: string | undefined;
}

export interface TranscriptLine {
  timeText: string;
  /** The command as a shell would take it, quoted like Python's `shlex.join`. */
  command: string;
  /** The pause before this command, e.g. `13 min`; undefined below `GAP_DIVIDER_SECONDS`. */
  gapText: string | undefined;
  jobs: TranscriptJob[];
}

export interface TranscriptJob {
  /** The job's row key in "Cluster jobs"; undefined when the jobs report does not list it. */
  key: string | undefined;
  verb: "Submitted" | "Cancelled";
  id: string;
  name: string | undefined;
  /** The dot's colour; undefined for a state no group covers, or an unknown one. */
  group: StateGroupId | undefined;
  stateLabel: string;
  detail: string | undefined;
}

export function buildTranscript(inputs: TranscriptInputs): CommandsTranscriptModel {
  const { cluster, log, status } = inputs;
  const commands = log?.commands ?? [];
  const jobsById = new Map(clusterJobs(inputs).map((job) => [job.jobid, job]));
  const lines = commands.map((command, index) => ({
    timeText: formatClock(command.epoch),
    command: shellJoin(command.command),
    gapText: gapText(commands[index - 1], command),
    jobs: jobsOf(command).map(({ verb, id }) => transcriptJob(cluster, verb, id, jobsById.get(id))),
  }));
  return {
    cluster,
    clusterOptions: inputs.clusters.map((id) => ({ id, selected: id === cluster })),
    headerText: headerText(cluster, status),
    countsText: countsText(lines),
    lines,
    emptyText: log && commands.length === 0 ? `No commands sent to ${cluster} this session.` : undefined,
  };
}

/** Joins command tokens as Python's `shlex.join` does, so the line reads like ctun's own log. */
export function shellJoin(tokens: readonly string[]): string {
  return tokens.map(shellQuote).join(" ");
}

function shellQuote(token: string): string {
  if (token === "") {
    return "''";
  }
  return SHELL_SAFE.test(token) ? token : `'${token.replace(/'/g, `'"'"'`)}'`;
}

function clusterJobs({ cluster, report }: TranscriptInputs): Job[] {
  return report?.clusters.find((entry) => entry.cluster === cluster)?.jobs ?? [];
}

/** P3: the jobs a command submitted come from ctun; the ones `scancel` names come from its arguments. */
function jobsOf(command: LoggedCommand): { verb: TranscriptJob["verb"]; id: string }[] {
  const submitted = (command.job_ids ?? []).map((id) => ({ verb: "Submitted" as const, id }));
  const [program, ...args] = command.command;
  const cancelled =
    program === "scancel" ? args.filter((arg) => JOB_ID_ARGUMENT.test(arg)).map((id) => ({ verb: "Cancelled" as const, id })) : [];
  return [...submitted, ...cancelled];
}

/** P6 and P7: what the jobs report knows about one job, or "state unknown". */
function transcriptJob(cluster: string, verb: TranscriptJob["verb"], id: string, job: Job | undefined): TranscriptJob {
  if (!job) {
    return { key: undefined, verb, id, name: undefined, group: undefined, stateLabel: "state unknown", detail: undefined };
  }
  const group = stateGroup(job);
  return { key: rowKey(cluster, id), verb, id, name: job.name, group, stateLabel: stateLabel(job), detail: detail(job, group) };
}

function detail(job: Job, group: StateGroupId | undefined): string | undefined {
  const start = slurmTime(job.start);
  switch (group) {
    case "running": {
      const progress = `${job.elapsed} / ${job.timelimit}`;
      return start ? `started ${start} · ${progress}` : progress;
    }
    case "queued":
      return start ? `est. start ${start}` : "no start estimate yet";
    case "completed":
    case "failed":
      return `ran ${job.elapsed}`;
    case "cancelled":
      return slurmDurationSeconds(job.elapsed) ? `ran ${job.elapsed}` : "never started";
    default:
      return undefined;
  }
}

function gapText(previous: LoggedCommand | undefined, command: LoggedCommand): string | undefined {
  const seconds = previous ? command.epoch - previous.epoch : 0;
  if (seconds < GAP_DIVIDER_SECONDS) {
    return undefined;
  }
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

function headerText(cluster: string, status: ClusterStatus | undefined): string {
  const parts = [cluster];
  if (status?.session) {
    parts.push(`logged in ${formatDateTime(status.session.start_epoch)}`);
  }
  if (status) {
    parts.push(status.limit === null ? "no budget limit" : `budget ${status.limit} ${status.unit ?? "units"}`);
  }
  return `# ${parts.join(" · ")}`;
}

function countsText(lines: readonly TranscriptLine[]): string {
  const jobs = lines.flatMap((line) => line.jobs);
  const submitted = jobs.filter((job) => job.verb === "Submitted").length;
  const cancelled = jobs.length - submitted;
  return [
    plural(lines.length, "command"),
    `${plural(submitted, "job")} submitted`,
    ...(cancelled ? [`${cancelled} cancelled`] : []),
  ].join(" · ");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatClock(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDateTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
