import { describe, it, expect } from 'vitest'
import { evaluateFopa } from '../rules/evaluateFopa'
import type { TripInput } from '../types/domain'

function baseTrip(overrides: Partial<TripInput> = {}): TripInput {
  return {
    origin: 'Boston, MA',
    destination: 'Pittsburgh, PA',
    hasPermit: true,
    permitState: 'MA',
    firearmType: 'handgun',
    magazineCapacity: 10,
    transportedItems: ['handgun'],
    firearmUnloaded: true,
    ammoAccessibleFromPassengerCompartment: false,
    firearmAccessibleFromPassengerCompartment: false,
    vehicleHasSeparateTrunk: true,
    lockedContainerUsed: false,
    ...overrides,
  }
}

describe('evaluateFopa', () => {
  it('potentially qualifies when unloaded, inaccessible, and trunked', () => {
    const out = evaluateFopa(baseTrip())
    expect(out.qualifiesPotentially).toBe(true)
  })

  it('fails when firearm is loaded', () => {
    const out = evaluateFopa(baseTrip({ firearmUnloaded: false }))
    expect(out.qualifiesPotentially).toBe(false)
    expect(out.reasons.some((r) => /unloaded/i.test(r))).toBe(true)
  })

  it('fails when firearm is accessible from passenger compartment', () => {
    const out = evaluateFopa(
      baseTrip({ firearmAccessibleFromPassengerCompartment: true })
    )
    expect(out.qualifiesPotentially).toBe(false)
    expect(out.reasons.some((r) => /accessible/i.test(r))).toBe(true)
  })

  it('fails when no separate trunk and no locked container', () => {
    const out = evaluateFopa(
      baseTrip({ vehicleHasSeparateTrunk: false, lockedContainerUsed: false })
    )
    expect(out.qualifiesPotentially).toBe(false)
    expect(out.reasons.some((r) => /locked container/i.test(r))).toBe(true)
  })

  it('warns about glove-box / console even when locked container is used', () => {
    const out = evaluateFopa(
      baseTrip({ vehicleHasSeparateTrunk: false, lockedContainerUsed: true })
    )
    // Still potentially qualifies, but warns about glove-box / console.
    expect(out.qualifiesPotentially).toBe(true)
    expect(out.warnings.some((w) => /glove/i.test(w))).toBe(true)
  })

  it('returns manual_review when origin/destination state cannot be parsed', () => {
    const out = evaluateFopa(
      baseTrip({ origin: 'unknown place', destination: 'somewhere else' })
    )
    expect(out.qualifiesPotentially).toBe('manual_review')
  })

  it('returns manual_review when an NFA item is in the transport list', () => {
    const out = evaluateFopa(baseTrip({ transportedItems: ['handgun', 'nfa_item'] }))
    expect(out.qualifiesPotentially).toBe('manual_review')
    expect(out.warnings.some((w) => /nfa|suppressor/i.test(w))).toBe(true)
  })

  it('returns manual_review when a suppressor is in the transport list', () => {
    const out = evaluateFopa(baseTrip({ transportedItems: ['handgun', 'suppressor'] }))
    expect(out.qualifiesPotentially).toBe('manual_review')
  })
})
