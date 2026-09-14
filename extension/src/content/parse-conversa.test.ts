import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { extrairConversa, extrairThreadId } from "./parse-conversa";
import type { SeletoresMensagens } from "../lib/types";

const FIXTURE_PATH = fileURLToPath(
  new URL("../../fixtures/hubspot-inbox-fixture.html", import.meta.url),
);

const SELETORES: SeletoresMensagens = {
  container_mensagens: ".thread-messages",
  mensagem: ".msg-bubble",
  mensagem_texto: ".msg-text",
  mensagem_autor_lead: ".from-visitor",
  mensagem_hora: ".msg-time",
};

describe("extrairConversa", () => {
  it("extrai autor, texto e hora de cada bolha na ordem do DOM", () => {
    const html = readFileSync(FIXTURE_PATH, "utf-8");
    const dom = new JSDOM(html);
    const container = dom.window.document.querySelector(SELETORES.container_mensagens)!;

    const mensagens = extrairConversa(container, SELETORES);

    expect(mensagens).toEqual([
      { autor: "lead", texto: "Oi, boa tarde! Queria saber mais sobre a pós de dados.", hora: "14:02" },
      {
        autor: "atendente",
        texto: "Boa tarde! Claro, posso te ajudar. Você já é graduado em qual área?",
        hora: "14:03",
      },
      { autor: "lead", texto: "Sou formado em administração.", hora: "14:05" },
    ]);
  });

  it("ignora bolhas sem texto (ex.: separador de data, indicador 'digitando')", () => {
    const dom = new JSDOM(
      `<div class="thread-messages"><div class="msg-bubble from-agent"></div></div>`,
    );
    const container = dom.window.document.querySelector(SELETORES.container_mensagens)!;
    expect(extrairConversa(container, SELETORES)).toEqual([]);
  });

  it("funciona sem seletor de hora configurado (opcional)", () => {
    const dom = new JSDOM(
      `<div class="thread-messages"><div class="msg-bubble from-visitor"><div class="msg-text">oi</div></div></div>`,
    );
    const container = dom.window.document.querySelector(SELETORES.container_mensagens)!;
    const { mensagem_hora: _semHora, ...semHora } = SELETORES;
    expect(extrairConversa(container, semHora)).toEqual([{ autor: "lead", texto: "oi", hora: null }]);
  });
});

describe("extrairThreadId", () => {
  it("extrai o id numérico da URL real do HubSpot", () => {
    expect(extrairThreadId("https://app.hubspot.com/live-messages/12345/inbox/998877")).toBe(
      "998877",
    );
  });

  it("retorna null fora de uma conversa do inbox", () => {
    expect(extrairThreadId("https://app.hubspot.com/contacts/12345/objects/0-1/views/all/list")).toBe(
      null,
    );
  });
});
