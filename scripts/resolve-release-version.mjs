import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.env.RELEASE_TAG || `v${pkg.version}`;
assert.match(tag, /^v\d+\.\d+\.\d+$/, 'Expected vX.Y.Z release tag');
appendFileSync(
  process.env.GITHUB_ENV,
  [
    `RELEASE_TAG=${tag}`,
    `QA_TOUCHSTONE_EXPECT_VERSION=${tag.slice(1)}`,
    `QA_TOUCHSTONE_CI_EXPECT_VERSION=${tag.slice(1)}`,
    '',
  ].join('\n')
);
