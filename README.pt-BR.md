# br-record-linkage

> [Read in English](./README.md)

[![ci](https://github.com/Isaac-jairi/br-record-linkage/actions/workflows/ci.yml/badge.svg)](https://github.com/Isaac-jairi/br-record-linkage/actions/workflows/ci.yml)

Matching fuzzy de nomes em português brasileiro, em TypeScript e sem dependências.
Similaridade Jaro-Winkler, normalização específica para PT-BR, comparação por
token-sort e Monge-Elkan, blocking fonético com Metaphone-PT-BR e uma regra de decisão
com três limiares sobre o nome da pessoa e o nome da mãe.

**Status: prova de conceito.** Este código foi extraído do Alerta 180, uma plataforma
de resolução de identidades que construí para a Defensoria Pública do Estado de Mato
Grosso. A plataforma hoje roda em todo o estado, vinculando registros de pessoas
presas entre bases do sistema de justiça criminal (SIGEPEN, BNMP e outras). O que
está aqui é o núcleo de matching: o comparador de strings exatamente como roda em
produção, mais a regra de decisão e o índice de blocking extraídos do worker como
funções puras. Tudo o que toca dado real (ingestão, filas, persistência, trilha de
auditoria, a tela de validação humana) permanece no sistema original.

## O problema

Bases governamentais raramente concordam sobre como o nome de uma pessoa é escrito.
A mesma pessoa aparece como `José Carlos da Silva`, `JOSE CARLOS SILVA` e
`SILVA, JOSÉ CARLOS`. Acentos somem, `ç` vira `c` ou não, partículas como *de*, *da*,
*dos* aparecem e desaparecem, e sobrenomes trocam de ordem. Nem sempre há CPF, então
match exato não basta.

Similaridade genérica de strings resolve erro de digitação. Não resolve partículas do
português, ordem dos sobrenomes nem o fato de que, no Brasil, o nome da mãe é o
segundo identificador mais forte depois do CPF. Este módulo resolve.

## Como funciona

### 1. Normalização (`normaliza`, `tokenize`)

Decomposição Unicode NFD e remoção de todas as marcas combinantes (cobre acentos e
cedilha), caixa baixa depois da remoção, pontuação convertida em espaço preservando
hífens internos (`Auzier-Souza` continua um token só), espaços colapsados. `tokenize`
descarta partículas conectivas (`de`, `da`, `do`, `das`, `dos`, `e`, além de algumas
italianas e germânicas comuns em sobrenomes brasileiros).

### 2. Comparação de nomes (`compareNames`)

Jaro-Winkler escrito à mão com a calibração original de Winkler (p = 0,1, prefixo até
4, bônus só quando Jaro ≥ 0,7), aplicado por duas estratégias, ficando com a melhor:

- **Token-sort**: tokens ordenados alfabeticamente e comparados como uma string só.
  Resolve sobrenomes trocados (`Ferreira Lima` vs `Lima Ferreira`).
- **Monge-Elkan (simétrico)**: cada token casado com o melhor correspondente do outro
  lado, média, tomando o máximo das duas direções. Resolve tokens a mais ou a menos
  (`Maria Silva` vs `Maria Aparecida Silva`).

Um pré-filtro de comprimento pula as duas estratégias quando as strings normalizadas
diferem em mais de 6 caracteres, já que Jaro-Winkler raramente passa de 0,85 nesse caso.

### 3. Decisão (`matchPerson`)

Três limiares, todos obrigatórios. Os padrões espelham o ponto de operação de produção:

| regra | padrão |
|---|---|
| score do nome ≥ `nameThreshold` | 0,90 |
| score do nome da mãe ≥ `motherThreshold` (só quando os dois lados têm) | 0,90 |
| `nome × 0,8 + mãe × 0,2` ≥ `totalThreshold` | 0,91 |

Um único limiar combinado escondia o caso mais perigoso: nomes idênticos com mães
claramente diferentes. São homônimos, não a mesma pessoa, e o limiar por campo da mãe
veta esses pares mesmo com score de nome 1,0 e total acima de 0,91. Nome da mãe
ausente em um dos lados não veta o par; entra como 0 no total, o que, com os pesos
padrão, mantém o par abaixo do limiar geral.

### 4. Blocking antes da pontuação (`PhoneticIndex`)

Comparar todos os pares é O(N×M) e `compareNames` não é barato. O worker de produção
monta um índice invertido com os códigos Metaphone-PT-BR dos tokens de cada nome e só
compara registros que compartilham pelo menos um código. `Souza`/`Sousa`,
`Marisa`/`Mariza` e `Felipe`/`Phelipe` caem no mesmo bloco; nomes sem relação nunca
são pontuados.

## Uso

```ts
import { compareNames, matchPerson, PhoneticIndex } from './src/index.js'

compareNames('José Carlos da Silva', 'SILVA, JOSE CARLOS')   // 1
compareNames('Maria Conceição Souza', 'Maria Conceicao Sousa') // 0.981

const r = matchPerson(
  { name: 'José Carlos da Silva', motherName: 'Maria Aparecida de Souza' },
  { name: 'SILVA, JOSE CARLOS', motherName: 'MARIA APARECIDA SOUZA' }
)
// { nameScore: 1, motherScore: 1, totalScore: 1, isMatch: true, rejectedBy: null }

const homonimo = matchPerson(
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

## Por que zero dependências

A primeira versão usava o pacote `natural`, que traz mongoose, pg, redis e wordnet-db
como dependências transitivas para uma única função. Jaro-Winkler tem cerca de 40
linhas de lógica, então foi reescrito à mão com testes de propriedade (simetria,
identidade, limites 0..1) e valores de referência da calibração `strcmp95` de Winkler.
Não há dependências em runtime; as únicas de desenvolvimento são TypeScript, Vitest e tsx.

## Estrutura

```
src/fuzzy-string.ts   o comparador de produção, sem alterações (comentários em português)
src/match.ts          regra de decisão com três limiares, extraída do worker
src/blocking.ts       índice invertido Metaphone-PT-BR, extraído do worker
src/index.ts          exports públicos
test/                 39 testes, todas as fixtures sintéticas
examples/basic.ts     exemplo executável
docs/research-brief.md  a revisão de literatura que orientou a escolha dos parâmetros
```

## O que este repositório não inclui

- **Persistência e fluxo de trabalho.** Em produção, todo par que passa pelos
  limiares vai para uma fila de validação em que um analista aprova ou rejeita, e a
  decisão é gravada com soft delete para poder ser desfeita. Trate `isMatch` como
  "merece revisão humana", não como verdade.
- **Dados de calibração.** Os limiares foram calibrados em dados de produção e
  revisados pelos analistas que validam os matches. Não há registros reais neste
  repositório, então será preciso ter seus próprios pares de referência para recalibrar.
- **Apelidos e data de nascimento.** Tabela de apelidos e pontuação por data de
  nascimento estão mapeadas, mas não implementadas. Falso positivo custa caro neste
  domínio, então o matching começou conservador.

## Limites conhecidos

`compareNames('Carlos Eduardo Rocha', 'Carla Eduarda Rocha')` retorna 0,945, acima do
limiar de nome. Variantes de gênero do primeiro nome com sobrenome em comum são a
principal fonte de quase-acertos, e a razão de existirem o nome da mãe e a revisão humana.

## Licença

MIT. Autor: Isaac Jairi da Silva.
