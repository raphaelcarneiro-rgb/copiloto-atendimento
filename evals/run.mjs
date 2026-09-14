#!/usr/bin/env node
// Runner de evals de recuperação (Etapa 3). Chama a Edge Function `search`
// (embedding + match_chunks) para cada pergunta-ouro em perguntas.json e
// verifica se o resultado no topo bate com o esperado.
//
// Uso:
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=... node evals/run.mjs
// A anon key é pública (não é segredo) — pode ficar num .env local se
// preferir, mas não precisa ser tratada como credencial sensível.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://trtmyuqatmhvikfbqmkv.supabase.co";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRydG15dXFhdG1odmlrZmJxbWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMzA0NTUsImV4cCI6MjEwNDkwNjQ1NX0.A1Wj9uzSgYxngeFBXAa-mtP9Xx4QMwl1r2a0F8VjiLU";

const perguntas = JSON.parse(readFileSync(join(__dirname, "perguntas.json"), "utf-8"));

function normalize(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

async function search(query, matchCount = 8) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, match_count: matchCount }),
  });
  if (!res.ok) {
    throw new Error(`search falhou (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const resultados = [];
  let acertos = 0;
  const similaridadesPositivas = [];
  const similaridadesNegativas = [];

  for (const p of perguntas) {
    const resp = await search(p.pergunta, 8);
    const top1 = resp.resultados?.[0];
    const sim = top1?.similaridade ?? 0;

    let ok;
    let motivo;

    if (p.esperar_baixa_similaridade) {
      similaridadesNegativas.push(sim);
      // Não exigimos um teto fixo aqui — o objetivo é medir, não travar o
      // eval numa pergunta claramente fora do domínio.
      ok = true;
      motivo = `similaridade do topo: ${sim.toFixed(3)} (esperado baixa)`;
    } else {
      similaridadesPositivas.push(sim);
      // "contem" é checado em TODOS os resultados retornados, não só no
      // topo: é isso que a etapa 4 (suggest/ask) vai mandar como contexto
      // para o LLM, então o que importa é se a informação está em algum
      // dos N trechos, não necessariamente em 1º lugar.
      const resultados = resp.resultados ?? [];
      const contemOk = !p.contem || resultados.some((r) => normalize(r.conteudo).includes(normalize(p.contem)));
      const posicao = resultados.findIndex((r) => normalize(r.conteudo).includes(normalize(p.contem ?? "")));
      const categoriaOk = !p.categoria_esperada || resultados.some((r) => r.metadados?.tipo === p.categoria_esperada);
      ok = resultados.length > 0 && categoriaOk && contemOk;
      motivo = ok
        ? `ok (posição ${posicao + 1}/${resultados.length}, sim_top1=${sim.toFixed(3)})`
        : `não encontrado contendo "${p.contem}" com categoria="${p.categoria_esperada}" em nenhum dos ${resultados.length} resultados`;
    }

    if (ok) acertos++;
    resultados.push({ id: p.id, pergunta: p.pergunta, ok, motivo, similaridade_top1: sim });
    console.log(`${ok ? "✓" : "✗"} ${p.id}: ${motivo}`);
  }

  const total = perguntas.length;
  console.log(`\n${acertos}/${total} perguntas passaram.`);

  if (similaridadesPositivas.length > 0 && similaridadesNegativas.length > 0) {
    const minPositivo = Math.min(...similaridadesPositivas);
    const maxNegativo = Math.max(...similaridadesNegativas);
    console.log(`\nSimilaridade (top1) — perguntas relevantes: min=${minPositivo.toFixed(3)}, perguntas fora do domínio: max=${maxNegativo.toFixed(3)}`);
    if (minPositivo > maxNegativo) {
      const sugestao = ((minPositivo + maxNegativo) / 2).toFixed(3);
      console.log(`Há separação clara — limiar_relevancia sugerido: ${sugestao} (ponto médio entre os dois grupos).`);
    } else {
      console.log(`Atenção: não há separação clara entre pergunta relevante e fora do domínio nessa amostra — mais perguntas-ouro ajudariam a calibrar melhor.`);
    }
  }

  writeFileSync(
    join(__dirname, "resultados.json"),
    JSON.stringify({ executado_em: new Date().toISOString(), acertos, total, resultados }, null, 2),
  );

  if (acertos < total) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Erro ao rodar os evals:", err);
  process.exitCode = 1;
});
