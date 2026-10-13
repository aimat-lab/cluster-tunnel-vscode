// Stands in for the ctun CLI in unit tests. The FAKE_CTUN variable picks what it does.
const behaviour = process.env.FAKE_CTUN ?? "";

if (behaviour === "echo-args") {
  console.log(JSON.stringify(process.argv.slice(2)));
} else if (behaviour === "echo-stdin") {
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => console.log(JSON.stringify({ args: process.argv.slice(2), stdin: input })));
} else if (behaviour === "git-log") {
  console.log("a60bc60\tKeep one MAGNDATA entry per formula");
  console.log("87d86d4\tFix leftover paths\tafter the refactoring");
} else if (behaviour.startsWith("exit:")) {
  console.error("ctun-error: some_marker");
  process.exit(Number(behaviour.slice("exit:".length)));
} else if (behaviour === "garbage") {
  console.log("not json {");
} else if (behaviour === "hang") {
  setTimeout(() => {}, 60_000);
} else {
  console.error(`fakeCtun: unknown FAKE_CTUN=${behaviour}`);
  process.exit(2);
}
