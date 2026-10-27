#!/usr/bin/env node
// Eval do `suggest` por modelo: roda as conversas dos prints da equipe
// (evals/suggest-casos.json) em cada modelo e confere as regras que cada print
// originou (deve / não deve aparecer no texto das sugestões).
//
// Usa o campo `modelo` do suggest, liberado só para os modelos de
// `config.modelos.eval_permitidos`, e `eval: true` (não registra lacunas na
// curadoria; o uso fica em usage_logs com thread_hash = "eval-modelos").
//
// Uso:
//   node evals/suggest.mjs                         # gpt-5.6-luna x gpt-6-luna, 3 repetições
//   MODELOS=gpt-6-luna REPETICOES=1 CASOS=p11-grade-completa node evals/suggest.mjs
//
// Saídas: evals/suggest-resultados.json (bruto) e evals/suggest-relatorio.md (lado a lado).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://trtmyuqatmhvikfbqmkv.supabase.co";
// Anon key pública (a mesma de evals/run.mjs).
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRydG15dXFhdG1odmlrZmJxbWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMzA0NTUsImV4cCI6MjEwNDkwNjQ1NX0.A1Wj9uzSgYxngeFBXAa-mtP9Xx4QMwl1r2a0F8VjiLU";

const MODELOS = (process.env.MODELOS ?? "gpt-5.6-luna,gpt-6-luna").split(",").map((s) => s.trim()).filter(Boolean);
const REPETICOES = Number(process.env.REPETICOES ?? 3);
const PARALELO = Number(process.env.PARALELO ?? 4);
const FILTRO = process.env.CASOS ? new Set(process.env.CASOS.split(",")) : null;

// US$ por 1M tokens (entrada sem cache, cache, saída) — tabela OpenAI de 2026-10.
const PRECOS = {
  "gpt-5.6-luna": [0.2, 0.02, 1.2],
  "gpt-6-luna": [0.1, 0.01, 0.5],
};

const casos = JSON.parse(readFileSync(join(__dirname, "suggest-casos.json"), "utf-8")).filter(
  (c) => !FILTRO || FILTRO.has(c.id),
);

function custo(modelo, u) {
  const p = PRECOS[modelo];
  if (!p || !u) return null;
  return ((u.tokens_entrada - u.tokens_cache) * p[0] + u.tokens_cache * p[1] + u.tokens_saida * p[2]) / 1e6;
}

async function chamarSuggest(caso, modelo) {
  const inicio = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/suggest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      mensagens: caso.mensagens.map((m) => ({ ...m, hora: null })),
      empresa_associada: caso.empresa_associada ?? undefined,
      estado_lead: caso.estado_lead ?? undefined,
      ignorar_ambiguidade: true,
      modelo,
      eval: true,
    }),
  });
  const latenciaMs = Date.now() - inicio;
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) return { erro: `${res.status}: ${corpo.error ?? JSON.stringify(corpo)}`, latenciaMs };
  return { corpo, latenciaMs };
}

function avaliar(caso, corpo) {
  const textos = (corpo.sugestoes ?? []).map((s) => s.texto);
  const tudo = textos.join("\n\n");
  const falhas = [];
  const min = caso.min_sugestoes ?? ((caso.deve ?? []).length > 0 ? 1 : 0);
  if (textos.length < min) falhas.push(`sem sugestão (esperava ≥ ${min})`);
  for (const r of caso.deve ?? []) {
    if (!new RegExp(r.re, "i").test(tudo)) falhas.push(`faltou: ${r.desc}`);
  }
  for (const r of caso.nao_deve ?? []) {
    if (new RegExp(r.re, "i").test(tudo)) falhas.push(`proibido: ${r.desc}`);
  }
  return { ok: falhas.length === 0, falhas, textos, lacunas: corpo.lacunas ?? [] };
}

async function emParalelo(tarefas, limite) {
  const resultados = new Array(tarefas.length);
  let i = 0;
  async function worker() {
    while (i < tarefas.length) {
      const k = i++;
      resultados[k] = await tarefas[k]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, tarefas.length) }, worker));
  return resultados;
}

async function main() {
  const tarefas = [];
  for (const caso of casos) {
    for (const modelo of MODELOS) {
      for (let rep = 1; rep <= REPETICOES; rep++) {
        tarefas.push(async () => {
          const r = await chamarSuggest(caso, modelo);
          const linha = { caso: caso.id, modelo, rep, latenciaMs: r.latenciaMs };
          if (r.erro) {
            process.stdout.write(`✗ ${caso.id} [${modelo} #${rep}] ERRO ${r.erro}\n`);
            return { ...linha, ok: false, erro: r.erro, falhas: [`erro: ${r.erro}`], textos: [], lacunas: [] };
          }
          const a = avaliar(caso, r.corpo);
          const uso = r.corpo.eval ?? null;
          process.stdout.write(`${a.ok ? "✓" : "✗"} ${caso.id} [${modelo} #${rep}] ${a.falhas.join("; ")}\n`);
          return { ...linha, ...a, uso, custoUsd: custo(modelo, uso), etapa: r.corpo.etapa, cursos: r.corpo.cursos_identificados };
        });
      }
    }
  }

  const resultados = await emParalelo(tarefas, PARALELO);
  writeFileSync(join(__dirname, "suggest-resultados.json"), JSON.stringify(resultados, null, 2));

  // Resumo por modelo
  const resumo = MODELOS.map((modelo) => {
    const rs = resultados.filter((r) => r.modelo === modelo);
    const comUso = rs.filter((r) => r.uso);
    const media = (f) => (comUso.length ? comUso.reduce((s, r) => s + f(r), 0) / comUso.length : 0);
    return {
      modelo,
      aprovadas: rs.filter((r) => r.ok).length,
      total: rs.length,
      erros: rs.filter((r) => r.erro).length,
      custoMedio: media((r) => r.custoUsd ?? 0),
      saidaMedia: media((r) => r.uso.tokens_saida),
      latenciaMedia: rs.reduce((s, r) => s + r.latenciaMs, 0) / (rs.length || 1),
    };
  });

  const md = [];
  md.push(`# Eval do suggest por modelo`, "", `Gerado em ${new Date().toISOString()} · ${casos.length} casos × ${REPETICOES} repetições`, "");
  md.push("| Modelo | Aprovadas | Erros | Custo médio/chamada | Tokens de saída (média) | Latência média |", "|---|---|---|---|---|---|");
  for (const r of resumo) {
    md.push(
      `| ${r.modelo} | ${r.aprovadas}/${r.total} | ${r.erros} | US$ ${r.custoMedio.toFixed(5)} | ${Math.round(r.saidaMedia)} | ${(r.latenciaMedia / 1000).toFixed(1)} s |`,
    );
  }
  md.push("", "## Por caso", "", `| Caso | ${MODELOS.join(" | ")} |`, `|---|${MODELOS.map(() => "---").join("|")}|`);
  for (const caso of casos) {
    const cels = MODELOS.map((m) => {
      const rs = resultados.filter((r) => r.caso === caso.id && r.modelo === m);
      return `${rs.filter((r) => r.ok).length}/${rs.length}`;
    });
    md.push(`| ${caso.id} | ${cels.join(" | ")} |`);
  }
  md.push("", "## Sugestões lado a lado (repetição 1)", "");
  for (const caso of casos) {
    md.push(`### ${caso.id}`, "", `_${caso.origem}_`, "", `**Última mensagem do lead:** ${caso.mensagens.at(-1).texto}`, "");
    for (const m of MODELOS) {
      const rs = resultados.filter((r) => r.caso === caso.id && r.modelo === m);
      const r1 = rs.find((r) => r.rep === 1);
      const falhas = [...new Set(rs.flatMap((r) => r.falhas))];
      md.push(`**${m}** — ${rs.filter((r) => r.ok).length}/${rs.length} aprovadas${falhas.length ? ` · falhas: ${falhas.join("; ")}` : ""}`, "");
      if (r1?.textos?.length) for (const t of r1.textos) md.push("> " + t.replace(/\n/g, "\n> "), "");
      else md.push("> _(sem sugestão)_" + (r1?.lacunas?.length ? ` · lacunas: ${r1.lacunas.join(" | ")}` : ""), "");
    }
  }
  writeFileSync(join(__dirname, "suggest-relatorio.md"), md.join("\n"));

  console.log("\nResumo:");
  console.table(resumo.map((r) => ({ ...r, custoMedio: r.custoMedio.toFixed(5), latenciaMedia: Math.round(r.latenciaMedia) })));
  console.log("Relatório: evals/suggest-relatorio.md");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
