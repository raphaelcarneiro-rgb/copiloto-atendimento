import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { extrairConversa, extrairEmpresaAssociada, extrairThreadId } from "./parse-conversa";
import type { SeletoresMensagens } from "../lib/types";

const FIXTURE_PATH = fileURLToPath(
  new URL("../../fixtures/hubspot-inbox-fixture.html", import.meta.url),
);

// Seletores reais, calibrados inspecionando o inbox de verdade (ver
// supabase/migrations/20260914030000_calibra_seletores_hubspot.sql) — não
// são um chute, e mudar isso aqui sem atualizar a migration destrava a
// extensão de novo.
const SELETORES: SeletoresMensagens = {
  container_mensagens: '[data-test-id="virtualParentRef"]',
  mensagem:
    '[data-test-id="primary-message-visitor"], [data-test-id="primary-message-agent"], [data-test-id="primary-message-AUTOMATED"]',
  mensagem_texto: '[data-test-id="primary-message-content"]',
  mensagem_autor_lead: '[data-test-id="primary-message-visitor"]',
  mensagem_hora: '[data-test-id="sender-header-content-timestamp"]',
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
      `<div data-test-id="virtualParentRef"><div data-test-id="primary-message-agent"></div></div>`,
    );
    const container = dom.window.document.querySelector(SELETORES.container_mensagens)!;
    expect(extrairConversa(container, SELETORES)).toEqual([]);
  });

  it("funciona sem seletor de hora configurado (opcional)", () => {
    const dom = new JSDOM(
      `<div data-test-id="virtualParentRef"><div data-test-id="primary-message-visitor"><div data-test-id="primary-message-content">oi</div></div></div>`,
    );
    const container = dom.window.document.querySelector(SELETORES.container_mensagens)!;
    const { mensagem_hora: _semHora, ...semHora } = SELETORES;
    expect(extrairConversa(container, semHora)).toEqual([{ autor: "lead", texto: "oi", hora: null }]);
  });

  const SELETORES_COM_ANEXO: SeletoresMensagens = {
    ...SELETORES,
    mensagem_anexo: '[data-test-id="file-attachment-wrapper"]',
  };

  it("sem seletor de anexo configurado, mensagem só com imagem continua sendo descartada (comportamento antigo)", () => {
    const dom = new JSDOM(
      `<div data-test-id="virtualParentRef"><div data-test-id="primary-message-agent"><div data-test-id="primary-message-content"></div><div data-test-id="file-attachment-wrapper"><img data-test-id="inline-image" src="x.png"></div></div></div>`,
    );
    const container = dom.window.document.querySelector(SELETORES.container_mensagens)!;
    expect(extrairConversa(container, SELETORES)).toEqual([]);
  });

  it("com seletor de anexo configurado, mensagem só com imagem vira um marcador em vez de sumir", () => {
    const dom = new JSDOM(
      `<div data-test-id="virtualParentRef"><div data-test-id="primary-message-agent"><div data-test-id="primary-message-content"></div><div data-test-id="file-attachment-wrapper"><img data-test-id="inline-image" src="x.png"></div></div></div>`,
    );
    const container = dom.window.document.querySelector(SELETORES.container_mensagens)!;
    expect(extrairConversa(container, SELETORES_COM_ANEXO)).toEqual([
      { autor: "atendente", texto: "[Imagem enviada — conteúdo não lido pelo copiloto]", hora: null },
    ]);
  });

  it("com seletor de anexo configurado, mensagem só com arquivo (não-imagem) usa o marcador genérico", () => {
    const dom = new JSDOM(
      `<div data-test-id="virtualParentRef"><div data-test-id="primary-message-agent"><div data-test-id="primary-message-content"></div><div data-test-id="file-attachment-wrapper"><a href="x.pdf">arquivo.pdf</a></div></div></div>`,
    );
    const container = dom.window.document.querySelector(SELETORES.container_mensagens)!;
    expect(extrairConversa(container, SELETORES_COM_ANEXO)).toEqual([
      { autor: "atendente", texto: "[Arquivo enviado — conteúdo não lido pelo copiloto]", hora: null },
    ]);
  });

  it("mensagem com texto E anexo prioriza o texto real (não sobrescreve)", () => {
    const dom = new JSDOM(
      `<div data-test-id="virtualParentRef"><div data-test-id="primary-message-agent"><div data-test-id="primary-message-content">Segue o print</div><div data-test-id="file-attachment-wrapper"><img data-test-id="inline-image" src="x.png"></div></div></div>`,
    );
    const container = dom.window.document.querySelector(SELETORES.container_mensagens)!;
    expect(extrairConversa(container, SELETORES_COM_ANEXO)).toEqual([
      { autor: "atendente", texto: "Segue o print", hora: null },
    ]);
  });
});

describe("extrairEmpresaAssociada", () => {
  it("retorna null sem seletor calibrado (ainda não temos o HTML real do painel de contato)", () => {
    const dom = new JSDOM(`<div><span class="empresa">Binário.Net</span></div>`);
    expect(extrairEmpresaAssociada(dom.window.document, undefined)).toBeNull();
  });

  it("extrai o texto do elemento quando o seletor está calibrado", () => {
    const dom = new JSDOM(`<div><span data-test-id="empresa-associada"> Binário.Net </span></div>`);
    expect(extrairEmpresaAssociada(dom.window.document, '[data-test-id="empresa-associada"]')).toBe("Binário.Net");
  });

  it("retorna null se o elemento existe mas está vazio", () => {
    const dom = new JSDOM(`<div><span data-test-id="empresa-associada"></span></div>`);
    expect(extrairEmpresaAssociada(dom.window.document, '[data-test-id="empresa-associada"]')).toBeNull();
  });

  it("retorna null se o elemento não existe no DOM (contato sem empresa associada)", () => {
    const dom = new JSDOM(`<div></div>`);
    expect(extrairEmpresaAssociada(dom.window.document, '[data-test-id="empresa-associada"]')).toBeNull();
  });
});

describe("extrairThreadId", () => {
  it("extrai o id numérico da URL real do HubSpot", () => {
    expect(extrairThreadId("https://app.hubspot.com/live-messages/12345/inbox/998877")).toBe(
      "998877",
    );
  });

  it("ignora o hash de canal (#whatsapp) que a URL real inclui", () => {
    expect(
      extrairThreadId("https://app.hubspot.com/live-messages/6010218/inbox/11173394035#whatsapp"),
    ).toBe("11173394035");
  });

  it("retorna null fora de uma conversa do inbox", () => {
    expect(extrairThreadId("https://app.hubspot.com/contacts/12345/objects/0-1/views/all/list")).toBe(
      null,
    );
  });
});
