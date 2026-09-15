// Tipos compartilhados entre content script, side panel e background.

export interface SeletoresMensagens {
  /** Selector do container rolável que lista as mensagens da conversa. */
  container_mensagens: string;
  /** Selector de cada bolha de mensagem, relativo ao container. */
  mensagem: string;
  /** Selector do texto da mensagem, relativo à bolha. */
  mensagem_texto: string;
  /** Selector (relativo à bolha) presente só quando a mensagem é do lead/contato. */
  mensagem_autor_lead: string;
  /** Selector do horário da mensagem, relativo à bolha. Opcional. */
  mensagem_hora?: string;
  /**
   * Selector (relativo à bolha) de um anexo (imagem ou arquivo). Opcional:
   * sem ele, uma bolha sem texto (ex.: mensagem só com print) é descartada
   * como antes. Com ele, vira um marcador tipo "[Imagem enviada]" em vez de
   * sumir da conversa extraída — o copiloto não lê o conteúdo do anexo.
   */
  mensagem_anexo?: string;
}

export interface SeletorComposer {
  /** Selector do campo de resposta (contenteditable) onde inserir texto. */
  composer_texto: string;
}

export interface SeletorEmpresaAssociada {
  /**
   * Selector do nome da empresa já associada ao contato no CRM (ex.: painel
   * "Sobre esse Contato" / seção "Empresas"). Pedido do Raphael em
   * 2026-09-15: o `suggest` não deve perguntar a empresa do lead se ela já
   * está associada no HubSpot — precisa ler daqui, não da conversa.
   */
  empresa_associada: string;
}

export interface SeletoresCabecalhoCrm {
  /** Nome do contato/lead da conversa ativa, lido do painel "Sobre esse Contato". */
  nome_lead: string;
  /** Estado/Região do contato, lido do mesmo painel. Só exibição — não usado em nenhuma busca. */
  estado_lead: string;
}

/** `{}` (todas as chaves ausentes) significa "ainda não calibrado" — ver docs/setup/04-extensao.md. */
export type SeletoresHubspot = Partial<SeletoresMensagens> &
  Partial<SeletorComposer> &
  Partial<SeletorEmpresaAssociada> &
  Partial<SeletoresCabecalhoCrm>;

export interface Expediente {
  dias: number[];
  inicio: string;
  fim: string;
  fuso: string;
}

export interface ConfigRemota {
  seletores_hubspot: SeletoresHubspot;
  expediente: Expediente;
  lembrete_antecedencia_min: number;
  versao_minima: string;
  versao_atual: string;
  feriados: Array<{ data: string; nome: string; tipo: string; conta_como_folga: boolean }>;
}

export type Autor = "lead" | "atendente";

export interface MensagemExtraida {
  autor: Autor;
  texto: string;
  hora: string | null;
  /**
   * URL do áudio (nota de voz), presente só enquanto a mensagem ainda não
   * foi transcrita (pedido do Raphael, 2026-09-15). `hubspot-reader.ts`
   * resolve isso pra texto antes de disparar `conversa-atualizada` — nunca
   * é enviado ao backend (ver `api.ts`).
   */
  audioUrl?: string | null;
  /** Texto veio de transcrição de nota de voz (pode ter erro de reconhecimento) — só pra exibição, nunca enviado ao backend. */
  viaAudio?: boolean;
}

export interface ConvenioInfo {
  encontrado: boolean;
  empresa_convenio?: string;
  desconto_pct?: number;
  nivel?: string | null;
  valido_ate?: string | null;
  status?: string | null;
}

export interface ConversaExtraida {
  threadId: string;
  mensagens: MensagemExtraida[];
  extraidoEm: string;
  /**
   * Empresa associada ao contato — vem da API do HubSpot (`contexto-lead`,
   * associação real de CRM), com fallback pra leitura do DOM se a API
   * falhar. Achado real (2026-09-15): o texto do cabeçalho da conversa às
   * vezes reflete um campo de texto livre do contato, não a Empresa de
   * fato associada — por isso a API é a fonte preferida.
   */
  empresaAssociada: string | null;
  /** Nome do lead/contato da conversa ativa (null se não encontrado). Só exibição no cabeçalho do painel. */
  nomeLead: string | null;
  /** Estado/Região do contato (null se não encontrado). Só exibição no cabeçalho do painel. */
  estadoLead: string | null;
  /**
   * Convênio já resolvido pelo backend (via `contexto-lead`), pra evitar
   * uma segunda chamada do side panel. `null` quando a API do HubSpot
   * falhou e caiu no fallback de DOM — nesse caso o side panel busca o
   * convênio ele mesmo (`buscarConvenio`), como antes.
   */
  convenio: ConvenioInfo | null;
}

/** Estado de ativação por conversa, persistido em chrome.storage.local. */
export interface AtivacaoState {
  [threadId: string]: boolean;
}

export type MensagemRuntime =
  | { tipo: "conversa-atualizada"; conversa: ConversaExtraida }
  | { tipo: "seletores-nao-calibrados"; threadId: string }
  | { tipo: "ativacao-mudou"; threadId: string; ativo: boolean }
  | { tipo: "pedir-estado"; threadId: string }
  | { tipo: "dispensar-lembrete-24h"; threadId: string }
  | { tipo: "baixar-audio"; url: string };

/** Resposta de `{ tipo: "baixar-audio" }`, via `sendResponse` (não é um `MensagemRuntime`). */
export type BaixarAudioResponse = { ok: true; base64: string; mimeType: string } | { ok: false };

/** Enviada do side panel para o content script da aba ativa do HubSpot (RF: copiar/inserir). */
export interface InserirTextoRequest {
  tipo: "inserir-texto";
  texto: string;
}

export interface InserirTextoResponse {
  ok: boolean;
  motivo?: "composer-nao-calibrado" | "composer-nao-encontrado";
}
