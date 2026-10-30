# Publishing the ctun extension

How to publish `cluster-tunnel` to the VS Code Marketplace as
`AiMatGroup.cluster-tunnel`. Checked against the official docs and the vsce
issue tracker in October 2026; the sources are listed at the end. Publishing is
public and hard to undo: a removed extension name stays reserved forever, and a
version number can never be reused.

There are two ways to publish: upload the `.vsix` in the browser (section 3), or
let GitHub Actions publish it with trusted publishing (section 4).

## 1. The publisher

The publisher **AiMatGroup** belongs to a group Microsoft account, not to one
person. Its ID is fixed and must equal `"publisher"` in `package.json`. Manage it
at <https://marketplace.visualstudio.com/manage>.

To add someone, open **Members** → **Add** and enter their Marketplace **User
ID**, not their email: adding by email often fails with `TF14045: The identity
could not be found`. Each person finds their User ID by hovering over their name
at the top of the manage page. The roles:

- **Owner**: everything, including publisher settings and members.
- **Contributor**: publish and manage all extensions, but not settings or
  members.
- **Creator**: publish, but not manage extensions published by others.
- **Reader**: view only.

Keep at least two permanent group members as **Owner**, so that the publisher
outlives any one of them. **Contributor** is enough for someone who only
releases.

The **Verified publisher** badge needs 6 months on the Marketplace and a domain
of your own. You don't need it to publish.

## 2. Build and check the package

```bash
npm ci
npm test
npm run package          # → cluster-tunnel-<version>.vsix
```

Install the `.vsix` once (`code --install-extension cluster-tunnel-<version>.vsix`)
and try it before the upload. Package from a clean `out/`: `tsc` does not delete
the output of removed source files, and vsce would ship it. Check the contents
with `npx vsce ls`. The package holds only `out/`, `media/`, the README, the
changelog, `docs/wandb-tagging.md` and `package.json` (see `.vscodeignore`). It
has no runtime dependencies, so packaging on Windows is fine.

Marketplace rules for each release:

- The version is plain `major.minor.patch`. Suffixes like `-beta` are not
  allowed.
- README images are `https` URLs and not SVG. vsce turns the README's relative
  links into absolute URLs from `repository` in `package.json`.
- `CHANGELOG.md` is shown as the "Changelog" tab.

## 3. Publish by hand: upload the `.vsix` in the browser

On <https://marketplace.visualstudio.com/manage>, open the publisher. For the
first release, choose **New extension → Visual Studio Code** and upload the
`.vsix`. For a later version, use **…** → **Update** on the extension. This needs
only the Microsoft login of a publisher member, no token.

The version first shows **Verifying**: the Marketplace scans the package for
malware, secrets and names that copy other extensions. After a few minutes it
shows the plain version number, and you can install it from the Extensions view.

## 4. Publish from GitHub Actions: trusted publishing (`--oidc`)

Trusted publishing stores no token in GitHub. It trusts only the publish
workflow in `aimat-lab/cluster-tunnel-vscode`, so publishing stays with the
group's repo.

The Marketplace accepts `--oidc` since 28 October 2026. It needs vsce 4.1.0 or
later (4.0.0 fails the token exchange) and Node.js 22 or later. The workflow
trades a GitHub OIDC token for a Marketplace token that lasts 15 minutes.

1. On the manage page, open the publisher → **Trusted Publishing** → **Create**.
   A **Contributor** may do this. Fill in:
   - Provider: GitHub Actions
   - Repository owner: `aimat-lab` (the GitHub owner, not the publisher)
   - Repository: `cluster-tunnel-vscode`
   - Workflow: `publish-extension.yml`
   - Environment: empty (the workflow uses none; with a value, the exchange
     fails)
2. A new policy is **Inactive** until a run uses it, and the page shows a
   deadline (about two days) for that first use.
3. To publish, push a tag `v*`. The `publish` job stops if the tag does not
   equal `v` + the `version` in `package.json`, runs the unit and host tests,
   and then runs `vsce publish --oidc`. With `--oidc`, vsce never falls back to
   a token. If the exchange fails, the job fails.

The policy matches the repo, the owner and the workflow file name. If you rename
the workflow file or move the repo, update the policy.

## 5. Pre-releases (optional)

```bash
npx vsce package --pre-release
```

Upload that `.vsix` as in section 3, or publish with `--pre-release` added to
the command in section 4. A pre-release needs its own version number (no
`-beta` suffix). The convention is odd minor numbers for pre-releases (`0.1.x`)
and even ones for releases (`0.2.x`). Users opt in per extension.

## 6. Undo a release

From mild to final:

- **Unpublish** (manage page → More Actions): nobody can download it, and the
  statistics are kept.
- **Delete this version** (Reports): that version number can never be used
  again. You cannot delete the latest version.
- **Remove** (manage page → Remove): this deletes the statistics and reserves
  the name forever.

## Release checklist

1. `CHANGELOG.md`: promote `[Unreleased]`.
2. Bump `version` in `package.json`.
3. `npm test` and `npm run test:host` pass.
4. Delete `out/`, run `npm run package`, install the `.vsix` locally, and try it.
5. Commit, tag (`vX.Y.Z`), push.
6. Publish (section 3 or 4).

## Sources

- VS Code docs, [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
  (trusted publishing, publisher, pre-release, restrictions, unpublishing)
- [vsce README, "Trusted publishing"](https://github.com/microsoft/vscode-vsce#trusted-publishing) (`--oidc` and its workflow)
- [vsce #1275](https://github.com/microsoft/vscode-vsce/issues/1275) (the Marketplace accepts `--oidc` with vsce 4.1.0 since 28 October 2026)
