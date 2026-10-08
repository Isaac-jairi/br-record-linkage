import { describe, expect, it } from 'vitest'
import { matchPerson, DEFAULT_MATCH_CONFIG } from '../src/match.js'

const a = { name: 'José Carlos da Silva', motherName: 'Maria Aparecida de Souza' }

describe('matchPerson', () => {
  it('matches the same person written differently in two systems', () => {
    const r = matchPerson(a, { name: 'SILVA, JOSE CARLOS', motherName: 'MARIA APARECIDA SOUZA' })
    expect(r.isMatch).toBe(true)
    expect(r.rejectedBy).toBeNull()
    expect(r.nameScore).toBe(1)
    expect(r.motherScore).toBe(1)
    expect(r.totalScore).toBeCloseTo(1, 12)
  })

  it('vetoes a namesake with a different mother even when the name score is 1', () => {
    const r = matchPerson(a, { name: 'José Carlos da Silva', motherName: 'Francisca Oliveira Ramos' })
    expect(r.nameScore).toBe(1)
    expect(r.isMatch).toBe(false)
    expect(r.rejectedBy).toBe('mother-below-threshold')
  })

  it('rejects on the name threshold before looking at the mother', () => {
    const r = matchPerson(a, { name: 'Fernanda Lima Prado', motherName: 'Maria Aparecida de Souza' })
    expect(r.isMatch).toBe(false)
    expect(r.rejectedBy).toBe('name-below-threshold')
  })

  it('does not veto on a missing mother, but the missing side scores 0 in the total', () => {
    const r = matchPerson(a, { name: 'José Carlos da Silva' })
    expect(r.motherScore).toBeNull()
    expect(r.totalScore).toBeCloseTo(DEFAULT_MATCH_CONFIG.nameWeight, 12)
    expect(r.rejectedBy).toBe('total-below-threshold')
  })

  it('reports missing names explicitly', () => {
    expect(matchPerson({ name: '' }, a).rejectedBy).toBe('missing-name')
  })

  it('is symmetric', () => {
    const b = { name: 'Jose Carlos Silva', motherName: 'Maria Aparecida Souza Lima' }
    const ab = matchPerson(a, b)
    const ba = matchPerson(b, a)
    expect(ab.nameScore).toBeCloseTo(ba.nameScore, 12)
    expect(ab.totalScore).toBeCloseTo(ba.totalScore, 12)
    expect(ab.isMatch).toBe(ba.isMatch)
  })

  it('accepts a custom configuration', () => {
    const r = matchPerson(a, { name: 'José Carlos da Silva' }, { motherWeight: 0, nameWeight: 1 })
    expect(r.isMatch).toBe(true)
  })
})
