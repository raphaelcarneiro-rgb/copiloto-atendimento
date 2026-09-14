import { describe, expect, it } from "vitest";
import { isBusinessTime, lastBusinessMomentBefore, reminderSchedule, type Feriado } from "./business-hours";
import type { Expediente } from "./types";

// 2024-01-01 é segunda-feira: 02=ter, 03=qua, 04=qui, 05=sex, 06=sáb, 07=dom, 08=seg.
const EXPEDIENTE: Expediente = { dias: [1, 2, 3, 4, 5], inicio: "09:00", fim: "19:00", fuso: "America/Sao_Paulo" };
const SEM_FERIADOS: Feriado[] = [];

/** Constrói o instante UTC de um horário local em America/Sao_Paulo (UTC-3), igual ao módulo testado. */
function sp(ano: number, mes: number, dia: number, hora: number, minuto = 0): Date {
  return new Date(Date.UTC(ano, mes - 1, dia, hora, minuto) + 3 * 60 * 60 * 1000);
}

describe("isBusinessTime", () => {
  it("dentro do expediente numa quarta", () => {
    expect(isBusinessTime(sp(2024, 1, 3, 15, 0), EXPEDIENTE, SEM_FERIADOS)).toBe(true);
  });

  it("almoço conta como expediente (sem pausa)", () => {
    expect(isBusinessTime(sp(2024, 1, 3, 13, 0), EXPEDIENTE, SEM_FERIADOS)).toBe(true);
  });

  it("antes do início não é expediente", () => {
    expect(isBusinessTime(sp(2024, 1, 3, 8, 59), EXPEDIENTE, SEM_FERIADOS)).toBe(false);
  });

  it("no fim exato (19:00) já não é mais expediente", () => {
    expect(isBusinessTime(sp(2024, 1, 3, 19, 0), EXPEDIENTE, SEM_FERIADOS)).toBe(false);
  });

  it("fim de semana nunca é expediente", () => {
    expect(isBusinessTime(sp(2024, 1, 6, 15, 0), EXPEDIENTE, SEM_FERIADOS)).toBe(false); // sábado
  });

  it("feriado com conta_como_folga derruba um dia útil normal", () => {
    const feriados: Feriado[] = [{ data: "2024-01-03", nome: "Feriado teste", tipo: "nacional", conta_como_folga: true }];
    expect(isBusinessTime(sp(2024, 1, 3, 15, 0), EXPEDIENTE, feriados)).toBe(false);
  });
});

describe("lastBusinessMomentBefore", () => {
  it("expira sex 21h → último momento útil sex 19h", () => {
    const r = lastBusinessMomentBefore(sp(2024, 1, 5, 21, 0), EXPEDIENTE, SEM_FERIADOS);
    expect(r?.getTime()).toBe(sp(2024, 1, 5, 19, 0).getTime());
  });

  it("expira seg 08h → último momento útil sex 19h (fim de semana no meio)", () => {
    const r = lastBusinessMomentBefore(sp(2024, 1, 8, 8, 0), EXPEDIENTE, SEM_FERIADOS);
    expect(r?.getTime()).toBe(sp(2024, 1, 5, 19, 0).getTime());
  });

  it("expira num feriado às 10h → último momento útil no dia útil anterior às 19h", () => {
    const feriados: Feriado[] = [{ data: "2024-01-04", nome: "Feriado teste", tipo: "nacional", conta_como_folga: true }];
    const r = lastBusinessMomentBefore(sp(2024, 1, 4, 10, 0), EXPEDIENTE, feriados);
    expect(r?.getTime()).toBe(sp(2024, 1, 3, 19, 0).getTime());
  });

  it("feriados encadeados (tipo Carnaval) pulam vários dias seguidos", () => {
    const feriados: Feriado[] = [
      { data: "2024-01-08", nome: "dia 1", tipo: "facultativo", conta_como_folga: true },
      { data: "2024-01-09", nome: "dia 2", tipo: "estadual", conta_como_folga: true },
      { data: "2024-01-10", nome: "dia 3", tipo: "institucional", conta_como_folga: true },
    ];
    const r = lastBusinessMomentBefore(sp(2024, 1, 10, 10, 0), EXPEDIENTE, feriados);
    expect(r?.getTime()).toBe(sp(2024, 1, 5, 19, 0).getTime());
  });

  it("já está em expediente → retorna o próprio instante", () => {
    const r = lastBusinessMomentBefore(sp(2024, 1, 3, 15, 0), EXPEDIENTE, SEM_FERIADOS);
    expect(r?.getTime()).toBe(sp(2024, 1, 3, 15, 0).getTime());
  });
});

describe("reminderSchedule", () => {
  const config = { expediente: EXPEDIENTE, lembrete_antecedencia_min: 120 };

  it("RF11: expira qua 15h → lembrete qua 13h", () => {
    const r = reminderSchedule(sp(2024, 1, 2, 15, 0), config, SEM_FERIADOS); // msg terça 15h
    expect(r.expiraEm.getTime()).toBe(sp(2024, 1, 3, 15, 0).getTime());
    expect(r.foraDeExpediente).toBe(false);
    expect(r.semJanelaUtil).toBe(false);
    expect(r.notificarEm?.getTime()).toBe(sp(2024, 1, 3, 13, 0).getTime());
  });

  it("RF11: expira qua 13h (almoço) → lembrete qua 11h, sem tratar como fora do expediente", () => {
    const r = reminderSchedule(sp(2024, 1, 2, 13, 0), config, SEM_FERIADOS);
    expect(r.foraDeExpediente).toBe(false);
    expect(r.notificarEm?.getTime()).toBe(sp(2024, 1, 3, 11, 0).getTime());
  });

  it("RF12: expira sex 21h → lembrete destacado desde sex 09h e notificação sex 17h", () => {
    const r = reminderSchedule(sp(2024, 1, 4, 21, 0), config, SEM_FERIADOS); // msg quinta 21h
    expect(r.expiraEm.getTime()).toBe(sp(2024, 1, 5, 21, 0).getTime());
    expect(r.foraDeExpediente).toBe(true);
    expect(r.ultimoMomentoUtil?.getTime()).toBe(sp(2024, 1, 5, 19, 0).getTime());
    expect(r.notificarEm?.getTime()).toBe(sp(2024, 1, 5, 17, 0).getTime());
    expect(r.destacarDesde?.getTime()).toBe(sp(2024, 1, 5, 9, 0).getTime());
  });

  it("RF13: msg sex 20h (já fora do expediente) → expira sáb 20h → sem janela útil", () => {
    const r = reminderSchedule(sp(2024, 1, 5, 20, 0), config, SEM_FERIADOS);
    expect(r.expiraEm.getTime()).toBe(sp(2024, 1, 6, 20, 0).getTime());
    expect(r.semJanelaUtil).toBe(true);
    expect(r.notificarEm).toBeNull();
  });

  it("notificarEm nunca é antes de ultimaMsgLead", () => {
    // msg 1 min antes do fim de sexta; expira sábado (fora do expediente) e o
    // único instante de expediente disponível é o fim de sexta, 1 min depois
    // da própria mensagem — 120min de antecedência cairia no passado.
    const ultimaMsgLead = sp(2024, 1, 5, 18, 59);
    const r = reminderSchedule(ultimaMsgLead, config, SEM_FERIADOS);
    expect(r.semJanelaUtil).toBe(false);
    expect(r.notificarEm!.getTime()).toBe(ultimaMsgLead.getTime());
  });
});
