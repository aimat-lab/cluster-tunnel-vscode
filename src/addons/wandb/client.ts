/** Finds W&B runs by their tags in every project of an entity, through the W&B GraphQL API. */

const GRAPHQL_URL = "https://api.wandb.ai/graphql";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface TaggedRun {
  project: string;
  name: string;
  displayName: string;
  state: string;
  tags: string[];
  url: string;
  /** The run's summary metrics. */
  summary: Record<string, unknown>;
}

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

  /**
   * The runs in any project of `entity` that carry one of `tags`. `entity` empty means the key's own.
   * Two requests: the entity's projects, then every project's tagged runs at once.
   */
  async taggedRuns(entity: string, tags: readonly string[]): Promise<TaggedRun[]> {
    if (tags.length === 0) {
      return [];
    }
    const owner = entity || (await this.ownEntity());
    const projects = await this.projectNames(owner);
    if (projects.length === 0) {
      return [];
    }
    const projectVariables = Object.fromEntries(projects.map((name, index) => [`project${index}`, name]));
    const data = (await this.query(taggedRunsQuery(projects.length), {
      entity: owner,
      filters: JSON.stringify({ tags: { $in: tags } }),
      first: tags.length,
      ...projectVariables,
    })) as Record<string, { runs: { edges: { node: RunNode }[] } } | null>;
    return projects.flatMap((project, index) =>
      (data[`project${index}`]?.runs.edges ?? []).map(({ node }) => ({
        project,
        name: node.name,
        displayName: node.displayName,
        state: node.state,
        tags: node.tags ?? [],
        url: `https://wandb.ai/${encodeURIComponent(owner)}/${encodeURIComponent(project)}/runs/${encodeURIComponent(node.name)}`,
        summary: parseSummary(node.summaryMetrics),
      })),
    );
  }

  /** The entity the API key belongs to; also how a new key is checked. */
  ownEntity(): Promise<string> {
    this.defaultEntity ??= this.query(VIEWER_ENTITY, {}).then((data) => (data as { viewer: { entity: string } }).viewer.entity);
    return this.defaultEntity;
  }

  private async projectNames(entity: string): Promise<string[]> {
    const data = (await this.query(ENTITY_PROJECTS, { entity })) as {
      entity: { projects: { edges: { node: { name: string } }[] } } | null;
    };
    return (data.entity?.projects.edges ?? []).map(({ node }) => node.name);
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
  tags: string[] | null;
  summaryMetrics: string | null;
}

/** One `runs` lookup per project, aliased `project0`, `project1`, …, so one request covers them all. */
function taggedRunsQuery(projectCount: number): string {
  const indexes = [...Array(projectCount).keys()];
  const runFields = "name displayName state tags summaryMetrics";
  const projectVariables = indexes.map((index) => `$project${index}: String!`).join(", ");
  const projectFields = indexes.map(
    (index) =>
      `  project${index}: project(name: $project${index}, entityName: $entity) {
    runs(filters: $filters, first: $first) { edges { node { ${runFields} } } }
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
