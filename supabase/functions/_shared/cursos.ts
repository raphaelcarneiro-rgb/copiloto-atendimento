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

/**
 * Normaliza para casar com nomes do catálogo: "MBA Live em X" / "pós EAD em X"
 * viram "mba em X" (achado real, print 13 de 2026-10-20: "MBA Live em Engenharia
 * de Cibersegurança" virava a GRADUAÇÃO de Cibersegurança, porque o "live" no
 * meio escapava da regra "graduação logo depois de 'MBA em' é o MBA").
 */
function normalizarParaBusca(s: string): string {
  return normalizar(s).replace(/\b(mba|mfa|pos|posgraduacao|especializacao) (live|ead|online|ao vivo) /g, "$1 ");
}

/**
 * Lead dispensando o curso de antes ("não quero mais esse", "desisti", "prefiro
 * outro"). Cursos citados só ANTES dessa mensagem saem de jogo (print 13: o lead
 * trocou Cibersegurança por Engenharia de Contexto e os dois continuavam "em jogo").
 */
const REJEICAO_CURSO =
  /\b(nao quero mais|nao tenho mais interesse|nao me interessa mais|desisti|mudei de ideia|esse nao|nao e esse|nao e mais esse|prefiro (o |a )?outr|quero (ver )?outro curso)/;

function ehRejeicaoDoLead(m: MensagemCurso): boolean {
  return m.autor === "lead" && REJEICAO_CURSO.test(normalizar(m.texto));
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
    const spans = acharNomesNoTexto(normalizarParaBusca(mensagens[i].texto), variantes);
    // o lead dispensou o curso anterior: nada antes desta mensagem conta
    const fronteira = ehRejeicaoDoLead(mensagens[i]);
    // mensagem que enumera 3+ cursos é um cardápio, não uma escolha
    if (spans.length === 0 || spans.length > MAX_CURSOS) {
      if (fronteira) break;
      continue;
    }
    for (const s of spans) {
      if (achados.size >= MAX_CURSOS && !achados.has(s.curso)) continue;
      const anterior = achados.get(s.curso);
      // guarda a PRIMEIRA vez que o curso apareceu (ordem de atendimento = ordem de menção)
      if (!anterior || i < anterior.idx || (i === anterior.idx && s.inicio < anterior.inicio)) {
        achados.set(s.curso, { idx: i, inicio: s.inicio, tipo: s.tipo });
      }
    }
    if (fronteira) break;
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
    const texto =
      m.autor === "atendente" ? normalizarParaBusca(m.texto).slice(0, CHARS_ATENDENTE_FALLBACK) : normalizarParaBusca(m.texto);
    const { vencedor, empatados } = decidir(texto, pontuarPorPalavras(texto, tk));
    if (vencedor) return { cursos: [vencedor], confianca: "inferida", candidatos: [] };
    if (empatados.length > 0 && empatados.length <= MAX_CANDIDATOS && !ambiguo && i >= mensagens.length - JANELA_AMBIGUIDADE) {
      ambiguo = empatados;
    }
    if (ehRejeicaoDoLead(m)) break;
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

export interface BlocoGrade {
  bloco: string;
  disciplinas: string[];
}

/** Competência começa com verbo no infinitivo ("Configurar", "Desenvolver"); título de disciplina não. */
function comecaComVerbo(linha: string): boolean {
  const primeira = normalizar(linha).split(" ")[0] ?? "";
  return /^([a-z]{2,}(ar|er|ir)|[a-z]*por)$/.test(primeira);
}

/**
 * Título grudado na primeira competência, sem quebra de linha na página
 * ("Comunicação Audiovisual Explicar o conceito de..."): corta no primeiro verbo no
 * infinitivo com maiúscula que inicia uma frase (4+ palavras, seguido de palavra minúscula:
 * "Explicar o conceito") — "Windows Server: ...", "SQL Server 2025 e Azure SQL" e
 * "Contêineres Docker" não são cortados.
 */
function cortarNoVerbo(linha: string): string {
  const palavras = linha.split(/\s+/);
  const corte = palavras.findIndex(
    (p, i) =>
      i > 0 &&
      /^[A-ZÀ-Ý][a-zà-ÿ]+$/.test(p) &&
      comecaComVerbo(p) &&
      palavras.length - i >= 4 &&
      /^[a-zà-ÿ]/.test(palavras[i + 1] ?? ""),
  );
  return corte > 0 ? palavras.slice(0, corte).join(" ") : linha;
}

/**
 * Grade da GRADUAÇÃO por blocos ("Matriz curricular" ou "Disciplinas e competências",
 * sem bullets): cada bloco tem um título, ~4 disciplinas (com ou sem ":" no fim) seguidas
 * das competências (frases que começam com verbo) e fecha com "Projeto de Bloco: <bloco>".
 * Os nomes dos blocos vêm dessas linhas de projeto, então o título do bloco nunca é
 * confundido com disciplina. Sem isso o modelo via a matriz espalhada em trechos
 * sobrepostos e recusava listar a grade (print 9; eval de 2026-10-27).
 * Devolve [] quando a página não tem esse formato.
 */
export function extrairGradeGraduacao(trechosEmOrdem: string[]): BlocoGrade[] {
  const texto = trechosEmOrdem.join("\n\n");
  const inicio = texto.search(/Matriz curricular|Disciplinas e compet[eê]ncias/i);
  if (inicio === -1) return [];
  const linhas: string[] = [];
  for (const bruta of texto.slice(inicio).split(/\n+/).slice(1)) {
    const l = bruta.trim();
    if (!l || l === "\u200d") continue;
    if (/^(ADMISS[ÃA]O E VALORES|Sobre a gradua[çc][ãa]o|Dura[çc][ãa]o:?|Pr[óo]xima turma:?)$/i.test(l)) break;
    linhas.push(l);
  }

  const semDoisPontos = (s: string) => s.replace(/\s*:\s*$/, "").trim();
  // "Projeto de Bloco: Introdução à Indústria Criativa Identificar problemas reais..." (sem quebra
  // de linha na página): o nome do bloco termina antes do primeiro verbo no infinitivo.
  const nomeDoProjeto = (bruto: string) => cortarNoVerbo(semDoisPontos(bruto));
  const PROJETO = /^Projeto de Bloco:\s*(.+)$/i;
  const nomesDosBlocos = new Map<string, string>();
  for (const l of linhas) {
    const m = l.match(PROJETO);
    if (m) {
      const nome = nomeDoProjeto(m[1]);
      if (!nomesDosBlocos.has(normalizar(nome))) nomesDosBlocos.set(normalizar(nome), nome);
    }
  }
  if (nomesDosBlocos.size === 0) return [];

  // Bloco "provisório": o título na página nem sempre é igual ao nome do projeto ("Machine
  // Learning" x "Projeto de Bloco: Inteligência Artificial e Machine Learning"); o bloco
  // recebe o nome oficial quando o "Projeto de Bloco" dele aparece.
  // `cabecalho` = título do bloco como aparece na página (normalizado), para reconhecer a
  // repetição dele na sobreposição entre trechos e não tratá-lo como disciplina.
  type BlocoTrab = BlocoGrade & { chave: string | null; cabecalho: string | null };
  const blocos: BlocoTrab[] = [];
  const porNome = new Map<string, BlocoTrab>();
  const abrirBloco = (chave: string) => {
    let b = porNome.get(chave);
    if (!b) {
      b = { bloco: nomesDosBlocos.get(chave) ?? chave, disciplinas: [], chave, cabecalho: chave };
      porNome.set(chave, b);
      blocos.push(b);
    }
    return b;
  };
  const adicionar = (b: BlocoGrade, titulo: string) => {
    if (!b.disciplinas.some((d) => normalizar(d) === normalizar(titulo))) b.disciplinas.push(titulo);
  };
  const tituloDaLinha = (l: string) => (/:\s*$/.test(l) ? semDoisPontos(l) : cortarNoVerbo(l));
  const pareceTitulo = (l: string) =>
    // título com ":" no fim é sinal forte (até 180: "Extração e Manipulação de Dados (ETL) utilizando ... (ADF):")
    tituloDaLinha(l).length <= (/:\s*$/.test(l) ? 180 : 120) &&
    !comecaComVerbo(l) &&
    (/:\s*$/.test(l) || !/[.;!?]$/.test(tituloDaLinha(l))) &&
    l !== l.toUpperCase() && // "DISCIPLINAS REGULARES", "ADMISSÃO E VALORES"
    !/^projeto de bloco:?$/i.test(l);

  let atual: BlocoTrab | null = null;
  let dentroDoProjeto = false; // depois de "Projeto de Bloco: X" vem só a descrição do projeto
  for (const l of linhas) {
    const projeto = l.match(PROJETO);
    if (projeto) {
      const chave = normalizar(nomeDoProjeto(projeto[1]));
      const existente = porNome.get(chave);
      if (atual && atual.chave === null && !existente) {
        atual.chave = chave;
        atual.bloco = nomesDosBlocos.get(chave) ?? atual.bloco;
        porNome.set(chave, atual);
      } else {
        const destino = existente ?? abrirBloco(chave);
        if (atual && atual.chave === null && atual !== destino) {
          for (const d of atual.disciplinas) adicionar(destino, d);
          blocos.splice(blocos.indexOf(atual), 1);
        }
        atual = destino;
      }
      adicionar(atual, `Projeto de Bloco: ${nomesDosBlocos.get(chave)}`);
      dentroDoProjeto = true;
      continue;
    }
    const chaveLinha = normalizar(semDoisPontos(l));
    if (nomesDosBlocos.has(chaveLinha)) {
      // título do bloco (pode repetir na sobreposição entre trechos)
      atual = abrirBloco(chaveLinha);
      dentroDoProjeto = false;
      continue;
    }
    const jaVisto = blocos.find((b) => b.cabecalho === chaveLinha);
    if (jaVisto) {
      atual = jaVisto;
      dentroDoProjeto = false;
      continue;
    }
    if (!pareceTitulo(l)) continue;
    if (dentroDoProjeto || !atual) {
      // fim da descrição do projeto: uma linha curta que não é competência abre o próximo
      // bloco, ainda sem nome oficial (o título da página nem sempre bate com o do projeto)
      if (/:\s*$/.test(l) && atual?.chave === null) {
        adicionar(atual, tituloDaLinha(l));
        continue;
      }
      atual = { bloco: semDoisPontos(l), disciplinas: [], chave: null, cabecalho: chaveLinha };
      blocos.push(atual);
      dentroDoProjeto = false;
      continue;
    }
    adicionar(atual, tituloDaLinha(l));
  }

  // provisório que nunca recebeu "Projeto de Bloco" é sobra (rodapé, lista solta) — fora
  const validos = blocos.filter((b) => b.chave !== null && b.disciplinas.length > 0);
  const total = validos.reduce((s, b) => s + b.disciplinas.length, 0);
  return total >= 6 ? validos.map(({ bloco, disciplinas }) => ({ bloco, disciplinas })) : [];
}

// --- Empresa atual citada pelo lead ------------------------------------------

/** Palavras que aparecem depois de "empresa"/"trabalho na" mas não são nome de empresa. */
const NAO_E_EMPRESA = new Set([
  "que", "onde", "minha", "nossa", "sua", "atual", "nova", "pequena", "grande", "media", "privada", "publica",
  "familiar", "propria", "mesma", "outra", "dele", "dela", "aqui", "hoje", "agora", "tambem", "ainda",
  "uma", "um", "essa", "esse", "nenhuma", "duas", "varias", "multinacional", "startup", "consultoria",
]);

/**
 * Empresa onde o lead diz trabalhar AGORA, numa das últimas mensagens dele
 * ("agora sou funcionário da empresa Certsys", "trabalho na Theos"). Print 13
 * (2026-10-21): o CRM ainda tinha a empresa antiga (Qintess, conveniada) e o
 * copiloto ofereceu o convênio dela a quem já trabalha na Certsys (sem convênio).
 * Devolve null quando não há menção clara — quem chama mantém a empresa do CRM.
 */
export function extrairEmpresaCitadaPeloLead(todasMensagens: MensagemCurso[], janela = 6): string | null {
  const recentes = todasMensagens.slice(-janela).filter((m) => m.autor === "lead");
  const padrao =
    /(?:empresa|trabalho\s+(?:na|no|em|pela|pelo)|funcion[aá]ri[oa]\s+(?:da|do|de|na|no)(?:\s+empresa)?|atuo\s+(?:na|no|em)|colaborador[a]?\s+(?:da|do|na|no))\s+([A-Za-zÀ-ÿ0-9&][A-Za-zÀ-ÿ0-9&.\-]*(?:\s+[A-ZÀ-Ý0-9][A-Za-zÀ-ÿ0-9&.\-]*){0,2})/gi;
  for (const m of [...recentes].reverse()) {
    let ultimo: string | null = null;
    for (const achado of m.texto.matchAll(padrao)) {
      // 1ª palavra sempre; as seguintes só se começam com maiúscula ("Theos que é" -> "Theos", "Grupo Konecta" fica)
      const [primeiroToken, ...resto] = achado[1].split(/\s+/);
      const extras: string[] = [];
      for (const p of resto) {
        if (!/^[A-ZÀ-Ý0-9]/.test(p)) break;
        extras.push(p);
      }
      const nome = [primeiroToken, ...extras].join(" ").replace(/[.,;!?]+$/, "").trim();
      const primeira = normalizar(nome.split(/\s+/)[0] ?? "");
      if (nome.length >= 3 && !NAO_E_EMPRESA.has(primeira) && primeira !== "empresa") ultimo = nome;
    }
    if (ultimo) return ultimo;
  }
  return null;
}
