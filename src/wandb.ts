/** Finds a job's W&B run and project by its `slurm:<job id>` tag (D11) through the W&B GraphQL API. */

const GRAPHQL_URL = "https://api.wandb.ai/graphql";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface WandbRun {
  name: string;
  displayName: string;
  state: string;
  url: string;
  epoch: number | undefined;
  /** The chosen metrics that the run's summary has, in the order asked for. */
  metrics: { name: string; value: number }[];
}

const RUN_BY_TAG = `query RunByTag($entity: String!, $project: String!, $filters: JSONString) {
  project(name: $project, entityName: $entity) {
    runs(filters: $filters, first: 1, order: "-created_at") {
      edges { node { name displayName state summaryMetrics } }
    }
  }
}`;

/** More projects than this in one entity are not searched. */
const MAX_PROJECTS = 100;

const ENTITY_PROJECTS = `query EntityProjects($entity: String!) {
  entity(name: $entity) {
    projects(first: ${MAX_PROJECTS}) { edges { node { name } } }
  }
}`;

const HTTP_UNAUTHORIZED = 401;

const VIEWER_ENTITY = `query { viewer { entity } }`;

export class WandbClient {
  private defaultEntity: Promise<string> | undefined;

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
  ) {}

  /** The run tagged `slurm:<jobId>`, or undefined if there is none. `entity` empty means the key's own. */
  async runForJob(entity: string, project: string, jobId: string, metricNames: readonly string[]): Promise<WandbRun | undefined> {
    const owner = entity || (await this.ownEntity());
    const data = (await this.query(RUN_BY_TAG, {
      entity: owner,
      project,
      filters: JSON.stringify({ tags: { $in: [slurmTag(jobId)] } }),
    })) as { project: { runs: { edges: { node: RunNode }[] } } | null };
    const node = data.project?.runs.edges[0]?.node;
    if (!node) {
      return undefined;
    }
    const summary = parseSummary(node.summaryMetrics);
    return {
      name: node.name,
      displayName: node.displayName,
      state: node.state,
      url: `https://wandb.ai/${encodeURIComponent(owner)}/${encodeURIComponent(project)}/runs/${encodeURIComponent(node.name)}`,
      epoch: typeof summary.epoch === "number" ? summary.epoch : undefined,
      metrics: metricNames.flatMap((name) => (typeof summary[name] === "number" ? [{ name, value: summary[name] as number }] : [])),
    };
  }

  /**
   * The project of each job whose run in `entity` is tagged `slurm:<job id>`; jobs without one are left out.
   * Two requests: the entity's projects, then every project's tagged runs at once.
   */
  async projectsOfJobs(entity: string, jobIds: readonly string[]): Promise<Map<string, string>> {
    const projectOfJob = new Map<string, string>();
    if (jobIds.length === 0) {
      return projectOfJob;
    }
    const owner = entity || (await this.ownEntity());
    const projects = await this.projectNames(owner);
    if (projects.length === 0) {
      return projectOfJob;
    }
    const projectVariables = Object.fromEntries(projects.map((name, index) => [`project${index}`, name]));
    const data = (await this.query(taggedRunsQuery(projects.length), {
      entity: owner,
      filters: JSON.stringify({ tags: { $in: jobIds.map(slurmTag) } }),
      first: jobIds.length,
      ...projectVariables,
    })) as Record<string, { runs: { edges: { node: { tags: string[] | null } }[] } } | null>;
    const wanted = new Set(jobIds);
    projects.forEach((project, index) => {
      for (const { node } of data[`project${index}`]?.runs.edges ?? []) {
        for (const jobId of (node.tags ?? []).flatMap(jobIdOfTag)) {
          if (wanted.has(jobId) && !projectOfJob.has(jobId)) {
            projectOfJob.set(jobId, project);
          }
        }
      }
    });
    return projectOfJob;
  }

  private async projectNames(entity: string): Promise<string[]> {
    const data = (await this.query(ENTITY_PROJECTS, { entity })) as {
      entity: { projects: { edges: { node: { name: string } }[] } } | null;
    };
    return (data.entity?.projects.edges ?? []).map(({ node }) => node.name);
  }

  /** The entity the API key belongs to; also how a new key is checked. */
  ownEntity(): Promise<string> {
    this.defaultEntity ??= this.query(VIEWER_ENTITY, {}).then((data) => (data as { viewer: { entity: string } }).viewer.entity);
    return this.defaultEntity;
  }

  private async query(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetchFn(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`api:${this.apiKey}`).toString("base64")}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (response.status === HTTP_UNAUTHORIZED) {
      throw new Error("W&B rejected the API key");
    }
    if (!response.ok) {
      throw new Error(`W&B answered HTTP ${response.status}`);
    }
    const body = (await response.json()) as { data?: unknown; errors?: { message: string }[] };
    if (body.errors?.length) {
      throw new Error(`W&B: ${body.errors.map((error) => error.message).join("; ")}`);
    }
    return body.data;
  }
}

interface RunNode {
  name: string;
  displayName: string;
  state: string;
  summaryMetrics: string | null;
}

const SLURM_TAG_PREFIX = "slurm:";

function slurmTag(jobId: string): string {
  return `${SLURM_TAG_PREFIX}${jobId}`;
}

/** `slurm:4821937` → `["4821937"]`; any other tag → `[]`. */
function jobIdOfTag(tag: string): string[] {
  return tag.startsWith(SLURM_TAG_PREFIX) ? [tag.slice(SLURM_TAG_PREFIX.length)] : [];
}

/** One `runs` lookup per project, aliased `project0`, `project1`, …, so one request covers them all. */
function taggedRunsQuery(projectCount: number): string {
  const indexes = [...Array(projectCount).keys()];
  const projectVariables = indexes.map((index) => `$project${index}: String!`).join(", ");
  const projectFields = indexes.map(
    (index) =>
      `  project${index}: project(name: $project${index}, entityName: $entity) {
    runs(filters: $filters, first: $first) { edges { node { tags } } }
  }`,
  );
  return `query TaggedRuns($entity: String!, $filters: JSONString, $first: Int, ${projectVariables}) {
${projectFields.join("\n")}
}`;
}

function parseSummary(summaryMetrics: string | null): Record<string, unknown> {
  try {
    return summaryMetrics ? (JSON.parse(summaryMetrics) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** `epoch 31 · val/loss 0.69 · val/mae_T_trans 38.3` */
export function trainingSummary(run: WandbRun): string {
  const parts = run.epoch === undefined ? [] : [`epoch ${run.epoch}`];
  for (const metric of run.metrics) {
    parts.push(`${metric.name} ${formatMetric(metric.value)}`);
  }
  return parts.join(" · ") || `${run.state}, no metrics yet`;
}

function formatMetric(value: number): string {
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toPrecision(3);
}
