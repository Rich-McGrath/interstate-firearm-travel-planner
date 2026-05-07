#!/usr/bin/env node
// Link-health check for officialSources.ts.
//
// Reads every state's "where to verify" URL from src/data/officialSources.ts,
// fetches each one, follows redirects manually so the chain is logged,
// and reports which entries are broken, redirected, or healthy.
//
// What this catches:
//   - DNS resolution failures (e.g. www. host not registered — see IL FOID)
//   - TLS handshake failures
//   - 4xx / 5xx responses
//   - Request timeouts (>10s)
//   - Excessive redirect chains (>5 hops)
//
// What this does NOT catch:
//   - URLs that 200 but point at a stale or wrong page after a site redesign
//   - Soft-404s served with status 200 and a "Page Not Found" body
//   - Authoritative content that has moved to a sibling URL on the same host
// For those, human review is still required — see src/data/README.md.
//
// Usage:
//   npm run check-sources                # fail on any broken link
//   npm run check-sources -- --warn-only # report but don't fail
//   npm run check-sources -- --verbose   # also list healthy entries

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCES_FILE = resolve(__dirname, '../src/data/officialSources.ts')

const args = process.argv.slice(2)
const warnOnly = args.includes('--warn-only')
const verbose = args.includes('--verbose') || args.includes('-v')

// Concurrency limit. Polite to state servers and keeps the live report
// readable. Bumping this above ~10 risks rate limits on some .gov hosts
// (especially anything fronted by a shared state CDN).
const CONCURRENCY = 6
const TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 5

// A real-browser User-Agent. Several state sites return 403 or empty
// bodies for the default Node fetch UA. This is identification, not
// deception — we tag the suffix so an admin reading their access log
// can see who we are.
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36 InterstateCarryPlanner/check-sources'

const REQUEST_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

// --- Parse officialSources.ts ----------------------------------------

const src = readFileSync(SOURCES_FILE, 'utf8')

// Match `  IL: { url: 'https://...', label: '...' },` — \s* is permissive
// enough to also catch any future multi-line variant of the same shape.
const ENTRY_RE = /\b([A-Z]{2}):\s*\{\s*url:\s*'([^']+)',\s*label:\s*'([^']+)'\s*\}/g

const entries = []
for (const m of src.matchAll(ENTRY_RE)) {
  entries.push({ code: m[1], url: m[2], label: m[3] })
}

if (entries.length === 0) {
  console.error('No entries parsed from', SOURCES_FILE)
  console.error('Has the file shape changed? Update ENTRY_RE in this script.')
  process.exit(2)
}

// --- Fetch with manual redirect handling -----------------------------

// We follow redirects ourselves so the full chain is visible in the
// report. fetch's default 'follow' hides intermediate hops, which means
// a URL that silently redirects to a different host looks identical to
// one that still serves directly — and that distinction is exactly what
// we care about for this dataset.
async function checkUrl(url) {
  const chain = [url]
  let current = url

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let resp
    try {
      // Try HEAD first — cheaper. Many servers (especially older IIS
      // installs common on state .gov hosts) reject HEAD with 405,
      // 403, or even 404; retry those with GET before giving up.
      resp = await fetch(current, {
        method: 'HEAD',
        headers: REQUEST_HEADERS,
        redirect: 'manual',
        signal: controller.signal,
      })
      if (resp.status === 405 || resp.status === 403 || resp.status === 404) {
        resp = await fetch(current, {
          method: 'GET',
          headers: REQUEST_HEADERS,
          redirect: 'manual',
          signal: controller.signal,
        })
      }
    } catch (err) {
      clearTimeout(timer)
      const reason =
        err.name === 'AbortError'
          ? 'TIMEOUT'
          : err.cause?.code || err.code || err.message || 'NETWORK_ERROR'
      return { ok: false, status: 0, chain, error: reason }
    }
    clearTimeout(timer)

    // 3xx with Location → follow manually, resolving relative URLs.
    if (resp.status >= 300 && resp.status < 400) {
      const next = resp.headers.get('location')
      if (!next) {
        return {
          ok: false,
          status: resp.status,
          chain,
          error: 'REDIRECT_NO_LOCATION',
        }
      }
      const resolved = new URL(next, current).toString()
      chain.push(resolved)
      current = resolved
      continue
    }

    return {
      ok: resp.status >= 200 && resp.status < 400,
      status: resp.status,
      chain,
    }
  }

  return { ok: false, status: 0, chain, error: 'TOO_MANY_REDIRECTS' }
}

// --- Concurrency-limited runner --------------------------------------

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

// --- Run -------------------------------------------------------------

console.log(`Checking ${entries.length} URLs in officialSources.ts...`)
console.log()

const results = await runWithConcurrency(entries, CONCURRENCY, async (entry) => {
  const r = await checkUrl(entry.url)
  return { ...entry, ...r }
})

// Sort each category alphabetically by state code so the report is
// stable across runs (concurrency means natural completion order is
// non-deterministic).
const sortByCode = (a, b) => a.code.localeCompare(b.code)

// Three buckets:
//   broken    — failed to load at all (network error, 4xx, 5xx)
//   redirected — loaded fine but the configured URL was not the
//                terminal page; worth cleaning up but not a failure
//   healthy   — loaded directly without redirect
const broken = []
const redirected = []
const healthy = []

for (const r of results) {
  if (!r.ok) broken.push(r)
  else if (r.chain.length > 1) redirected.push(r)
  else healthy.push(r)
}

broken.sort(sortByCode)
redirected.sort(sortByCode)
healthy.sort(sortByCode)

// --- Report ----------------------------------------------------------

if (broken.length > 0) {
  console.log('BROKEN — failing condition:')
  for (const r of broken) {
    const why = r.error ? r.error : `HTTP ${r.status}`
    console.log(`  ${r.code}  ${why}`)
    console.log(`        ${r.url}`)
  }
  console.log()
}

if (redirected.length > 0) {
  console.log('REDIRECTED — configured URL is no longer the live page:')
  for (const r of redirected) {
    const hops = r.chain.length - 1
    console.log(`  ${r.code}  HTTP ${r.status} via ${hops} hop${hops === 1 ? '' : 's'}`)
    console.log(`        from: ${r.url}`)
    console.log(`        to:   ${r.chain[r.chain.length - 1]}`)
  }
  console.log()
}

if (verbose && healthy.length > 0) {
  console.log('HEALTHY:')
  for (const r of healthy) {
    console.log(`  ${r.code}  HTTP ${r.status}  ${r.url}`)
  }
  console.log()
}

// --- Summary + exit code ---------------------------------------------

console.log(
  `Summary: ${healthy.length} healthy, ${redirected.length} redirected, ` +
    `${broken.length} broken (of ${entries.length} total)`
)

if (broken.length > 0 && !warnOnly) {
  console.log()
  console.log('Failing on broken links. Run with --warn-only to bypass.')
  process.exit(1)
}

process.exit(0)
