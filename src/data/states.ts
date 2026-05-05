import type {
  DutyToInform,
  RecognitionStatus,
  SourceRef,
  StateLawProfile,
} from '../types/domain'

// SEED DATA. Illustrative only. Every entry is a coarse 3-tier
// classification of the state's carry-recognition posture, not a
// definitive answer. Real reciprocity is granular (some states recognize
// only resident permits, only enhanced permits, only specific issuing
// states, etc.). Replace with a vetted, current dataset before any
// real-world use.
//
// To update an entry: change the values, bump `lastVerified` to today's
// ISO date, and update `source` to point at the page you actually
// consulted. States without explicit lastVerified/source fall back to
// the module-level DEFAULT_VERIFIED and DEFAULT_SOURCE — which is fine
// for initial seeding but should be treated as "not yet individually
// verified."

type CarryPolicy =
  | 'broad' // permissive — generally recognizes most other state permits
  | 'limited' // shall-issue with conditions or partial recognition
  | 'restrictive' // recognizes few or no out-of-state permits

interface StateDef {
  name: string
  policy: CarryPolicy
  // Duty to inform law enforcement of carry when stopped. See domain.ts
  // for the value semantics. Conservative defaults; mark as manual_review
  // wherever uncertain.
  dutyToInform: DutyToInform
  magazineLimit?: number
  hasAssaultWeaponBan?: boolean
  hasSpecialTransportRules?: boolean
  suppressorRiskNote?: string
  nfaRiskNote?: string
  notes: string[]
  // Per-state provenance — recommended to set whenever you touch the
  // entry. Falls back to module defaults if omitted.
  lastVerified?: string // ISO date
  source?: SourceRef
  confidence?: 'high' | 'medium' | 'low'
}

// When seed data was first compiled. Entries that haven't been
// individually verified inherit this date. Once you start updating
// per-state, prefer setting lastVerified on each entry directly.
const DEFAULT_VERIFIED = '2025-12-01'
const DEFAULT_CONFIDENCE: 'high' | 'medium' | 'low' = 'medium'
const DEFAULT_SOURCE: SourceRef = {
  url: 'https://www.usconcealedcarry.com/resources/ccw_reciprocity_map/',
  type: 'secondary',
  label: 'seed dataset',
}

// All 50 states + DC. Policy assignments are conservative approximations.
const STATE_DEFS: Record<string, StateDef> = {
  AL: { name: 'Alabama', policy: 'broad', dutyToInform: 'no_duty', notes: [] },
  AK: { name: 'Alaska', policy: 'broad', dutyToInform: 'must_inform', notes: ['Constitutional carry; permit not required for residents.'] },
  AZ: { name: 'Arizona', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry; permits issued for reciprocity purposes.'] },
  AR: { name: 'Arkansas', policy: 'broad', dutyToInform: 'must_inform', notes: [] },
  CA: {
    name: 'California',
    policy: 'restrictive',
    dutyToInform: 'manual_review',
    magazineLimit: 10,
    hasAssaultWeaponBan: true,
    hasSpecialTransportRules: true,
    suppressorRiskNote: 'Civilian suppressor possession is generally prohibited.',
    notes: [
      'California generally does not recognize out-of-state concealed carry permits.',
      'Magazine and assault-weapon definitions apply.',
    ],
  },
  CO: {
    name: 'Colorado',
    policy: 'limited',
    dutyToInform: 'no_duty',
    magazineLimit: 15,
    hasSpecialTransportRules: true,
    notes: [
      'Magazine capacity above the state limit raises a likely conflict.',
      'Reciprocity is limited to specific issuing states; verify before travel.',
    ],
  },
  CT: {
    name: 'Connecticut',
    policy: 'restrictive',
    dutyToInform: 'manual_review',
    magazineLimit: 10,
    hasAssaultWeaponBan: true,
    hasSpecialTransportRules: true,
    notes: [
      'Connecticut generally does not recognize out-of-state permits.',
      'Magazine and assault-weapon definitions apply.',
    ],
  },
  DE: {
    name: 'Delaware',
    policy: 'restrictive',
    dutyToInform: 'no_duty',
    hasSpecialTransportRules: true,
    notes: ['Delaware recognizes a limited list of out-of-state permits; verify before travel.'],
  },
  DC: {
    name: 'District of Columbia',
    policy: 'restrictive',
    dutyToInform: 'manual_review',
    magazineLimit: 10,
    hasAssaultWeaponBan: true,
    hasSpecialTransportRules: true,
    suppressorRiskNote: 'Civilian suppressor possession is generally prohibited.',
    nfaRiskNote: 'Many NFA items face additional restrictions.',
    notes: [
      'D.C. does not recognize out-of-state concealed carry permits.',
      'D.C. has its own carry licensing process that is not transferable.',
    ],
  },
  FL: {
    name: 'Florida',
    policy: 'broad',
    dutyToInform: 'no_duty',
    notes: [],
    lastVerified: '2025-12-01',
    confidence: 'high',
    source: {
      url: 'https://www.fdacs.gov/Consumer-Resources/Concealed-Weapon-License',
      type: 'official',
      label: 'FL DACS',
    },
  },
  GA: { name: 'Georgia', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry.'] },
  HI: {
    name: 'Hawaii',
    policy: 'restrictive',
    dutyToInform: 'manual_review',
    magazineLimit: 10,
    hasAssaultWeaponBan: true,
    hasSpecialTransportRules: true,
    notes: ['Hawaii generally does not recognize out-of-state permits.'],
  },
  ID: { name: 'Idaho', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry for residents.'] },
  IL: {
    name: 'Illinois',
    policy: 'restrictive',
    dutyToInform: 'inform_if_asked',
    magazineLimit: 10,
    hasAssaultWeaponBan: true,
    hasSpecialTransportRules: true,
    notes: [
      'Illinois generally does not recognize out-of-state permits for non-residents.',
      'Firearm Owner Identification (FOID) requirements may apply to possession.',
    ],
  },
  IN: { name: 'Indiana', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry.'] },
  IA: { name: 'Iowa', policy: 'broad', dutyToInform: 'no_duty', notes: [] },
  KS: { name: 'Kansas', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry.'] },
  KY: { name: 'Kentucky', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry.'] },
  LA: { name: 'Louisiana', policy: 'broad', dutyToInform: 'must_inform', notes: [] },
  ME: { name: 'Maine', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry.'] },
  MD: {
    name: 'Maryland',
    policy: 'restrictive',
    dutyToInform: 'inform_if_asked',
    magazineLimit: 10,
    hasAssaultWeaponBan: true,
    hasSpecialTransportRules: true,
    notes: [
      'Maryland generally does not recognize out-of-state permits.',
      'Magazine and regulated-firearm definitions apply.',
    ],
  },
  MA: {
    name: 'Massachusetts',
    policy: 'restrictive',
    dutyToInform: 'manual_review',
    magazineLimit: 10,
    hasAssaultWeaponBan: true,
    hasSpecialTransportRules: true,
    suppressorRiskNote: 'Civilian suppressor possession is generally prohibited.',
    nfaRiskNote: 'NFA items face state-level restrictions in addition to federal rules.',
    notes: [
      'Massachusetts does not recognize out-of-state concealed carry permits for non-residents.',
      'Magazine and assault-weapon definitions apply.',
    ],
    lastVerified: '2025-12-01',
    confidence: 'medium',
    source: {
      url: 'https://www.mass.gov/topics/firearms-laws-licensing',
      type: 'official',
      label: 'Mass.gov',
    },
  },
  MI: { name: 'Michigan', policy: 'limited', dutyToInform: 'must_inform', notes: ['Recognition is limited to specific issuing states.'] },
  MN: {
    name: 'Minnesota',
    policy: 'limited',
    dutyToInform: 'no_duty',
    notes: ['Recognizes a specific list of out-of-state permits; verify issuing state.'],
  },
  MS: { name: 'Mississippi', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry.'] },
  MO: { name: 'Missouri', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry.'] },
  MT: { name: 'Montana', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry.'] },
  NE: { name: 'Nebraska', policy: 'broad', dutyToInform: 'must_inform', notes: ['Constitutional carry.'] },
  NV: { name: 'Nevada', policy: 'limited', dutyToInform: 'no_duty', notes: ['Recognition is limited to specific issuing states.'] },
  NH: { name: 'New Hampshire', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry.'] },
  NJ: {
    name: 'New Jersey',
    policy: 'restrictive',
    dutyToInform: 'manual_review',
    magazineLimit: 10,
    hasAssaultWeaponBan: true,
    hasSpecialTransportRules: true,
    suppressorRiskNote: 'Civilian suppressor possession is generally prohibited.',
    nfaRiskNote: 'Many NFA items face additional state restrictions.',
    notes: [
      'New Jersey generally does not recognize out-of-state concealed carry permits.',
      'Hollow-point ammunition has additional restrictions.',
      'Strict transport conditions apply.',
    ],
  },
  NM: { name: 'New Mexico', policy: 'limited', dutyToInform: 'no_duty', notes: ['Recognizes resident permits from specific issuing states.'] },
  NY: {
    name: 'New York',
    policy: 'restrictive',
    dutyToInform: 'manual_review',
    magazineLimit: 10,
    hasAssaultWeaponBan: true,
    hasSpecialTransportRules: true,
    suppressorRiskNote: 'Civilian suppressor possession is generally prohibited.',
    nfaRiskNote: 'NFA items subject to additional state restrictions.',
    notes: [
      'New York generally does not recognize out-of-state concealed carry permits.',
      'Magazine and assault-weapon definitions apply; SAFE Act restrictions in effect.',
    ],
    lastVerified: '2025-12-01',
    confidence: 'medium',
    source: {
      url: 'https://troopers.ny.gov/firearms',
      type: 'official',
      label: 'NY State Police',
    },
  },
  NC: { name: 'North Carolina', policy: 'broad', dutyToInform: 'must_inform', notes: [] },
  ND: { name: 'North Dakota', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry for residents.'] },
  OH: { name: 'Ohio', policy: 'broad', dutyToInform: 'must_inform', notes: ['Constitutional carry.'] },
  OK: { name: 'Oklahoma', policy: 'broad', dutyToInform: 'must_inform', notes: ['Constitutional carry.'] },
  OR: {
    name: 'Oregon',
    policy: 'restrictive',
    dutyToInform: 'manual_review',
    hasSpecialTransportRules: true,
    notes: ['Oregon generally does not recognize out-of-state permits.'],
  },
  PA: {
    name: 'Pennsylvania',
    policy: 'broad',
    dutyToInform: 'no_duty',
    notes: [
      'Pennsylvania has reciprocity arrangements with many states; verify the current list before travel.',
    ],
  },
  RI: {
    name: 'Rhode Island',
    policy: 'restrictive',
    dutyToInform: 'manual_review',
    magazineLimit: 10,
    hasSpecialTransportRules: true,
    notes: ['Rhode Island generally does not recognize out-of-state permits.'],
  },
  SC: { name: 'South Carolina', policy: 'broad', dutyToInform: 'must_inform', notes: [] },
  SD: { name: 'South Dakota', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry.'] },
  TN: { name: 'Tennessee', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry.'] },
  TX: {
    name: 'Texas',
    policy: 'broad',
    dutyToInform: 'no_duty',
    notes: [
      'Constitutional carry; License to Carry available for reciprocity.',
      'No statutory duty to inform law enforcement of carry status as of 2017 (SB 1849).',
    ],
    lastVerified: '2025-12-01',
    confidence: 'high',
    source: {
      url: 'https://www.dps.texas.gov/section/handgun-licensing',
      type: 'official',
      label: 'TX DPS',
    },
  },
  UT: { name: 'Utah', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry.'] },
  VT: {
    name: 'Vermont',
    policy: 'broad',
    dutyToInform: 'no_duty',
    notes: [
      'Vermont has constitutional carry and does not issue carry permits, which can complicate reciprocity in the other direction.',
    ],
  },
  VA: { name: 'Virginia', policy: 'broad', dutyToInform: 'no_duty', notes: [] },
  WA: {
    name: 'Washington',
    policy: 'restrictive',
    dutyToInform: 'manual_review',
    magazineLimit: 10,
    hasSpecialTransportRules: true,
    notes: [
      'Washington generally does not recognize out-of-state permits.',
      'Magazine and assault-weapon definitions apply.',
    ],
  },
  WV: { name: 'West Virginia', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry.'] },
  WI: { name: 'Wisconsin', policy: 'limited', dutyToInform: 'no_duty', notes: ['Recognizes a specific list of out-of-state permits.'] },
  WY: { name: 'Wyoming', policy: 'broad', dutyToInform: 'no_duty', notes: ['Constitutional carry for residents.'] },
}

function recognitionFor(
  carryingState: CarryPolicy,
  issuingState: CarryPolicy
): RecognitionStatus {
  // Restrictive states generally recognize no out-of-state permits, with
  // narrow exceptions we treat as 'limited'.
  if (carryingState === 'restrictive') {
    if (issuingState === 'broad') return 'limited'
    return 'no'
  }
  if (carryingState === 'limited') {
    if (issuingState === 'broad') return 'limited'
    return 'no'
  }
  // Broad-policy states tend to recognize most permits, but recognition of
  // permits issued by restrictive states often comes with conditions.
  if (issuingState === 'restrictive') return 'limited'
  return 'yes'
}

function buildPermitRecognition(carrying: StateDef): Record<string, RecognitionStatus> {
  const map: Record<string, RecognitionStatus> = {}
  for (const [code, def] of Object.entries(STATE_DEFS)) {
    map[code] = code === Object.keys(STATE_DEFS).find((k) => STATE_DEFS[k] === carrying)
      ? 'yes' // a state always recognizes its own permits
      : recognitionFor(carrying.policy, def.policy)
  }
  return map
}

function toProfile(code: string, def: StateDef): StateLawProfile {
  return {
    stateCode: code,
    stateName: def.name,
    permitRecognition: buildPermitRecognition(def),
    dutyToInform: def.dutyToInform,
    ...(def.magazineLimit !== undefined ? { magazineLimit: def.magazineLimit } : {}),
    ...(def.hasAssaultWeaponBan !== undefined
      ? { hasAssaultWeaponBan: def.hasAssaultWeaponBan }
      : {}),
    ...(def.hasSpecialTransportRules !== undefined
      ? { hasSpecialTransportRules: def.hasSpecialTransportRules }
      : {}),
    ...(def.suppressorRiskNote ? { suppressorRiskNote: def.suppressorRiskNote } : {}),
    ...(def.nfaRiskNote ? { nfaRiskNote: def.nfaRiskNote } : {}),
    notes: def.notes,
    source: def.source ?? DEFAULT_SOURCE,
    lastVerified: def.lastVerified ?? DEFAULT_VERIFIED,
    confidence: def.confidence ?? DEFAULT_CONFIDENCE,
  }
}

export const STATE_PROFILES: Record<string, StateLawProfile> = Object.fromEntries(
  Object.entries(STATE_DEFS).map(([code, def]) => [code, toProfile(code, def)])
)

export function getStateProfile(stateCode: string): StateLawProfile | undefined {
  return STATE_PROFILES[stateCode.toUpperCase()]
}

export function getStateName(stateCode: string): string {
  return STATE_PROFILES[stateCode.toUpperCase()]?.stateName ?? stateCode
}

// Compact list for the permit-state autocomplete.
export const ALL_STATES: { code: string; name: string }[] = Object.entries(STATE_DEFS)
  .map(([code, def]) => ({ code, name: def.name }))
  .sort((a, b) => a.name.localeCompare(b.name))
