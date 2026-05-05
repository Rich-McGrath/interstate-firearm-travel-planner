#!/usr/bin/env node
// Stale-data check. Reads the state seed dataset, computes how recently
// each entry was verified, and warns / fails depending on age.
//
// Run as part of CI to catch silent decay: if a state hasn't been
// reviewed in over 18 months, the build fails. Forces a deliberate
// "yes I have re-checked this" cadence so the dataset doesn't quietly
// rot.
//
// Run manually: `node scripts/check-stale-data.mjs`
// Run with no failures (warn only): `node scripts/check-stale-data.mjs --warn-only`

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATES_FILE = resolve(__dirname, '../src/data/states.ts')

// Thresholds (in months). Tunable based on how aggressively you want
// to be reminded. State firearm law typically shifts on a months-to-
// years cadence; 12 months for a warning and 18 months for a hard
// failure is a reasonable middle ground.
const WARN_AFTER_MONTHS = 12
const FAIL_AFTER_MONTHS = 18

const args = process.argv.slice(2)
const warnOnly = args.includes('--warn-only')

const src = readFileSync(STATES_FILE, 'utf8')

// Extract the DEFAULT_VERIFIED constant — the fallback date used by
// states that don't have an explicit lastVerified.
const defaultMatch = src.match(/const DEFAULT_VERIFIED = '([^']+)'/)
if (!defaultMatch) {
  console.error('Could not find DEFAULT_VERIFIED constant in states.ts')
  process.exit(2)
}
const defaultVerified = defaultMatch[1]

// Find each state entry. Pattern matches the start of a state object
// (e.g. `  TX: {` or `  TX: { name: 'Texas',`) and the optional
// `lastVerified: '...'` inside its body. Crude but works on the
// hand-edited shape of states.ts.
const stateMatches = [...src.matchAll(/\b([A-Z]{2}):\s*\{[\s\S]*?\}/g)]

const now = new Date()
function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

const entries = []
for (const m of stateMatches) {
  const code = m[1]
  // Skip non-state matches (e.g. embedded URLs or unrelated capitals).
  // Real entries always have `name: '...'`.
  if (!/name:\s*'/.test(m[0])) continue
  const verifiedMatch = m[0].match(/lastVerified:\s*'([^']+)'/)
  const verified = verifiedMatch ? verifiedMatch[1] : defaultVerified
  const explicitlyVerified = !!verifiedMatch
  const date = new Date(verified)
  if (isNaN(date.getTime())) {
    console.error(`Invalid lastVerified date for ${code}: ${verified}`)
    process.exit(2)
  }
  entries.push({
    code,
    verified,
    explicitlyVerified,
    monthsAgo: monthsBetween(date, now),
  })
}

if (entries.length === 0) {
  console.error('No state entries found — is the regex still right?')
  process.exit(2)
}

entries.sort((a, b) => b.monthsAgo - a.monthsAgo)

const stale = entries.filter((e) => e.monthsAgo >= FAIL_AFTER_MONTHS)
const warning = entries.filter(
  (e) => e.monthsAgo >= WARN_AFTER_MONTHS && e.monthsAgo < FAIL_AFTER_MONTHS
)
const fresh = entries.filter((e) => e.monthsAgo < WARN_AFTER_MONTHS)

console.log(`State dataset summary (${entries.length} entries):`)
console.log(`  ✓ Fresh (<${WARN_AFTER_MONTHS} mo):       ${fresh.length}`)
console.log(`  ⚠ Warning (${WARN_AFTER_MONTHS}-${FAIL_AFTER_MONTHS - 1} mo):    ${warning.length}`)
console.log(`  ✗ Stale (≥${FAIL_AFTER_MONTHS} mo):       ${stale.length}`)
console.log()

if (warning.length > 0) {
  console.log('Warning — review recommended:')
  for (const e of warning) {
    const tag = e.explicitlyVerified ? '' : ' (default)'
    console.log(`  ${e.code}: verified ${e.verified} (${e.monthsAgo} mo ago)${tag}`)
  }
  console.log()
}

if (stale.length > 0) {
  console.log('Stale — must be reviewed:')
  for (const e of stale) {
    const tag = e.explicitlyVerified ? '' : ' (default)'
    console.log(`  ${e.code}: verified ${e.verified} (${e.monthsAgo} mo ago)${tag}`)
  }
  console.log()
  console.log(`To fix: open src/data/states.ts and update each stale entry's`)
  console.log(`lastVerified, source, and confidence after re-checking the state's`)
  console.log(`firearm-law page (URL is in officialSourceFor() in officialSources.ts).`)
  console.log()
  if (!warnOnly) {
    console.error(`✗ ${stale.length} state${stale.length === 1 ? '' : 's'} stale — failing build.`)
    process.exit(1)
  } else {
    console.log('--warn-only set; not failing build.')
  }
}

console.log('✓ Stale-data check complete.')
