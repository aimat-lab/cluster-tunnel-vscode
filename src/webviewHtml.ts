import * as crypto from "crypto";
import * as vscode from "vscode";

/**
 * The page of a webview that renders with `media/<asset>.js` and `media/<asset>.css`
 * into `<main id="app">`; the CSP lets in only those two files.
 */
export function webviewHtml(webview: vscode.Webview, mediaRoot: vscode.Uri, asset: string, title: string): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const script = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, `${asset}.js`));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, `${asset}.css`));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${style}">
<title>${title}</title>
</head>
<body>
<main id="app" aria-busy="true"></main>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
