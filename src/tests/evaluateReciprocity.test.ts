import { describe, it, expect } from 'vitest'
import { evaluateReciprocity } from '../rules/evaluateReciprocity'

describe('evaluateReciprocity — permit mode', () => {
  it('returns "no" for every state when no permit is reported', () => {
    const out = evaluateReciprocity({
      hasPermit: false,
      routeStates: ['NY', 'PA', 'OH'],
    })
    expect(out.every((r) => r.status === 'no')).toBe(true)
    expect(out[0]?.detail).toMatch(/no permit/i)
  })

  it('uses home-state language when carrier is in their issuing state', () => {
    const out = evaluateReciprocity({
      hasPermit: true,
      permitState: 'TX',
      routeStates: ['TX'],
    })
    expect(out[0]?.status).toBe('yes')
    expect(out[0]?.detail).toMatch(/issuing state's own permit/i)
  })

  it('returns manual_review for an unknown state code', () => {
    const out = evaluateReciprocity({
      hasPermit: true,
      permitState: 'TX',
      routeStates: ['ZZ'],
    })
    expect(out[0]?.status).toBe('manual_review')
  })

  it('marks restrictive states as not-recognizing a broad-state permit', () => {
    const out = evaluateReciprocity({
      hasPermit: true,
      permitState: 'TX',
      routeStates: ['NY'],
    })
    // NY is restrictive; recognition for any out-of-state permit is 'no'.
    expect(out[0]?.status).toBe('no')
    expect(out[0]?.detail).toMatch(/does not appear to recognize/i)
  })
})

describe('evaluateReciprocity — constitutional-carry mode', () => {
  it('returns yes for the carrier\'s home state when home is a CC state', () => {
    // TX has hasConstitutionalCarry=true. Carrier originates in TX so
    // residency is satisfied even if residentsOnly is manual_review.
    const out = evaluateReciprocity({
      hasPermit: false,
      relyingOnConstitutionalCarry: true,
      originStateCode: 'TX',
      routeStates: ['TX'],
    })
    expect(out[0]?.status).toBe('yes')
    expect(out[0]?.detail).toMatch(/home state/i)
  })

  it('returns no for a restrictive state regardless of CC mode', () => {
    const out = evaluateReciprocity({
      hasPermit: false,
      relyingOnConstitutionalCarry: true,
      originStateCode: 'TX',
      routeStates: ['NY'],
    })
    expect(out[0]?.status).toBe('no')
    expect(out[0]?.detail).toMatch(/does not appear to allow constitutional carry/i)
  })

  it('returns no for a non-resident in a residents-only CC state', () => {
    // WY has constitutionalCarryResidentsOnly=true. A TX resident
    // traveling through WY would not qualify under WY's framework.
    const out = evaluateReciprocity({
      hasPermit: false,
      relyingOnConstitutionalCarry: true,
      originStateCode: 'TX',
      routeStates: ['WY'],
    })
    expect(out[0]?.status).toBe('no')
    expect(out[0]?.detail).toMatch(/restricted to residents/i)
  })

  it('returns manual_review for a residents-only CC state when origin is unknown', () => {
    // Same WY, but no originStateCode — we can't tell whether the user
    // qualifies, so degrade to manual_review rather than guess.
    const out = evaluateReciprocity({
      hasPermit: false,
      relyingOnConstitutionalCarry: true,
      routeStates: ['WY'],
    })
    expect(out[0]?.status).toBe('manual_review')
    expect(out[0]?.detail).toMatch(/origin state could not be determined/i)
  })

  it('returns manual_review when residency status of a CC state is uncertain', () => {
    // Most CC states in the seed data have residentsOnly defaulted to
    // manual_review because the original notes don't explicitly say.
    // GA is one such state.
    const out = evaluateReciprocity({
      hasPermit: false,
      relyingOnConstitutionalCarry: true,
      originStateCode: 'TX',
      routeStates: ['GA'],
    })
    expect(out[0]?.status).toBe('manual_review')
    expect(out[0]?.detail).toMatch(/residency requirements .* not in the seed dataset/i)
  })

  it('returns manual_review for a broad state without a CC flag', () => {
    // AR is broad-policy in the seed but doesn't have a CC note. In
    // reality it is CC, but the seed didn't say so — conservative
    // answer is manual_review rather than 'no' (which would be wrong)
    // or 'yes' (which we can't justify from the data we have).
    const out = evaluateReciprocity({
      hasPermit: false,
      relyingOnConstitutionalCarry: true,
      originStateCode: 'TX',
      routeStates: ['AR'],
    })
    expect(out[0]?.status).toBe('manual_review')
    expect(out[0]?.detail).toMatch(/not flagged as constitutional-carry/i)
  })

  it('returns manual_review for an unknown state code in CC mode', () => {
    const out = evaluateReciprocity({
      hasPermit: false,
      relyingOnConstitutionalCarry: true,
      originStateCode: 'TX',
      routeStates: ['ZZ'],
    })
    expect(out[0]?.status).toBe('manual_review')
  })

  it('CC mode wins over a stray hasPermit:true', () => {
    // Defense-in-depth: the form should set hasPermit=false when CC is
    // on, but if it doesn't, the rule should still take the CC branch.
    const out = evaluateReciprocity({
      hasPermit: true,
      permitState: 'TX',
      relyingOnConstitutionalCarry: true,
      originStateCode: 'TX',
      routeStates: ['NY'],
    })
    // If the permit branch had won, status would still be 'no' (NY
    // doesn't recognize TX permits), but the detail would mention the
    // permit. Check the detail to confirm we took the CC branch.
    expect(out[0]?.detail).toMatch(/constitutional carry/i)
  })

  it('handles a multi-state route with mixed outcomes', () => {
    const out = evaluateReciprocity({
      hasPermit: false,
      relyingOnConstitutionalCarry: true,
      originStateCode: 'TX',
      routeStates: ['TX', 'NM', 'AZ', 'NY'],
    })
    // TX: home, yes
    // NM: limited-policy, no
    // AZ: CC but residentsOnly=manual_review → manual_review
    // NY: restrictive, no
    expect(out.find((r) => r.stateCode === 'TX')?.status).toBe('yes')
    expect(out.find((r) => r.stateCode === 'NM')?.status).toBe('no')
    expect(out.find((r) => r.stateCode === 'AZ')?.status).toBe('manual_review')
    expect(out.find((r) => r.stateCode === 'NY')?.status).toBe('no')
  })
})
