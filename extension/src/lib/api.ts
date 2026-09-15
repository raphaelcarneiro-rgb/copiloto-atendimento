// Cliente das Edge Functions do Supabase. A anon key é pública por design do
// Supabase (equivalente a uma chave de projeto, não a um segredo — o mesmo
// valor já é usado pelo job pg_cron); a autorização de verdade vem do RLS e
// do JWT do usuário logado, que é anexado aqui quando existir (RF09).
import type { ConfigRemota, ConvenioInfo, MensagemExtraida } from "./types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-config";
import { getSessao } from "./auth";

export { SUPABASE_URL, SUPABASE_ANON_KEY };

async function getUserJwt(): Promise<string | null> {
  const sessao = await getSessao();
  return sessao?.access_token ?? null;
}

async function callFunction<T>(path: string, init?: RequestInit): Promise<T> {
  const jwt = await getUserJwt();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt ?? SUPABASE_ANON_KEY}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`${path} falhou (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export function fetchConfig(): Promise<ConfigRemota> {
  return callFunction<ConfigRemota>("config", { method: "GET" });
}

export interface AskResponse {
  resposta: string;
  encontrado: boolean;
  confianca: "alta" | "media" | "baixa";
  fontes: Array<{ chunk_id: number; trecho: string | null }>;
  lacuna_registrada: boolean;
  usage_log_id: number | null;
}

export function ask(pergunta: string, threadHash?: string): Promise<AskResponse> {
  return callFunction<AskResponse>("ask", {
    method: "POST",
    body: JSON.stringify({ pergunta, thread_hash: threadHash }),
  });
}

export interface SuggestResponse {
  etapa: string;
  script_etapa: string;
  sugestoes: Array<{
    texto: string;
    fontes: Array<{ chunk_id: number; trecho: string | null }>;
  }>;
  perguntas_para_lead: string[];
  alertas: string[];
  lacunas: string[];
  confianca: "alta" | "media" | "baixa";
  lacuna_registrada: boolean;
  usage_log_id: number | null;
}

export function suggest(
  mensagens: MensagemExtraida[],
  threadHash?: string,
  empresaAssociada?: string | null,
  modo?: "resposta" | "follow_up",
): Promise<SuggestResponse> {
  // `audioUrl` é só um estado intermediário de transcrição (ver
  // hubspot-reader.ts) — nunca deve sair do navegador, mesmo que por algum
  // motivo ainda esteja presente no momento da chamada.
  const mensagensSemAudioUrl = mensagens.map(({ autor, texto, hora }) => ({ autor, texto, hora }));
  return callFunction<SuggestResponse>("suggest", {
    method: "POST",
    body: JSON.stringify({
      mensagens: mensagensSemAudioUrl,
      thread_hash: threadHash,
      empresa_associada: empresaAssociada ?? undefined,
      modo: modo ?? undefined,
    }),
  });
}

export interface Notificacao {
  gap_id: string;
  pergunta_mascarada: string;
  resolvido_em: string | null;
  resposta: string | null;
}

/** RF20: lacunas que o usuário logado perguntou e que já viraram FAQ. Sem sessão, nem chama (401 certo). */
export async function listarNotificacoes(): Promise<Notificacao[]> {
  const { notificacoes } = await callFunction<{ notificacoes: Notificacao[] }>("notificacoes", { method: "GET" });
  return notificacoes;
}

export type ConvenioResponse = ConvenioInfo;

/** Cabeçalho do side panel (pedido do Raphael, 2026-09-15): % de desconto de convênio da empresa associada. */
export function buscarConvenio(empresa: string): Promise<ConvenioResponse> {
  return callFunction<ConvenioResponse>(`convenio?empresa=${encodeURIComponent(empresa)}`, { method: "GET" });
}

export interface ContextoLeadResponse {
  encontrado: boolean;
  nome?: string | null;
  cargo?: string | null;
  estado?: string | null;
  empresa?: string | null;
  convenio?: ConvenioInfo;
}

/**
 * Nome/cargo/estado/empresa direto da API do HubSpot (`contexto-lead`),
 * não da tela — corrige um bug real (2026-09-15): o texto do cabeçalho da
 * conversa às vezes reflete um campo de texto livre do contato, não a
 * Empresa de fato associada via CRM. Falha (rede, token não configurado)
 * não é fatal — `hubspot-reader.ts` cai de volta pra leitura do DOM.
 */
export function buscarContextoLead(threadId: string): Promise<ContextoLeadResponse> {
  return callFunction<ContextoLeadResponse>(`contexto-lead?thread_id=${encodeURIComponent(threadId)}`, {
    method: "GET",
  });
}

/** Nota de voz do WhatsApp (pedido do Raphael, 2026-09-15): transcreve o áudio já baixado pelo navegador. */
export function transcreverAudio(params: {
  audioBase64: string;
  mimeType: string;
  duracaoSeg?: number | null;
  threadHash?: string;
}): Promise<{ texto: string }> {
  return callFunction<{ texto: string }>("transcrever-audio", {
    method: "POST",
    body: JSON.stringify({
      audio_base64: params.audioBase64,
      mime_type: params.mimeType,
      duracao_seg: params.duracaoSeg ?? undefined,
      thread_hash: params.threadHash,
    }),
  });
}

export function enviarFeedback(params: {
  usageLogId: number;
  aceita?: boolean;
  feedback?: "positivo" | "negativo";
}): Promise<{ ok: boolean }> {
  return callFunction("feedback", {
    method: "POST",
    body: JSON.stringify({
      usage_log_id: params.usageLogId,
      aceita: params.aceita,
      feedback: params.feedback,
    }),
  });
}
