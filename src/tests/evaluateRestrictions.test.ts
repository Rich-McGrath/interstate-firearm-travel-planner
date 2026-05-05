import { describe, it, expect } from 'vitest'
import { evaluateRestrictions } from '../rules/evaluateRestrictions'
import type { TripInput } from '../types/domain'

function trip(overrides: Partial<TripInput> = {}): TripInput {
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
    lockedContainerUsed: true,
    ...overrides,
  }
}

describe('evaluateRestrictions', () => {
  it('flags magazine-capacity conflict when capacity exceeds state limit', () => {
    const out = evaluateRestrictions({
      trip: trip({ magazineCapacity: 17 }),
      routeStates: ['NY'],
    })
    const conflict = out.find((r) => r.title.includes('magazine'))
    expect(conflict?.level).toBe('high')
  })

  it('does not flag magazine-capacity when at or below the limit', () => {
    const out = evaluateRestrictions({
      trip: trip({ magazineCapacity: 10 }),
      routeStates: ['NY'],
    })
    expect(out.find((r) => r.title.includes('magazine'))).toBeUndefined()
  })

  it('flags AR-style platform when state has an assault-weapon framework', () => {
    const out = evaluateRestrictions({
      trip: trip({
        firearmType: 'ar_style',
        transportedItems: ['ar_style_rifle', 'magazines'],
      }),
      routeStates: ['MA'],
    })
    expect(
      out.find((r) => r.title.toLowerCase().includes('assault-weapon'))?.level
    ).toBe('high')
  })

  it('flags suppressor when transported through a state with suppressor restrictions', () => {
    const out = evaluateRestrictions({
      trip: trip({ transportedItems: ['handgun', 'suppressor'] }),
      routeStates: ['NY'],
    })
    expect(out.find((r) => r.title.toLowerCase().includes('suppressor'))?.level).toBe(
      'high'
    )
  })

  it('returns manual_review for an unknown state', () => {
    const out = evaluateRestrictions({ trip: trip(), routeStates: ['ZZ'] })
    expect(out[0]?.level).toBe('manual_review')
  })
})
