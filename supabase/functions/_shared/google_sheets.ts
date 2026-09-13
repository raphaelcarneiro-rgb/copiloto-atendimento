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
