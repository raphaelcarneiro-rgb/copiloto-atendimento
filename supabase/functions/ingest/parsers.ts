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
}

const CURSO_HEADER_KEYS = ["titulo", "data de inicio"];

function isCursoHeaderRow(row: string[]): boolean {
  const normalized = row.map(normalize);
  return CURSO_HEADER_KEYS.every((k) => normalized.includes(k));
}

export function parseCalendarioCursos(rows: string[][]): CursoRow[] {
  const result: CursoRow[] = [];
  let colIndex: Record<string, number> | null = null;
  let grupoAtual = "";

  for (const row of rows) {
    const nonEmpty = row.filter((c) => (c ?? "").trim().length > 0);
    if (nonEmpty.length === 0) continue;

    if (isCursoHeaderRow(row)) {
      colIndex = buildColumnIndex(row);
      continue;
    }

    // Linha "marcador de grupo": poucas células preenchidas e nenhum
    // cabeçalho ainda ativo para esse bloco, ou primeira célula isolada.
    if (colIndex === null || nonEmpty.length === 1) {
      grupoAtual = nonEmpty[0] ?? grupoAtual;
      continue;
    }

    const curso = cell(row, colIndex, "titulo");
    if (!curso) continue;

    result.push({
      grupo: grupoAtual,
      curso,
      dataInicio: cell(row, colIndex, "data de inicio"),
      frequencia: cell(row, colIndex, "frequencia"),
      horario: cell(row, colIndex, "horario"),
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Empresas conveniadas (fonte "convenios")
// Cabeçalho: Nome da Empresa, Domínio, Nome Alternativo, Nível do Convênio,
// Data de Início Convênio, Data Final Convênio, Status, Semestre Captação.
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
    });
  }

  return result;
}

export function convenioParaTexto(c: ConvenioRow): string {
  const partes = [`Empresa conveniada: ${c.empresa}.`];
  if (c.dominio) partes.push(`Domínio: ${c.dominio}.`);
  if (c.nivel) partes.push(`Nível do convênio: ${c.nivel}.`);
  if (c.dataInicio) partes.push(`Convênio vigente desde ${c.dataInicio}.`);
  if (c.dataFim) partes.push(`Válido até ${c.dataFim}.`);
  if (c.status) partes.push(`Status: ${c.status}.`);
  return partes.join(" ");
}
