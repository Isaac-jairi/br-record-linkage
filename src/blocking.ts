/**
 * blocking.ts: Phonetic blocking with Metaphone-PT-BR.
 *
 * Comparing every pending record against every known record is O(N×M), and
 * `compareNames` is not cheap (normalization, token-sort, Monge-Elkan, several
 * Jaro-Winkler calls per pair). Blocking cuts the candidate set before any
 * scoring happens: two names only get compared when at least one of their
 * tokens shares a phonetic code.
 *
 * Phonetic codes are a good blocking key for Brazilian names because spelling
 * variation for the same sound is common ("Souza"/"Sousa", "Marisa"/"Mariza",
 * "Felipe"/"Phelipe"). Codes shorter than 2 characters are dropped: they would
 * put most of the dataset in the same block and defeat the purpose.
 *
 * This is the same inverted index the production worker builds in memory
 * before its comparison loop, extracted as a small class.
 */

import { metaphonePtBr, normaliza, tokenize } from './fuzzy-string.js'

/** Phonetic codes of a name's tokens, deduplicated, with codes shorter than `minCodeLength` removed. */
export function phoneticCodes(name: string | null | undefined, minCodeLength = 2): string[] {
  if (!name) return []
  const codes = tokenize(normaliza(name))
    .map(metaphonePtBr)
    .filter((c) => c.length >= minCodeLength)
  return [...new Set(codes)]
}

export class PhoneticIndex<Id = string> {
  private readonly index = new Map<string, Set<Id>>()

  constructor(private readonly minCodeLength = 2) {}

  /** Adds one record. The same id may be added under several codes. */
  add(id: Id, name: string | null | undefined): void {
    for (const code of phoneticCodes(name, this.minCodeLength)) {
      let bucket = this.index.get(code)
      if (!bucket) {
        bucket = new Set()
        this.index.set(code, bucket)
      }
      bucket.add(id)
    }
  }

  /** Ids that share at least one phonetic code with `name`. Never includes `exclude`. */
  candidates(name: string | null | undefined, exclude?: Id): Id[] {
    const ids = new Set<Id>()
    for (const code of phoneticCodes(name, this.minCodeLength)) {
      const bucket = this.index.get(code)
      if (!bucket) continue
      for (const id of bucket) ids.add(id)
    }
    if (exclude !== undefined) ids.delete(exclude)
    return [...ids]
  }

  /** Number of distinct phonetic codes in the index. */
  get size(): number {
    return this.index.size
  }
}
