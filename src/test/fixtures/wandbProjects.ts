import type { JobProjects } from "../../jobsTable";

/** The W&B projects of the fixture jobs: the ones their records name; 90, 92, 93 and 94 have no tagged run. */
export const JOB_PROJECTS: JobProjects = {
  byJob: new Map([
    ["101", "htfm"],
    ["102", "htfm"],
    ["103", "legacy"],
    ["91", "htfm"],
    ["80", "htfm"],
  ]),
  error: undefined,
};
