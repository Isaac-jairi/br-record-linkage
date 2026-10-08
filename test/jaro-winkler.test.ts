import { describe, expect, it } from 'vitest'
import { jaroWinkler } from '../src/fuzzy-string.js'

const samples = [
  'martha', 'marhta', 'dixon', 'dicksonx', 'jellyfish', 'smellyfish',
  'jose', 'joao', 'souza', 'sousa', 'a', 'ab', '', 'conceicao',
]

describe('jaroWinkler properties', () => {
  it('is bounded in [0, 1]', () => {
    for (const a of samples) for (const b of samples) {
      const s = jaroWinkler(a, b)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(1)
    }
  })
  it('is symmetric', () => {
    for (const a of samples) for (const b of samples) {
      expect(jaroWinkler(a, b)).toBeCloseTo(jaroWinkler(b, a), 12)
    }
  })
  it('returns 1 for identical non-empty strings and 0 when either side is empty', () => {
    for (const a of samples) {
      if (a === '') continue
      expect(jaroWinkler(a, a)).toBe(1)
      expect(jaroWinkler(a, '')).toBe(0)
    }
  })
})

describe('jaroWinkler reference values (Winkler strcmp95 calibration)', () => {
  it('matches well-known pairs', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.9611, 3)
    expect(jaroWinkler('dixon', 'dicksonx')).toBeCloseTo(0.8133, 3)
    expect(jaroWinkler('jellyfish', 'smellyfish')).toBeCloseTo(0.8963, 3)
  })
  it('does not apply the prefix bonus below the 0.7 boost threshold', () => {
    // "abcd" vs "abxyzw": shared prefix "ab" but Jaro is low, so no boost.
    expect(jaroWinkler('abcd', 'xyzw')).toBe(0)
  })
  it('normalizes internally', () => {
    expect(jaroWinkler('José', 'JOSE')).toBe(1)
  })
})
