# qa-touchstone-ci

Thin `npx` launcher for the QA Touchstone headless CI runner.

The npm package does not bundle the native binary. On first run it downloads the
matching `qa-touchstone-ci-<os>-<arch>` artifact from the QA Touchstone GitHub
Release, verifies the `.sha256` checksum, caches the binary, and forwards all
arguments to it.

```bash
npx qa-touchstone-ci@<version> scan \
  --config qa-touchstone.json \
  --html reports/security.html \
  --sarif reports/security.sarif \
  --fail-on high
```

Useful environment variables:

- `QA_TOUCHSTONE_CI_VERSION`: release tag or semver to download, for example
  `v0.22.1` or `0.22.1`.
- `QA_TOUCHSTONE_CI_REPO`: GitHub repo that hosts the release assets. Defaults
  to `asdfghj1237890/qa-touchstone`.
- `QA_TOUCHSTONE_CI_CACHE_DIR`: cache directory for downloaded assets.
- `QA_TOUCHSTONE_CI_BIN`: local binary override for development and tests.

The `perf` command still requires `k6` to be available on the runner, or passed
with `--k6-bin`.
