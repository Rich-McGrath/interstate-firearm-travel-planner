import { describe, it, expect } from 'vitest'
import { evaluateCarryWarning } from '../rules/evaluateCarryWarning'
import type {
  ReciprocityResult,
  TransportItem,
  TripInput,
  TripStop,
} from '../types/domain'

function stop(label: string, stateCode?: string): TripStop {
  return {
    id: label,
    label,
    coords: { lng: 0, lat: 0 },
    ...(stateCode ? { stateCode } : {}),
  }
}

function trip(overrides: Partial<TripInput> = {}): TripInput {
  return {
    stops: [stop('Houston, TX', 'TX'), stop('New York, NY', 'NY')],
    hasPermit: true,
    permitState: 'TX',
    firearmType: 'handgun',
    transportedItems: ['handgun'] as TransportItem[],
    firearmUnloaded: true,
    ammoAccessibleFromPassengerCompartment: false,
    firearmAccessibleFromPassengerCompartment: false,
    vehicleHasSeparateTrunk: true,
    lockedContainerUsed: true,
    ...overrides,
  }
}

function reciprocity(
  status: ReciprocityResult['status'],
  stateCode = 'NY'
): ReciprocityResult[] {
  return [
    { stateCode: 'TX', status: 'yes', detail: 'Issuing state.' },
    {
      stateCode,
      status,
      detail: `${stateCode} reciprocity detail (test).`,
    },
  ]
}

describe('evaluateCarryWarning', () => {
  it('fires when permit + firearm transport + destination recognition is "no"', () => {
    const result = evaluateCarryWarning({
      trip: trip(),
      reciprocity: reciprocity('no'),
      destinationStateCode: 'NY',
    })
    expect(result).not.toBeNull()
    expect(result?.destinationStateCode).toBe('NY')
    expect(result?.issuingStateCode).toBe('TX')
  })

  it('does not fire when destination recognition is "yes"', () => {
    const result = evaluateCarryWarning({
      trip: trip(),
      reciprocity: reciprocity('yes'),
      destinationStateCode: 'NY',
    })
    expect(result).toBeNull()
  })

  it('does not fire on "limited" recognition (intentional design choice)', () => {
    // 'limited' goes to the per-state panel below; conflating it with
    // 'no' would flatten an important distinction in the data.
    const result = evaluateCarryWarning({
      trip: trip(),
      reciprocity: reciprocity('limited'),
      destinationStateCode: 'NY',
    })
    expect(result).toBeNull()
  })

  it('does not fire on "manual_review" recognition', () => {
    // We can't make a confident "carry isn't authorized" claim when
    // the data is uncertain. Manual_review surfaces in the per-state
    // panel — this banner is reserved for confident negatives.
    const result = evaluateCarryWarning({
      trip: trip(),
      reciprocity: reciprocity('manual_review'),
      destinationStateCode: 'NY',
    })
    expect(result).toBeNull()
  })

  it('does not fire when the user reported no permit', () => {
    // Without this guard, the banner would fire on every trip where
    // the user didn\u2019t fill in permit fields — noise that trains
    // users to ignore the warning.
    const result = evaluateCarryWarning({
      trip: trip({ hasPermit: false }),
      reciprocity: reciprocity('no'),
      destinationStateCode: 'NY',
    })
    expect(result).toBeNull()
  })

  it('does not fire when permitState is missing even if hasPermit is true', () => {
    const result = evaluateCarryWarning({
      trip: trip({ hasPermit: true, permitState: undefined }),
      reciprocity: reciprocity('no'),
      destinationStateCode: 'NY',
    })
    expect(result).toBeNull()
  })

  it('does not fire when no firearm-class items are being transported', () => {
    // A trip transporting only ammo or magazines doesn\u2019t need a
    // permit-recognition warning — there\u2019s no firearm to carry.
    const result = evaluateCarryWarning({
      trip: trip({ transportedItems: ['ammunition', 'magazines'] }),
      reciprocity: reciprocity('no'),
      destinationStateCode: 'NY',
    })
    expect(result).toBeNull()
  })

  it('fires for long-gun transport too (rifle, AR-style, etc.)', () => {
    // Carry-permit recognition still matters for long guns when the
    // user has reported a carry permit — we don\u2019t try to second-
    // guess whether they\u2019re relying on it. The per-state panel
    // surfaces the nuance; the banner just flags the gap.
    const result = evaluateCarryWarning({
      trip: trip({
        firearmType: 'rifle',
        transportedItems: ['rifle'] as TransportItem[],
      }),
      reciprocity: reciprocity('no'),
      destinationStateCode: 'NY',
    })
    expect(result).not.toBeNull()
  })

  it('does not fire when destinationStateCode is missing', () => {
    // Defensive: without a resolved destination state, we can\u2019t
    // make a recognition claim. Falls back to silence.
    const result = evaluateCarryWarning({
      trip: trip(),
      reciprocity: reciprocity('no'),
      destinationStateCode: undefined,
    })
    expect(result).toBeNull()
  })

  it('matches the destination state case-insensitively', () => {
    // The reciprocity result uses uppercase codes; route resolution
    // could in theory hand us lowercase. Both should match.
    const result = evaluateCarryWarning({
      trip: trip(),
      reciprocity: reciprocity('no', 'NY'),
      destinationStateCode: 'ny',
    })
    expect(result?.destinationStateCode).toBe('NY')
  })

  it('does not fire when destination is the issuing state itself', () => {
    // Carrying in the state that issued your own permit \u2014 the
    // reciprocity rule returns 'yes' for this case, so the banner
    // naturally won\u2019t fire. Verifying defensively.
    const result = evaluateCarryWarning({
      trip: trip({ permitState: 'NY' }),
      reciprocity: [
        { stateCode: 'TX', status: 'yes', detail: 'Origin transit.' },
        { stateCode: 'NY', status: 'yes', detail: 'Issuing state.' },
      ],
      destinationStateCode: 'NY',
    })
    expect(result).toBeNull()
  })
})
