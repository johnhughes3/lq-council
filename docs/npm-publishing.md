# npm Publishing

The package name is:

```txt
@johnhughes/lq-council
```

The publish workflow is:

```txt
.github/workflows/publish-npm.yml
```

It uses npm trusted publishing through GitHub Actions OIDC and runs:

```bash
npm publish --access public --provenance
```

## Setup Required On npm

1. Log in to npmjs.com as the `johnhughes` account or an account that controls the
   `@johnhughes` scope.
2. Create or claim the package/scope if npm requires a first manual publish.
3. In the package settings, add a trusted publisher:

   ```txt
   Provider: GitHub Actions
   Organization/user: johnhughes3
   Repository: lq-council
   Workflow filename: publish-npm.yml
   ```

   The `Organization/user` value above is the GitHub repository owner. Keep it as
   `johnhughes3` while the source repository lives at `github.com/johnhughes3/lq-council`;
   the npm package scope is separately `@johnhughes`.

4. Make sure the GitHub repository is public if you want npm provenance generated.
5. In GitHub, create an environment named `npm`. Add required reviewers if you want a manual
   approval step before publishing.

No `NPM_TOKEN` is required for the configured workflow.

## Release

1. Update `version` in `package.json`.
2. Run:

   ```bash
   pnpm check
   ```

3. Commit and push.
4. Create and publish a GitHub Release whose tag exactly matches the package version with a leading
   `v`, for example:

   ```bash
   gh release create v0.1.1 --title "v0.1.1" --notes "..."
   ```

5. The `Publish npm Package` workflow verifies that the release tag matches `package.json`, verifies
   that the npm version is not already published, runs `pnpm check`, and publishes to npm through
   trusted publishing.

Do not publish on every push to `main`. npm versions are immutable, so push-based publishing either
fails on ordinary commits or encourages unsafe automatic version bumps.

You can also run the workflow manually from GitHub Actions after the trusted publisher is configured.
Manual runs are a fallback path only: select the `main` branch and enter `publish` in the confirmation
input. The preflight job fails before the protected `npm` environment is entered if the run is not
from `main`, the confirmation text is wrong, or the package version is already published.
