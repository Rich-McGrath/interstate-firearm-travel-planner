import type {
  RouteOption,
  StopRecommendation,
} from '../types/domain'
import { getStateProfile } from '../data/states'

// For each stop, find the nearest route sample by squared-distance and
// adopt that sample's state code. Cheap (no extra API call) and accurate
// enough since stops are returned by tilequery near sample points
// already. The enriched stop carries hot-spot flags the UI uses to
// surface state-context warnings on the stop card.

export interface EnrichedStop extends StopRecommendation {
  contextStateCode?: string
  contextStateName?: string
  contextDuty?: 'no_duty' | 'must_inform' | 'inform_if_asked' | 'manual_review'
  contextRestrictive?: boolean // restrictive carry recognition state
}

interface SamplePoint {
  lng: number
  lat: number
  stateCode?: string
}

export function enrichStopsWithStateContext(
  stops: StopRecommendation[],
  route: RouteOption | undefined
): EnrichedStop[] {
  if (!route || route.samples.length === 0) {
    return stops as EnrichedStop[]
  }
  const samples: SamplePoint[] = route.samples
  return stops.map((s) => {
    const nearest = nearestSample(s.lng, s.lat, samples)
    if (!nearest?.stateCode) return s as EnrichedStop
    const profile = getStateProfile(nearest.stateCode)
    if (!profile) return s as EnrichedStop
    // A stop is in a "restrictive" state if any reciprocity entry on its
    // permitRecognition map is 'no' for many states — proxy via the fact
    // that restrictive states default-deny most permits. Cheaper signal:
    // hasAssaultWeaponBan or hasSpecialTransportRules.
    const restrictive = !!(
      profile.hasAssaultWeaponBan ||
      profile.hasSpecialTransportRules ||
      profile.dutyToInform === 'manual_review'
    )
    return {
      ...s,
      contextStateCode: profile.stateCode,
      contextStateName: profile.stateName,
      contextDuty: profile.dutyToInform,
      contextRestrictive: restrictive,
    }
  })
}

function nearestSample(
  lng: number,
  lat: number,
  samples: SamplePoint[]
): SamplePoint | undefined {
  let bestDist = Number.POSITIVE_INFINITY
  let best: SamplePoint | undefined
  for (const s of samples) {
    const d = (s.lng - lng) ** 2 + (s.lat - lat) ** 2
    if (d < bestDist) {
      bestDist = d
      best = s
    }
  }
  return best
}
