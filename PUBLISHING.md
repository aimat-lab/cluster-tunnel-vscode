# Publishing the ctun extension

How to publish `cluster-tunnel-vscode` to the VS Code Marketplace (and, optionally, Open
VSX). Checked against the official docs on 2026-10-12; the sources are listed
at the end. Publishing is public and hard to undo: a removed extension name stays
reserved forever, and a version number can never be reused.

> **Deadline: 1 December 2026.** On that date Azure DevOps retires *global*
> personal access tokens (PATs), the classic way to log in with `vsce`. A PAT made
> today stops working then. For anything after that, use trusted publishing from
> GitHub Actions (step 6) or the manual upload (step 5b).

## 1. Fix what blocks a public release

The icon (`media/icon.png`, redrawn from
cluster-tunnel's banner) is in place. Check the rest before a publish:

| Item | Now | To do |
|---|---|---|
| License | None yet | Pick one, add `LICENSE` and set `"license"` in `package.json`. Without a file, vsce asks before it packages, and without a license nobody may reuse the code. |
| Publisher | `"publisher": "aimat-lab"` | Must equal the publisher ID you create in step 3. The ID can never change. |
| Repository | `aimat-lab/cluster-tunnel-vscode` | vsce turns README links into absolute URLs from it. If the repo moves, change the URL. |
| Name | `cluster-tunnel-vscode` / "Cluster Tunnel" | The name and display name must be unique on the Marketplace. Search for them first. |
| README | Links only to files in the repo | Images must be `https` URLs and not SVG (except badges from trusted providers). |
| Version | `0.0.1` | Use plain `major.minor.patch`. Suffixes like `-beta` are not allowed. |
| Metadata | `categories: ["Other"]` | Optional: add `keywords` (at most 30) and a `galleryBanner`. |

Also update `CHANGELOG.md`: rename `## [Unreleased]` to `## [0.1.0] - YYYY-MM-DD`.
The Marketplace shows that file as the "Changelog" tab.

## 2. Install vsce

`@vscode/vsce` is already a dev dependency, so `npx vsce …` works in this repo. Trusted publishing (step 6) needs Node.js 22 or later.

## 3. Create the publisher (once)

1. Go to <https://marketplace.visualstudio.com/manage> and sign in with your
   Microsoft account.
2. Click **Create publisher**. Enter the **ID** (`aimat-lab`, or what
   `package.json` says) and a display **Name**.

The **Verified publisher** badge comes later: it needs 6 months on the
Marketplace and a domain of your own. You don't need it to publish.

## 4. Build and check the package

```bash
npm ci
npm test
npm run package          # → cluster-tunnel-vscode-<version>.vsix
```

Install the `.vsix` once (`code --install-extension cluster-tunnel-vscode-<version>.vsix`)
and try it before the upload. The package holds only `out/`, `media/`, the README,
the changelog and `package.json` (see `.vscodeignore`). It has no runtime
dependencies, so it does not matter that you package on Windows. (vsce warns
that Windows drops POSIX file modes, which only breaks a bundled `node_modules`.)

## 5. Publish by hand

Pick one way.

### 5a. With a PAT (works until 1 December 2026)

1. In Azure DevOps (`https://dev.azure.com/<your-org>` → **User settings** →
   **Personal access tokens** → **New token**), set **Organization** to **All
   accessible organizations**. Set **Scopes** to **Custom defined** →
   **Marketplace** → **Manage**.
2. Log in and publish:

   ```bash
   npx vsce login aimat-lab     # paste the PAT
   npx vsce publish             # publishes the version in package.json
   ```

   `npx vsce publish minor` (or `patch`, `major`, or an exact `1.2.3`) also
   bumps the version. It commits and tags in git, so run it only on the branch
   you release from.

### 5b. Upload the `.vsix` in the browser (no token)

On <https://marketplace.visualstudio.com/manage>, open your publisher. Choose
**New extension → Visual Studio Code** and upload the `.vsix`. For a later
version, use **…** → **Update** on the extension. This uses only your Microsoft
login. (The current publishing page no longer describes this flow, so check it
when you first use it.)

## 6. Publish from GitHub Actions (trusted publishing, for after December 2026)

No stored token: the workflow trades a GitHub OIDC token for a Marketplace token
that lasts 15 minutes.

1. On the Marketplace, add a **trusted publishing policy** for the repo and the
   workflow file. The vsce README describes it under "Trusted publishing", and
   the field names may change, so follow that page.
2. Add a workflow, e.g. `.github/workflows/publish-extension.yml`, triggered by
   a tag such as `v*`:

   ```yaml
   on:
     push:
       tags: ["v*"]
   jobs:
     publish:
       runs-on: ubuntu-latest
       permissions:
         contents: read
         id-token: write
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 22
         - run: npm ci
         - run: npm test
         - run: npx @vscode/vsce publish --oidc
   ```

   With `--oidc`, vsce never falls back to a PAT. If the exchange fails, the job
   fails.

Microsoft's own docs show a second way, `vsce publish --azure-credential` with an
Entra ID managed identity. Its example is for Azure Pipelines; a July 2026
report says it is hard to use with GitHub Actions and a personal publisher.

## 7. Pre-releases (optional)

```bash
npx vsce publish --pre-release
```

A pre-release needs its own version number (no `-beta` suffix). The convention
is odd minor numbers for pre-releases (`0.1.x`) and even ones for releases
(`0.2.x`). Users opt in per extension.

## 8. Open VSX (optional: VSCodium, Cursor, Gitpod)

1. Create an Eclipse account with your GitHub username. Log in to
   <https://open-vsx.org> with GitHub and sign the **Publisher Agreement**
   (Settings → Log in with Eclipse).
2. Create a token: Settings → **Access Tokens**. It is shown only once.
3. Once:

   ```bash
   npx ovsx create-namespace aimat-lab -p <token>
   ```

4. For each release, upload the same `.vsix`:

   ```bash
   npx ovsx publish cluster-tunnel-vscode-<version>.vsix -p <token>
   ```

## 9. After publishing

- Within a few minutes, the extension shows at
  `https://marketplace.visualstudio.com/items?itemName=aimat-lab.cluster-tunnel-vscode`.
- In the README, replace the "Install from VSIX" steps with the Marketplace
  link, and with `code --install-extension aimat-lab.cluster-tunnel-vscode`.
- Undo options, from mild to final:
  - **Unpublish** (manage page → More Actions): nobody can download it, and the
    statistics are kept.
  - **Delete this version** (Reports): that version number can never be used
    again. You cannot delete the latest version.
  - **Remove**: `npx vsce unpublish aimat-lab.cluster-tunnel-vscode`, or manage page →
    Remove. This deletes the statistics and reserves the name forever.

## Release checklist

1. `CHANGELOG.md`: promote `[Unreleased]`.
2. Bump `version` in `package.json`.
3. `npm test` and `npm run test:host` pass.
4. `npm run package`, install the `.vsix` locally, and try it.
5. Commit, tag (`vX.Y.Z`), push.
6. Publish (step 5 or 6), and the same `.vsix` to Open VSX if you use it.

## Sources

- VS Code docs, [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
  (PAT and Entra ID, publisher, pre-release, restrictions, unpublishing)
- [vsce README, "Trusted publishing"](https://github.com/microsoft/vscode-vsce#trusted-publishing) (`--oidc` and its workflow)
- Azure DevOps Blog, [Retirement of Global Personal Access Tokens](https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops/)
- [vsmarketplace #2121](https://github.com/microsoft/vsmarketplace/issues/2121) (organization-scoped PATs, not confirmed to work)
- [Classmethod, July 2026](https://dev.classmethod.jp/en/articles/publish-vscode-extension-ci-marketplace-openvsx-npm/) (Entra ID from GitHub Actions; secondary source)
- Open VSX wiki, [Publishing Extensions](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions)
