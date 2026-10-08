# br-record-linkage

> [Leia em português](./README.pt-BR.md)

[![ci](https://github.com/Isaac-jairi/br-record-linkage/actions/workflows/ci.yml/badge.svg)](https://github.com/Isaac-jairi/br-record-linkage/actions/workflows/ci.yml)

Zero-dependency fuzzy name matching for Brazilian Portuguese, written in TypeScript.
Jaro-Winkler similarity, PT-BR aware normalization, token-sort and Monge-Elkan
comparison, Metaphone-PT-BR phonetic blocking, and a three-threshold decision rule
over the person's name and the mother's name.

**Status: proof of concept.** This code was extracted from Alerta 180, an identity
resolution platform I built for the Public Defender's Office of Mato Grosso, Brazil.
The platform runs statewide today, linking records of incarcerated people across
criminal justice databases (SIGEPEN, BNMP and others). What is here is the matching
core: the string comparator exactly as it runs in production, plus the decision rule
and the blocking index extracted from the worker as pure functions. Everything that
touches real data (ingestion, queues, persistence, audit trail, the human validation
screen) stays in the original system.

## The problem

Government databases rarely agree on how a person's name is written. The same
person shows up as `José Carlos da Silva`, `JOSE CARLOS SILVA` and
`SILVA, JOSÉ CARLOS`. Accents go missing, `ç` becomes `c` or stays, particles like
*de*, *da*, *dos* appear and disappear, and surnames change order. A national ID
(CPF) is not always present, so exact matching is not enough.

Generic string similarity handles typos. It does not handle Portuguese particles,
surname order, or the fact that in Brazil the mother's name is the second strongest
identifier after the CPF. This module does.

## How it works

### 1. Normalize (`normaliza`, `tokenize`)

Unicode NFD decomposition and removal of every combining mark (which covers accents
and the cedilla), lowercasing after the strip, punctuation turned into spaces with
inner hyphens preserved (`Auzier-Souza` stays one token), whitespace collapsed.
`tokenize` then drops connective particles (`de`, `da`, `do`, `das`, `dos`, `e`, plus
a few Italian and Germanic ones common in Brazilian surnames).

### 2. Compare names (`compareNames`)

A hand-written Jaro-Winkler with Winkler's original calibration (p = 0.1, prefix up to
4, boost only when Jaro ≥ 0.7), applied through two strategies and taking the best:

- **Token-sort**: tokens sorted alphabetically and compared as one string. Handles
  swapped surnames (`Ferreira Lima` vs `Lima Ferreira`).
- **Monge-Elkan (symmetric)**: each token matched against its best counterpart on the
  other side, averaged, taking the max of both directions. Handles extra or missing
  tokens (`Maria Silva` vs `Maria Aparecida Silva`).

A length pre-filter skips both strategies when the normalized strings differ by more
than 6 characters, since Jaro-Winkler rarely clears 0.85 in that case.

### 3. Decide (`matchPerson`)

Three thresholds, all required. Defaults mirror the production operating point:

| rule | default |
|---|---|
| name score ≥ `nameThreshold` | 0.90 |
| mother's name score ≥ `motherThreshold` (only when both sides have one) | 0.90 |
| `name × 0.8 + mother × 0.2` ≥ `totalThreshold` | 0.91 |

A single combined cut-off hid the most dangerous case: identical names with clearly
different mothers. Those are namesakes, not the same person, and the per-field mother
threshold vetoes them even when the name score is 1.0 and the total is above 0.91.
A missing mother's name on one side does not veto the pair; it scores 0 in the total,
which with the default weights keeps the pair below the overall threshold.

### 4. Block before scoring (`PhoneticIndex`)

Comparing every pair is O(N×M) and `compareNames` is not cheap. The production worker
builds an inverted index from Metaphone-PT-BR codes of each name's tokens and only
compares records that share at least one code. `Souza`/`Sousa`, `Marisa`/`Mariza` and
`Felipe`/`Phelipe` land in the same block; unrelated names are never scored.

## Usage

```ts
import { compareNames, matchPerson, PhoneticIndex } from './src/index.js'

compareNames('José Carlos da Silva', 'SILVA, JOSE CARLOS')   // 1
compareNames('Maria Conceição Souza', 'Maria Conceicao Sousa') // 0.981

const r = matchPerson(
  { name: 'José Carlos da Silva', motherName: 'Maria Aparecida de Souza' },
  { name: 'SILVA, JOSE CARLOS', motherName: 'MARIA APARECIDA SOUZA' }
)
// { nameScore: 1, motherScore: 1, totalScore: 1, isMatch: true, rejectedBy: null }

const namesake = matchPerson(
  { name: 'José Carlos da Silva', motherName: 'Maria Aparecida de Souza' },
  { name: 'José Carlos da Silva', motherName: 'Francisca Oliveira Ramos' }
)
// { nameScore: 1, motherScore: 0.646, totalScore: 0.929, isMatch: false,
//   rejectedBy: 'mother-below-threshold' }

const index = new PhoneticIndex<number>()
index.add(1, 'Marisa Souza Lima')
index.add(2, 'Mariza Sousa Lima')
index.add(3, 'Roberto Nunes')
index.candidates('Marisa Souza') // [1, 2]
```

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run example   # examples/basic.ts
```

## Why zero dependencies

The first version used the `natural` package, which pulls in mongoose, pg, redis and
wordnet-db as transitive dependencies for a single function. Jaro-Winkler is about 40
lines of logic, so it was rewritten by hand with property tests (symmetry, identity,
0..1 bounds) and reference values from Winkler's `strcmp95` calibration. There are no
runtime dependencies; the only dev dependencies are TypeScript, Vitest and tsx.

## Layout

```
src/fuzzy-string.ts   the production comparator, verbatim (comments in Portuguese)
src/match.ts          three-threshold decision rule extracted from the worker
src/blocking.ts       Metaphone-PT-BR inverted index extracted from the worker
src/index.ts          public exports
test/                 39 tests, all fixtures synthetic
examples/basic.ts     runnable walkthrough
docs/research-brief.md  the literature review that drove the parameter choices
```

## What this repository does not include

- **Persistence and workflow.** In production every pair that passes the thresholds
  goes to a validation queue where an analyst approves or rejects it, and the decision
  is stored with a soft delete so it can be undone. Treat `isMatch` as "worth a human
  look", not as truth.
- **Calibration data.** The thresholds were tuned on production data and reviewed by
  the analysts who validate matches. No real records are in this repository, so you
  will need your own gold-standard pairs to re-tune them.
- **Nicknames and birth date.** A nickname table and date-of-birth scoring are mapped
  but not implemented. False positives are expensive in this domain, so the matching
  started conservative.

## Known limits

`compareNames('Carlos Eduardo Rocha', 'Carla Eduarda Rocha')` returns 0.945, above
the name threshold. Gender-variant given names with a shared surname are the main
source of near-misses, and the reason the mother's name and the human review exist.

## License

MIT. Author: Isaac Jairi da Silva.
