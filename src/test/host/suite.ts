import * as assert from "assert";
import * as vscode from "vscode";

const EXTENSION_ID = "AiMatGroup.cluster-tunnel";

/** Entry point VS Code calls inside the Extension Development Host. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} is not loaded`);
  await extension.activate();
  assert.ok(extension.isActive, "extension did not activate");

  const ctunPath = vscode.workspace.getConfiguration("ctun").get<string>("path");
  assert.strictEqual(ctunPath, "ctun");

  console.log("host suite: extension activated");
}
