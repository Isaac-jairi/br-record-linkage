/**
 * Run with: npm run example
 * Every name below is synthetic.
 */
import { compareNames, matchPerson, PhoneticIndex } from '../src/index.js'

// 1) Name-level similarity: accents, case, particles and surname order are all handled.
const pairs: [string, string][] = [
  ['José Carlos da Silva', 'JOSE CARLOS SILVA'],
  ['Maria Conceição Souza', 'Maria Conceicao Sousa'],
  ['Ana Paula Ferreira Lima', 'Ana Paula Lima Ferreira'],
  ['João Pedro dos Santos', 'Joao Pedro Santos'],
  ['Carlos Eduardo Rocha', 'Carla Eduarda Rocha'],
]
console.log('compareNames')
for (const [a, b] of pairs) {
  console.log(`  ${compareNames(a, b).toFixed(3)}  ${a}  ~  ${b}`)
}

// 2) Pair-level decision with the three-threshold rule.
console.log('\nmatchPerson')
const result = matchPerson(
  { name: 'José Carlos da Silva', motherName: 'Maria Aparecida de Souza' },
  { name: 'SILVA, JOSE CARLOS', motherName: 'MARIA APARECIDA SOUZA' }
)
console.log(' ', result)

const namesake = matchPerson(
  { name: 'José Carlos da Silva', motherName: 'Maria Aparecida de Souza' },
  { name: 'José Carlos da Silva', motherName: 'Francisca Oliveira Ramos' }
)
console.log(' ', namesake)

// 3) Phonetic blocking: only records sharing a Metaphone-PT-BR code become candidates.
console.log('\nPhoneticIndex')
const index = new PhoneticIndex<number>()
const people = [
  [1, 'Marisa Souza Lima'],
  [2, 'Mariza Sousa Lima'],
  [3, 'Felipe Andrade'],
  [4, 'Phelipe Andrade'],
  [5, 'Roberto Nunes'],
] as const
for (const [id, name] of people) index.add(id, name)
console.log('  candidates for "Marisa Souza":', index.candidates('Marisa Souza'))
console.log('  candidates for "Felipe":', index.candidates('Felipe'))
console.log('  candidates for "Roberto":', index.candidates('Roberto', 5))
