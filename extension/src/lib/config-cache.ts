// Cache local da config remota (RF22). TTL curto porque a fonte de verdade
// (planilha/tabela) já sincroniza a cada 15 min — não faz sentido a extensão
// segurar um valor mais velho que isso.
import { fetchConfig } from "./api";
import type { ConfigRemota } from "./types";

const CACHE_KEY = "config_remota_cache";
const TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  valor: ConfigRemota;
  buscadoEm: number;
}

export async function getConfigCached(): Promise<ConfigRemota> {
  const { [CACHE_KEY]: cache } = (await chrome.storage.local.get(CACHE_KEY)) as {
    [CACHE_KEY]?: CacheEntry;
  };
  if (cache && Date.now() - cache.buscadoEm < TTL_MS) {
    return cache.valor;
  }
  const valor = await fetchConfig();
  const entry: CacheEntry = { valor, buscadoEm: Date.now() };
  await chrome.storage.local.set({ [CACHE_KEY]: entry });
  return valor;
}

/** Compara "0.1.0" style. Só cobre o que a extensão usa: maior/menor/igual. */
export function versaoMenorQue(atual: string, minima: string): boolean {
  const a = atual.split(".").map(Number);
  const b = minima.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

export function seletoresCalibrados(config: ConfigRemota): boolean {
  const s = config.seletores_hubspot;
  return Boolean(s.container_mensagens && s.mensagem && s.mensagem_texto && s.mensagem_autor_lead);
}
