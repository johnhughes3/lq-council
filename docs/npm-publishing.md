# npm Publishing

The package name is:

```txt
@johnhughes3/lq-council
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

1. Log in to npmjs.com as the `johnhughes3` account or an account that controls the
   `@johnhughes3` scope.
2. Create or claim the package/scope if npm requires a first manual publish.
3. In the package settings, add a trusted publisher:

   ```txt
   Provider: GitHub Actions
   Organization/user: johnhughes3
   Repository: lq-council
   Workflow filename: publish-npm.yml
   ```

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
4. Create a GitHub Release.
5. The `Publish npm Package` workflow publishes to npm.

You can also run the workflow manually from GitHub Actions after the trusted publisher is configured.
Manual runs are guarded to publish only from `main`; release-triggered runs publish from the release
ref.
