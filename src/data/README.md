# State data — update workflow

The state firearm-law seed dataset lives in `states.ts` plus per-state
official-source URLs in `officialSources.ts`. This file documents how
to update an entry when laws change, and how staleness is tracked.

## When to update

Update a state's entry when:

- A statute is amended (e.g. duty-to-inform rule changes)
- A court decision changes effective recognition (e.g. *Bruen* aftermath)
- An AG opinion clarifies a previously-uncertain question
- The state's official source URL changes (rebrand, site redesign)
- The CI stale-data check flags it (over 18 months since last review)

## How to update an entry

1. Open `states.ts`, find the state's entry (alphabetical by USPS).
2. Read the official source page linked from `officialSources.ts`. If
   the URL is broken, find the new authoritative page and update
   `officialSources.ts` first.
3. Update the relevant fields:
   - `policy` — `'broad' | 'limited' | 'restrictive'`
   - `dutyToInform` — `'no_duty' | 'must_inform' | 'inform_if_asked' | 'manual_review'`
   - `magazineLimit` — capacity, or omit if no limit
   - `hasAssaultWeaponBan`, `hasSpecialTransportRules` — boolean flags
   - `suppressorRiskNote`, `nfaRiskNote` — free-text notes
   - `ammunitionRestrictions` — array of `{detail, level}` pairs
   - `notes` — bullet points shown in the State Analysis card
4. Set the provenance fields:

```ts
TX: {
  // ...all the rule fields above...
  lastVerified: '2026-04-15', // today's ISO date
  confidence: 'high',          // 'high' if you read the official source directly
  source: {
    url: 'https://www.dps.texas.gov/section/handgun-licensing',
    type: 'official',           // 'official' | 'secondary'
    label: 'TX DPS',            // short, recognizable
    quotedText: '...',          // optional; the key sentence you relied on
  },
}
```

5. Run `npm test` and `npm run check-data` to confirm nothing broke.
6. Commit with a descriptive message: `Update FL duty-to-inform per HB-XXXX`.
   Push. Cloudflare Pages auto-deploys.

## Why `confidence: 'high'` matters

Entries with `confidence: 'high'` show "Verified [date]" in the UI;
everything else shows "Compiled summary · verify at [official source]."
Setting `'high'` is your assertion that *you* personally verified this
entry. Don't set it without doing the work.

## Staleness tracking

The CI script `scripts/check-stale-data.mjs` runs as part of the build
pipeline. It reads every state entry's `lastVerified` (or falls back
to `DEFAULT_VERIFIED` if the entry doesn't have one), and:

- **<12 months ago** → fresh, no action needed
- **12–17 months ago** → warning printed in CI logs, build still passes
- **≥18 months ago** → build fails, must update before merging

Run locally with `npm run check-data`. Run in warn-only mode with
`npm run check-data:warn` (won't fail the build).

## What automation cannot do

State firearm law cannot be reliably scraped automatically:

- State websites have inconsistent structures
- Statutory text needs interpretation (a sentence in the code is not
  always a clean `'must_inform' | 'no_duty'` mapping)
- The cost of a wrong automated update is severe (the app
  confidently misleads users)

The right "automation" is being subscribed to a 2A legal newsletter
or a state-specific firearms-law tracker. When you see something
relevant, run the manual workflow above.

## Suggested cadence

- Quarterly: spot-check 5 states (rotate through the list over a year)
- Annually: full re-verification sweep
- Ad-hoc: when *Bruen*-style major decisions land

The CI staleness check is the safety net, not the schedule.
