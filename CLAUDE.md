# ResumeForge — Project Context

## What This Is
A vanilla JS SPA (no React, no bundler) that helps users build AI-enhanced resumes. Hash-based routing, ES modules served directly from `localhost:8080`. Gemini API for AI features.

Run with: `npx http-server -p 8080` from the `resume-forge/` directory.

## Architecture

### File Map
```
index.html              Entry point, loads CDN libs (pdf.js, html2canvas, jsPDF)
styles.css              All styles, CSS variables, print styles, responsive
js/
  app.js                Router, AppState class, navbar, API key modal
  gemini.js             Gemini API wrapper (model: gemini-3.1-flash-lite-preview)
  ai-engine.js          AI-powered resume enhancement (Gemini + deterministic fallbacks)
  analyzer.js           Job fit analysis, industry detection, culture analysis
  parser.js             PDF text extraction + resume parsing (Gemini-first, regex fallback)
  constants.js          All data: WINNING_BULLETS, ROLE_MAP, SEMANTIC_PIVOTS, HR_TIPS, etc.
  pattern-matcher.js    Matches user bullets to WINNING_BULLETS patterns (no circular deps)
  linter.js             Impact linter for bullet quality checking
  export.js             PDF/Word/HTML/Print export functions
  progress.js           Named task progress bar + dropdown pill UI
  pages/
    home.js             Landing page
    import.js           Resume upload/parse. Saves original snapshot on import.
    target-job.js       Job description analysis, fit scoring, gap bridging
    editor.js           5-tab editor with AI advisor, ghost mode, linting
    templates.js        Template selection (6 templates)
    preview.js          Resume preview, ghost comparison slider, recruiter ghost, exports
```

### Routing
Hash-based: `#home`, `#import`, `#target-job`, `#editor`, `#templates`, `#preview`. Router in `app.js` dispatches to `PAGE_RENDERERS[page](container, appState)`.

### State Management
`AppState` class in `app.js` with observer pattern. Key behavior:
- `updateData()` calls `_saveOnly()` — does NOT trigger re-render. Pages manage their own DOM.
- `setPage()` sets `window.location.hash` which triggers `hashchange` → `navigate()` → `renderApp()`.
- `notify()` triggers full re-render. Only use for state changes that need global UI update.
- Debounced save to localStorage (800ms).

### Page State Persistence
Pages use module-level cache objects (e.g., `_editorCache`, `_localCache`) to persist local UI state across re-renders triggered by navigation. These survive `renderApp()` calls but not page refreshes.

## Data Shapes — Critical Gotchas

### tailorResume() returns nested objects, not strings
```js
{
  summary: "string",
  experiences: [{
    expIdx: 0, title: "...", company: "...",
    bullets: [{ original: "old", rewritten: "new", changed: true }]  // NOT strings
  }],
  changeCount: 5, roleName: "...", companyName: "..."
}
```
Anywhere that consumes bullets from tailorResume must handle the `{ original, rewritten, changed }` shape.

### ROLE_MAP values are arrays
```js
ROLE_MAP = { "project manager": ["Operations", "Consulting"], ... }
```
NOT `{ keywords, industries }` objects. Iterate with `for (const [role, industries] of Object.entries(ROLE_MAP))`.

### SEMANTIC_PIVOTS is an object, not an array
```js
SEMANTIC_PIVOTS = { "frontend-frameworks": ["react", "vue", ...], ... }
```
Iterate with `Object.entries()`, not `for...of`.

### extractJDInfo() is synchronous
Returns a plain object, not a Promise. Wrap in `Promise.resolve()` if you need `.then()`/`.finally()`.

### detectIndustries() takes experiences array, not full data object
Call as `detectIndustries(data.experiences)`, not `detectIndustries(data)`.

### calculateRoleVelocity() takes experiences array
Call as `calculateRoleVelocity(data.experiences)`, not `calculateRoleVelocity(data)`.

### extractMetrics() takes a string
Not an object. Pass `summary + bullets.join(' ')`, not a data object.

### findPivot() signature: (targetSkill, userSkills, userExperiences)
`targetSkill` must be a string. Has `typeof !== 'string'` guard that returns null.

## Gemini API
- Model: `gemini-3.1-flash-lite-preview`
- Endpoint: `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- API key stored in localStorage as `resume_forge_gemini_key`
- .env file at `/Users/jamee/claude-code/.env` has `GEMINI_KEY=...`
- 30s timeout, 1 retry
- For JSON responses, set `responseFormat: 'json'` which adds `responseMimeType: 'application/json'` to the request.

### Response Caching
- Cached in `sessionStorage` (survives page refresh, clears on tab close)
- Keyed by prompt hash (first 200 chars + length + last 100 chars)
- Max 20 entries. On quota exceeded, evicts half the cache and retries.
- Cache index tracked in `sessionStorage` under `gemini_cache_index`
- All cache entries prefixed with `gemini_cache_`
- Pass `skipCache: true` in options to bypass cache (used by Refresh buttons)
- `clearGeminiCache()` exported from gemini.js — called by "Start Over" in `clearAll()`
- All wrapper functions (`enhanceBulletWithGemini`, `generateSummaryWithGemini`, etc.) accept and pass through `{ skipCache }`

### WINNING_BULLETS Pattern Matching
- `pattern-matcher.js` exports `findMatchingPatterns(bullet, industries)`, `extractBulletMetrics(text)`, `tryFillPattern(pattern, metrics)`
- Gemini bullet enhancement prompts include top 2-3 matching industry patterns as few-shot examples
- Deterministic fallback tries to fill patterns with real user metrics (only if score > 0.2 and all placeholders fillable)
- Never fabricate metrics — `tryFillPattern` returns null if any placeholder remains

## Progress Bar
`showProgress(label)` / `hideProgress(label)` in `progress.js`. Uses named tasks, not a counter.
- Shows a pill in the nav bar with task count + dropdown
- Tasks stay visible until all complete, then clear after 2 seconds
- Labels must match between show/hide calls

## Original Snapshot System
On resume import, a deep copy is saved to localStorage (`multiverse_resume_original`) via `saveOriginalSnapshot()` in app.js. The preview page's ghost comparison uses this: left side = original import, right side = current state. No API calls needed for comparison. Cleared by "Start Over".

## Ghost Mode (Editor)
- Toggle in editor header calls `tailorResume(data, jobContext)` which returns `{ experiences: [{ bullets: [{ original, rewritten, changed }] }] }`
- Shows strikethrough original text above AI rewrite per bullet
- "Ghost Rewrites (N bullets)" header per experience
- "Accept All Rewrites" button applies all changed bullets at once
- Individual Accept/Dismiss per bullet

## Ghost Comparison (Preview)
- Slider reveals original (left) vs current (right) with clip-based overlay
- Ghost layer: `position: absolute`, `width: sliderPos%`, `overflow: hidden`, opaque gradient background
- Inner content fixed at `width: 800px` to prevent text reflow
- Container capped at `maxWidth: 800px` so both layers wrap identically
- "AI MULTIVERSE · N changes" badge counts differences
- Uses original snapshot from localStorage — no API calls

## Recruiter Ghost (Preview)
- Floating panel bottom-right showing unquantified bullet count + rotating HR tips
- Minimizable with X button → collapses to small avatar circle
- `no-print` class hides it from print/PDF

## Lessons Learned — Do NOT Repeat

1. **Never use dynamic `await import()` in the browser** — caused the progress bar to hang forever. Use static imports only.
2. **Never call `notify()` or trigger re-render from `_scheduleSave()`** — caused infinite re-render loops that crashed the browser.
3. **Linter regex: always use `rule.rx`** — the GRAMMAR_RULES entries have `rx` property (RegExp), not `pattern` or `word`. Using `new RegExp(undefined)` creates `/(?:)/gi` which matches every character → OOM crash. Always add safety cap on issue count (50 max).
4. **CSS animations must be gated** — `.progress-top-bar` animation was `infinite` even without `.active` class. Gate with `.progress-top.active .progress-top-bar { animation: ... }`.
5. **Print CSS: use `#resume-document` (id), not `.resume-document` (class)** — The resume element uses `id="resume-document"`. Use visibility-based hiding for deeply nested elements.
6. **Don't fabricate metrics in AI rewrites** — WINNING_BULLETS patterns have `[X]`, `[Y]` placeholders. Only fill with real user data. `tryFillPattern()` returns null if any placeholder can't be filled.
7. **Circular imports** — `progress.js` was extracted from `app.js` to break circular deps. `pattern-matcher.js` only imports from `constants.js` for the same reason.

## Testing
- `test-integration.mjs` — Node.js integration tests (56 tests) for function signatures and data shapes
- `test-e2e.mjs` — Playwright E2E tests (40 tests) covering all pages and user flows
- Run: `node test-integration.mjs` and `npx playwright test test-e2e.mjs`

## Templates
6 templates in `TEMPLATES` constant: `faang`, `mbb`, `finance`, `executive`, `startup`, `product`. Each has `name`, `accent` (color), `font`, `headerStyle`, `layout` properties. Note: `accent` not `accentColor`, `font` not `fontFamily`.
