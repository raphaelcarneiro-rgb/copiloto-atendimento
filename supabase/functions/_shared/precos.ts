// Preço oficial de PGL/GRL, determinístico (Etapa 14, pedido do Raphael
// 2026-09-16). Compartilhado entre `suggest` e `ask` — os dois precisam da
// mesma lógica: detectar qual curso está em jogo pelos chunks de
// calendario_cursos já recuperados pela busca híbrida (metadados.curso),
// buscar o preço via `buscar_preco_curso` (SQL determinístico, nunca o
// LLM), e montar um bloco pronto pra injetar no prompt. Ver
// supabase/migrations/20260916030*.sql para as tabelas/função.
import type { createServiceClient } from "./db.ts";

type Db = ReturnType<typeof createServiceClient>;

interface ChunkComMetadados {
  metadados: Record<string, unknown>;
  conteudo?: string;
}

const STOPWORDS_CURSO = new Set([
  "sobre", "informacoes", "informacao", "curso", "cursos", "quero", "saber", "gostaria", "conhecer", "valor", "valores",
  "preco", "quanto", "custa", "qual", "quais", "como", "funciona", "para", "pela", "pelo", "mais", "esse", "essa",
  "esta", "este", "live", "faculdade", "graduacao", "pos", "posgraduacao", "tenho", "interesse", "ola", "obrigado",
  "obrigada", "duvida", "duvidas", "nome", "aulas", "aula",
]);

function normalizarTexto(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function tokensDeCurso(s: string, filtrarStopwords: boolean): string[] {
  return normalizarTexto(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => (t.length >= 4 || t === "mba") && !(filtrarStopwords && STOPWORDS_CURSO.has(t)));
}

/**
 * Descobre, por palavras da própria mensagem do lead, de qual curso do catálogo
 * (calendário) ele está falando. Só devolve quando há UM vencedor claro — em
 * empate (ex.: "engenharia" bate com vários) devolve null e deixa a busca
 * normal decidir. Achado real (2026-09-21): "MBA em cibersegurança" virou o
 * MBA de Gestão de Riscos porque o trecho da página dele fala muito de
 * cibersegurança e o modelo se ancorou nele.
 */
export async function identificarCursoCitado(db: Db, textos: string[]): Promise<string | null> {
  const { data } = await db.from("chunks").select("metadados").eq("metadados->>tipo", "calendario_cursos");
  const catalogo = [
    ...new Set(((data ?? []) as { metadados: { curso?: unknown } }[]).map((r) => r.metadados?.curso).filter((c): c is string => typeof c === "string")),
  ];
  const tokensPorCurso = catalogo.map((c) => ({ curso: c, tokens: new Set(tokensDeCurso(c, false)) }));

  for (const texto of textos) {
    const leadTokens = new Set(tokensDeCurso(texto, true));
    if (leadTokens.size === 0) continue;
    const pontuados = tokensPorCurso
      .map(({ curso, tokens }) => {
        const comuns = [...leadTokens].filter((t) => tokens.has(t));
        const semMba = comuns.filter((t) => t !== "mba");
        return { curso, score: comuns.length, semMba: semMba.length };
      })
      .filter((p) => p.semMba >= 1)
      .sort((a, b) => b.score - a.score);
    if (pontuados.length === 0) continue;
    if (pontuados.length > 1 && pontuados[1].score === pontuados[0].score) continue;
    return pontuados[0].curso;
  }
  return null;
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
    .limit(12);
  return ((chunks ?? []) as { id: number; document_id: string; conteudo: string; metadados: Record<string, unknown> }[]).map((c) => ({
    chunk_id: c.id,
    document_id: c.document_id,
    conteudo: c.conteudo,
    metadados: c.metadados ?? {},
    similaridade: 0,
    rrf_score: 0,
  }));
}

export function blocoCursoIdentificado(curso: string | null): string {
  if (!curso) return "";
  return `\n\nCURSO IDENTIFICADO PELA MENSAGEM DO LEAD: "${curso}". Fale SOMENTE deste curso — use apenas trechos do contexto que sejam claramente deste curso e NUNCA misture nem substitua por cursos parecidos da mesma área (outro MBA ou graduação com tema semelhante). Se os trechos recuperados forem de outro curso, ignore-os.`;
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
    if (empresaAssociada) {
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
        " O estado do lead ainda não é conhecido — ANTES de informar um valor específico, pergunte se ele mora no Rio de Janeiro ou fora. Pode adiantar que o valor muda conforme o estado, mas NÃO informe nenhum valor exato ainda.";
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
