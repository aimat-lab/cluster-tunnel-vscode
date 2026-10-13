import * as path from "path";
import { runTests } from "@vscode/test-electron";

/** Downloads VS Code into `.vscode-test/` and runs the host suite inside it. */
async function main(): Promise<void> {
  // Set in terminals inside VS Code; it would start the test VS Code as plain Node.
  delete process.env.ELECTRON_RUN_AS_NODE;
  const extensionRoot = path.resolve(__dirname, "../../..");
  await runTests({
    extensionDevelopmentPath: extensionRoot,
    extensionTestsPath: path.resolve(__dirname, "suite"),
    launchArgs: ["--disable-extensions"],
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
