import type { StateLawProfile } from '../types/domain'

// SEED DATA ONLY. This is illustrative and partial. Before any real-world
// use, replace with a vetted, regularly-updated dataset sourced from
// official state attorney-general publications and current statutes.
// Recognition entries default to 'manual_review' for any pair not listed.

const verified = '2025-01-01'

export const STATE_PROFILES: Record<string, StateLawProfile> = {
  MA: {
    stateCode: 'MA',
    stateName: 'Massachusetts',
    permitRecognition: {
      MA: 'yes',
      NY: 'no',
      NJ: 'no',
      CT: 'no',
      PA: 'no',
    },
    magazineLimit: 10,
    hasAssaultWeaponBan: true,
    hasSpecialTransportRules: true,
    suppressorRiskNote:
      'Possession of suppressors by civilians is generally prohibited; manual review required.',
    nfaRiskNote:
      'NFA items face state-level restrictions in addition to federal rules; manual review required.',
    notes: [
      'Magazine capacity above the state limit may not be lawful to possess.',
      'AR-style platforms may face significant restrictions; manual review required.',
      'Transport rules may require additional containment beyond federal baseline.',
    ],
    sourceType: 'secondary',
    sourceUrl: 'https://www.mass.gov/topics/firearms-laws-licensing',
    lastVerified: verified,
    confidence: 'medium',
  },

  NY: {
    stateCode: 'NY',
    stateName: 'New York',
    permitRecognition: {
      NY: 'yes',
      MA: 'no',
      NJ: 'no',
      CT: 'no',
      PA: 'no',
    },
    magazineLimit: 10,
    hasAssaultWeaponBan: true,
    hasSpecialTransportRules: true,
    suppressorRiskNote:
      'Suppressors generally prohibited for civilian possession in NY; manual review required.',
    nfaRiskNote:
      'NFA items subject to additional state restrictions; manual review required.',
    notes: [
      'New York generally does not recognize out-of-state concealed carry permits.',
      'Magazine capacity above the state limit raises a likely conflict.',
      'AR-style features may trigger an assault-weapon classification.',
    ],
    sourceType: 'secondary',
    sourceUrl: 'https://troopers.ny.gov/firearms',
    lastVerified: verified,
    confidence: 'medium',
  },

  NJ: {
    stateCode: 'NJ',
    stateName: 'New Jersey',
    permitRecognition: {
      NJ: 'yes',
      MA: 'no',
      NY: 'no',
      CT: 'no',
      PA: 'no',
    },
    magazineLimit: 10,
    hasAssaultWeaponBan: true,
    hasSpecialTransportRules: true,
    suppressorRiskNote:
      'Suppressors generally prohibited; manual review required.',
    nfaRiskNote:
      'Many NFA items face additional state restrictions; manual review required.',
    notes: [
      'New Jersey generally does not recognize out-of-state concealed carry permits.',
      'Hollow-point ammunition has additional restrictions; manual review required.',
      'Strict transport conditions apply; review FOPA conditions carefully.',
    ],
    sourceType: 'secondary',
    sourceUrl: 'https://www.njsp.org/firearms/',
    lastVerified: verified,
    confidence: 'medium',
  },

  CT: {
    stateCode: 'CT',
    stateName: 'Connecticut',
    permitRecognition: {
      CT: 'yes',
      MA: 'no',
      NY: 'no',
      NJ: 'no',
      PA: 'no',
    },
    magazineLimit: 10,
    hasAssaultWeaponBan: true,
    hasSpecialTransportRules: true,
    notes: [
      'Connecticut generally does not recognize out-of-state permits.',
      'Magazine and assault-weapon definitions may apply.',
    ],
    sourceType: 'secondary',
    sourceUrl: 'https://portal.ct.gov/despp',
    lastVerified: verified,
    confidence: 'medium',
  },

  PA: {
    stateCode: 'PA',
    stateName: 'Pennsylvania',
    permitRecognition: {
      PA: 'yes',
      MA: 'limited',
      NY: 'no',
      NJ: 'no',
      CT: 'limited',
    },
    hasAssaultWeaponBan: false,
    hasSpecialTransportRules: false,
    notes: [
      'Pennsylvania has reciprocity arrangements with several states; verify current list before travel.',
      'Recognition status of any specific out-of-state permit should be manually verified.',
    ],
    sourceType: 'secondary',
    sourceUrl: 'https://www.attorneygeneral.gov/firearms-reciprocity/',
    lastVerified: verified,
    confidence: 'medium',
  },
}

export function getStateProfile(stateCode: string): StateLawProfile | undefined {
  return STATE_PROFILES[stateCode.toUpperCase()]
}

export function getStateName(stateCode: string): string {
  return STATE_PROFILES[stateCode.toUpperCase()]?.stateName ?? stateCode
}
