# Security Page UI Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Security page's UI rough edges (broken active-tab color, double header, mode-toggle wrapping, per-row privileged-toggle noise, grid overflow, clipped dropdown) with a light visual lift, keeping the existing theme.

**Architecture:** One small JSX restructure in `src/qa/Security.jsx` (the mode toggle becomes a top tab-bar row; the matrix's header moves into the matrix branch so each mode has exactly one header), plus presentational changes in `src/qa/qa.css`. No engine/behavior changes except the privileged toggle's off-state becoming hover-reveal.

**Tech Stack:** React, CSS (custom-property theme tokens), Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-03-security-ui-polish-design.md`

---

## File Structure

- **Modify** `src/qa/Security.jsx` — page header → `.qa-sec-tabs` row only; move matrix title+subtitle+run button into the matrix branch.
- **Modify** `src/__tests__/security-page.test.jsx` — assert one header per mode (no double header in BOLA mode).
- **Modify** `src/qa/qa.css` — tab-bar restyle (fixes the active-color bug + wrapping), privileged-toggle hover-reveal, sticky endpoint column, add-test dropdown min-width.

Test command: `npx vitest run <file>`. Build: `npm run build`.

---

## Task 1: Security.jsx — tab-bar row + one header per mode

**Files:**
- Modify: `src/qa/Security.jsx:226-247`
- Test: `src/__tests__/security-page.test.jsx`

- [ ] **Step 1: Write the failing test**

Add to the existing describe in `src/__tests__/security-page.test.jsx`:

```js
  it('renders exactly one header per mode (no double header in BOLA mode)', async () => {
    renderPage();
    // Matrix mode: one .qa-sec-head.
    expect(document.querySelectorAll('.qa-sec-head').length).toBe(1);
    // Switch to BOLA — still exactly one header (the panel's), not the matrix's too.
    fireEvent.click(screen.getByRole('button', { name: /Object access/i }));
    await waitFor(() => expect(document.querySelector('.qa-bola')).not.toBeNull());
    expect(document.querySelectorAll('.qa-sec-head').length).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: FAIL — in BOLA mode there are currently TWO `.qa-sec-head` (the always-rendered page header + `BolaPanel`'s own), so the count is 2.

- [ ] **Step 3: Restructure the JSX**

In `src/qa/Security.jsx`, replace the page header block (lines 226-247, from `<div className="qa-sec-head">` through the `<>` that opens the matrix branch) with this — the toggle becomes a `.qa-sec-tabs` row, and the matrix header moves inside the matrix branch:

```jsx
      <div className="qa-sec-tabs">
        <button className={`qa-seg ${mode === 'matrix' ? 'qa-seg--on' : ''}`} onClick={() => setMode('matrix')}>{t('security.mode.matrix')}</button>
        <button className={`qa-seg ${mode === 'bola' ? 'qa-seg--on' : ''}`} onClick={() => setMode('bola')}>{t('security.mode.bola')}</button>
        <button className={`qa-seg ${mode === 'ratelimit' ? 'qa-seg--on' : ''}`} onClick={() => setMode('ratelimit')}>{t('security.mode.ratelimit')}</button>
      </div>

      {mode === 'bola' ? (
        <BolaPanel identities={identities} bola={bola} setBola={setBola}
                   env={env} vars={vars} cookies={cookies} sslVerify={sslVerify} />
      ) : mode === 'ratelimit' ? (
        <RateLimitPanel identities={identities} rateLimit={rateLimit} setRateLimit={setRateLimit}
                        env={env} vars={vars} cookies={cookies} sslVerify={sslVerify} />
      ) : (
      <>
      <div className="qa-sec-head">
        <div><h2>{t('security.title')}</h2><p>{t('security.subtitle')}</p></div>
        <div className="qa-sec-actions">
          {running
            ? <button className="qa-btn qa-btn--danger" onClick={stop}><Icon name="stop" size={14} /> {t('security.stop')}</button>
            : <button className="qa-btn qa-btn--primary" onClick={() => run()} disabled={!endpoints.length}><Icon name="play" size={14} /> {t('security.runAll')}</button>}
        </div>
      </div>
```

(The `mode === 'matrix' &&` guard on the run button is dropped — it's now inside the matrix branch, so it's always matrix. The rest of the matrix body — `.qa-sec-summary` onward — is unchanged and still inside the same `<>…</>`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: PASS — matrix mode has one `.qa-sec-head` (now inside the branch); BOLA mode has one (the panel's); the page level is a `.qa-sec-tabs` row, not a header. All pre-existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/qa/Security.jsx src/__tests__/security-page.test.jsx
git commit -m "refactor(security): tab-bar row + one header per mode (fix double header)"
```

---

## Task 2: qa.css — tab color fix, hover-reveal priv toggle, sticky column, dropdown width

**Files:**
- Modify: `src/qa/qa.css:1231-1233` (toggle), `:1276-1277` (priv off-state); append sticky-column + dropdown rules.

- [ ] **Step 1: Fix the tab bar (active-color bug + wrapping)**

Replace lines 1231-1233 in `src/qa/qa.css`:

```css
  .qa-sec-modetoggle { display: inline-flex; gap: 2px; background: var(--surface-2, rgba(127,127,127,.1)); border-radius: 8px; padding: 2px; }
  .qa-seg { border: 0; background: transparent; color: var(--text-dim); font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 6px; cursor: pointer; }
  .qa-seg--on { background: var(--surface, #fff); color: var(--text); }
```

with (renames the container to `.qa-sec-tabs`, fixes the broken `--surface`/`#fff` tokens, sets the chosen accent-soft active color, adds nowrap + hover):

```css
  .qa-sec-tabs { display: inline-flex; gap: 2px; margin-bottom: 14px; background: var(--bg-1); border: 1px solid var(--border); border-radius: 8px; padding: 2px; }
  .qa-seg { border: 1px solid transparent; background: transparent; color: var(--text-dim); font-size: 12px; font-weight: 600; white-space: nowrap; padding: 5px 12px; border-radius: 6px; cursor: pointer; transition: color .12s, background .12s; }
  .qa-seg:hover { color: var(--text); }
  .qa-seg--on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-line); }
```

- [ ] **Step 2: Hover-reveal the privileged off-state**

Replace lines 1276-1277 in `src/qa/qa.css`:

```css
  .qa-sec-priv--off { background: transparent; color: var(--text-dim); border-color: var(--border); opacity: .55; font-weight: 600; }
  .qa-sec-priv--off:hover { opacity: 1; }
```

with (off-state hidden until the row is hovered or the control is keyboard-focused):

```css
  .qa-sec-priv--off { background: transparent; color: var(--text-dim); border-color: var(--border); opacity: 0; font-weight: 600; transition: opacity .12s; }
  .qa-sec-grid tbody tr:hover .qa-sec-priv--off, .qa-sec-priv--off:focus-visible { opacity: .6; }
  .qa-sec-priv--off:hover { opacity: 1; }
```

- [ ] **Step 3: Sticky endpoint column + add-test dropdown width**

Append to the end of `src/qa/qa.css` (the `.qa-sec-corner`/`.qa-sec-rowhead` already set `background: var(--bg-1)` on the row header; these add sticky positioning so the endpoint column stays put while identity columns scroll, and widen the panels' add-test selects so the placeholder isn't clipped):

```css
  /* ── Security page polish: sticky endpoint column + add-test dropdown ────── */
  .qa-sec-corner { position: sticky; left: 0; z-index: 3; background: var(--bg-1); }
  .qa-sec-rowhead { position: sticky; left: 0; z-index: 1; }
  .qa-sec-toolbar select.qa-inp { min-width: 220px; }
```

- [ ] **Step 4: Verify build + tests**

Run: `npm run build`
Expected: clean build.
Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: PASS (CSS-only + the Task 1 restructure; selectors unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/qa/qa.css
git commit -m "style(security): accent-soft active tab, hover-reveal priv toggle, sticky endpoint column"
```

---

## Task 3: Full verification + visual proof

**Files:** none (verification only)

- [ ] **Step 1: Full suite + build**

Run: `npx vitest run`
Expected: all suites PASS.
Run: `npm run build`
Expected: clean.

- [ ] **Step 2: Visual check on the live dev server**

The dev server runs on port 3000 (`qa-dev`). Reload it and capture screenshots of all three Security modes, confirming:
- the active tab is the accent-soft tint (readable, not white-on-white);
- BOLA / rate-limit modes show a single header (no stacked `安全矩陣` + panel header);
- the tab labels don't wrap;
- the "標高權" off-state is hidden until a matrix row is hovered;
- the endpoint column stays put while identity columns scroll;
- the BOLA/rate-limit add-test dropdown shows its full placeholder.

- [ ] **Step 3: Final status**

```bash
git status   # clean
git log --oneline master..HEAD | cat
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** active-tab color fix → accent-soft (T2 step 1) ✓ · double header (T1) ✓ · toggle wrapping/nowrap (T2 step 1) ✓ · priv toggle hover-reveal (T2 step 2) ✓ · grid overflow / sticky column (T2 step 3) ✓ · dropdown clipping (T2 step 3) ✓ · spacing (tabs margin, T2 step 1) ✓. Chip consistency from the spec is a "verify, adjust only if inconsistent" item — the existing chips already share radius/size, so no forced change (YAGNI).
- **Selector preservation:** `.qa-seg`/`.qa-seg--on` class names are kept (only the container renamed `.qa-sec-modetoggle`→`.qa-sec-tabs`, which is not referenced by any test). `.qa-bola`, `.qa-rl`, `.qa-sec-priv--on/--off`, `.qa-sec-cell`, verdict classes, and the role/name queries (`/Run all/i`, `/Object access/i`, `/Rate limit/i`) are unchanged.
- **One behavior change:** the privileged off-state is now hover-reveal (CSS only; the element and its onClick are unchanged, so `security-page.test.jsx`'s `.qa-sec-priv--on` assertion — which targets the ON state — is unaffected).
- **Risk:** sticky-column z-index vs the cell hover rule (`tr:hover > th/td { background: var(--bg-2) !important }`) — the row header keeps a background on hover, so no see-through. Corner uses `z-index:3` + its own `--bg-1` background.
