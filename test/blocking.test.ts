import { describe, expect, it } from 'vitest'
import { PhoneticIndex, phoneticCodes } from '../src/blocking.js'

describe('phoneticCodes', () => {
  it('drops particles and short codes, and deduplicates', () => {
    const codes = phoneticCodes('Souza de Sousa')
    expect(codes).toHaveLength(1)
  })
  it('returns empty for missing input', () => {
    expect(phoneticCodes(null)).toEqual([])
  })
})

describe('PhoneticIndex', () => {
  const index = new PhoneticIndex<number>()
  index.add(1, 'Marisa Souza Lima')
  index.add(2, 'Mariza Sousa Lima')
  index.add(3, 'Felipe Andrade')
  index.add(4, 'Phelipe Andrade')
  index.add(5, 'Roberto Nunes')

  it('returns records that share at least one phonetic code', () => {
    expect(index.candidates('Marisa Souza').sort()).toEqual([1, 2])
    expect(index.candidates('Felipe').sort()).toEqual([3, 4])
  })
  it('excludes the record itself when asked', () => {
    expect(index.candidates('Roberto Nunes', 5)).toEqual([])
  })
  it('returns nothing for a name with no shared code', () => {
    expect(index.candidates('Xavier')).toEqual([])
  })
})
