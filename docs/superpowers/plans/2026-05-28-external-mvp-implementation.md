# External MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first external MVP shell with API Client as the primary feature, generic auth methods, external-safe navigation, and internal surfaces hidden by edition gating.

**Architecture:** Add a small product configuration module that defines external edition labels and visible surfaces, then wire `App.jsx` and `Home.jsx` to it. Move request auth mutation into a pure utility so Bearer, API Key, Basic, and No Auth can be tested without rendering the large API page; keep AWS SigV4 on the existing backend path. Replace Sidewalk-specific API environments with generic external defaults and make backend URL rebasing use only environment-provided known base paths.

**Tech Stack:** React 18, Material UI 7, Vite/Vitest, Tauri 2, Rust reqwest backend.

---

## File Structure

- Create `src/productConfig.js`: external edition constants, product name, visible page defaults, settings tab policy, generic API environments.
- Create `src/utils/apiAuth.js`: pure helpers to apply No Auth, Bearer, API Key, and Basic Auth to cloned Postman request details.
- Create `src/__tests__/productConfig.test.js`: verifies external edition defaults hide internal tabs and use safe labels.
- Create `src/__tests__/utils/apiAuth.test.js`: verifies auth mutation behavior.
- Modify `src/App.jsx`: use product config for app title, external visible pages, filtered main tabs, and filtered settings tabs.
- Replace `src/pages/Home.jsx`: external-safe dashboard with API-first positioning and no internal links.
- Modify `src/pages/ApiTestPage.jsx`: use generic environments and new auth utility; add API Key and Basic Auth UI state.
- Modify `src/__tests__/App.test.jsx`: align default visible-page assertions with external edition gating.
- Modify `src/__tests__/pages/ApiTestPage.test.jsx`: update auth option expectations and remove internal environment assumptions where directly asserted.
- Modify `src-tauri/src/commands/api.rs`: use environment-provided `knownBasePaths` and rebase when `baseUrl` is set, even if `basePath` is empty.
- Modify `src-tauri/src/reqprep.rs`: update comments/tests away from Sidewalk-only assumptions where needed.
- Modify `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `README.md`: external-safe name/identifier/docs.

---

### Task 1: Product Config And External Navigation

**Files:**
- Create: `src/productConfig.js`
- Create: `src/__tests__/productConfig.test.js`
- Modify: `src/App.jsx`
- Test: `src/__tests__/productConfig.test.js`
- Test: `src/__tests__/App.test.jsx`

- [ ] **Step 1: Write failing product config tests**

Create `src/__tests__/productConfig.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  PRODUCT_NAME,
  PRODUCT_EDITION,
  EXTERNAL_VISIBLE_PAGES,
  getVisiblePagesForEdition,
  isExternalSettingsTabVisible,
} from '../productConfig';

describe('productConfig', () => {
  it('uses an external-safe product identity', () => {
    expect(PRODUCT_EDITION).toBe('external');
    expect(PRODUCT_NAME).toBe('QA Companion');
    expect(PRODUCT_NAME).not.toMatch(/amazon|sidewalk|ring|echo/i);
  });

  it('defaults external navigation to API, Nordic, and Silabs only', () => {
    expect(EXTERNAL_VISIBLE_PAGES).toEqual({
      credentials: false,
      flashNordic: true,
      flashSilabs: true,
      flashEFD: false,
      flashRFD: false,
      tab6: false,
      apiTest: true,
      tab8: false,
    });
  });

  it('enforces external hidden tabs even if saved config enables them', () => {
    const visible = getVisiblePagesForEdition({
      credentials: true,
      flashNordic: false,
      flashSilabs: false,
      flashEFD: true,
      flashRFD: true,
      tab6: true,
      apiTest: false,
      tab8: true,
    });

    expect(visible).toEqual({
      credentials: false,
      flashNordic: true,
      flashSilabs: true,
      flashEFD: false,
      flashRFD: false,
      tab6: false,
      apiTest: true,
      tab8: false,
    });
  });

  it('hides placeholder settings tabs from the external edition', () => {
    expect(isExternalSettingsTabVisible('setting5')).toBe(false);
    expect(isExternalSettingsTabVisible('apiSettings')).toBe(true);
  });
});
```

- [ ] **Step 2: Run product config tests to verify they fail**

Run:

```bash
npm test -- src/__tests__/productConfig.test.js
```

Expected: FAIL because `src/productConfig.js` does not exist.

- [ ] **Step 3: Implement product config**

Create `src/productConfig.js`:

```js
export const PRODUCT_EDITION = import.meta.env.VITE_PRODUCT_EDITION || 'external';

export const PRODUCT_NAME = PRODUCT_EDITION === 'internal'
  ? 'Sidewalk QA Friends'
  : 'QA Companion';

export const EXTERNAL_VISIBLE_PAGES = Object.freeze({
  credentials: false,
  flashNordic: true,
  flashSilabs: true,
  flashEFD: false,
  flashRFD: false,
  tab6: false,
  apiTest: true,
  tab8: false,
});

export const INTERNAL_VISIBLE_PAGE_DEFAULTS = Object.freeze({
  credentials: true,
  flashNordic: true,
  flashSilabs: false,
  flashEFD: true,
  flashRFD: true,
  tab6: true,
  apiTest: true,
  tab8: false,
});

export const GENERIC_API_ENVIRONMENTS = Object.freeze([
  { label: 'None', baseUrl: '', basePath: '', variables: {}, knownBasePaths: [] },
  { label: 'Local', baseUrl: 'http://localhost:3000', basePath: '', variables: {}, knownBasePaths: [] },
  { label: 'Staging', baseUrl: '', basePath: '', variables: {}, knownBasePaths: [] },
  { label: 'Production', baseUrl: '', basePath: '', variables: {}, knownBasePaths: [] },
]);

const EXTERNAL_SETTINGS_TABS = new Set(['setting1', 'setting2', 'setting3', 'apiSettings']);

export function getVisiblePagesForEdition(savedVisiblePages = {}) {
  if (PRODUCT_EDITION === 'internal') {
    return {
      ...INTERNAL_VISIBLE_PAGE_DEFAULTS,
      ...savedVisiblePages,
    };
  }

  return { ...EXTERNAL_VISIBLE_PAGES };
}

export function isExternalSettingsTabVisible(tabKey) {
  return PRODUCT_EDITION === 'internal' || EXTERNAL_SETTINGS_TABS.has(tabKey);
}
```

- [ ] **Step 4: Wire App to product config**

Modify `src/App.jsx`:

```js
import {
  PRODUCT_NAME,
  getVisiblePagesForEdition,
  isExternalSettingsTabVisible,
} from './productConfig';
```

Change the initial visible page state:

```js
const [visiblePages, setVisiblePages] = useState(getVisiblePagesForEdition());
```

When handling config updates:

```js
const nextVisiblePages = getVisiblePagesForEdition(newConfig.visiblePages);
if (!isEqual(currentVisiblePages, nextVisiblePages)) {
  console.log('[React] visiblePages have changed. Updating state:', nextVisiblePages);
  return nextVisiblePages;
}
```

When loading config:

```js
setVisiblePages(getVisiblePagesForEdition(config.visiblePages));
```

Change title text:

```jsx
{isSettingsWindow ? 'Settings' : PRODUCT_NAME}
```

Filter settings tabs:

```js
const getFilteredTabs = () => {
  return (isSettingsWindow ? settingsTabs.filter((tab) => isExternalSettingsTabVisible(tab.key)) : mainTabs);
};
```

Change settings panels to render only filtered setting pages by mapping a `settingsPages` array instead of hard-coded `TabPanel` indexes.

- [ ] **Step 5: Run navigation tests**

Run:

```bash
npm test -- src/__tests__/productConfig.test.js src/__tests__/App.test.jsx
```

Expected: product config tests PASS. Some existing App tests may fail because they expect internal tabs; update only assertions that conflict with the external edition.

- [ ] **Step 6: Commit product config/navigation**

```bash
git add src/productConfig.js src/App.jsx src/__tests__/productConfig.test.js src/__tests__/App.test.jsx
git commit -m "feat: add external edition navigation"
```

---

### Task 2: Request Auth Utility

**Files:**
- Create: `src/utils/apiAuth.js`
- Create: `src/__tests__/utils/apiAuth.test.js`
- Test: `src/__tests__/utils/apiAuth.test.js`

- [ ] **Step 1: Write failing auth utility tests**

Create `src/__tests__/utils/apiAuth.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { applyApiAuthentication } from '../../utils/apiAuth';

const baseRequest = () => ({
  request: {
    method: 'GET',
    header: [{ key: 'Accept', value: 'application/json' }],
    url: 'https://api.example.com/devices?existing=1',
  },
});

describe('applyApiAuthentication', () => {
  it('leaves requests unchanged for no auth', () => {
    expect(applyApiAuthentication(baseRequest(), { type: 'none' })).toEqual(baseRequest());
  });

  it('adds bearer authorization', () => {
    const result = applyApiAuthentication(baseRequest(), {
      type: 'bearer',
      bearerToken: 'token-123',
    });

    expect(result.request.header).toContainEqual({
      key: 'Authorization',
      value: 'Bearer token-123',
    });
  });

  it('adds API key as a header', () => {
    const result = applyApiAuthentication(baseRequest(), {
      type: 'apiKey',
      apiKey: { key: 'x-api-key', value: 'key-123', placement: 'header' },
    });

    expect(result.request.header).toContainEqual({ key: 'x-api-key', value: 'key-123' });
  });

  it('adds API key as a query parameter', () => {
    const result = applyApiAuthentication(baseRequest(), {
      type: 'apiKey',
      apiKey: { key: 'api_key', value: 'key-123', placement: 'query' },
    });

    expect(result.request.url).toBe('https://api.example.com/devices?existing=1&api_key=key-123');
  });

  it('adds basic authorization', () => {
    const result = applyApiAuthentication(baseRequest(), {
      type: 'basic',
      basic: { username: 'alice', password: 'secret' },
    });

    expect(result.request.header).toContainEqual({
      key: 'Authorization',
      value: 'Basic YWxpY2U6c2VjcmV0',
    });
  });
});
```

- [ ] **Step 2: Run auth utility tests to verify they fail**

Run:

```bash
npm test -- src/__tests__/utils/apiAuth.test.js
```

Expected: FAIL because `src/utils/apiAuth.js` does not exist.

- [ ] **Step 3: Implement auth utility**

Create `src/utils/apiAuth.js`:

```js
function ensureHeaders(requestDetails) {
  if (!requestDetails.request.header) {
    requestDetails.request.header = [];
  }
  return requestDetails.request.header;
}

function upsertHeader(requestDetails, key, value) {
  if (!key || !value) return;
  const headers = ensureHeaders(requestDetails);
  const index = headers.findIndex((header) => header.key?.toLowerCase() === key.toLowerCase());
  if (index >= 0) {
    headers[index] = { ...headers[index], key, value };
    return;
  }
  headers.push({ key, value });
}

function encodeBasic(username, password) {
  const input = `${username}:${password}`;
  if (typeof btoa === 'function') {
    return btoa(input);
  }
  return Buffer.from(input, 'utf8').toString('base64');
}

function getRawUrl(requestDetails) {
  const url = requestDetails.request.url;
  if (typeof url === 'string') return url;
  return url?.raw || '';
}

function setRawUrl(requestDetails, rawUrl) {
  if (typeof requestDetails.request.url === 'string') {
    requestDetails.request.url = rawUrl;
    return;
  }
  requestDetails.request.url = {
    ...(requestDetails.request.url || {}),
    raw: rawUrl,
  };
}

function upsertQueryParam(requestDetails, key, value) {
  if (!key || !value) return;
  const rawUrl = getRawUrl(requestDetails);
  const url = new URL(rawUrl);
  url.searchParams.set(key, value);
  setRawUrl(requestDetails, url.toString());
}

export function applyApiAuthentication(requestDetails, auth) {
  const next = JSON.parse(JSON.stringify(requestDetails));
  switch (auth?.type) {
    case 'bearer':
      if (auth.bearerToken) {
        upsertHeader(next, 'Authorization', `Bearer ${auth.bearerToken}`);
      }
      return next;
    case 'apiKey':
      if (auth.apiKey?.placement === 'query') {
        upsertQueryParam(next, auth.apiKey.key, auth.apiKey.value);
      } else {
        upsertHeader(next, auth.apiKey?.key, auth.apiKey?.value);
      }
      return next;
    case 'basic':
      if (auth.basic?.username && auth.basic?.password) {
        upsertHeader(next, 'Authorization', `Basic ${encodeBasic(auth.basic.username, auth.basic.password)}`);
      }
      return next;
    case 'aws':
    case 'none':
    default:
      return next;
  }
}
```

- [ ] **Step 4: Run auth utility tests**

Run:

```bash
npm test -- src/__tests__/utils/apiAuth.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit auth utility**

```bash
git add src/utils/apiAuth.js src/__tests__/utils/apiAuth.test.js
git commit -m "feat(api): add generic auth helpers"
```

---

### Task 3: API Client Auth And Generic Environments

**Files:**
- Modify: `src/pages/ApiTestPage.jsx`
- Modify: `src/__tests__/pages/ApiTestPage.test.jsx`
- Test: `src/__tests__/pages/ApiTestPage.test.jsx`

- [ ] **Step 1: Add failing API page expectations**

Update `src/__tests__/pages/ApiTestPage.test.jsx` where auth options are checked so it expects:

```js
expect(screen.getByLabelText(/No Auth/i)).toBeInTheDocument();
expect(screen.getByLabelText(/Bearer Token/i)).toBeInTheDocument();
expect(screen.getByLabelText(/API Key/i)).toBeInTheDocument();
expect(screen.getByLabelText(/Basic Auth/i)).toBeInTheDocument();
expect(screen.getByLabelText(/AWS SigV4/i)).toBeInTheDocument();
```

Update environment assertions so they expect generic labels:

```js
expect(screen.queryByText(/Hyperion gamma/i)).not.toBeInTheDocument();
expect(screen.queryByText(/Sidewalk Operations/i)).not.toBeInTheDocument();
expect(screen.getByText(/Local/i)).toBeInTheDocument();
expect(screen.getByText(/Staging/i)).toBeInTheDocument();
expect(screen.getByText(/Production/i)).toBeInTheDocument();
```

- [ ] **Step 2: Run API page tests to verify failures**

Run:

```bash
npm test -- src/__tests__/pages/ApiTestPage.test.jsx
```

Expected: FAIL on missing API Key/Basic Auth and old environment labels.

- [ ] **Step 3: Wire generic environments and auth utility**

Modify `src/pages/ApiTestPage.jsx`:

```js
import { GENERIC_API_ENVIRONMENTS } from '../productConfig';
import { applyApiAuthentication } from '../utils/apiAuth';
```

Replace the current hardcoded `ENVIRONMENTS` array with:

```js
const ENVIRONMENTS = GENERIC_API_ENVIRONMENTS;
```

Add state:

```js
const [apiKeyAuth, setApiKeyAuth] = useState({ key: 'x-api-key', value: '', placement: 'header' });
const [showApiKeyValue, setShowApiKeyValue] = useState(false);
const [basicAuth, setBasicAuth] = useState({ username: '', password: '' });
const [showBasicPassword, setShowBasicPassword] = useState(false);
```

Update `handleAuthTypeChange`:

```js
if (newAuthType !== 'bearer') setBearerToken('');
if (newAuthType !== 'apiKey') setApiKeyAuth({ key: 'x-api-key', value: '', placement: 'header' });
if (newAuthType !== 'basic') setBasicAuth({ username: '', password: '' });
```

Replace manual Bearer mutation in `handleSendRequest` with:

```js
const requestToSend = applyApiAuthentication(selectedRequest, {
  type: authType,
  bearerToken,
  apiKey: apiKeyAuth,
  basic: basicAuth,
});
```

Do not log bearer token, API key value, basic password, access key, secret key, or session token.

- [ ] **Step 4: Add API Key and Basic Auth UI**

In the Authentication panel radio group, use labels:

```jsx
<FormControlLabel value="none" control={<Radio />} label={<Typography sx={{ color: 'white', fontSize: '0.9rem' }}>No Auth</Typography>} />
<FormControlLabel value="bearer" control={<Radio />} label={<Typography sx={{ color: 'white', fontSize: '0.9rem' }}>Bearer Token</Typography>} />
<FormControlLabel value="apiKey" control={<Radio />} label={<Typography sx={{ color: 'white', fontSize: '0.9rem' }}>API Key</Typography>} />
<FormControlLabel value="basic" control={<Radio />} label={<Typography sx={{ color: 'white', fontSize: '0.9rem' }}>Basic Auth</Typography>} />
<FormControlLabel value="aws" control={<Radio />} label={<Typography sx={{ color: 'white', fontSize: '0.9rem' }}>AWS SigV4</Typography>} disabled={isApiConfigsLoading || (!isApiConfigsLoading && apiConfigs.length === 0)} />
```

Add an API Key form with fields:

```jsx
<TextField label="Key Name" value={apiKeyAuth.key} onChange={(event) => setApiKeyAuth((prev) => ({ ...prev, key: event.target.value }))} />
<TextField label="Key Value" value={apiKeyAuth.value} type={showApiKeyValue ? 'text' : 'password'} onChange={(event) => setApiKeyAuth((prev) => ({ ...prev, value: event.target.value }))} />
<Select value={apiKeyAuth.placement} onChange={(event) => setApiKeyAuth((prev) => ({ ...prev, placement: event.target.value }))}>
  <MenuItem value="header">Header</MenuItem>
  <MenuItem value="query">Query Parameter</MenuItem>
</Select>
```

Add a Basic Auth form with fields:

```jsx
<TextField label="Username" value={basicAuth.username} onChange={(event) => setBasicAuth((prev) => ({ ...prev, username: event.target.value }))} />
<TextField label="Password" value={basicAuth.password} type={showBasicPassword ? 'text' : 'password'} onChange={(event) => setBasicAuth((prev) => ({ ...prev, password: event.target.value }))} />
```

Reuse existing dark `TextField` styling from the Bearer field so text remains legible.

- [ ] **Step 5: Run API tests**

Run:

```bash
npm test -- src/__tests__/utils/apiAuth.test.js src/__tests__/pages/ApiTestPage.test.jsx
```

Expected: PASS after adjusting outdated internal-environment assertions.

- [ ] **Step 6: Commit API auth/environments**

```bash
git add src/pages/ApiTestPage.jsx src/__tests__/pages/ApiTestPage.test.jsx src/utils/apiAuth.js src/__tests__/utils/apiAuth.test.js
git commit -m "feat(api): add external auth methods"
```

---

### Task 4: Backend Environment Rebasing

**Files:**
- Modify: `src-tauri/src/commands/api.rs`
- Modify: `src-tauri/src/reqprep.rs`
- Test: `src-tauri/src/commands/api.rs`
- Test: `src-tauri/src/reqprep.rs`

- [ ] **Step 1: Add failing Rust tests for generic rebasing**

In `src-tauri/src/reqprep.rs`, add:

```rust
#[test]
fn rebase_url_keeps_generic_path_when_no_known_paths() {
    let r = rebase_url(
        "https://old.example.com/v1/devices?id=1",
        "https://new.example.com",
        "",
        &[],
    );
    assert_eq!(r, "https://new.example.com/v1/devices?id=1");
}
```

In `src-tauri/src/commands/api.rs`, add or adjust tests so selected environments without `knownBasePaths` do not imply Sidewalk path stripping.

- [ ] **Step 2: Run Rust tests to verify current behavior**

Run:

```bash
cd src-tauri
cargo test reqprep::tests::rebase_url_keeps_generic_path_when_no_known_paths
```

Expected: PASS for pure `rebase_url`; add API command-level assertion if needed to expose current fallback to `KNOWN_ENV_BASE_PATHS`.

- [ ] **Step 3: Implement environment-provided known paths**

Modify imports in `src-tauri/src/commands/api.rs`:

```rust
use crate::reqprep::{rebase_url, remove_json_comments, substitute_body, substitute_url};
```

Add helper:

```rust
fn string_array_field(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(|x| x.as_array())
        .map(|arr| arr.iter().filter_map(|item| item.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default()
}
```

Change selected environment handling:

```rust
if let Some(env) = env {
    let base_url = str_field(env, "baseUrl").unwrap_or("");
    let base_path = str_field(env, "basePath").unwrap_or("");
    if !base_url.is_empty() {
        let known_base_path_values = string_array_field(env, "knownBasePaths");
        let known_base_paths: Vec<&str> = known_base_path_values.iter().map(String::as_str).collect();
        raw_url = rebase_url(&raw_url, base_url, base_path, &known_base_paths);
    }
}
```

Change AssumeRole session name:

```rust
aws::assume_role(&creds, role_arn, "QACompanion").await
```

- [ ] **Step 4: Run Rust tests**

Run:

```bash
cd src-tauri
cargo test
```

Expected: PASS.

- [ ] **Step 5: Commit backend environment changes**

```bash
git add src-tauri/src/commands/api.rs src-tauri/src/reqprep.rs
git commit -m "feat(api): support generic environment rebasing"
```

---

### Task 5: Home, Branding, Packaging, And Docs

**Files:**
- Replace: `src/pages/Home.jsx`
- Modify: `src/__tests__/pages/Home.test.jsx`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `README.md`

- [ ] **Step 1: Write/update failing external-safe Home test**

Update `src/__tests__/pages/Home.test.jsx`:

```js
it('renders external-safe product copy', async () => {
  render(<Home />);
  expect(screen.getByText(/QA Companion/i)).toBeInTheDocument();
  expect(screen.getByText(/Postman-compatible API client/i)).toBeInTheDocument();
  expect(screen.queryByText(/Sidewalk/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Ring/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Echo/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run Home tests to verify failures**

Run:

```bash
npm test -- src/__tests__/pages/Home.test.jsx
```

Expected: FAIL because current Home still shows internal Sidewalk content.

- [ ] **Step 3: Replace Home with external dashboard**

Replace `src/pages/Home.jsx` with a focused dashboard that imports `PRODUCT_NAME` and `package.json`, shows:

```txt
QA Companion
Postman-compatible API client for QA workflows with AWS SigV4 support.
Primary cards: API Client, API Settings, Nordic Flash, Silabs Flash.
Stats: 5 auth methods, Postman collections, Local execution.
```

Keep `requestTabChange` dispatch for cards using current tab indexes:

```js
const tabMapping = { api: 3, nordic: 1, silabs: 2 };
```

Do not include any external links unless they are public-safe; first pass can use no links.

- [ ] **Step 4: Update branding and package metadata**

Modify `package.json`:

```json
"name": "qa-companion",
"description": "A desktop API client and embedded QA utility for local test workflows.",
"build": {
  "appId": "com.qacompanion.desktop",
  "productName": "QA Companion"
}
```

Modify `package-lock.json` root names from `@amzn/sidewalk-qa-friends` to `qa-companion`.

Modify `src-tauri/tauri.conf.json`:

```json
"productName": "QA Companion",
"identifier": "com.qacompanion.desktop",
"title": "QA Companion",
"security": {
  "csp": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"
}
```

Modify `src-tauri/Cargo.toml`:

```toml
name = "qa-companion"
description = "QA Companion"
```

- [ ] **Step 5: Replace README with external-safe content**

Update README to describe:

- QA Companion
- API Client
- Auth methods: No Auth, Bearer Token, API Key, Basic Auth, AWS SigV4
- Nordic/Silabs flashing utilities
- Local-first desktop model
- Public build/test commands

Remove:

- corp drive links
- git.amazon clone command
- Amazon internal use license line
- Sidewalk/Ring/Echo/labcollab/phonetool references

- [ ] **Step 6: Run branding scans and frontend tests**

Run:

```bash
rg -n "Amazon|amzn|Sidewalk|Ring|Echo|labcollab|phonetool|drive\\.corp|git\\.amazon" README.md package.json package-lock.json src src-tauri/tauri.conf.json src-tauri/Cargo.toml
npm test -- src/__tests__/pages/Home.test.jsx src/__tests__/App.test.jsx
```

Expected: `rg` should return no external-facing source hits outside tests or internal-only Rust comments that are intentionally deferred. Tests should PASS.

- [ ] **Step 7: Commit branding/docs**

```bash
git add README.md package.json package-lock.json src/pages/Home.jsx src/__tests__/pages/Home.test.jsx src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "feat: externalize product shell"
```

---

### Task 6: Final Verification

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run focused JS tests**

```bash
npm test -- src/__tests__/productConfig.test.js src/__tests__/utils/apiAuth.test.js src/__tests__/App.test.jsx src/__tests__/pages/Home.test.jsx src/__tests__/pages/ApiTestPage.test.jsx
```

Expected: PASS.

- [ ] **Step 2: Run Rust tests**

```bash
cd src-tauri
cargo test
```

Expected: PASS.

- [ ] **Step 3: Run full build if time allows**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff and status**

```bash
git status --short
git log --oneline -5
```

Expected: clean worktree if all tasks committed; recent commits show the plan and implementation commits.
