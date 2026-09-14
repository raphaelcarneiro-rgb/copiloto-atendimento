// Registro de lacunas da base (RF15) com deduplicação por similaridade de
// embedding (RF16). Compartilhado entre `ask` e `suggest` — extraído do
// `ask` na etapa do `suggest` porque virou duplicação de verdade, não só
// parecido (mesma função, mesmo comportamento, dois chamadores).
import type { createServiceClient } from "./db.ts";

type Db = ReturnType<typeof createServiceClient>;

/**
 * `userId` (RF20, adicionado quando o login ficou pronto — 2026-09-14):
 * quando o chamador está autenticado, registra quem perguntou em
 * `usuarios_ids`, pra depois avisar "sua dúvida agora tem resposta" quando
 * a lacuna for aprovada como FAQ. Sem login (chamada anônima, ainda comum
 * enquanto nem todo mundo logou), fica `null` e a lacuna é registrada do
 * mesmo jeito — só não dá pra notificar ninguém especificamente por ela.
 */
export async function registrarLacuna(
  db: Db,
  perguntaMascarada: string,
  embedding: number[],
  limiarDedup: number,
  userId: string | null = null,
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
    const { data: atual } = await db.from("knowledge_gaps").select("contagem, usuarios_ids").eq("id", gapId).single();
    const usuariosAtuais: string[] = atual?.usuarios_ids ?? [];
    const usuariosNovos = userId && !usuariosAtuais.includes(userId) ? [...usuariosAtuais, userId] : usuariosAtuais;
    await db
      .from("knowledge_gaps")
      .update({ contagem: (atual?.contagem ?? 1) + 1, ultima_vez: new Date().toISOString(), usuarios_ids: usuariosNovos })
      .eq("id", gapId);
    return { registrada: true, gapId };
  }

  const { data: novo, error: insErr } = await db
    .from("knowledge_gaps")
    .insert({ pergunta_mascarada: perguntaMascarada, embedding, usuarios_ids: userId ? [userId] : [] })
    .select("id")
    .single();
  if (insErr) {
    console.error("knowledge_gaps.insert falhou:", insErr.message);
    return { registrada: false, gapId: null };
  }
  return { registrada: true, gapId: novo.id };
}
