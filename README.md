# Interstate Firearm Travel Planner

> The GPS for Gun Law. Travel in peace, carry your piece.

A web app that helps lawful gun owners assess legal posture for interstate
firearm transport under federal § 926A and state-specific frameworks.
Plan your route, see which states recognize your permit, get warnings for
strict-state crossings, and find refueling stops chosen with state law in
mind.

**Live site:** [gunnav.com](https://gunnav.com)

> ⚠ **Informational only. Not legal advice.** No guarantee of compliance,
> reciprocity, or personal safety. Federal and state firearms laws change;
> verify with current official sources before travel.

<!-- Screenshot placeholder — replace with a real screenshot of the app
     showing a multi-state route. Recommended size: 1600 x 900 or so.
     Save it as docs/screenshot.png and uncomment the image below. -->
<!-- ![Screenshot of the route planner](docs/screenshot.png) -->

---

## What it does

- **Route planning** — enter origin, destination, and any stops; the app
  routes through them and reports every state crossed.
- **Permit reciprocity** — for each state on the route, shows whether
  your reported carry permit appears to be recognized, with limitations,
  or not at all.
- **Destination carry warning** — a prominent banner if the destination
  state's recognition of your permit is uncertain or absent and you're
  transporting a firearm.
- **FOPA (§ 926A) analysis** — checks the federal safe-passage conditions
  against your trip details and flags what's required.
- **Duty to inform** — groups states by duty-to-inform tier (must inform,
  inform if asked, no duty, manual review) with direct links to each
  state's official firearms-licensing page.
- **Refueling stops** — Mapbox-sourced gas / gas+food stops along the
  route, ranked by detour cost and brand recognition. With MPG and tank
  size set, the app auto-adds top-off stops before strict states and
  suggests routine fill-ups.
- **Turn-by-turn directions** — full step list for the trip, with
  inline fuel-stop markers between maneuvers.
- **Export** — open the planned route in Google Maps, Apple Maps, or
  Waze. Multi-stop routes carry into Google and Apple; Waze is hidden
  for multi-stop because the URL scheme can't carry waypoints.
- **Share links** — every trip encodes into a URL hash you can send to
  someone else; no server, no account.

Everything runs client-side or in stateless Cloudflare Pages Functions.
There is no backend, no database, no user accounts, and no analytics
attached to your trip data. Recent trips are stored in your browser's
`localStorage`; clearing site data removes them.

---

## For developers

### Stack

- **Frontend**: React 18 + TypeScript (strict), Vite for build
- **Map**: Mapbox GL JS, lazy-loaded (~500 KB gzipped chunk)
- **Server-side**: Cloudflare Pages Functions in `functions/api/` —
  proxy Mapbox APIs to keep the secret token server-side
- **State data**: hardcoded in `src/data/states.ts`, plus a TopoJSON of
  US state polygons in `public/us-states-10m.json`
- **Persistence**: `localStorage` via the typed wrapper in
  `src/services/storage.ts`
- **Tests**: Vitest

### Local setup

You'll need [Node.js 20+](https://nodejs.org) and a free Mapbox account.

```bash
# Install dependencies
npm install

# Set the Mapbox public token for the browser-side map.
# Get one at https://account.mapbox.com/access-tokens/
echo 'VITE_MAPBOX_PUBLIC_TOKEN=pk.your_public_token_here' > .env.local

# Set the Mapbox secret token for the Pages Functions.
# This must be a separate scoped token (different from the public one).
# For local Wrangler dev, put it in .dev.vars:
echo 'MAPBOX_TOKEN=sk.your_secret_token_here' > .dev.vars

# Run the dev server (Vite + Pages Functions via Wrangler)
npm run dev
```

In production, set `MAPBOX_TOKEN` as an environment variable in the
Cloudflare Pages dashboard (Settings → Environment Variables). Never
commit either token to the repo.

### Useful commands

```bash
npm test                                       # run the Vitest suite
npm run build                                  # production build
npx tsc --project functions/tsconfig.json      # typecheck Pages Functions
npm run check-data                             # CI staleness check on state data
```

### Project layout

```
functions/api/
├── directions.ts     Mapbox Directions proxy; samples points and reverse-geocodes states
├── geocode.ts        Mapbox Geocoding proxy with autocomplete
└── stops.ts          Mapbox Tilequery proxy for gas/food POIs along the route

src/
├── App.tsx           Top-level state owner; wires the evaluation pipeline together
├── components/       UI components
├── data/
│   ├── states.ts            STATE_DEFS — the seed dataset (51 entries: 50 states + DC)
│   ├── officialSources.ts   Per-state authoritative URLs for the "verify at" links
│   └── README.md            How to update state data (review when changing data)
├── rules/            Pure evaluators (testable, no React)
├── services/         Stateful or side-effecting modules
├── tests/            Vitest suites (rule modules only — no UI testing)
├── types/domain.ts   ALL domain types live here. Single source of truth.
└── utils/            Format helpers, checklists
```

### Conventions

This project ships with strong conventions about uncertainty, language,
and architecture. Key principles:

- **Pure rule modules, no React imports.** Every legal evaluator is a
  pure function in `src/rules/`, tested in isolation.
- **Domain types in `src/types/domain.ts` are the source of truth.**
  Don't define equivalent shapes elsewhere.
- **"Manual review required" for anything uncertain.** Never default
  uncertain cases to permissive.
- **Hedged language** — use "may potentially qualify," "appears
  recognized," not "safe" or "compliant." This is a legal-adjacent tool
  with consequences for being wrong.

See the per-state data update workflow in `src/data/README.md`.

---

## Link health

`scripts/check-sources.mjs` (run as `npm run check-sources`) verifies that
every URL in `officialSources.ts` still loads. It reports broken links and
silent redirects, but cannot detect URLs that resolve to a stale or wrong
page after a site redesign — for that, the 18-month review cadence above
is the only safeguard.

---

## License

All rights reserved. See [LICENSE](LICENSE).

This source is published for reference and review. No license is
granted to use, fork, modify, or redistribute the code. If you have a
licensing question, contact the copyright holder.
