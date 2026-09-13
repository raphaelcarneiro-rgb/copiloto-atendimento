// Exportação de um Google Doc como texto simples, via Drive API.
// Usado para fontes tipo='pdf' cujo `ref` começa com "gdoc:" (documento
// vivo do Google Docs, não um PDF enviado ao Storage).

export async function exportGoogleDocAsText(token: string, fileId: string): Promise<string> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text%2Fplain`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Drive export falhou (${res.status}): ${await res.text()}`);
  }
  return await res.text();
}
