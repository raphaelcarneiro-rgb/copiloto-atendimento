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
}

export interface SeletorComposer {
  /** Selector do campo de resposta (contenteditable) onde inserir texto. */
  composer_texto: string;
}

/** `{}` (todas as chaves ausentes) significa "ainda não calibrado" — ver docs/setup/04-extensao.md. */
export type SeletoresHubspot = Partial<SeletoresMensagens> & Partial<SeletorComposer>;

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
}

export interface ConversaExtraida {
  threadId: string;
  mensagens: MensagemExtraida[];
  extraidoEm: string;
}

/** Estado de ativação por conversa, persistido em chrome.storage.local. */
export interface AtivacaoState {
  [threadId: string]: boolean;
}

export type MensagemRuntime =
  | { tipo: "conversa-atualizada"; conversa: ConversaExtraida }
  | { tipo: "seletores-nao-calibrados"; threadId: string }
  | { tipo: "ativacao-mudou"; threadId: string; ativo: boolean }
  | { tipo: "pedir-estado"; threadId: string };

/** Enviada do side panel para o content script da aba ativa do HubSpot (RF: copiar/inserir). */
export interface InserirTextoRequest {
  tipo: "inserir-texto";
  texto: string;
}

export interface InserirTextoResponse {
  ok: boolean;
  motivo?: "composer-nao-calibrado" | "composer-nao-encontrado";
}
