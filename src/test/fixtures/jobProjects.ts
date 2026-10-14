import type { JobProjects } from "../../jobsTable";

/** The projects of the fixture jobs, as their records name them; 90, 92, 93 and 94 have none. */
export const JOB_PROJECTS: JobProjects = {
  byJob: new Map([
    ["haicore/101", "htfm"],
    ["haicore/102", "htfm"],
    ["haicore/103", "legacy"],
    ["haicore/91", "htfm"],
    ["haicore/80", "htfm"],
  ]),
  unassignedReason: "submitted without --project",
  sourceLabel: "ctun",
  error: undefined,
};
