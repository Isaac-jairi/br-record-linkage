export {
  PARTICULAS,
  normaliza,
  tokenize,
  jaroWinkler,
  mongeElkanSym,
  metaphonePtBr,
  compareNames,
} from './fuzzy-string.js'

export { matchPerson, DEFAULT_MATCH_CONFIG } from './match.js'
export type { PersonRecord, MatchConfig, MatchResult, MatchRejection } from './match.js'

export { PhoneticIndex, phoneticCodes } from './blocking.js'
