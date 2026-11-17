# Release verification

New `vX.Y.Z` tag pushes run `release.yml`: the full CI gate, native builds,
published desktop installation checks, packaged CLI and setup-ci checks,
npm publishing when enabled, and three-platform npx functional checks.
The desktop and CLI verification workflows are shared with recovery runs.

To revalidate an already published version using the current verifier:

```sh
gh workflow run release.yml --ref master -f tag=v0.23.1
```

This dispatch uses read-only repository permissions. It verifies all nine
downloads and CLI checksum manifests, runs full CI and the same desktop,
headless and npx checks as normal releases, and compares the tag reference,
commit, release ID, asset IDs, sizes, SHA256 digests and timestamps afterward.
It does not build, upload, replace assets, or publish npm versions.

GitHub reruns retain their original event's commit and ref. A historical
run cannot pick up verifier fixes without changing the tagged source;
use a new dispatch from `master` and retain the historical logs.

`npm run test:release` permanently covers public/local DMG names, wrong or
ambiguous versions, the exact Tauri NSIS marker patch, unrelated binary
changes, and the release preservation gate. CI and release gates run it.
Registry visibility is polled before npx checks; actual functional failures
are not retried or ignored.
