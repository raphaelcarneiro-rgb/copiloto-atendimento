import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

export interface Fonte {
  id: string;
  tipo: "sheet" | "pdf" | "url" | "faq" | "arquivo";
  ref: string;
  nome: string;
  categoria: string | null;
  ativo: boolean;
  status: "pendente" | "ok" | "erro";
  erro: string | null;
  ultima_sync: string | null;
  criado_em: string;
}

export interface PromptEditavel {
  chave: string;
  valor: string;
  descricao: string | null;
  atualizado_em: string;
  atualizado_por: string | null;
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function chamar<T>(caminho: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${caminho}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Falha (${res.status})`, res.status);
  return data as T;
}

export function listarFontes(accessToken: string): Promise<{ fontes: Fonte[] }> {
  return chamar("fontes", accessToken);
}

export function criarFonteArquivo(
  accessToken: string,
  params: { storagePath: string; nome: string; categoria: string },
): Promise<{ fonte: Fonte; ingestao: unknown }> {
  return chamar("fontes", accessToken, {
    method: "POST",
    body: JSON.stringify({ tipo: "arquivo", storage_path: params.storagePath, nome: params.nome, categoria: params.categoria }),
  });
}

export function criarFonteUrl(
  accessToken: string,
  params: { ref: string; nome: string; categoria: string },
): Promise<{ fonte: Fonte; ingestao: unknown }> {
  return chamar("fontes", accessToken, {
    method: "POST",
    body: JSON.stringify({ tipo: "url", ref: params.ref, nome: params.nome, categoria: params.categoria }),
  });
}

export function alternarFonteAtiva(accessToken: string, id: string, ativo: boolean): Promise<{ ok: true }> {
  return chamar("fontes", accessToken, { method: "PATCH", body: JSON.stringify({ id, ativo }) });
}

export function excluirFonte(accessToken: string, id: string): Promise<{ ok: true }> {
  return chamar("fontes", accessToken, { method: "DELETE", body: JSON.stringify({ id }) });
}

export function listarPrompts(accessToken: string): Promise<{ prompts: PromptEditavel[] }> {
  return chamar("admin-config", accessToken);
}

export function salvarPrompt(accessToken: string, chave: string, valor: string): Promise<{ ok: true }> {
  return chamar("admin-config", accessToken, { method: "PATCH", body: JSON.stringify({ chave, valor }) });
}

/**
 * Upload direto pro bucket "fontes-pdf" via REST do Storage (sem SDK do
 * Supabase, mesmo estilo do resto do projeto) — a sessão do próprio usuário
 * logado é o que autoriza (RLS do bucket: admin-only). Devolve o `path`
 * gravado, que vira `storage_path` no POST de `fontes`.
 */
export async function subirArquivoFontesPdf(accessToken: string, file: File): Promise<string> {
  const nomeSeguro = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${Date.now()}-${nomeSeguro}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/fontes-pdf/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.message ?? `Falha ao subir arquivo (${res.status})`, res.status);
  }
  return path;
}

export { ApiError };
