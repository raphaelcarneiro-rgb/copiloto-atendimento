// Leitura de Google Sheets via REST API (sem SDK), com o access_token
// obtido por domain-wide delegation (ver google_auth.ts).

export interface SheetTab {
  title: string;
}

export async function listSheetTabs(token: string, spreadsheetId: string): Promise<SheetTab[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Sheets metadata falhou (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return (data.sheets ?? []).map((s: { properties: { title: string } }) => ({
    title: s.properties.title,
  }));
}

/** Valores brutos de uma aba, como matriz de strings (linhas x colunas). */
export async function getSheetValues(
  token: string,
  spreadsheetId: string,
  tabTitle: string,
): Promise<string[][]> {
  const range = encodeURIComponent(`'${tabTitle}'!A1:Z2000`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?majorDimension=ROWS`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Sheets values falhou (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return (data.values ?? []) as string[][];
}

/**
 * Hyperlinks por célula, na mesma faixa e mesma forma (linhas x colunas) de
 * `getSheetValues` — precisa de um endpoint diferente (`spreadsheets.get`
 * com `includeGridData`) porque `values.get` só devolve o texto visível da
 * célula (ex.: "Clique Aqui"), não a URL por trás de um link estilo
 * `=HYPERLINK(url, texto)`. `null` onde a célula não tem link.
 */
export async function getSheetHyperlinksGrid(
  token: string,
  spreadsheetId: string,
  tabTitle: string,
): Promise<(string | null)[][]> {
  const range = encodeURIComponent(`'${tabTitle}'!A1:Z2000`);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `?ranges=${range}&fields=sheets.data.rowData.values.hyperlink&includeGridData=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Sheets hyperlinks falhou (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const rowData = data.sheets?.[0]?.data?.[0]?.rowData ?? [];
  return rowData.map((row: { values?: Array<{ hyperlink?: string }> }) =>
    (row.values ?? []).map((v) => v.hyperlink ?? null),
  );
}
