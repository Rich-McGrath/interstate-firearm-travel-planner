import type { RouteOption } from '../types/domain'

// Two illustrative routes from a Massachusetts origin to a Pennsylvania
// destination. Risk score is a placeholder seed value; the rules engine
// recomputes a final score for the user's actual trip.

export const MOCK_ROUTES: RouteOption[] = [
  {
    id: 'route-i90-i84-i81',
    name: 'Inland route via I-90 / I-84 / I-81',
    polyline: 'mock-polyline-inland',
    distanceMiles: 412,
    durationMinutes: 380,
    statesCrossed: ['MA', 'CT', 'NY', 'PA'],
    waypoints: [
      { id: 'wp-1', name: 'Sturbridge, MA', lat: 42.108, lng: -72.078 },
      { id: 'wp-2', name: 'Hartford, CT', lat: 41.764, lng: -72.685 },
      { id: 'wp-3', name: 'Scranton, PA', lat: 41.408, lng: -75.662 },
    ],
    riskScore: 58,
    riskLevel: 'caution',
    riskReasons: [
      'Crosses Connecticut and New York, both with restrictive frameworks.',
    ],
  },
  {
    id: 'route-i95-nj',
    name: 'Coastal route via I-95 through NY and NJ',
    polyline: 'mock-polyline-coastal',
    distanceMiles: 388,
    durationMinutes: 410,
    statesCrossed: ['MA', 'CT', 'NY', 'NJ', 'PA'],
    waypoints: [
      { id: 'wp-1', name: 'Providence, RI area', lat: 41.823, lng: -71.412 },
      { id: 'wp-2', name: 'New Haven, CT', lat: 41.308, lng: -72.928 },
      { id: 'wp-3', name: 'Newark, NJ', lat: 40.735, lng: -74.172 },
    ],
    riskScore: 78,
    riskLevel: 'high',
    riskReasons: [
      'Adds New Jersey, which has additional restrictions and limited reciprocity.',
      'Multiple highly restrictive states in sequence.',
    ],
  },
]
