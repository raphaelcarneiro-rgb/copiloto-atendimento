// Identificação de qual(is) curso(s) do catálogo uma conversa está tratando.
// Pura (sem banco, sem Deno) de propósito: é a parte mais frágil do `suggest`
// e precisa ser testável com conversas reais (ver `cursos_test.ts`).
//
// Histórico (2026-10-19, prints 8-11 do Raphael): a versão antiga só somava
// palavras em comum com o nome do curso e DESCARTAVA empates — bastava a
// mensagem do atendente listar disciplinas ("Cloud", "Segurança", "Redes")
// ou o catálogo ter um MBA de nome parecido ("Banco de Dados e Data
// Warehouse") para o curso sumir, e sem curso não há preço nem grade completa.
// Também só devolvia UM curso, então "graduação + pós" ignorava um deles.
//
// Ordem de confiança: (1) nome do curso escrito por inteiro em alguma
// mensagem recente; (2) palavras em comum, com desempate por cobertura do
// nome e pelo nível (MBA x graduação); (3) empate real → "ambígua", e quem
// chama pergunta ao atendente em vez de adivinhar.

export type ConfiancaCursos = "exata" | "inferida" | "ambigua" | "nenhuma" | "manual";

export interface MensagemCurso {
  autor: "lead" | "atendente";
  texto: string;
}

export interface IdentificacaoCursos {
  /** Até 2 cursos, na ordem em que devem ser atendidos (um por vez). */
  cursos: string[];
  confianca: ConfiancaCursos;
  /** Só preenchido quando `confianca === "ambigua"`: opções para o atendente escolher. */
  candidatos: string[];
}

/** Só as últimas N mensagens contam — o lead muda de assunto e um curso citado há 30 mensagens não deve voltar. */
const JANELA_MENSAGENS = 10;
const MAX_CURSOS = 2;
/** Ambiguidade só vira pergunta ao atendente se veio de uma das últimas mensagens... */
const JANELA_AMBIGUIDADE = 3;
/** ...e se o empate é pequeno; "dados" sozinho empata com meio catálogo e perguntar isso é ruído. */
const MAX_CANDIDATOS = 4;
/** Mensagens do atendente são longas (listas de disciplinas): só o começo costuma citar o curso. */
const CHARS_ATENDENTE_FALLBACK = 240;

const PALAVRAS_GENERICAS = new Set([
  // palavras de ligação (a versão antiga só filtrava por tamanho >= 4)
  "com", "para", "uma", "que", "por", "dos", "das", "nos", "nas", "seu", "sua", "pelo", "pela", "isso", "esse", "essa",
  "esta", "este", "mais", "como", "qual", "quais", "tem", "ter", "ser", "sim", "nao", "ola", "bom", "dia", "tarde",
  // pedidos e conversa, nunca nome de curso
  "sobre", "informacoes", "informacao", "curso", "cursos", "quero", "queria", "saber", "gostaria", "conhecer", "valor",
  "valores", "preco", "precos", "quanto", "custa", "funciona", "tenho", "interesse", "obrigado", "obrigada", "duvida",
  "duvidas", "nome", "aulas", "aula", "seria", "certo", "voce", "pode", "poderia", "gostei",
  // nível: usado só como desempate, não como palavra do nome
  "pos", "posgraduacao", "graduacao", "especializacao",
  // boilerplate dos nomes do catálogo
  "faculdade", "ead", "live",
]);

const PALAVRAS_NIVEL_POS = /\b(mba|mfa|pos|posgraduacao|pos graduacao|especializacao)\b/;
const PALAVRAS_NIVEL_GRAD = /\b(graduacao|faculdade|bacharelado|tecnologo|superior)\b/;

export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalizar(s)
    .split(" ")
    .filter((t) => (t.length >= 3 || t === "ia") && !PALAVRAS_GENERICAS.has(t) && t !== "ia");
}

function ehGraduacao(curso: string): boolean {
  return /^faculdade ead live em /i.test(curso.trim());
}

interface Variante {
  curso: string;
  texto: string; // normalizado
  /** "completa" = o nome como está no catálogo (com ou sem prefixo/sufixo de marketing); "derivada" = pedaço do nome. */
  tipo: "completa" | "derivada";
}

function palavras(s: string): number {
  return s ? s.split(" ").length : 0;
}

/** Formas em que alguém escreveria o nome do curso por extenso numa conversa. */
export function variantesDoCurso(curso: string): Variante[] {
  const bruto = curso.replace(/\s+/g, " ").trim();
  const mapa = new Map<string, "completa" | "derivada">();
  const add = (texto: string, tipo: "completa" | "derivada") => {
    const t = normalizar(texto);
    // curto demais ("marketing") casaria com qualquer conversa
    if (t.length < 12 || palavras(t) < 2) return;
    if (!mapa.has(t) || tipo === "completa") mapa.set(t, tipo);
  };
  const semSufixoIA = (t: string) => t.replace(/ com ia$/, "");

  const semPrefixo = bruto.replace(/^faculdade ead live em /i, "");
  const semParenteses = (t: string) => t.replace(/\([^)]*\)/g, " ");

  for (const base of [bruto, semPrefixo]) {
    add(base, "completa");
    add(semSufixoIA(normalizar(base)), "completa");
    add(semParenteses(base), "derivada");
    add(semSufixoIA(normalizar(semParenteses(base))), "derivada");
    const antesDosDoisPontos = base.split(":")[0];
    if (antesDosDoisPontos !== base) add(antesDosDoisPontos, "derivada");
  }
  return [...mapa.entries()].map(([texto, tipo]) => ({ curso, texto, tipo }));
}

interface Span {
  curso: string;
  inicio: number;
  fim: number;
  tipo: "completa" | "derivada";
}

/** Cursos cujo nome aparece por extenso no texto (texto já normalizado). */
function acharNomesNoTexto(textoNorm: string, variantes: Variante[]): Span[] {
  const padded = ` ${textoNorm} `;
  const melhorPorCurso = new Map<string, Span>();
  for (const v of variantes) {
    const alvo = ` ${v.texto} `;
    let pos = padded.indexOf(alvo);
    while (pos !== -1) {
      const span: Span = { curso: v.curso, inicio: pos, fim: pos + alvo.length, tipo: v.tipo };
      // graduação citada logo depois de "MBA em"/"pós em" é, na verdade, o MBA
      if (ehGraduacao(v.curso) && /\b(mba|mfa|pos|posgraduacao|pos graduacao|especializacao)( em| de| na| no)? $/.test(padded.slice(0, pos + 1))) {
        pos = padded.indexOf(alvo, pos + 1);
        continue;
      }
      const atual = melhorPorCurso.get(v.curso);
      if (!atual || span.fim - span.inicio > atual.fim - atual.inicio) melhorPorCurso.set(v.curso, span);
      pos = padded.indexOf(alvo, pos + 1);
    }
  }
  const spans = [...melhorPorCurso.values()];
  // um nome dentro do nome mais longo de OUTRO curso não conta ("engenharia de software" dentro do MBA .NET)
  return spans.filter(
    (s) => !spans.some((o) => o !== s && o.inicio <= s.inicio && o.fim >= s.fim && o.fim - o.inicio > s.fim - s.inicio),
  );
}

interface Pontuado {
  curso: string;
  score: number;
  cobertura: number;
}

function pontuarPorPalavras(textoNorm: string, catalogoTokens: Map<string, Set<string>>): Pontuado[] {
  const textoTokens = new Set(tokens(textoNorm));
  // "mba"/"mfa" fazem parte do nome, mas não bastam para dizer QUAL curso
  const sub = (t: string) => t !== "mba" && t !== "mfa";
  const lista: Pontuado[] = [];
  for (const [curso, tk] of catalogoTokens) {
    const comuns = [...textoTokens].filter((t) => tk.has(t));
    if (comuns.filter(sub).length < 1) continue;
    lista.push({ curso, score: comuns.length, cobertura: tk.size ? comuns.length / tk.size : 0 });
  }
  return lista.sort((a, b) => b.score - a.score || b.cobertura - a.cobertura);
}

function tokensDoCatalogo(catalogo: string[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const c of catalogo) {
    // tokens do nome sem o filtro de "ia" (que não discrimina) mas com siglas úteis de 3 letras (net, sap, ux, ui)
    m.set(c, new Set(tokens(c)));
  }
  return m;
}

/** Desempate: nível citado e cobertura do nome. Devolve o vencedor claro ou os empatados. */
function decidir(textoNorm: string, ranking: Pontuado[]): { vencedor: string | null; empatados: string[] } {
  if (ranking.length === 0) return { vencedor: null, empatados: [] };
  const topo = ranking[0].score;
  let empatados = ranking.filter((r) => r.score === topo);
  if (empatados.length === 1) return { vencedor: empatados[0].curso, empatados: [] };

  const quer_pos = PALAVRAS_NIVEL_POS.test(textoNorm);
  const quer_grad = PALAVRAS_NIVEL_GRAD.test(textoNorm);
  if (quer_pos !== quer_grad) {
    const filtrados = empatados.filter((e) => (quer_pos ? !ehGraduacao(e.curso) : ehGraduacao(e.curso)));
    if (filtrados.length >= 1) empatados = filtrados;
    if (empatados.length === 1) return { vencedor: empatados[0].curso, empatados: [] };
  }

  // cobertura do nome: "Engenharia de Dados: Big Data" cobre 100% das palavras citadas; "Banco de Dados e Data Warehouse" só ~60%
  empatados = [...empatados].sort((a, b) => b.cobertura - a.cobertura);
  if (empatados[0].cobertura - empatados[1].cobertura >= 0.2) return { vencedor: empatados[0].curso, empatados: [] };
  return { vencedor: null, empatados: empatados.map((e) => e.curso) };
}

/** "graduação antes", "primeiro o MBA"... nas últimas mensagens do lead. */
function nivelPedidoPrimeiro(mensagens: MensagemCurso[]): "grad" | "pos" | null {
  const recentesDoLead = mensagens.filter((m) => m.autor === "lead").slice(-3);
  for (const m of [...recentesDoLead].reverse()) {
    const t = normalizar(m.texto);
    const grad = /(graduacao|faculdade)( \w+){0,6} (antes|primeiro|primeira)\b|\b(antes|primeiro|primeira)( \w+){0,6} (graduacao|faculdade)/.test(t);
    const pos = /\b(mba|pos|posgraduacao|pos graduacao|especializacao)( \w+){0,6} (antes|primeiro|primeira)\b|\b(antes|primeiro|primeira)( \w+){0,6} (mba|pos|posgraduacao|pos graduacao|especializacao)\b/.test(t);
    if (grad && !pos) return "grad";
    if (pos && !grad) return "pos";
  }
  return null;
}

export function identificarCursosNaConversa(catalogo: string[], todasMensagens: MensagemCurso[]): IdentificacaoCursos {
  const nenhuma: IdentificacaoCursos = { cursos: [], confianca: "nenhuma", candidatos: [] };
  if (catalogo.length === 0 || todasMensagens.length === 0) return nenhuma;

  const mensagens = todasMensagens.slice(-JANELA_MENSAGENS);
  const variantes = catalogo.flatMap(variantesDoCurso);

  // Passo 1 — nome por extenso, da mensagem mais recente para a mais antiga.
  const achados = new Map<string, { idx: number; inicio: number; tipo: "completa" | "derivada" }>();
  for (let i = mensagens.length - 1; i >= 0 && achados.size < MAX_CURSOS; i--) {
    const spans = acharNomesNoTexto(normalizar(mensagens[i].texto), variantes);
    // mensagem que enumera 3+ cursos é um cardápio, não uma escolha
    if (spans.length === 0 || spans.length > MAX_CURSOS) continue;
    for (const s of spans) {
      if (achados.size >= MAX_CURSOS && !achados.has(s.curso)) continue;
      const anterior = achados.get(s.curso);
      // guarda a PRIMEIRA vez que o curso apareceu (ordem de atendimento = ordem de menção)
      if (!anterior || i < anterior.idx || (i === anterior.idx && s.inicio < anterior.inicio)) {
        achados.set(s.curso, { idx: i, inicio: s.inicio, tipo: s.tipo });
      }
    }
  }
  if (achados.size > 0) {
    let cursos = [...achados.entries()]
      .sort((a, b) => a[1].idx - b[1].idx || a[1].inicio - b[1].inicio)
      .map(([c]) => c);
    const primeiro = nivelPedidoPrimeiro(mensagens);
    if (primeiro && cursos.length === 2) {
      const grads = cursos.filter(ehGraduacao);
      if (grads.length === 1) cursos = primeiro === "grad" ? [grads[0], ...cursos.filter((c) => c !== grads[0])] : [...cursos.filter((c) => c !== grads[0]), grads[0]];
    }
    const todosCompletos = [...achados.values()].every((a) => a.tipo === "completa");
    return { cursos, confianca: todosCompletos ? "exata" : "inferida", candidatos: [] };
  }

  // Passo 2 — palavras em comum, da mais recente para a mais antiga.
  const tk = tokensDoCatalogo(catalogo);
  let ambiguo: string[] | null = null;
  for (let i = mensagens.length - 1; i >= 0; i--) {
    const m = mensagens[i];
    const texto = m.autor === "atendente" ? normalizar(m.texto).slice(0, CHARS_ATENDENTE_FALLBACK) : normalizar(m.texto);
    const { vencedor, empatados } = decidir(texto, pontuarPorPalavras(texto, tk));
    if (vencedor) return { cursos: [vencedor], confianca: "inferida", candidatos: [] };
    if (empatados.length > 0 && empatados.length <= MAX_CANDIDATOS && !ambiguo && i >= mensagens.length - JANELA_AMBIGUIDADE) {
      ambiguo = empatados;
    }
  }
  if (ambiguo) return { cursos: [], confianca: "ambigua", candidatos: ambiguo };
  return nenhuma;
}

/** Mantém só nomes que existem no catálogo (o atendente escolhe numa lista, mas a API não confia no cliente). */
export function validarCursosForcados(catalogo: string[], pedidos: unknown): string[] {
  if (!Array.isArray(pedidos)) return [];
  const validos = pedidos.filter((c): c is string => typeof c === "string" && catalogo.includes(c));
  return [...new Set(validos)].slice(0, MAX_CURSOS);
}

// --- Disciplinas (grade) extraídas por código, não pela busca -----------------

/**
 * Títulos das disciplinas de uma página de MBA/pós ("Disciplinas e competências":
 * título numa linha e as competências em bullets logo abaixo). A grade fica
 * espalhada em vários trechos que se sobrepõem; sem isso o modelo via só o
 * primeiro trecho (2 de 8 disciplinas, print 11) e se recusava a listar.
 * Devolve [] quando a página não tem esse formato (ex.: graduação) — quem
 * chama cai no texto dos trechos como antes.
 */
export function extrairDisciplinasDePagina(trechosEmOrdem: string[]): string[] {
  const texto = trechosEmOrdem.join("\n\n");
  const inicio = texto.search(/Disciplinas e compet[eê]ncias/i);
  if (inicio === -1) return [];
  const linhas = texto
    .slice(inicio)
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== "\u200d");
  const ehBullet = (l: string) => /^[•\-–*]\s/.test(l);

  const titulos: string[] = [];
  const vistos = new Set<string>();
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (/^Sobre (o|a) /i.test(l)) break;
    if (ehBullet(l)) continue;
    if (i + 1 < linhas.length && ehBullet(linhas[i + 1]) && l.length <= 120) {
      const chave = normalizar(l);
      if (!vistos.has(chave)) {
        vistos.add(chave);
        titulos.push(l);
      }
    }
  }
  return titulos.length >= 3 ? titulos : [];
}
