// Canonical "where to verify this state's firearm laws" URLs. Used as a
// fallback when a state entry doesn't carry an explicit per-claim
// `source` ref. Pointing at the state's own authoritative page lets a
// user confirm directly even when the seed entry hasn't been
// individually verified.
//
// Each entry should be the most authoritative public page available —
// State Police, Attorney General's firearms division, or licensing
// agency. Avoid linking to advocacy groups or commercial reciprocity
// maps; the goal is to send the user to the rule-maker, not a
// summarizer.
//
// When you do verify a state and add a per-claim `source` block on its
// StateDef, that wins over this fallback automatically.

import type { SourceRef } from '../types/domain'

interface OfficialSource {
  url: string
  label: string
}

const SOURCES: Record<string, OfficialSource> = {
  AL: { url: 'https://www.alea.gov/dps/abi/concealed-pistol-permit', label: 'AL Law Enforcement Agency' },
  AK: { url: 'https://dps.alaska.gov/AST/ABI/Permits/CHP', label: 'AK Dept of Public Safety' },
  AZ: { url: 'https://www.azdps.gov/services/public/cwp', label: 'AZ Dept of Public Safety' },
  AR: { url: 'https://www.dps.arkansas.gov/law-enforcement/asp/concealed-handgun-licensing/', label: 'AR State Police' },
  CA: { url: 'https://oag.ca.gov/firearms', label: 'CA Office of the Attorney General' },
  CO: { url: 'https://cbi.colorado.gov/sections/instacheck-unit', label: 'CO Bureau of Investigation' },
  CT: { url: 'https://portal.ct.gov/DESPP/Special-Licensing-and-Firearms/Special-Licensing-and-Firearms-Unit', label: 'CT State Police SLFU' },
  DE: { url: 'https://courts.delaware.gov/superior/ccdw.aspx', label: 'DE Superior Court' },
  DC: { url: 'https://mpdc.dc.gov/page/firearms-registration', label: 'DC Metropolitan Police' },
  FL: { url: 'https://www.fdacs.gov/Consumer-Resources/Concealed-Weapon-License', label: 'FL Dept of Agriculture & Consumer Services' },
  GA: { url: 'https://georgia.gov/apply-weapons-license', label: 'Georgia.gov' },
  HI: { url: 'https://ag.hawaii.gov/cpja/firearms/', label: 'HI Dept of the Attorney General' },
  ID: { url: 'https://isp.idaho.gov/bci/concealed-weapons/', label: 'ID State Police' },
  IL: { url: 'https://www.isp.illinois.gov/Foid', label: 'IL State Police' },
  IN: { url: 'https://www.in.gov/isp/firearms-licensing/', label: 'IN State Police' },
  IA: { url: 'https://dps.iowa.gov/divisions/administrative-services/weapon-permits', label: 'IA Dept of Public Safety' },
  KS: { url: 'https://www.ag.ks.gov/licensing/concealed-carry', label: 'KS Office of the Attorney General' },
  KY: { url: 'https://www.kentuckystatepolice.org/concealed-carry-deadly-weapons/', label: 'KY State Police' },
  LA: { url: 'https://www.lsp.org/concealed-handgun-permit-unit/', label: 'LA State Police' },
  ME: { url: 'https://www.maine.gov/dps/msp/licenses-permits/concealed-handgun', label: 'ME State Police' },
  MD: { url: 'https://mdsp.maryland.gov/Organization/Pages/CriminalInvestigationBureau/LicensingDivision/HandgunPermit.aspx', label: 'MD State Police' },
  MA: { url: 'https://www.mass.gov/topics/firearms-laws-licensing', label: 'Mass.gov' },
  MI: { url: 'https://www.michigan.gov/msp/divisions/cjic/cpl', label: 'MI State Police' },
  MN: { url: 'https://dps.mn.gov/divisions/bca/bca-divisions/mnjis/Pages/permit-to-carry.aspx', label: 'MN Dept of Public Safety' },
  MS: { url: 'https://www.dps.ms.gov/firearm-permits', label: 'MS Dept of Public Safety' },
  MO: { url: 'https://dps.mo.gov/dir/programs/ohs/conceal/', label: 'MO Dept of Public Safety' },
  MT: { url: 'https://dojmt.gov/enforcement/concealed-weapons/', label: 'MT Dept of Justice' },
  NE: { url: 'https://statepatrol.nebraska.gov/concealed-handgun-permit', label: 'NE State Patrol' },
  NV: { url: 'https://www.leg.state.nv.us/nrs/nrs-202.html#NRS202Sec3653', label: 'NV Revised Statutes Ch. 202' },
  NH: { url: 'https://www.nh.gov/safety/divisions/nhsp/jib/permitslicensing/index.html', label: 'NH State Police' },
  NJ: { url: 'https://www.njsp.org/firearms/', label: 'NJ State Police' },
  NM: { url: 'https://www.dps.nm.gov/index.php/concealed-carry/', label: 'NM Dept of Public Safety' },
  NY: { url: 'https://troopers.ny.gov/firearms', label: 'NY State Police' },
  NC: { url: 'https://www.ncdoj.gov/about-doj/law-enforcement-training-and-standards/concealed-handgun-permit/', label: 'NC Dept of Justice' },
  ND: { url: 'https://attorneygeneral.nd.gov/public-safety/concealed-weapons-license', label: 'ND Attorney General' },
  OH: { url: 'https://www.ohioattorneygeneral.gov/Law-Enforcement/Concealed-Carry', label: 'OH Attorney General' },
  OK: { url: 'https://oklahoma.gov/osbi/forms-and-resources/sda.html', label: 'OK State Bureau of Investigation' },
  OR: { url: 'https://www.oregon.gov/osp/programs/cjis/Pages/Firearms-Unit.aspx', label: 'OR State Police' },
  PA: { url: 'https://www.psp.pa.gov/firearms-information/Pages/default.aspx', label: 'PA State Police' },
  RI: { url: 'https://risp.ri.gov/concealed-carry-permits', label: 'RI State Police' },
  SC: { url: 'https://www.sled.sc.gov/CWP.aspx', label: 'SC Law Enforcement Division' },
  SD: { url: 'https://atg.sd.gov/Concealed%20Pistol/Default.aspx', label: 'SD Attorney General' },
  TN: { url: 'https://www.tn.gov/safety/handgun.html', label: 'TN Dept of Safety & Homeland Security' },
  TX: { url: 'https://www.dps.texas.gov/section/handgun-licensing', label: 'TX Dept of Public Safety' },
  UT: { url: 'https://bci.utah.gov/concealed-firearm/', label: 'UT Bureau of Criminal Identification' },
  VT: { url: 'https://vsp.vermont.gov/firearms', label: 'VT State Police' },
  VA: { url: 'https://www.vsp.virginia.gov/sections-units-bureaus/baci/firearms-transaction-center/', label: 'VA State Police' },
  WA: { url: 'https://www.atg.wa.gov/firearms', label: 'WA Attorney General' },
  WV: { url: 'https://www.wvlegislature.gov/wvcode/code.cfm?chap=61&art=7', label: 'WV Code Ch. 61, Art. 7' },
  WI: { url: 'https://www.doj.state.wi.us/dles/cib/concealed-carry-licensing', label: 'WI Dept of Justice' },
  WY: { url: 'https://attorneygeneral.wyo.gov/concealed-firearm-permits', label: 'WY Attorney General' },
}

// Returns a SourceRef for a state, marked as 'official' (it's the
// state's own page) but with no `quotedText` since this is a generic
// pointer, not a per-claim citation.
export function officialSourceFor(stateCode: string): SourceRef | undefined {
  const entry = SOURCES[stateCode.toUpperCase()]
  if (!entry) return undefined
  return {
    url: entry.url,
    type: 'official',
    label: entry.label,
  }
}
