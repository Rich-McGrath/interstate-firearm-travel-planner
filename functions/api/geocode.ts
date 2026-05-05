// Cloudflare Pages Function — proxies Mapbox forward-geocoding for
// origin/destination autocomplete. The MAPBOX_TOKEN secret is stored as
// a Pages environment variable and never reaches the browser.

interface Env {
  MAPBOX_TOKEN: string
}

interface MapboxFeature {
  id: string
  place_name: string
  center: [number, number]
  context?: { id: string; short_code?: string; text: string }[]
  text: string
}

interface MapboxResponse {
  features: MapboxFeature[]
}

export interface GeocodeSuggestion {
  id: string
  label: string
  lng: number
  lat: number
  stateCode?: string
}

const ALLOWED_ORIGINS_RE = /^https:\/\/([\w-]+\.)?pages\.dev$|^http:\/\/localhost(:\d+)?$/

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // Same-origin in production. In dev, allow localhost.
  const origin = request.headers.get('Origin') ?? ''
  if (origin && !ALLOWED_ORIGINS_RE.test(origin)) {
    return json({ error: 'origin not allowed' }, 403)
  }

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim()
  if (!q || q.length < 2) {
    return json({ suggestions: [] })
  }

  if (!env.MAPBOX_TOKEN) {
    return json({ error: 'server misconfigured' }, 500)
  }

  // Mapbox's autocomplete mode performs prefix matching, which works for
  // "san anto..." but returns fuzzy results for queries containing a
  // house number ("18015 Kyle Seale Parkway"). When digits are present,
  // switch to precise matching so the address resolves correctly.
  const hasDigits = /\d/.test(q)

  // Restrict to US, prioritize places with addresses, return up to 6.
  const mapboxUrl = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`
  )
  mapboxUrl.searchParams.set('access_token', env.MAPBOX_TOKEN)
  mapboxUrl.searchParams.set('country', 'US')
  mapboxUrl.searchParams.set('types', 'place,locality,neighborhood,address,postcode,poi')
  mapboxUrl.searchParams.set('autocomplete', hasDigits ? 'false' : 'true')
  mapboxUrl.searchParams.set('limit', '6')

  const resp = await fetch(mapboxUrl.toString(), {
    cf: { cacheTtl: 60, cacheEverything: true },
  })
  if (!resp.ok) {
    return json({ error: 'upstream error', status: resp.status }, 502)
  }
  const data = (await resp.json()) as MapboxResponse

  const suggestions: GeocodeSuggestion[] = data.features.map((f) => ({
    id: f.id,
    label: f.place_name,
    lng: f.center[0],
    lat: f.center[1],
    stateCode: extractStateCode(f),
  }))

  return json({ suggestions })
}

function extractStateCode(f: MapboxFeature): string | undefined {
  // US state short_codes look like 'us-ma'
  const region = f.context?.find((c) => c.id.startsWith('region'))
  const short = region?.short_code?.split('-')[1]
  return short ? short.toUpperCase() : undefined
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60',
    },
  })
}
