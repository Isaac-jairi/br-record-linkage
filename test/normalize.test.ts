import { describe, expect, it } from 'vitest'
import { normaliza, tokenize, PARTICULAS } from '../src/fuzzy-string.js'

describe('normaliza', () => {
  it('strips diacritics, including cedilla', () => {
    expect(normaliza('José Conceição Araújo')).toBe('jose conceicao araujo')
  })
  it('lowercases and collapses whitespace', () => {
    expect(normaliza('  MARIA   DA   SILVA ')).toBe('maria da silva')
  })
  it('turns punctuation into spaces but keeps inner hyphens', () => {
    expect(normaliza('Silva, José')).toBe('silva jose')
    expect(normaliza('Auzier-Souza')).toBe('auzier-souza')
    expect(normaliza('- Souza -')).toBe('souza')
  })
  it('returns empty string for empty input', () => {
    expect(normaliza('')).toBe('')
  })
})

describe('tokenize', () => {
  it('drops connective particles by default', () => {
    expect(tokenize('jose carlos da silva')).toEqual(['jose', 'carlos', 'silva'])
    expect(tokenize('maria e souza dos santos')).toEqual(['maria', 'souza', 'santos'])
  })
  it('keeps particles when asked', () => {
    expect(tokenize('jose da silva', { dropParticulas: false })).toEqual(['jose', 'da', 'silva'])
  })
  it('treats every particle in PARTICULAS as droppable', () => {
    for (const p of PARTICULAS) expect(tokenize(`ana ${p} lima`)).toEqual(['ana', 'lima'])
  })
})
