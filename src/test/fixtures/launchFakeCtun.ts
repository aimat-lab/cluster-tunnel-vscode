import * as path from "path";
import { Ctun } from "../../ctun";

const FAKE_CTUN = path.resolve(__dirname, "fakeCtun.js");

/** A `Ctun` that runs fakeCtun.ts with `behaviour`; reset `FAKE_CTUN` after each test. */
export function fakeCtun(behaviour: string, timeoutMs?: number): Ctun {
  process.env.FAKE_CTUN = behaviour;
  return new Ctun([process.execPath, FAKE_CTUN], timeoutMs);
}
