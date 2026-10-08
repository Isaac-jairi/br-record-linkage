/**
 * match.ts: Pair-level decision rule on top of `compareNames`.
 *
 * This is the scoring step of the production worker, extracted as a pure
 * function. The worker itself (queue, persistence, audit trail, human
 * validation) is not part of this repository.
 *
 * Decision rule (defaults mirror the production operating point):
 *   1. nameScore   = compareNames(a.name, b.name)       must be >= nameThreshold
 *   2. motherScore = compareNames(a.mother, b.mother)   must be >= motherThreshold,
 *      but only when BOTH sides have a mother's name. A missing mother's name on
 *      either side does not veto the pair; it just contributes 0 to the total.
 *   3. totalScore  = nameScore * nameWeight + (motherScore ?? 0) * motherWeight
 *      must be >= totalThreshold
 *
 * Why three thresholds instead of one: a single combined cut-off hid the most
 * dangerous case, identical names with clearly different mothers. Those are
 * namesakes, not the same person, and the per-field mother threshold vetoes
 * them even when the name score is 1.0.
 */

import { compareNames } from './fuzzy-string.js'

export interface PersonRecord {
  /** Full name as it appears in the source system. */
  name: string | null | undefined
  /** Mother's full name as it appears in the source system. */
  motherName?: string | null | undefined
}

export interface MatchConfig {
  /** Minimum `compareNames` score for the person's name. Default 0.9. */
  nameThreshold: number
  /** Minimum `compareNames` score for the mother's name (only enforced when both sides have one). Default 0.9. */
  motherThreshold: number
  /** Minimum weighted total. Default 0.91. */
  totalThreshold: number
  /** Weight of the name score in the total. Default 0.8. */
  nameWeight: number
  /** Weight of the mother's name score in the total. Default 0.2. */
  motherWeight: number
  /** Enable the token-sort strategy inside `compareNames`. Default true. */
  useTokenSort: boolean
  /** Enable the Monge-Elkan strategy inside `compareNames`. Default true. */
  useMongeElkan: boolean
}

export const DEFAULT_MATCH_CONFIG: Readonly<MatchConfig> = Object.freeze({
  nameThreshold: 0.9,
  motherThreshold: 0.9,
  totalThreshold: 0.91,
  nameWeight: 0.8,
  motherWeight: 0.2,
  useTokenSort: true,
  useMongeElkan: true,
})

export type MatchRejection =
  | 'missing-name'
  | 'name-below-threshold'
  | 'mother-below-threshold'
  | 'total-below-threshold'

export interface MatchResult {
  /** Similarity of the two names in [0, 1]. */
  nameScore: number
  /** Similarity of the two mothers' names in [0, 1], or null when either side has none. */
  motherScore: number | null
  /** Weighted total in [0, 1]. */
  totalScore: number
  /** True when every threshold passed. In production this means "send to human validation", not "same person". */
  isMatch: boolean
  /** Which rule stopped the pair, when `isMatch` is false. */
  rejectedBy: MatchRejection | null
}

/**
 * Scores a pair of person records and applies the three-threshold rule.
 * Pure and symmetric: `matchPerson(a, b)` and `matchPerson(b, a)` return the same result.
 */
export function matchPerson(
  a: PersonRecord,
  b: PersonRecord,
  config: Partial<MatchConfig> = {}
): MatchResult {
  const cfg: MatchConfig = { ...DEFAULT_MATCH_CONFIG, ...config }
  const compareOpts = { usarTokenSort: cfg.useTokenSort, usarMongeElkan: cfg.useMongeElkan }

  if (!a.name || !b.name) {
    return { nameScore: 0, motherScore: null, totalScore: 0, isMatch: false, rejectedBy: 'missing-name' }
  }

  const nameScore = compareNames(a.name, b.name, compareOpts)

  const motherScore =
    a.motherName && b.motherName ? compareNames(a.motherName, b.motherName, compareOpts) : null

  const totalScore = nameScore * cfg.nameWeight + (motherScore ?? 0) * cfg.motherWeight

  let rejectedBy: MatchRejection | null = null
  if (nameScore < cfg.nameThreshold) rejectedBy = 'name-below-threshold'
  else if (motherScore !== null && motherScore < cfg.motherThreshold) rejectedBy = 'mother-below-threshold'
  else if (totalScore < cfg.totalThreshold) rejectedBy = 'total-below-threshold'

  return { nameScore, motherScore, totalScore, isMatch: rejectedBy === null, rejectedBy }
}
