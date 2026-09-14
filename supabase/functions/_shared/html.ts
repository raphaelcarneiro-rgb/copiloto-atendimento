// Fontes tipo='url': busca a página e extrai um texto legível, sem tags.
// Implementação deliberadamente simples (regex), sem parser de DOM completo
// — suficiente para páginas institucionais de conteúdo, não para SPAs que só
// renderizam via JavaScript no navegador.

export async function fetchUrlAsText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CopilotoInfnetBot/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`Falha ao buscar URL (${res.status}): ${url}`);
  }
  const html = await res.text();
  return htmlToText(html);
}

function htmlToText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // blocos que devem virar quebra de parágrafo antes de remover as tags
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n\n");

  return text;
}
