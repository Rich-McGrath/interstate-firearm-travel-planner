import { describe, it, expect } from 'vitest'
import { scoreStops } from '../rules/scoreStops'
import type { StopFilters, StopRecommendation } from '../types/domain'

function stop(over: Partial<StopRecommendation>): StopRecommendation {
  return {
    id: over.id ?? 'x',
    name: over.name ?? 'X',
    category: over.category ?? 'gas',
    address: over.address ?? '',
    lat: 0,
    lng: 0,
    distanceOffRouteMiles: over.distanceOffRouteMiles ?? 1,
    rating: over.rating,
    reviewCount: over.reviewCount,
    isOpenNow: over.isOpenNow,
    chainBrand: over.chainBrand,
    inCommercialCorridor: over.inCommercialCorridor,
    score: 0,
    label: 'manual_review',
    reasons: [],
    ...over,
  }
}

const defaultFilters: StopFilters = {
  category: 'all',
  openNowOnly: false,
  chainOnly: false,
  sortBy: 'score',
}

describe('scoreStops', () => {
  it('ranks an open, highly rated, low-detour chain stop above a weak alternative', () => {
    const strong = stop({
      id: 'strong',
      distanceOffRouteMiles: 0.3,
      rating: 4.5,
      reviewCount: 1500,
      isOpenNow: true,
      chainBrand: true,
      inCommercialCorridor: true,
    })
    const weak = stop({
      id: 'weak',
      distanceOffRouteMiles: 4.5,
      rating: 3.0,
      reviewCount: 8,
      isOpenNow: false,
      chainBrand: false,
      inCommercialCorridor: false,
    })

    const result = scoreStops([weak, strong], defaultFilters)
    expect(result[0]?.id).toBe('strong')
    expect(result[1]?.id).toBe('weak')
    expect(result[0]?.label).toBe('recommended')
  })

  it('respects the openNowOnly filter', () => {
    const open = stop({ id: 'open', isOpenNow: true })
    const closed = stop({ id: 'closed', isOpenNow: false })
    const result = scoreStops([open, closed], { ...defaultFilters, openNowOnly: true })
    expect(result.map((r) => r.id)).toEqual(['open'])
  })

  it('respects the chainOnly filter', () => {
    const chain = stop({ id: 'chain', chainBrand: true })
    const indep = stop({ id: 'indep', chainBrand: false })
    const result = scoreStops([chain, indep], { ...defaultFilters, chainOnly: true })
    expect(result.map((r) => r.id)).toEqual(['chain'])
  })

  it('matches gas_food stops when filtering by gas or food', () => {
    const both = stop({ id: 'both', category: 'gas_food' })
    const food = stop({ id: 'food', category: 'food' })
    const gas = stop({ id: 'gas', category: 'gas' })
    const gasFiltered = scoreStops([both, food, gas], { ...defaultFilters, category: 'gas' })
    expect(gasFiltered.find((s) => s.id === 'both')).toBeDefined()
    expect(gasFiltered.find((s) => s.id === 'gas')).toBeDefined()
    expect(gasFiltered.find((s) => s.id === 'food')).toBeUndefined()
  })

  it('sorts by detour when requested', () => {
    const a = stop({ id: 'a', distanceOffRouteMiles: 3 })
    const b = stop({ id: 'b', distanceOffRouteMiles: 0.5 })
    const c = stop({ id: 'c', distanceOffRouteMiles: 1.5 })
    const result = scoreStops([a, b, c], { ...defaultFilters, sortBy: 'detour' })
    expect(result.map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('labels low-detour, well-rated, but closed/independent stops as better_traffic, not recommended', () => {
    const s = stop({
      id: 's',
      distanceOffRouteMiles: 0.4,
      rating: 4.0,
      isOpenNow: false,
      chainBrand: false,
    })
    const result = scoreStops([s], defaultFilters)
    expect(result[0]?.label).toBe('better_traffic')
  })
})
