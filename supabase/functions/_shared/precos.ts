// Preço oficial de PGL/GRL, determinístico (Etapa 14, pedido do Raphael
// 2026-09-16). Compartilhado entre `suggest` e `ask` — os dois precisam da
// mesma lógica: detectar qual curso está em jogo pelos chunks de
// calendario_cursos já recuperados pela busca híbrida (metadados.curso),
// buscar o preço via `buscar_preco_curso` (SQL determinístico, nunca o
// LLM), e montar um bloco pronto pra injetar no prompt. Ver
// supabase/migrations/20260916030*.sql para as tabelas/função.
import type { createServiceClient } from "./db.ts";
import { extrairDisciplinasDePagina, extrairGradeGraduacao, identificarCursosNaConversa, type ConfiancaCursos } from "./cursos.ts";

type Db = ReturnType<typeof createServiceClient>;

interface ChunkComMetadados {
  metadados: Record<string, unknown>;
  conteudo?: string;
}

/** Nomes oficiais dos cursos (metadados.curso dos chunks de calendario_cursos), em ordem alfabética. */
export async function carregarCatalogoCursos(db: Db): Promise<string[]> {
  const { data } = await db.from("chunks").select("metadados").eq("metadados->>tipo", "calendario_cursos");
  return [
    ...new Set(
      ((data ?? []) as { metadados: { curso?: unknown } }[])
        .map((r) => r.metadados?.curso)
        .filter((c): c is string => typeof c === "string"),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Compatibilidade com o `ask` (pergunta isolada, sem histórico): devolve o curso
 * só quando a identificação é decisiva. A lógica de verdade mora em
 * `cursos.ts::identificarCursosNaConversa` (usada direto pelo `suggest`).
 */
export async function identificarCursoCitado(db: Db, textos: string[]): Promise<string | null> {
  const catalogo = await carregarCatalogoCursos(db);
  const r = identificarCursosNaConversa(
    catalogo,
    textos.map((texto) => ({ autor: "lead" as const, texto })).reverse(),
  );
  return r.cursos[0] ?? null;
}

/**
 * Trechos da página oficial do curso identificado (fonte com o mesmo nome do
 * curso no catálogo), sempre incluídos no contexto: a grade completa fica
 * espalhada em vários chunks e a busca por similaridade nem sempre traz todos
 * (achado 2026-09-21: o modelo listava só "as principais disciplinas").
 */
export async function buscarTrechosDoCurso(
  db: Db,
  curso: string,
): Promise<
  { chunk_id: number; document_id: string; conteudo: string; metadados: Record<string, unknown>; similaridade: number; rrf_score: number }[]
> {
  const { data: fontes } = await db.from("sources").select("id").eq("nome", curso).eq("ativo", true);
  const sourceIds = ((fontes ?? []) as { id: string }[]).map((f) => f.id);
  if (sourceIds.length === 0) return [];
  const { data: docs } = await db.from("documents").select("id").in("source_id", sourceIds);
  const docIds = ((docs ?? []) as { id: string }[]).map((d) => d.id);
  if (docIds.length === 0) return [];
  const { data: chunks } = await db
    .from("chunks")
    .select("id, document_id, conteudo, metadados")
    .in("document_id", docIds)
    .order("ordem", { ascending: true })
    .limit(20); // a página da graduação passa de 12 trechos (a matriz curricular ocupa os primeiros)
  return ((chunks ?? []) as { id: number; document_id: string; conteudo: string; metadados: Record<string, unknown> }[]).map((c) => ({
    chunk_id: c.id,
    document_id: c.document_id,
    conteudo: c.conteudo,
    metadados: c.metadados ?? {},
    similaridade: 0,
    rrf_score: 0,
  }));
}

/**
 * Bloco "CURSO(S) EM JOGO" do prompt. Com 2 cursos (ex.: MBA + graduação, print 9)
 * o modelo atende um por vez, na ordem dada, e só avança depois de o lead
 * confirmar que entendeu tudo (pedido do Raphael, 2026-10-19).
 */
export function blocoCursoIdentificado(
  cursosEntrada: string | string[] | null,
  confianca: ConfiancaCursos | null = null,
): string {
  const cursos = Array.isArray(cursosEntrada) ? cursosEntrada : cursosEntrada ? [cursosEntrada] : [];
  if (cursos.length === 0) return "";
  const origem =
    confianca === "manual"
      ? " (escolhido manualmente pelo atendente — é o curso certo, não discuta)"
      : " (identificado pela conversa)";
  if (cursos.length === 1) {
    return `\n\nCURSO EM JOGO${origem}: "${cursos[0]}". Fale SOMENTE deste curso — use apenas trechos do contexto que sejam claramente deste curso e NUNCA misture nem substitua por cursos parecidos da mesma área (outro MBA ou graduação com tema semelhante). Se os trechos recuperados forem de outro curso, ignore-os.`;
  }
  return `\n\nCURSOS EM JOGO${origem}, na ORDEM em que devem ser atendidos: 1º "${cursos[0]}"; 2º "${cursos[1]}". Atenda UM curso por vez: apresente o 1º (grade e, depois, valores — seguindo os passos) e SÓ passe ao 2º depois de o lead confirmar que entendeu tudo e está satisfeito com o 1º — ao terminar um curso, a mensagem deve perguntar se ficou alguma dúvida e se ele quer seguir para o próximo curso, e o próximo só é apresentado na mensagem seguinte. Releia o histórico para saber o que já foi apresentado de cada curso e retome do ponto certo. NUNCA misture dados de um curso no outro, nem de cursos parecidos que não estejam nesta lista; se os trechos recuperados forem de outro curso, ignore-os.`;
}

/**
 * Lista COMPLETA de disciplinas, extraída por código dos trechos da página do
 * curso (ver `extrairDisciplinasDePagina`) — a grade vive espalhada em vários
 * trechos sobrepostos e o modelo, vendo só parte, listava 2 de 8 (print 11).
 */
export function blocoDisciplinasOficiais(
  paginas: Array<{ curso: string; trechos: string[] }>,
): string {
  let bloco = "";
  for (const { curso, trechos } of paginas) {
    const titulos = extrairDisciplinasDePagina(trechos);
    if (titulos.length > 0) {
      bloco += `\n\nLISTA OFICIAL DE DISCIPLINAS de "${curso}" — ${titulos.length} disciplinas, lista COMPLETA, na ordem do curso (ao apresentar a grade use TODAS elas, só o título, e nenhuma além destas; nunca diga que a lista está incompleta): ${titulos.map((t, i) => `${i + 1}) ${t}`).join("; ")}.`;
      continue;
    }
    // Graduação: grade em blocos, sem bullets (print 9 / eval de 2026-10-27).
    const blocos = extrairGradeGraduacao(trechos);
    if (blocos.length === 0) continue;
    const total = blocos.reduce((s, b) => s + b.disciplinas.length, 0);
    bloco += `\n\nLISTA OFICIAL DE DISCIPLINAS de "${curso}" — graduação organizada em ${blocos.length} blocos (${total} itens no total), lista COMPLETA, na ordem do curso. Ao apresentar a grade, use TODOS os blocos e TODAS as disciplinas, agrupadas por bloco (nome do bloco em negrito, disciplinas em bullets), só os títulos, e nenhuma além destas; o nome do bloco NÃO é uma disciplina; nunca diga que a lista está incompleta: ${blocos
      .map((b, i) => `Bloco ${i + 1} "${b.bloco}": ${b.disciplinas.join("; ")}`)
      .join(" | ")}.`;
  }
  return bloco;
}

/**
 * Trecho de calendario_cursos do curso identificado (início, frequência,
 * horário), buscado direto pelo metadado — sem depender da busca por
 * similaridade nem do estado do lead. Antes a data só entrava se a busca
 * trouxesse esse trecho por acaso, e "Quando o curso começa?" virava grade
 * (print 12, 2026-10-20).
 */
export async function buscarCalendarioDoCurso(
  db: Db,
  curso: string,
): Promise<
  { chunk_id: number; document_id: string; conteudo: string; metadados: Record<string, unknown>; similaridade: number; rrf_score: number }[]
> {
  const { data } = await db
    .from("chunks")
    .select("id, document_id, conteudo, metadados")
    .eq("metadados->>tipo", "calendario_cursos")
    .eq("metadados->>curso", curso)
    .limit(2);
  return ((data ?? []) as { id: number; document_id: string; conteudo: string; metadados: Record<string, unknown> }[]).map((c) => ({
    chunk_id: c.id,
    document_id: c.document_id,
    conteudo: c.conteudo,
    metadados: c.metadados ?? {},
    similaridade: 0,
    rrf_score: 0,
  }));
}

/**
 * Data de início + prazo de matrícula de cada curso em jogo, calculados aqui
 * (nunca pelo LLM), pra responder "quando começa?" com o par início/prazo
 * mesmo antes do preço (que exige o estado do lead).
 */
export async function blocoCalendarioOficial(
  db: Db,
  calendarios: Array<{ curso: string; chunks: { chunk_id: number; conteudo: string; metadados: Record<string, unknown> }[] }>,
): Promise<string> {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  let bloco = "";
  for (const { curso, chunks } of calendarios) {
    const inicio = extrairInicioTurma(chunks, curso);
    if (!inicio || chunks.length === 0) continue;
    const limite = await calcularPrazoMatricula(db, inicio);
    const [a, m, d] = inicio.split("-");
    bloco += `\n\nCALENDÁRIO OFICIAL de "${curso}" (cite chunk_id=${chunks[0].chunk_id}): ${chunks[0].conteudo}`;
    bloco +=
      limite < hoje
        ? ` As matrículas dessa turma (início ${d}/${m}/${a}) provavelmente já encerraram — NÃO ofereça essa turma; diga que vai confirmar a próxima turma com a coordenação e registre em 'lacunas'.`
        : ` Se o lead perguntar quando começa, responda com essa data (${d}/${m}/${a}) e, na mesma frase, que as matrículas, em geral, encerram até ${dataBr(limite)} (${DIAS_UTEIS_ANTES_DO_INICIO} dias úteis antes do início) — nunca deixe entender que dá para se matricular no dia do início.`;
  }
  return bloco;
}

const DIAS_UTEIS_ANTES_DO_INICIO = 3;

function isoUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return isoUtc(d);
}

function dataBr(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** "Início previsto: 05/10/2026" do chunk de calendário do curso → "2026-10-05". */
function extrairInicioTurma(chunks: ChunkComMetadados[], curso: string): string | null {
  for (const c of chunks) {
    const meta = c.metadados as { tipo?: string; curso?: unknown } | null;
    if (meta?.tipo !== "calendario_cursos" || meta?.curso !== curso) continue;
    const m = c.conteudo?.match(/In[ií]cio previsto:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}

/** Matrículas encerram, em geral, 3 dias úteis antes do início das aulas (regra do Raphael, 2026-09-21). */
async function calcularPrazoMatricula(db: Db, inicioIso: string): Promise<string> {
  const { data } = await db
    .from("feriados")
    .select("data")
    .eq("conta_como_folga", true)
    .gte("data", somarDias(inicioIso, -21))
    .lte("data", inicioIso);
  const folgas = new Set(((data ?? []) as { data: string }[]).map((f) => f.data));
  let atual = inicioIso;
  let contados = 0;
  while (contados < DIAS_UTEIS_ANTES_DO_INICIO) {
    atual = somarDias(atual, -1);
    const diaSemana = new Date(`${atual}T00:00:00Z`).getUTCDay();
    if (diaSemana !== 0 && diaSemana !== 6 && !folgas.has(atual)) contados++;
  }
  return atual;
}

/** Únicos prazos verdadeiros que podem virar gatilho de escassez — nunca inventar outros. */
async function montarTextoPrazos(
  db: Db,
  chunks: ChunkComMetadados[],
  curso: string,
  semanaVigenteIso: string,
): Promise<string> {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  // Regra do Raphael (2026-09-21): a validade é sempre a sexta-feira da semana vigente, nunca domingo.
  const validadeValor = somarDias(semanaVigenteIso, 4);
  const partes: string[] = [`o valor acima vale até sexta-feira, ${dataBr(validadeValor)}`];

  const inicio = extrairInicioTurma(chunks, curso);
  let matriculasEncerradas = false;
  if (inicio) {
    const limite = await calcularPrazoMatricula(db, inicio);
    if (limite < hoje) {
      matriculasEncerradas = true;
    } else {
      partes.push(
        `a próxima turma começa em ${dataBr(inicio)} e as matrículas, em geral, encerram até ${dataBr(limite)} (${DIAS_UTEIS_ANTES_DO_INICIO} dias úteis antes do início, para dar tempo de preparar os acessos) — NÃO se aceita matrícula no dia do início das aulas`,
      );
    }
  }

  if (matriculasEncerradas && inicio) {
    return ` PRAZOS: a turma que começa em ${dataBr(inicio)} provavelmente já teve as matrículas encerradas (encerram, em geral, ${DIAS_UTEIS_ANTES_DO_INICIO} dias úteis antes do início). NÃO ofereça matrícula nessa turma nem use escassez — diga que vai confirmar a turma disponível com a coordenação (registre em 'lacunas').`;
  }
  return ` PRAZOS REAIS (os ÚNICOS que podem ser usados como gatilho de escassez): ${partes.join("; ")}. Ao apresentar o preço, encerre a mensagem com UMA frase leve citando esses prazos (ex.: "esse valor vale até sexta-feira (DD/MM)" — NUNCA diga domingo), seguida de uma pergunta simples que encaminhe o fechamento (ex.: se quer que você explique os próximos passos da matrícula). Sempre que citar o início da turma, cite junto até quando vai a matrícula — nunca deixe o lead entender que dá para se matricular até o dia do início. Sem tom de pressão. NUNCA invente outros prazos, vagas limitadas ou urgência ("últimas vagas", "só hoje").`;
}

interface PrecoCursoResultado {
  produto_encontrado: string;
  programa: string;
  valor_final: number | null;
  valor_final_rj: number | null;
  semana_vigente: string;
}

interface FormaPagamento {
  forma: string;
  descricao: string;
  parcelas: number;
  multiplicador: number;
}

interface ConvenioResultado {
  empresa: string;
  dominio: string;
  nivel: string;
  desconto_pct: number;
  valido_ate: string | null;
  status: string;
}

function formatarMoedaBrl(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "Pix (à vista): R$ 11.024,99; 18x de R$ 12.522,95; ..." */
function montarLinhasFormasPagamento(valorFinal: number, formas: FormaPagamento[]): string {
  return formas
    .map((f) => {
      const parcela = (valorFinal * f.multiplicador) / f.parcelas;
      return f.parcelas === 1
        ? `${f.descricao}: ${formatarMoedaBrl(parcela)}`
        : `${f.descricao}: ${f.parcelas}x de ${formatarMoedaBrl(parcela)}`;
    })
    .join("; ");
}

/**
 * Nomes de curso oficiais do catálogo (metadados.curso), já presentes nos
 * chunks de calendario_cursos que a busca híbrida retornou — não é uma
 * busca nova, é reaproveitar um sinal que já existe.
 */
export function extrairCursosCandidatos(chunks: ChunkComMetadados[], limite = 2): string[] {
  return [
    ...new Set(
      chunks
        .filter((c) => {
          const meta = c.metadados as { tipo?: string; curso?: unknown } | null;
          return meta?.tipo === "calendario_cursos" && typeof meta?.curso === "string";
        })
        .map((c) => (c.metadados as { curso: string }).curso),
    ),
  ].slice(0, limite);
}

/**
 * Monta o bloco "DADOS OFICIAIS DE PREÇO" pra injetar no prompt do usuário.
 * `injetado=false` quando nenhum curso candidato tem preço cadastrado —
 * nesse caso o LLM é instruído (no prompt fixo) a não inventar preço.
 */
export async function montarBlocoPrecoOficial(
  db: Db,
  cursosCandidatos: string[],
  empresaAssociada: string | null,
  estadoLead: string | null,
  chunks: ChunkComMetadados[] = [],
): Promise<{ bloco: string; injetado: boolean }> {
  let bloco = "";
  let injetado = false;

  for (const curso of cursosCandidatos) {
    const { data: precoData, error: precoErr } = await db.rpc("buscar_preco_curso", { p_produto: curso });
    if (precoErr) {
      console.error("buscar_preco_curso falhou:", precoErr.message);
      continue;
    }
    const preco = (precoData as PrecoCursoResultado[] | null)?.[0];
    if (!preco) continue;

    const formas =
      preco.programa === "PGL" || preco.programa === "GRL"
        ? ((
            await db
              .from("formas_pagamento_cursos")
              .select("forma, descricao, parcelas, multiplicador")
              .eq("programa", preco.programa)
              .eq("ativo", true)
              .order("ordem")
          ).data as FormaPagamento[] | null) ?? []
        : [];

    const linhasForaRj =
      preco.valor_final == null
        ? null
        : formas.length > 0
          ? montarLinhasFormasPagamento(preco.valor_final, formas)
          : formatarMoedaBrl(preco.valor_final);
    const linhasRj =
      preco.valor_final_rj == null
        ? null
        : formas.length > 0
          ? montarLinhasFormasPagamento(preco.valor_final_rj, formas)
          : formatarMoedaBrl(preco.valor_final_rj);

    let textoConvenio = "";
    // Só calcula o convênio quando o estado já é conhecido — com estado
    // desconhecido, `base` seria sempre o valor "fora do RJ" por padrão
    // mesmo sem confirmação, criando um bloco contradizendo a própria
    // instrução de "não informe valor nenhum ainda" (achado real, 2026-10-08:
    // isso fez o modelo inventar uma pergunta estranha sobre "usar o
    // convênio" em vez de simplesmente perguntar o estado do lead).
    if (empresaAssociada && estadoLead) {
      const { data: convenioData } = await db.rpc("buscar_convenio_empresa", { p_empresa: empresaAssociada });
      const convenio = (convenioData as ConvenioResultado[] | null)?.[0];
      if (convenio?.desconto_pct != null) {
        const base = estadoLead === "RJ" ? preco.valor_final_rj : preco.valor_final;
        if (base != null) {
          const valorComConvenio = base * (1 - convenio.desconto_pct / 100);
          const detalheConvenio =
            formas.length > 0 ? montarLinhasFormasPagamento(valorComConvenio, formas) : formatarMoedaBrl(valorComConvenio);
          textoConvenio =
            ` Com o convênio da empresa "${empresaAssociada}" (${convenio.desconto_pct}% de desconto adicional sobre esse valor), ficam assim: ${detalheConvenio} — cite essa parceria ao informar esses valores e apresente TODAS essas formas de pagamento também. NUNCA invente um código de cupom combinando os dois descontos; se o lead quiser fechar assim, diga que esse código específico precisa ser gerado pela equipe de Suporte.`;
        }
      }
    }

    injetado = true;
    bloco += `\n\nDADOS OFICIAIS DE PREÇO para "${preco.produto_encontrado}" (use EXATAMENTE estes números — se o curso perguntado pelo lead não for este, ignore este bloco e registre a dúvida em 'lacunas'/responda "não encontrado" em vez de usar um valor de outro curso):`;
    if (estadoLead === "RJ") {
      if (linhasRj) bloco += ` Valores para este lead: ${linhasRj}. NÃO mencione que são valores "para residentes no Rio de Janeiro" nem pergunte o estado — o lead já é conhecido; apenas apresente os valores.`;
    } else if (estadoLead) {
      if (linhasForaRj) bloco += ` Valores para este lead: ${linhasForaRj}. NÃO mencione que são valores "para quem mora fora do Rio de Janeiro" nem pergunte o estado — o lead já é conhecido; apenas apresente os valores.`;
    } else {
      bloco +=
        ' O estado do lead ainda não é conhecido — ANTES de informar um valor específico, pergunte de forma natural e genérica onde ele mora ou de onde está falando (ex.: "De qual cidade você está falando?" ou "Me conta de onde você é?") — NUNCA pergunte literalmente "você mora no Rio de Janeiro ou fora?": isso soa como uma pergunta de faixa de preço, não uma pergunta genuína sobre a pessoa. Pode adiantar que o valor muda conforme a localização, mas NÃO informe nenhum valor exato ainda.' +
        (empresaAssociada
          ? ` A ÚNICA pergunta pendente aqui é de onde o lead é — o convênio da empresa "${empresaAssociada}" já é conhecido e será aplicado automaticamente assim que a localização vier; NUNCA pergunte se o lead "quer considerar" o convênio ou se "fará a matrícula usando" o convênio, isso não é uma escolha dele.`
          : "");
    }
    bloco += textoConvenio;
    if (formas.length > 1) {
      bloco += ` IMPORTANTE: ao apresentar o preço, liste TODAS as formas de pagamento acima, uma por linha, e SOMENTE elas — nunca mostre só a mais barata/à vista e nunca acrescente outras formas.`;
    }
    if (textoConvenio) {
      bloco += ` ESTRUTURA OBRIGATÓRIA quando há convênio: apresente PRIMEIRO todas as formas de pagamento SEM o convênio, e DEPOIS, em bloco separado, todas as formas COM o convênio — para o lead enxergar a economia. Não omita nenhum dos dois blocos.`;
    }
    if (estadoLead) {
      bloco += await montarTextoPrazos(db, chunks, curso, preco.semana_vigente);
    }
  }

  return { bloco, injetado };
}
