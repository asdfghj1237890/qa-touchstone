# Security Testing Workflow

This is the end-to-end journey for QA Touchstone's core feature: proving your
API enforces authorization correctly. The desktop UI packs the whole flow onto
one page (`src/qa/Security.tsx`); the headless CLI (`qa-touchstone-ci scan`)
runs the same engines from a config file. This doc is the map of that journey —
the same concepts apply to both surfaces.

## Mental model

You are checking one thing: **does the API allow exactly who it should, and deny
everyone else?** Everything below is in service of that. The unit of truth is an
**expectation** — "identity X should be *allowed* / *denied* on endpoint Y" — and
a finding is raised when the live API disagrees with an expectation.

## The seven steps

### 1. Define environments and identities

- **Environment** = a base URL + variables (`local` / `staging` / `production` /
  custom). Everything resolves `{{baseUrl}}`-style variables against the active
  environment.
- **Identity** = an auth context: `none` (anonymous), `bearer`, `apiKey`,
  `basic`, `oauth2`, or `awsSigV4`. Identities are the rows of the matrix — the
  "who". A realistic suite has at least `anon` + one privileged identity.

Secrets never live in the config: desktop stores them in the OS keychain, CLI
reads them from env as `{ "env": "API_TOKEN" }`.

### 2. Add endpoints (saved requests)

Endpoints are saved requests (method + URL + headers + body + assertions). Add
the ones whose authorization you care about — especially anything `privileged`
(admin, cross-tenant, destructive).

### 3. Mark expectations

For each **identity × endpoint** cell, mark the expected outcome: `allow` or
`deny`. This is the oracle — the matrix has nothing to check against until you
say what "correct" is. A configurable **deny-status set** (401/403/404…) defines
what counts as a deny at the HTTP layer.

The matrix oracle is **body-aware**: a `200` that denies in-band
(`{"error":"Access denied"}`) is classified as *denied*, not a false vuln — so
soft-deny APIs don't light up the whole matrix red.

### 4. Run the engines

Run engines individually, or **Run full security suite** to execute them as one
recorded run. Six engines (see [capability-matrix.md](capability-matrix.md)):

| Engine          | Answers                                                      |
| --------------- | ----------------------------------------------------------- |
| **matrix**      | Does each identity get allow/deny as expected? (RBAC)       |
| **conformance** | Do 2xx responses match the declared JSON Schema / OpenAPI?  |
| **bfla**        | Can a non-privileged identity hit a privileged *function*?  |
| **bola**        | Can identity A read/act on identity B's *objects* (IDOR)?   |
| **fuzz**        | Do mutated inputs cause 5xx, stack-trace leaks, or reflection? |
| **ratelimit**   | Is abuse throttled? Graded none / weak / strong.            |

All six run in the **desktop** suite. In **CI** (`scan`), five run —
**conformance is desktop-only** (no Rust port yet), so a CI scan won't flag
schema-conformance issues. See [capability-matrix.md](capability-matrix.md).

**Order matters:** the suite runs **rate-limit last**, so its request bursts
don't skew the matrix and BOLA results. BOLA uses a negative control scored by
an independent structural oracle to suppress false positives (an id echo only
counts at an identity-like key).

### 5. Triage findings

Every finding enters a lifecycle (`src/qa/findings.ts`):

- **Suppress** a false positive (it stops gating but stays visible).
- **Override severity** when your context differs from the default.
- **Assign** owner / status / note.

Optional **AI triage** (`src/qa/triage.ts`) condenses a whole run into a
prioritized, categorized shortlist — advisory only; it never alters findings.

A finding's fingerprint survives rule renames (canonical-id alias registry), and
a separate detail hash surfaces evidence drift without destabilizing the diff.

### 6. Pin a baseline and diff

Pin the current run as a **baseline**. Later runs diff against it and label each
finding **new / carried / resolved**, plus a **new-high/critical** counter. This
is what turns "a wall of findings" into "what changed since we last looked" — the
signal a CI gate acts on.

### 7. Export CI artifacts

Export a completed run as **JSON**, **HTML** (executive report), **JUnit XML**
(CI test checks), or **SARIF** (GitHub code scanning; rules carry CWE/OWASP tags,
`helpUri`, and a `security-severity` score).

Three **redaction levels** control what leaves the machine:

| Level      | What ships                                                        |
| ---------- | ----------------------------------------------------------------- |
| `strict`   | No evidence at all                                                |
| `redacted` | A short masked value per finding                                  |
| `evidence` | Structure-preserving, mask-by-default request/response summary — every leaf type-tokenized except the finding itself |

Evidence is generated on demand and only persisted into a saved run on explicit
opt-in. Run records otherwise store only a compact redacted snapshot; raw
request/response bodies are never persisted.

## Same flow in CI (`qa-touchstone-ci scan`)

The config file encodes steps 1–3 (see README "Headless CI Runner" for the full
schema):

```json
{
  "environments": [{ "name": "staging", "variables": { "baseUrl": "https://api.example.com" } }],
  "identities": [
    { "id": "anon", "auth": { "type": "none" } },
    { "id": "api", "auth": { "type": "bearer", "token": { "env": "API_TOKEN" } } }
  ],
  "requests": [{ "id": "admin-users", "method": "GET", "url": "{{baseUrl}}/admin/users", "privileged": true }],
  "security": {
    "matrix": {
      "endpoints": ["admin-users"],
      "expect": { "admin-users": { "anon": "deny", "api": "allow" } }
    }
  }
}
```

```bash
API_TOKEN="$API_TOKEN" qa-touchstone-ci scan \
  --config qa.json --env staging \
  --out reports/security.json --html reports/security.html \
  --junit reports/security-junit.xml --sarif reports/security.sarif \
  --fail-on high
```

- Adopt the current run as baseline: add `--baseline .qa/security-baseline.json
  --update-baseline`. Later scans gate on **new** findings only.
- **Exit codes:** `0` pass · `1` runtime/network error · `2` invalid input ·
  `3` findings at/above `--fail-on` · `4` assertion/perf failure.

## Gotchas

- No expectations marked → the matrix has nothing to grade. Always set step 3.
- Rate-limit bursts are real traffic — they fire behind a confirm gate in the UI
  and are ordered last in the suite. Don't point them at production carelessly.
- `evidence` redaction is the only level that can carry PII-shaped data, and even
  then it's mask-by-default. Match the level to your artifact's destination.
