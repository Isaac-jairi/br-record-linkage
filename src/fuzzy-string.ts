/**
 * fuzzy-string.ts — Comparação fuzzy de nomes para record linkage PT-BR
 * =====================================================================
 *
 * Implementa o pipeline recomendado no docs/research-brief.md (paper):
 *   normalize → tokenize → metaphone block → compareNames(max(JW_sorted, MongeElkan))
 *
 * Base: Jaro (1989) + Winkler (1990) + Cohen/Ravikumar/Fienberg (IJCAI-2003) +
 *       Christen (2006) + CIDACS-RL (Fiocruz, 100M-Brazilian-Cohort).
 *
 * Glossário de abreviações usado neste módulo e no docs/research-brief.md:
 *   JW         — Jaro–Winkler: variante de Jaro com bônus para prefixo comum.
 *   Jaro       — Similaridade baseada em chars em comum dentro de uma janela e transposições.
 *   τ (tau)    — Boost threshold; abaixo dela, JW não aplica o bônus de prefixo (padrão 0.7).
 *   p          — Scaling factor do prefixo (padrão 0.1; deve respeitar p · L_max ≤ 1).
 *   L_max      — Tamanho máximo do prefixo considerado para o bônus (padrão 4).
 *   m, t       — m = chars que casaram entre s1 e s2; t = transposições / 2.
 *   NFD        — Normalization Form Decomposed (Unicode): separa base + combining marks.
 *   PT-BR      — Português Brasileiro.
 *   ME         — Monge–Elkan: agregação token-a-token assimétrica de uma similaridade base.
 *   Token-sort — Ordenar tokens alfabeticamente antes de comparar (lida com troca de sobrenomes).
 *   Metaphone-PT-BR — Codificação fonética PT-BR (regras Carlos Jordão); chave de blocking.
 *   Blocking   — Particionar candidatos antes da comparação para reduzir custo de O(N²) a O(N·k).
 *   CIDACS-RL  — Centro de Integração de Dados e Conhecimentos para Saúde / Record Linkage (Fiocruz).
 *   AtyImo     — Engine de record linkage usada pelo CIDACS-RL no 100M-Brazilian-Cohort.
 *   SUS        — Sistema Único de Saúde.
 *   BNMP       — Banco Nacional de Monitoramento de Prisões (CNJ).
 *   SIGEPEN    — Sistema de Gestão Penitenciária.
 *   CPF        — Cadastro de Pessoas Físicas (identificador fiscal brasileiro).
 *   PG         — PessoaGlobal: entidade consolidada deste sistema, com 1..N relacionamentos.
 *   IdentidadeExterna — registro bruto importado de SIGEPEN/BNMP/outro sistema.
 *   FilaDeProcessamento — fila do worker; estados: pendente | processado | comparado.
 */

// `PARTICULAS` — conjunto de tokens conectivos sem valor identificador.
// Recebe: nada (constante).
// Entrega: Set imutável usado por `tokenize` para descartar tokens.
// Por quê: "de/da/do/das/dos/e" aparecem inconsistentemente entre bases (SIGEPEN tem,
// BNMP às vezes não); incluir/omitir essas partículas vira ruído puro no JW.
// Lista do paper §6 (estendida com partículas italianas/germânicas comuns em sobrenomes BR).
export const PARTICULAS: ReadonlySet<string> = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e',
  'di', 'du', 'del', 'della', 'dello',
  'von', 'van', 'der', 'la', 'le',
])

// `normaliza` — pipeline de canonização de uma string de nome PT-BR.
// Recebe: string crua (possivelmente com acentos, case misto, pontuação, espaços extras).
// Entrega: string em lowercase, sem diacríticos, sem pontuação (exceto hífen interno),
//          com whitespace colapsado e sem espaços nas pontas.
// Por quê: o paper §6 mostra que normalização agressiva é o ÚNICO passo de maior
// alavancagem para PT-BR — a maioria dos "falsos negativos" do JW vem de acentuação
// inconsistente, não do algoritmo. Ordem dos passos importa: lowercase só DEPOIS
// de strip de combining marks para garantir que ç (U+00E7) → c sem ambiguidade.
export function normaliza(s: string): string {
  if (!s) return ''
  return s
    // 1) NFD decompõe ç→c+◌̧, á→a+◌́, etc. para que combining marks fiquem isoláveis.
    .normalize('NFD')
    // 2) Remove TODOS os combining marks (categoria Unicode "Mark") — \p{M} cobre acentos,
    //    cedilha, til, etc. Mais robusto que regex literal de faixa U+0300–U+036F.
    .replace(/\p{M}/gu, '')
    // 3) Lowercase só depois do strip (evita problemas com case + cedilha em alguns locales).
    .toLowerCase()
    // 4) Substitui pontuação por espaço, MAS preserva hífens entre letras (ex.: "Auzier-Souza"
    //    deve ficar "auzier-souza" e não "auzier souza" — o paper §6 alerta sobre isso).
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')              // mantém letras, dígitos, espaços e hífens
    .replace(/(?<![\p{L}\p{N}])-+|-+(?![\p{L}\p{N}])/gu, ' ')  // remove hífens isolados (preserva os internos)
    // 5) Colapsa whitespace múltiplo em espaço simples.
    .replace(/\s+/g, ' ')
    // 6) Tira espaços nas bordas.
    .trim()
}

// `tokenize` — quebra um nome normalizado em tokens significativos.
// Recebe: string (idealmente já passou por `normaliza`) e opts.
// Entrega: array de tokens em lowercase, sem partículas (opt-out), sem strings vazias.
// Por quê: comparação token-a-token (Monge-Elkan, token-sort) requer particionar o nome.
// `dropParticulas=true` por padrão remove "de/da/do" porque diferentes bases gravam
// esses conectivos de forma inconsistente.
export function tokenize(s: string, opts: { dropParticulas?: boolean } = {}): string[] {
  const { dropParticulas = true } = opts
  if (!s) return []
  const toks = s.split(/\s+/).filter((t) => t.length > 0)
  if (!dropParticulas) return toks
  return toks.filter((t) => !PARTICULAS.has(t))
}

// `jaroDistance` — similaridade de Jaro pura (sem boost de prefixo).
// Recebe: duas strings (já normalizadas pelo caller, ou cruas — função não normaliza).
// Entrega: número em [0, 1]; 1.0 = idêntico, 0.0 = nenhum char em comum dentro da janela.
// Por quê: base matemática de toda a família. Fórmula:
//   sim_J = ( m/|s1| + m/|s2| + (m-t)/m ) / 3
// onde:
//   m = chars que casaram dentro da janela ⌊max(|s1|,|s2|)/2⌋ - 1.
//   t = transposições/2 (pares de chars que casaram mas em ordens diferentes).
// Edge cases seguem strcmp95.c do Census Bureau:
//   - s1==s2 → 1.0
//   - len 0 em qualquer dos lados → 0.0
//   - m == 0 → 0.0 (sem boost)
function jaroDistance(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const len1 = s1.length
  const len2 = s2.length
  if (len1 === 0 || len2 === 0) return 0

  // Janela de matching: chars precisam estar a no máximo `matchWindow` posições de distância.
  // Math.max(0, ...) garante que strings curtas (len ≤ 2) caem para janela 0 = só matches na
  // mesma posição (comportamento idêntico ao reference strcmp95.c).
  const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1)
  const s1Matches = new Array<boolean>(len1).fill(false)
  const s2Matches = new Array<boolean>(len2).fill(false)

  // Passo 1: conta `matches` — chars iguais dentro da janela; cada posição em s2 pode ser
  // reivindicada apenas uma vez (greedy first-fit).
  let matches = 0
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow)
    const end = Math.min(i + matchWindow + 1, len2)
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue
      if (s1[i] !== s2[j]) continue
      s1Matches[i] = true
      s2Matches[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0

  // Passo 2: conta transposições — pares de chars que casaram mas aparecem em ordens diferentes.
  // Percorre s1 e s2 em paralelo, contando quando o k-ésimo match em s1 difere do k-ésimo em s2.
  let transpositions = 0
  let k = 0
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue
    while (!s2Matches[k]) k++   // avança k até o próximo match em s2
    if (s1[i] !== s2[k]) transpositions++
    k++
  }

  // Fórmula final: média das três frações (cobertura em s1, cobertura em s2, ordem preservada).
  return (
    matches / len1 +
    matches / len2 +
    (matches - transpositions / 2) / matches
  ) / 3
}

// `jaroWinkler` — Jaro com bônus de prefixo comum (Winkler 1990).
// Recebe: duas strings a, b e opcionalmente `scalingFactor` p (padrão 0.1).
// Entrega: número em [0, 1]; sempre ≥ jaroDistance(a, b).
// Por quê: typos são raros no INÍCIO de nomes (Pollock & Zamora 1984). Winkler dá um bônus
// linear proporcional ao prefixo em comum (até L_max=4 chars) quando o Jaro base já cruzou
// τ=0.7 — o threshold evita inflar pares dissimilares que casualmente compartilham 1 letra.
// Fórmula:
//   sim_JW = sim_J + L · p · (1 - sim_J)   se sim_J ≥ τ
//          = sim_J                          caso contrário
// IMPORTANTE: esta função NORMALIZA internamente (compat. com callers antigos). `compareNames`
// já normaliza antes, então o custo extra é desprezível mas existe — chamar `jaroDistance`
// direto se quiser comparar strings pré-canonizadas sem rodar `normaliza` duas vezes.
export function jaroWinkler(a: string, b: string, scalingFactor = 0.1): number {
  const s1 = normaliza(a)
  const s2 = normaliza(b)
  const jaro = jaroDistance(s1, s2)
  // τ = 0.7: Winkler strcmp95.c hard-coded. Não aplica bônus se Jaro já é baixo.
  if (jaro < 0.7) return jaro

  // Conta prefixo comum até L_max=4 chars (Winkler default).
  let prefix = 0
  const maxPrefix = Math.min(4, s1.length, s2.length)
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) prefix++
    else break
  }
  return jaro + prefix * scalingFactor * (1 - jaro)
}

// `jaroWinklerNorm` — variante que NÃO renormaliza (assume strings já canonizadas).
// Recebe: duas strings já passadas por `normaliza`.
// Entrega: número em [0, 1].
// Por quê: `compareNames` e o índice de blocking já normalizam — chamar `jaroWinkler` lá
// rodaria `normaliza` duas vezes por par. Usar este para evitar trabalho redundante.
function jaroWinklerNorm(s1: string, s2: string, scalingFactor = 0.1): number {
  const jaro = jaroDistance(s1, s2)
  if (jaro < 0.7) return jaro
  let prefix = 0
  const maxPrefix = Math.min(4, s1.length, s2.length)
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) prefix++
    else break
  }
  return jaro + prefix * scalingFactor * (1 - jaro)
}

// `mongeElkan` — agregação token-a-token assimétrica.
// Recebe: dois arrays de tokens `a` e `b`, e uma função de similaridade `sim` (ex.: jaroWinkler).
// Entrega: número em [0, 1]; média das melhores similaridades de cada token de `a` contra `b`.
// Por quê: ME(a,b) ≠ ME(b,a) — assimétrico. Captura "cada token de a tem um bom par em b?".
// Fórmula: ME(a,b) = (1/|a|) · Σᵢ maxⱼ sim(aᵢ, bⱼ)
// Cohen et al. (IJCAI-2003) mostraram que ME(jaroWinkler) é um dos melhores comparators
// para nomes com tokens em ordem trocada ou tokens extras/faltantes.
function mongeElkan(a: string[], b: string[], sim: (x: string, y: string) => number): number {
  if (a.length === 0 || b.length === 0) return 0
  let sum = 0
  for (const tokA of a) {
    let best = 0
    for (const tokB of b) {
      const s = sim(tokA, tokB)
      if (s > best) best = s
    }
    sum += best
  }
  return sum / a.length
}

// `mongeElkanSym` — versão simétrica via max(ME(a,b), ME(b,a)).
// Recebe: idem mongeElkan.
// Entrega: número em [0, 1], simétrico (não depende da ordem dos argumentos).
// Por quê: comparar dois nomes deve dar o mesmo resultado independente de quem é "a" ou "b".
// Tomar `max` em vez de média favorece o caso em que um nome é subset do outro
// (ex.: "Maria Silva" vs "Maria Aparecida Silva" — ME(a,b)=1.0 puxa o resultado).
export function mongeElkanSym(a: string[], b: string[], sim: (x: string, y: string) => number): number {
  return Math.max(mongeElkan(a, b, sim), mongeElkan(b, a, sim))
}

// `metaphonePtBr` — chave fonética simplificada para PT-BR.
// Recebe: um token de nome (com ou sem acento, com ou sem case).
// Entrega: string ASCII representando a classe sonora (ex.: "Souza"→"SUZA", "Sousa"→"SUZA").
//          Strings vazias ou que reduzem a nada retornam ''.
// Por quê: nomes brasileiros têm muita variação ortográfica para o MESMO som
// ("Souza"/"Sousa", "Silva"/"Silba" em ditados regionais, "Marisa"/"Mariza", "Felipe"/"Phelipe").
// Usado como CHAVE DE BLOCKING: dois nomes com mesma classe fonética em ≥ 1 token viram
// candidatos para comparação JW; nomes sem chave em comum são pulados.
// Regras simplificadas do port Carlos Jordão (ver docs/research-brief.md §6).
// Aplicadas EM ORDEM — ordem importa porque algumas regras consomem chars que outras testariam.
export function metaphonePtBr(token: string): string {
  if (!token) return ''
  // Normaliza acentos/cedilha e força UPPERCASE só com [A-Z]; ç já virou c em normaliza.
  let s = normaliza(token).toUpperCase().replace(/[^A-Z]/g, '')
  if (s.length === 0) return ''

  // Dígrafos PT-BR primeiro (consomem 2 chars cada, evita regras de char único interferirem).
  s = s.replace(/LH/g, 'L')   // dígrafo "lh" → /ʎ/ ≈ L (palatalização)
  s = s.replace(/NH/g, 'N')   // dígrafo "nh" → /ɲ/ ≈ N
  s = s.replace(/CH/g, 'X')   // "ch" tem som de /ʃ/, mapeado em X
  s = s.replace(/PH/g, 'F')   // raro mas aparece em grafias antigas ("Phelipe")
  s = s.replace(/SS/g, 'S')   // duplo s → s simples
  s = s.replace(/RR/g, 'R')   // duplo r → r simples
  s = s.replace(/SC([EI])/g, 'S$1')  // "sci/sce" som de /s/ ("nascimento" → "nasimento")

  // C antes de e/i tem som de /s/; antes de outras vogais → /k/.
  s = s.replace(/C([EI])/g, 'S$1')
  s = s.replace(/C/g, 'K')

  // G antes de e/i tem som de /ʒ/ ≈ J; antes de outras vogais mantém /g/ (não normaliza).
  s = s.replace(/G([EI])/g, 'J$1')

  // QU antes de e/i = /k/; resto = /kw/ (mas simplificamos para K também).
  s = s.replace(/QU([EI])/g, 'K$1')
  s = s.replace(/QU/g, 'K')
  s = s.replace(/Q/g, 'K')

  // H sem dígrafo é mudo.
  s = s.replace(/H/g, '')

  // W e Y raros em PT-BR puro; tratamos como vogais neutras (removidas).
  s = s.replace(/[WY]/g, '')

  // Final M em PT-BR é nasalizado → som mais próximo de N.
  s = s.replace(/M$/g, 'N')

  // Final L em PT-BR vira semivogal /w/ ≈ U ("Brasil" → "Brasiu").
  s = s.replace(/L$/g, 'U')

  // Z e S entre vogais têm som idêntico no Brasil → unifica como Z.
  s = s.replace(/([AEIOU])S([AEIOU])/g, '$1Z$2')

  // Colapsa duplicações remanescentes (.)\1+ → $1 ("AA"→"A", "AAA"→"A").
  s = s.replace(/(.)\1+/g, '$1')

  return s
}

// `compareNames` — score composto recomendado para nomes PT-BR.
// Recebe: dois nomes (cruus ou já normalizados — não importa) e opcionalmente toggles.
// Entrega: número em [0, 1], maior entre as estratégias habilitadas (paper §6).
// Por quê: o paper recomenda `max(s_sorted, s_monge_elkan)` porque:
//   - s_sorted (token-sort): captura troca de ordem de sobrenomes ("Maria Silva Souza"
//     vs "Maria Souza Silva") — Winkler chamou de "Sorted Winkler".
//   - s_monge_elkan: captura nomes com tokens extras ou faltantes ("José da Silva"
//     vs "José Antônio da Silva") — token-a-token tolera ruído de comprimento.
//   - max(...): pegar o melhor dos dois nunca piora o recall.
// Toggles permitem desligar cada estratégia para debug ou para comparar com o algoritmo antigo.
// `lengthPreFilterDelta`: pre-filter opcional — se diferença de comprimento é grande,
// JW raramente cruza 0.85 (paper §5). Usamos 6 (mais permissivo que 4 do paper) porque
// nosso threshold default é 0.9; com esse threshold mais alto daria pra apertar para 4.
export function compareNames(
  n1: string | null | undefined,
  n2: string | null | undefined,
  opts: {
    usarTokenSort?: boolean
    usarMongeElkan?: boolean
    lengthPreFilterDelta?: number | null
  } = {}
): number {
  const { usarTokenSort = true, usarMongeElkan = true, lengthPreFilterDelta = 6 } = opts
  if (!n1 || !n2) return 0
  const a = normaliza(n1)
  const b = normaliza(n2)
  if (a === b) return 1
  if (!a || !b) return 0

  // Length pre-filter (paper §5): se um nome é muito mais longo que o outro,
  // JW dificilmente cruzará 0.85. Pula o pipeline caro e retorna JW direto.
  if (lengthPreFilterDelta != null && Math.abs(a.length - b.length) > lengthPreFilterDelta) {
    return jaroWinklerNorm(a, b)
  }

  const ta = tokenize(a)
  const tb = tokenize(b)

  // Acumula scores das estratégias habilitadas; pega o maior no final.
  const scores: number[] = []

  if (usarTokenSort) {
    // Token-sort: ordena alfabeticamente e compara como string única — neutraliza
    // troca de sobrenome materno/paterno (paper §6).
    const sa = [...ta].sort().join(' ')
    const sb = [...tb].sort().join(' ')
    scores.push(jaroWinklerNorm(sa, sb))
  }

  if (usarMongeElkan && ta.length > 0 && tb.length > 0) {
    // Monge-Elkan simétrico com JW como similaridade base — o "SoftTFIDF light"
    // do Cohen et al. (IJCAI-2003), sem o peso TF-IDF (que exige corpus pré-computado).
    scores.push(mongeElkanSym(ta, tb, jaroWinklerNorm))
  }

  // Fallback: se ambos toggles estão OFF, devolve JW raw sobre as strings normalizadas.
  if (scores.length === 0) {
    return jaroWinklerNorm(a, b)
  }

  return Math.max(...scores)
}
