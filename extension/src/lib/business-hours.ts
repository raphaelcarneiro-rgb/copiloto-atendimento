// Etapa 6 (RF10-RF14): funções puras de expediente e lembrete da janela de
// 24h do WhatsApp. Sem dependência de DOM/chrome.* para ficarem fáceis de
// testar isoladamente — window-guard.ts usa isso pra agendar chrome.alarms.
//
// Fuso fixo America/Sao_Paulo = UTC-3: o Brasil aboliu o horário de verão em
// todo o território a partir de 2019, então um offset fixo é seguro sem
// precisar de uma lib de fusos horários. Se isso mudar por lei, precisa
// revisar aqui.
import type { Expediente } from "./types";

const OFFSET_MS = 3 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

export interface Feriado {
  data: string; // "YYYY-MM-DD"
  nome: string;
  tipo: string;
  conta_como_folga: boolean;
}

interface PartesSP {
  ano: number;
  mes: number; // 1-12
  dia: number;
  semana: number; // 0=domingo .. 6=sábado
  hora: number;
  minuto: number;
}

/** Decompõe um instante (Date) nos campos de calendário em America/Sao_Paulo. */
function paraSaoPaulo(instante: Date): PartesSP {
  const local = new Date(instante.getTime() - OFFSET_MS);
  return {
    ano: local.getUTCFullYear(),
    mes: local.getUTCMonth() + 1,
    dia: local.getUTCDate(),
    semana: local.getUTCDay(),
    hora: local.getUTCHours(),
    minuto: local.getUTCMinutes(),
  };
}

/** Constrói o instante (Date) correspondente a um horário local em America/Sao_Paulo. */
function deSaoPaulo(ano: number, mes: number, dia: number, hora: number, minuto: number): Date {
  const localComoUtc = Date.UTC(ano, mes - 1, dia, hora, minuto);
  return new Date(localComoUtc + OFFSET_MS);
}

function dataStr(p: PartesSP): string {
  return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

function ehFeriado(p: PartesSP, feriados: Feriado[]): boolean {
  const str = dataStr(p);
  return feriados.some((f) => f.data === str && f.conta_como_folga);
}

function ehDiaUtil(p: PartesSP, expediente: Expediente, feriados: Feriado[]): boolean {
  return expediente.dias.includes(p.semana) && !ehFeriado(p, feriados);
}

function minutosDoDia(hora: number, minuto: number): number {
  return hora * 60 + minuto;
}

function parseHoraMinuto(hhmm: string): { hora: number; minuto: number } {
  const [hora, minuto] = hhmm.split(":").map(Number);
  return { hora, minuto };
}

/** RF11/RF12: o instante está dentro do expediente (almoço incluso, sem pausa)? */
export function isBusinessTime(instante: Date, expediente: Expediente, feriados: Feriado[]): boolean {
  const p = paraSaoPaulo(instante);
  if (!ehDiaUtil(p, expediente, feriados)) return false;
  const { hora: ih, minuto: im } = parseHoraMinuto(expediente.inicio);
  const { hora: fh, minuto: fm } = parseHoraMinuto(expediente.fim);
  const min = minutosDoDia(p.hora, p.minuto);
  return min >= minutosDoDia(ih, im) && min < minutosDoDia(fh, fm);
}

const LOOKBACK_MAX_DIAS = 30;

/**
 * RF12/RF13: último instante de expediente ≤ `instante`. Retorna `null` se
 * nenhum dia útil for encontrado nos últimos `LOOKBACK_MAX_DIAS` dias
 * (feriados encadeados anormalmente longos).
 */
export function lastBusinessMomentBefore(
  instante: Date,
  expediente: Expediente,
  feriados: Feriado[],
): Date | null {
  const { hora: ih, minuto: im } = parseHoraMinuto(expediente.inicio);
  const { hora: fh, minuto: fm } = parseHoraMinuto(expediente.fim);

  let cursor = instante;
  for (let i = 0; i < LOOKBACK_MAX_DIAS; i++) {
    const p = paraSaoPaulo(cursor);
    const mesmoDia = i === 0;

    if (ehDiaUtil(p, expediente, feriados)) {
      const inicioInstante = deSaoPaulo(p.ano, p.mes, p.dia, ih, im);
      const fimInstante = deSaoPaulo(p.ano, p.mes, p.dia, fh, fm);

      if (mesmoDia) {
        if (instante.getTime() >= fimInstante.getTime()) return fimInstante;
        if (instante.getTime() >= inicioInstante.getTime()) return instante;
        // instante é antes do início do expediente desse dia — cai pro dia anterior.
      } else {
        return fimInstante;
      }
    }

    // Vai pro fim do dia anterior (meia-noite local menos 1ms) e repete.
    const meiaNoite = deSaoPaulo(p.ano, p.mes, p.dia, 0, 0);
    cursor = new Date(meiaNoite.getTime() - 1);
  }
  return null;
}

export interface AgendaLembrete {
  expiraEm: Date;
  ultimoMomentoUtil: Date | null;
  /** RF13: não existe nenhum instante de expediente entre a msg do lead e expiraEm. */
  semJanelaUtil: boolean;
  /** RF12: expiraEm cai fora do expediente. */
  foraDeExpediente: boolean;
  /** Quando mostrar a notificação do Chrome (RF11/RF12), ou null se sem janela útil. */
  notificarEm: Date | null;
  /** RF12(a): a partir de quando destacar o lembrete no painel como "expira fora do expediente". */
  destacarDesde: Date | null;
}

/**
 * RF10-RF13: calcula toda a agenda do lembrete de 24h a partir do horário da
 * última mensagem do lead.
 */
export function reminderSchedule(
  ultimaMsgLead: Date,
  config: { expediente: Expediente; lembrete_antecedencia_min: number },
  feriados: Feriado[],
): AgendaLembrete {
  const expiraEm = new Date(ultimaMsgLead.getTime() + DIA_MS);
  const ultimoMomentoUtil = lastBusinessMomentBefore(expiraEm, config.expediente, feriados);
  const semJanelaUtil = ultimoMomentoUtil === null || ultimoMomentoUtil.getTime() <= ultimaMsgLead.getTime();
  const foraDeExpediente = !isBusinessTime(expiraEm, config.expediente, feriados);

  if (semJanelaUtil) {
    return { expiraEm, ultimoMomentoUtil, semJanelaUtil, foraDeExpediente, notificarEm: null, destacarDesde: null };
  }

  const antecedenciaMs = config.lembrete_antecedencia_min * 60 * 1000;
  const candidato = new Date(ultimoMomentoUtil!.getTime() - antecedenciaMs);
  const notificarEm = candidato.getTime() < ultimaMsgLead.getTime() ? ultimaMsgLead : candidato;

  let destacarDesde: Date | null = null;
  if (foraDeExpediente) {
    const p = paraSaoPaulo(ultimoMomentoUtil!);
    const { hora: ih, minuto: im } = parseHoraMinuto(config.expediente.inicio);
    destacarDesde = deSaoPaulo(p.ano, p.mes, p.dia, ih, im);
  }

  return { expiraEm, ultimoMomentoUtil, semJanelaUtil, foraDeExpediente, notificarEm, destacarDesde };
}
