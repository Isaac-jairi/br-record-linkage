import { describe, expect, it } from 'vitest'
import { compareNames, metaphonePtBr, mongeElkanSym, jaroWinkler } from '../src/fuzzy-string.js'

describe('compareNames', () => {
  it('ignores accents, case and particles', () => {
    expect(compareNames('José Carlos da Silva', 'JOSE CARLOS SILVA')).toBe(1)
  })
  it('handles surname order swaps', () => {
    expect(compareNames('Ana Paula Ferreira Lima', 'Ana Paula Lima Ferreira')).toBe(1)
  })
  it('handles the "SURNAME, Given" convention', () => {
    expect(compareNames('Silva, José Carlos', 'José Carlos da Silva')).toBe(1)
  })
  it('tolerates an extra token through Monge-Elkan when lengths are close', () => {
    expect(compareNames('José Silva Lima', 'José da Silva Lima')).toBe(1)
  })
  it('skips token strategies when the length gap exceeds the pre-filter', () => {
    // "jose da silva" (13) vs "jose antonio da silva" (21): gap 8 > default delta 6,
    // so compareNames returns raw Jaro-Winkler instead of running token-sort / Monge-Elkan.
    expect(compareNames('José da Silva', 'José Antônio da Silva')).toBeLessThan(0.9)
    expect(compareNames('José da Silva', 'José Antônio da Silva', { lengthPreFilterDelta: null })).toBe(1)
  })
  it('keeps different people apart', () => {
    expect(compareNames('Carlos Eduardo Rocha', 'Fernanda Lima Prado')).toBeLessThan(0.7)
  })
  it('is symmetric', () => {
    const a = 'Maria Conceição Souza'
    const b = 'Maria Aparecida Sousa Lima'
    expect(compareNames(a, b)).toBeCloseTo(compareNames(b, a), 12)
  })
  it('returns 0 for missing input', () => {
    expect(compareNames(null, 'x')).toBe(0)
    expect(compareNames('x', undefined)).toBe(0)
  })
  it('falls back to raw Jaro-Winkler when both strategies are off', () => {
    const s = compareNames('jose silva', 'jose silva lima', { usarTokenSort: false, usarMongeElkan: false })
    expect(s).toBeCloseTo(jaroWinkler('jose silva', 'jose silva lima'), 12)
  })
})

describe('mongeElkanSym', () => {
  it('scores a subset name as 1 because it takes the max of both directions', () => {
    expect(mongeElkanSym(['maria', 'silva'], ['maria', 'aparecida', 'silva'], jaroWinkler)).toBe(1)
  })
  it('returns 0 when a side is empty', () => {
    expect(mongeElkanSym([], ['a'], jaroWinkler)).toBe(0)
  })
})

describe('metaphonePtBr', () => {
  it('maps common spelling variants to the same code', () => {
    expect(metaphonePtBr('Souza')).toBe(metaphonePtBr('Sousa'))
    expect(metaphonePtBr('Marisa')).toBe(metaphonePtBr('Mariza'))
    expect(metaphonePtBr('Felipe')).toBe(metaphonePtBr('Phelipe'))
    expect(metaphonePtBr('Filho')).toBe(metaphonePtBr('Filo'))
  })
  it('separates clearly different names', () => {
    expect(metaphonePtBr('Roberto')).not.toBe(metaphonePtBr('Fernanda'))
  })
  it('returns empty for empty input', () => {
    expect(metaphonePtBr('')).toBe('')
  })
})
