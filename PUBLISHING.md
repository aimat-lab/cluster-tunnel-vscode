# Publishing the ctun extension

How to publish `cluster-tunnel` to the VS Code Marketplace (and, optionally, Open
VSX). Checked against the official docs and the vsce issue tracker on
2026-10-18; the sources are listed at the end. Publishing is public and hard to
undo: a removed extension name stays reserved forever, and a version number can
never be reused.

> **Deadline: 1 December 2026.** On that date Azure DevOps retires *global*
> personal access tokens (PATs), the classic way to log in with `vsce`. A PAT made
> today stops working then. After that, use the manual upload (step 5b) or
> publish from GitHub Actions (step 6). Trusted publishing, the simple way to do
> step 6, does not work yet (October 2026), so check its status before a release.

## 1. Fix what blocks a public release

The icon (`media/icon.png`, redrawn from
cluster-tunnel's banner) is in place. Check the rest before a publish:

| Item | Now | To do |
|---|---|---|
| License | MIT (`LICENSE`, `"license"` in `package.json`) | Nothing. Without a license file, vsce asks before it packages. |
| Publisher | `"publisher": "aimat-lab"` | Must equal the publisher ID you create in step 3. The ID can never change. |
| Repository | `aimat-lab/cluster-tunnel-vscode` | vsce turns README links into absolute URLs from it. If the repo moves, change the URL, and the publish trust in step 6, which names the repo. |
| Name | `cluster-tunnel` / "Cluster Tunnel" | The name and display name must be unique on the Marketplace. Search for them first. |
| README | Links only to files in the repo | Images must be `https` URLs and not SVG (except badges from trusted providers). |
| Version | `0.1.0` | Use plain `major.minor.patch`. Suffixes like `-beta` are not allowed. |
| Metadata | `categories: ["Other"]` | Optional: add `keywords` (at most 30) and a `galleryBanner`. |

`CHANGELOG.md` has the `## [0.1.0]` entry. The Marketplace shows that file as
the "Changelog" tab.

## 2. Install vsce

`@vscode/vsce` is already a dev dependency, so `npx vsce …` works in this repo. Trusted publishing (step 6a) needs vsce 4.0.0 or later and Node.js 22 or later.

## 3. Create the publisher (once)

The publisher should belong to the group, not to one person. Every publisher
needs a Microsoft login behind it, so use a group account:

1. Get a group email address (e.g. a KIT functional mailbox) and create a
   Microsoft account on it. Keep its password with the group's shared
   credentials.
2. With that account, go to <https://marketplace.visualstudio.com/manage>. On
   the first login, Microsoft asks for a name, email and country ("We need a few
   more details"): fill it in and click **Continue**. Then click **Create
   publisher**. Enter the **ID** (`aimat-lab`, or what `package.json` says, in
   lowercase) and a display **Name**.
3. Add the people who publish under **Members** → **Add**. Enter their
   Marketplace **User ID**, not their email: adding by email often fails with
   `TF14045: The identity could not be found`. Each person finds their User ID
   by hovering over their name at the top of the manage page. The roles:
   - **Owner**: everything, including publisher settings and members.
   - **Contributor**: publish and manage all extensions, but not settings or
     members.
   - **Creator**: publish, but not manage extensions published by others.
   - **Reader**: view only.

   Make at least two permanent group members **Owner**, so that the publisher
   outlives any one of them. **Contributor** is enough for someone who only
   releases.

The **Verified publisher** badge comes later: it needs 6 months on the
Marketplace and a domain of your own. You don't need it to publish.

## 4. Build and check the package

```bash
npm ci
npm test
npm run package          # → cluster-tunnel-<version>.vsix
```

Install the `.vsix` once (`code --install-extension cluster-tunnel-<version>.vsix`)
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
version, use **…** → **Update** on the extension. This needs only the Microsoft
login of a publisher member. (Tested on 2026-10-25 with a placeholder extension.)

The version first shows **Verifying**: the Marketplace scans the package for
malware, secrets and names that copy other extensions. After a few minutes it
shows the plain version number, and you can install it from the Extensions view.

## 6. Publish from GitHub Actions (for after December 2026)

Neither way below stores a token in GitHub. Both trust only workflows in
`aimat-lab/cluster-tunnel-vscode`, so publishing stays with the group's repo.

### 6a. Trusted publishing (`--oidc`): not available yet

**Status, 25 October 2026:** vsce has the `--oidc` flag (since 4.0.0), but the
Marketplace does not accept it yet. On 8 October the token exchange still
failed with `TrustedPublishingNotSupportedException`, and the Marketplace has no
page to set up the policy. On 21 October the maintainers named Friday 30 October
as their target. Before a release, check
[vsce #1275](https://github.com/microsoft/vscode-vsce/issues/1275).

No document names the publisher role that sets up the policy. The policy is a
publisher setting, and only an **Owner** may change those (see step 3).

When it works, the workflow trades a GitHub OIDC token for a Marketplace token
that lasts 15 minutes:

1. On the Marketplace, add a **trusted publishing policy** for the repo and the
   workflow file. The vsce README describes it under "Trusted publishing", and
   the field names may change, so follow that page.
2. The workflow is in place: `.github/workflows/publish-extension.yml`. A pushed
   tag `v*` runs it. It stops if the tag does not equal `v` + the `version` in
   `package.json`, runs the unit and host tests, and then runs
   `vsce publish --oidc`. With `--oidc`, vsce never falls back to a PAT. If the
   exchange fails, the job fails.

Until the Marketplace accepts `--oidc`, do not push a `v*` tag: the job fails at
the publish step.

### 6b. Entra ID (`--azure-credential`): works today, more setup

This is the way the VS Code docs recommend. Their example is for Azure
Pipelines, but people use it from GitHub Actions too:

1. Create an Entra ID app registration (or a managed identity) and give it a
   **federated credential** that trusts GitHub Actions in this repo. Create it in
   a tenant the group controls (KIT's, through IT, or one of the group
   account), not in a personal one, or publishing hangs on one person again.
2. Add that identity to the publisher as a **Contributor**. Without this, the
   login works but the publish fails with "operation not allowed".
3. In the workflow, log in with `azure/login` (OIDC, `id-token: write`) and run
   `npx @vscode/vsce publish --azure-credential`.

A federated credential matches one exact subject, so a credential for `main`
does not match a tag-triggered run. Run the publish job in a GitHub
environment (e.g. `marketplace`) and trust that environment instead. (Not yet
tried here.)

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
   npx ovsx publish cluster-tunnel-<version>.vsix -p <token>
   ```

## 9. After publishing

- Within a few minutes, the extension shows at
  `https://marketplace.visualstudio.com/items?itemName=aimat-lab.cluster-tunnel`.
- In the README, replace the "Install from VSIX" steps with the Marketplace
  link, and with `code --install-extension aimat-lab.cluster-tunnel`.
- Undo options, from mild to final:
  - **Unpublish** (manage page → More Actions): nobody can download it, and the
    statistics are kept.
  - **Delete this version** (Reports): that version number can never be used
    again. You cannot delete the latest version.
  - **Remove**: `npx vsce unpublish aimat-lab.cluster-tunnel`, or manage page →
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
- [vsce #1275](https://github.com/microsoft/vscode-vsce/issues/1275) (the Marketplace does not accept `--oidc` yet, October 2026)
- [DEV Community, "How did I automate a VS Code Marketplace release without a PAT?"](https://dev.to/john_smith_0fe98c53831097/how-did-i-automate-a-vs-code-marketplace-release-without-a-pat-17lo) (Entra ID from GitHub Actions; secondary source)
- Azure DevOps Blog, [Retirement of Global Personal Access Tokens](https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops/)
- [vsmarketplace #2121](https://github.com/microsoft/vsmarketplace/issues/2121) (organization-scoped PATs, not confirmed to work)
- [Classmethod, July 2026](https://dev.classmethod.jp/en/articles/publish-vscode-extension-ci-marketplace-openvsx-npm/) (Entra ID from GitHub Actions; secondary source)
- Open VSX wiki, [Publishing Extensions](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions)
