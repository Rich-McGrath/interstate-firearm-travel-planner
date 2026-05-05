import type {
  DutyToInform,
  RecognitionStatus,
  RiskLevel,
  StopLabel,
} from '../types/domain'

export function formatRiskLevel(level: RiskLevel): string {
  switch (level) {
    case 'low':
      return 'Lower apparent risk'
    case 'caution':
      return 'Caution'
    case 'high':
      return 'Higher apparent risk'
    case 'manual_review':
      return 'Manual review required'
  }
}

export function formatRecognitionStatus(status: RecognitionStatus): string {
  switch (status) {
    case 'yes':
      return 'Appears recognized'
    case 'limited':
      return 'Recognized with limitations'
    case 'no':
      return 'Does not appear recognized'
    case 'manual_review':
      return 'Manual review required'
  }
}

export function formatStopLabel(label: StopLabel): string {
  switch (label) {
    case 'recommended':
      return 'Recommended'
    case 'better_traffic':
      return 'Better traffic'
    case 'manual_review':
      return 'Manual review'
  }
}

export function formatDistance(miles: number): string {
  if (miles < 1) return `${(miles * 1).toFixed(1)} mi`
  return `${miles.toFixed(0)} mi`
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m} min`
  return `${h}h ${m}m`
}

export function fallback<T>(value: T | undefined | null, alt: string): string {
  return value === undefined || value === null ? alt : String(value)
}

export function riskClassName(level: RiskLevel): string {
  return `risk-${level}`
}

export function recognitionClassName(status: RecognitionStatus): string {
  return `reco-${status}`
}

export function stopLabelClassName(label: StopLabel): string {
  return `label-${label}`
}

export function formatDutyToInform(d: DutyToInform): string {
  switch (d) {
    case 'no_duty':
      return 'No duty to inform'
    case 'must_inform':
      return 'Must inform'
    case 'inform_if_asked':
      return 'Inform if asked'
    case 'manual_review':
      return 'Manual review'
  }
}

export function dutyShortLabel(d: DutyToInform): string {
  switch (d) {
    case 'no_duty':
      return 'No duty'
    case 'must_inform':
      return 'Must inform'
    case 'inform_if_asked':
      return 'If asked'
    case 'manual_review':
      return 'Review'
  }
}

export function dutyClassName(d: DutyToInform): string {
  return `duty-${d}`
}

// ---------------------------------------------------------------------------
// Verification freshness helpers
// ---------------------------------------------------------------------------

const STALE_MONTHS = 12

export function formatVerifiedDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function monthsSince(iso: string, now: Date = new Date()): number {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return Number.POSITIVE_INFINITY
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
}

export function isStale(iso: string, threshold: number = STALE_MONTHS): boolean {
  return monthsSince(iso) >= threshold
}
