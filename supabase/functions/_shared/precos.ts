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
      if (linhasRj) bloco += ` Residente no Rio de Janeiro: ${linhasRj}.`;
    } else if (estadoLead) {
      if (linhasForaRj) bloco += ` Fora do Rio de Janeiro: ${linhasForaRj}.`;
    } else {
      bloco +=
        " O estado do lead ainda não é conhecido — ANTES de informar um valor específico, pergunte se ele mora no Rio de Janeiro ou fora. Pode adiantar que o valor muda conforme o estado, mas NÃO informe nenhum valor exato ainda.";
    }
    bloco += textoConvenio;
    if (formas.length > 1) {
      bloco += ` IMPORTANTE: ao apresentar o preço, liste TODAS as formas de pagamento acima (Pix, cartão parcelado em 12x e 18x, recorrente e boleto), uma por linha — nunca mostre só a mais barata/à vista.`;
    }
  }

  return { bloco, injetado };
}
