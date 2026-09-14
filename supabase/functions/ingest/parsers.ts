// Interpretação das planilhas de origem. Ver docs/setup/02-planilhas-fonte.md
// para a estrutura real observada em cada uma (data desta escrita: 2026-09).

function normalize(s: string | undefined | null): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos (marcas diacríticas combinantes)
    .toLowerCase()
    .trim();
}

function buildColumnIndex(headerRow: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  headerRow.forEach((cell, i) => {
    index[normalize(cell)] = i;
  });
  return index;
}

function cell(row: string[], index: Record<string, number>, key: string): string {
  const i = index[key];
  return i === undefined ? "" : (row[i] ?? "").trim();
}

// ---------------------------------------------------------------------------
// Calendário de turmas (fonte "calendario_cursos")
// Layout observado: linhas de banner → marcador de grupo (ex.: "PÓS-GRADUAÇÕES
// (LIVE)") → cabeçalho "Título,Data de Início,Frequência,Horário,Mais
// Informações" → linhas de dados → repete para o próximo grupo.
// ---------------------------------------------------------------------------

export interface CursoRow {
  grupo: string;
  curso: string;
  dataInicio: string;
  frequencia: string;
  horario: string;
  /**
   * URL da página do curso, por trás do link "Clique Aqui" na coluna "Mais
   * Informações" — vem de `getSheetHyperlinksGrid`, não de `getSheetValues`
   * (achado real em 2026-09-14: o texto da célula não é a URL, é só o rótulo
   * do link). `null` quando a linha não tem link.
   */
  linkPagina: string | null;
}

const CURSO_HEADER_KEYS = ["titulo", "data de inicio"];

function isCursoHeaderRow(row: string[]): boolean {
  const normalized = row.map(normalize);
  return CURSO_HEADER_KEYS.every((k) => normalized.includes(k));
}

/**
 * `hyperlinks`, quando informado, deve ser a mesma faixa/forma de `rows`
 * (linha a linha) — usado para achar a URL por trás de "Mais Informações".
 */
export function parseCalendarioCursos(
  rows: string[][],
  hyperlinks?: (string | null)[][],
): CursoRow[] {
  const result: CursoRow[] = [];
  let colIndex: Record<string, number> | null = null;
  let grupoAtual = "";

  rows.forEach((row, i) => {
    const nonEmpty = row.filter((c) => (c ?? "").trim().length > 0);
    if (nonEmpty.length === 0) return;

    if (isCursoHeaderRow(row)) {
      colIndex = buildColumnIndex(row);
      return;
    }

    // Linha "marcador de grupo": poucas células preenchidas e nenhum
    // cabeçalho ainda ativo para esse bloco, ou primeira célula isolada.
    if (colIndex === null || nonEmpty.length === 1) {
      grupoAtual = nonEmpty[0] ?? grupoAtual;
      return;
    }

    const curso = cell(row, colIndex, "titulo");
    if (!curso) return;

    const colLink = colIndex["mais informacoes"];
    const linkPagina =
      colLink !== undefined ? hyperlinks?.[i]?.[colLink] ?? null : null;

    result.push({
      grupo: grupoAtual,
      curso,
      dataInicio: cell(row, colIndex, "data de inicio"),
      frequencia: cell(row, colIndex, "frequencia"),
      horario: cell(row, colIndex, "horario"),
      linkPagina,
    });
  });

  return result;
}

// ---------------------------------------------------------------------------
// Lista de páginas institucionais (fonte "lista_urls")
// Planilha "Copiloto | Páginas Institucionais", colunas: URL, Nome.
// Cada linha vira (ou atualiza) uma fonte tipo='url' própria — mesmo
// mecanismo usado para as páginas de curso via o calendário (2026-09-14),
// só que aqui a lista de URLs é o próprio propósito da planilha, não uma
// coluna a mais dentro de outra.
// ---------------------------------------------------------------------------

export interface UrlListaRow {
  url: string;
  nome: string;
}

function isUrlListaHeaderRow(row: string[]): boolean {
  return row.some((c) => normalize(c) === "url");
}

export function parseListaUrls(rows: string[][]): UrlListaRow[] {
  const result: UrlListaRow[] = [];
  let colIndex: Record<string, number> | null = null;

  for (const row of rows) {
    const nonEmpty = row.filter((c) => (c ?? "").trim().length > 0);
    if (nonEmpty.length === 0) continue;

    if (isUrlListaHeaderRow(row)) {
      colIndex = buildColumnIndex(row);
      continue;
    }
    if (colIndex === null) continue;

    const url = cell(row, colIndex, "url");
    if (!url) continue;

    result.push({ url, nome: cell(row, colIndex, "nome") || url });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Empresas conveniadas (fonte "convenios")
// Cabeçalho: Nome da Empresa, Domínio, Nome Alternativo, Nível do Convênio,
// Data de Início Convênio, Data Final Convênio, Status, Semestre Captação,
// % Desconto Convênio (adicionada em 2026-09-14 — RF07: desconto é um valor
// numérico, só pode vir de coluna estruturada, nunca de texto livre).
// Colunas opcionais nem sempre vêm preenchidas nem na mesma posição relativa
// quando vazias — por isso o mapeamento é sempre por nome de cabeçalho.
// ---------------------------------------------------------------------------

export interface ConvenioRow {
  empresa: string;
  dominio: string;
  nivel: string;
  dataInicio: string;
  dataFim: string;
  status: string;
  descontoPercentual: string;
}

function isConvenioHeaderRow(row: string[]): boolean {
  return row.some((c) => normalize(c) === "nome da empresa");
}

export function parseConvenios(rows: string[][]): ConvenioRow[] {
  const result: ConvenioRow[] = [];
  let colIndex: Record<string, number> | null = null;

  for (const row of rows) {
    const nonEmpty = row.filter((c) => (c ?? "").trim().length > 0);
    if (nonEmpty.length === 0) continue;

    if (isConvenioHeaderRow(row)) {
      colIndex = buildColumnIndex(row);
      continue;
    }
    if (colIndex === null) continue;

    const empresa = cell(row, colIndex, "nome da empresa");
    if (!empresa) continue;

    result.push({
      empresa,
      dominio: cell(row, colIndex, "dominio"),
      nivel: cell(row, colIndex, "nivel do convenio"),
      dataInicio: cell(row, colIndex, "data de inicio convenio"),
      dataFim: cell(row, colIndex, "data final convenio"),
      status: cell(row, colIndex, "status"),
      descontoPercentual: cell(row, colIndex, "% desconto convenio"),
    });
  }

  return result;
}

export function convenioParaTexto(c: ConvenioRow): string {
  const partes = [`Empresa conveniada: ${c.empresa}.`];
  if (c.dominio) partes.push(`Domínio: ${c.dominio}.`);
  if (c.nivel) partes.push(`Nível do convênio: ${c.nivel}.`);
  // A célula já pode vir com "%" (ex.: "10%") — tira antes de acrescentar o
  // nosso, senão dá "10%%." (achado real testando com dado de verdade).
  if (c.descontoPercentual) {
    partes.push(`Desconto do convênio: ${c.descontoPercentual.replace(/%\s*$/, "")}%.`);
  }
  if (c.dataInicio) partes.push(`Convênio vigente desde ${c.dataInicio}.`);
  if (c.dataFim) partes.push(`Válido até ${c.dataFim}.`);
  if (c.status) partes.push(`Status: ${c.status}.`);
  return partes.join(" ");
}

// ---------------------------------------------------------------------------
// Feriados (fonte "feriados")
// Planilha "Calendário Infnet — Feriados", colunas:
// data (YYYY-MM-DD), nome, tipo, conta_como_folga (sim/não), observação.
// Usada pelo lembrete de 24h (RF10–RF14) e por chunks para perguntas gerais
// sobre o calendário.
// ---------------------------------------------------------------------------

export interface FeriadoRow {
  data: string;
  nome: string;
  tipo: string;
  contaComoFolga: boolean;
  observacao: string;
}

const TIPOS_FERIADO_VALIDOS = new Set([
  "nacional",
  "estadual",
  "municipal",
  "institucional",
  "facultativo",
]);

function isFeriadoHeaderRow(row: string[]): boolean {
  const normalized = row.map(normalize);
  return ["data", "nome", "tipo"].every((k) => normalized.includes(k));
}

export function parseFeriados(rows: string[][]): FeriadoRow[] {
  const result: FeriadoRow[] = [];
  let colIndex: Record<string, number> | null = null;

  for (const row of rows) {
    const nonEmpty = row.filter((c) => (c ?? "").trim().length > 0);
    if (nonEmpty.length === 0) continue;

    if (isFeriadoHeaderRow(row)) {
      colIndex = buildColumnIndex(row);
      continue;
    }
    if (colIndex === null) continue;

    const data = cell(row, colIndex, "data");
    const nome = cell(row, colIndex, "nome");
    if (!data || !nome) continue;

    const tipoBruto = normalize(cell(row, colIndex, "tipo"));
    const tipo = TIPOS_FERIADO_VALIDOS.has(tipoBruto) ? tipoBruto : "institucional";
    const folgaBruto = normalize(cell(row, colIndex, "conta_como_folga"));

    result.push({
      data,
      nome,
      tipo,
      contaComoFolga: folgaBruto === "" ? true : ["sim", "s", "true", "1"].includes(folgaBruto),
      observacao: cell(row, colIndex, "observacao"),
    });
  }

  return result;
}

export function feriadosParaTexto(feriados: FeriadoRow[]): string {
  const linhas = feriados.map((f) => {
    const detalhe = [f.tipo, f.observacao].filter(Boolean).join(", ");
    return `${f.data} — ${f.nome}${detalhe ? ` (${detalhe})` : ""}${
      f.contaComoFolga ? "" : " — não conta como folga"
    }.`;
  });
  return `Calendário de feriados e pontos facultativos da Infnet:\n${linhas.join("\n")}`;
}
