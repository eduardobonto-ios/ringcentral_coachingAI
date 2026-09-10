# Coaching Admin — web app

React 18 + TypeScript + Vite. The admin surface where the company reviews every call
that was scored and every coaching email that went to an agent.

```bash
npm install
npm run dev      # http://localhost:5173
```

Vite proxies `/api` and `/audio` to the coaching API on `http://localhost:8787`
(see `vite.config.ts`), so start the server first or the app shows a connection error.

```bash
npm run build      # dist/
npm run typecheck
```

## Files

| File | |
|---|---|
| `src/main.tsx` | mounts the app |
| `src/App.tsx` | layout, stat row, call list, upload button, state |
| `src/components/CallDetail.tsx` | the three tabs — coaching, transcript, sent email |
| `src/api.ts` | typed API client, formatters, demo mode |
| `src/styles.css` | design tokens and every component style, light + dark |
| `vite.config.ts` | dev server and the API proxy |

## How it's put together

**One fetch per screen, no state library.** `App` loads `/api/calls` and `/api/rubric`
once, then `/api/calls/:id` whenever the selection changes. At this volume that is
faster than any cache would be and there is nothing to invalidate.

**The audio element is the spine of the detail view.** Every timestamp — in the
transcript and beside each evidence quote — is a button that seeks the same `<audio>`
ref. That is the feature the whole dashboard exists for: when an agent disputes a
score, you click the quote and hear the moment.

**Types mirror the API rows, not a domain model.** `CallSummary` is literally the
shape of the SQL join, `snake_case` and all. One less translation layer to keep in
sync while the schema is still moving.

**Demo mode.** If the page is served with a `window.__SEED__` payload baked in,
`api.ts` reads from that instead of calling the server — same components, no backend.
That is how the read-only preview build works (`scripts/build-preview.mjs` in the
parent repo). `isDemo` disables the upload button.

**Theming.** All colour lives in CSS custom properties on `:root`, redefined once
under `prefers-color-scheme: dark`. No component hardcodes a colour, so the app
follows the viewer's OS theme with no toggle to maintain.

## Not built yet

- **Auth.** No sign-in; anyone who reaches the port sees every call. Entra ID via
  Auth.js is the intended route, and agents must only see their own calls.
- **Manager override.** The rubric scores are read-only here. Letting a supervisor
  correct a score and add a note is what produces the data to improve the rubric.
- **Agent scorecard.** `/api/agents/:id/summary` returns the 8-week per-dimension
  averages already; nothing renders them yet.
- **Pagination.** The call list loads everything. Fine at a few hundred, not at ten thousand.
