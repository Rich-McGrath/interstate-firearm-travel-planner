// Encode a TripInput into the URL hash so it can be shared via a single
// link. Encoding uses base64url (no '+', '/', or padding) on JSON,
// keeping the URL clean and avoiding extra encoding layers.
//
// The hash format is `#trip=<payload>`. On load, App.tsx checks the hash
// and prefills the form. Sharing isn't authoritative — a malformed
// payload simply falls back to an empty form.

import type { TripInput } from '../types/domain'

const HASH_PARAM = 'trip'

// Bump this when TripInput shape changes incompatibly. Old payloads with
// an older version are rejected to avoid loading wrong-shape data.
const PAYLOAD_VERSION = 1

interface SharedPayload {
  v: number
  trip: TripInput
}

// ---------------------------------------------------------------------------
// Base64url helpers (browser-native btoa/atob, then URL-safe transform)
// ---------------------------------------------------------------------------

function toBase64Url(text: string): string {
  // btoa requires Latin-1; encode as UTF-8 first via TextEncoder
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(b64: string): string {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildShareUrl(trip: TripInput, baseUrl: string = window.location.origin + window.location.pathname): string {
  const payload: SharedPayload = { v: PAYLOAD_VERSION, trip }
  const encoded = toBase64Url(JSON.stringify(payload))
  return `${baseUrl}#${HASH_PARAM}=${encoded}`
}

export function readSharedTripFromHash(): TripInput | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash
  if (!hash || hash.length < 2) return null
  const params = new URLSearchParams(hash.slice(1))
  const raw = params.get(HASH_PARAM)
  if (!raw) return null
  try {
    const json = fromBase64Url(raw)
    const payload = JSON.parse(json) as Partial<SharedPayload>
    if (payload.v !== PAYLOAD_VERSION || !payload.trip) return null
    return payload.trip as TripInput
  } catch {
    return null
  }
}

export function clearShareHash(): void {
  if (typeof window === 'undefined') return
  // Replace the hash without scrolling/reloading
  history.replaceState(null, '', window.location.pathname + window.location.search)
}
