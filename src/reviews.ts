import type { JobRecord } from "./ctun";

export type ReviewStatus = "confirmed" | "edited" | "discarded";

/** The human's verdict on an agent's note. Records never change; reviews live here. */
export interface Review {
  status: ReviewStatus;
  /** The edited note, for `edited`. */
  text?: string;
  /** ISO 8601. */
  at: string;
}

/** Where reviews are kept: the extension's `globalState`, which Settings Sync carries. */
export const REVIEWS_STATE_KEY = "ctun.reviews";

/** The part of `vscode.Memento` the store needs; tests pass a plain object. */
export interface ReviewMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

/** One key per job across machines: the Slurm cluster name (not a local config name) and the job ID. */
export function reviewKey(record: JobRecord, fallbackCluster: string): string {
  return `${record.slurm_cluster ?? fallbackCluster}/${record.job_id}`;
}

export class ReviewStore {
  constructor(private readonly memento: ReviewMemento) {}

  all(): Record<string, Review> {
    return this.memento.get<Record<string, Review>>(REVIEWS_STATE_KEY) ?? {};
  }

  get(key: string): Review | undefined {
    return this.all()[key];
  }

  async set(key: string, status: ReviewStatus, text?: string): Promise<void> {
    const review: Review = { status, at: new Date().toISOString(), ...(text === undefined ? {} : { text }) };
    await this.memento.update(REVIEWS_STATE_KEY, { ...this.all(), [key]: review });
  }
}
