// Registro de lacunas da base (RF15) com deduplicação por similaridade de
// embedding (RF16). Compartilhado entre `ask` e `suggest` — extraído do
// `ask` na etapa do `suggest` porque virou duplicação de verdade, não só
// parecido (mesma função, mesmo comportamento, dois chamadores).
import type { createServiceClient } from "./db.ts";

type Db = ReturnType<typeof createServiceClient>;

export async function registrarLacuna(
  db: Db,
  perguntaMascarada: string,
  embedding: number[],
  limiarDedup: number,
): Promise<{ registrada: boolean; gapId: string | null }> {
  const { data: similar, error: matchErr } = await db.rpc("match_gap_similar", {
    query_embedding: embedding,
    limiar: limiarDedup,
  });
  if (matchErr) {
    console.error("match_gap_similar falhou:", matchErr.message);
    return { registrada: false, gapId: null };
  }

  if (similar && similar.length > 0) {
    const gapId = similar[0].id;
    // Sem função dedicada de incremento atômico: leitura + escrita. O
    // volume esperado não gera concorrência real; se isso mudar, trocar
    // por um `update ... set contagem = contagem + 1`.
    const { data: atual } = await db.from("knowledge_gaps").select("contagem").eq("id", gapId).single();
    await db
      .from("knowledge_gaps")
      .update({ contagem: (atual?.contagem ?? 1) + 1, ultima_vez: new Date().toISOString() })
      .eq("id", gapId);
    return { registrada: true, gapId };
  }

  const { data: novo, error: insErr } = await db
    .from("knowledge_gaps")
    .insert({ pergunta_mascarada: perguntaMascarada, embedding })
    .select("id")
    .single();
  if (insErr) {
    console.error("knowledge_gaps.insert falhou:", insErr.message);
    return { registrada: false, gapId: null };
  }
  return { registrada: true, gapId: novo.id };
}
