import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { inserirNoComposer } from "./composer";

describe("inserirNoComposer", () => {
  it("degrada com 'composer-nao-calibrado' quando o seletor não está configurado", () => {
    const dom = new JSDOM(`<div></div>`);
    // @ts-expect-error só para este teste isolado
    globalThis.document = dom.window.document;
    expect(inserirNoComposer("oi", {})).toEqual({ ok: false, motivo: "composer-nao-calibrado" });
  });

  it("degrada com 'composer-nao-encontrado' quando o elemento não existe na página", () => {
    const dom = new JSDOM(`<div></div>`);
    // @ts-expect-error só para este teste isolado
    globalThis.document = dom.window.document;
    expect(inserirNoComposer("oi", { composer_texto: '[data-test-id="rte-content"]' })).toEqual({
      ok: false,
      motivo: "composer-nao-encontrado",
    });
  });

  it("retorna ok quando o elemento existe", () => {
    const dom = new JSDOM(`<div data-test-id="rte-content" contenteditable="true"></div>`);
    // @ts-expect-error só para este teste isolado
    globalThis.document = dom.window.document;
    dom.window.document.execCommand = () => true;
    expect(inserirNoComposer("oi", { composer_texto: '[data-test-id="rte-content"]' })).toEqual({
      ok: true,
    });
  });
});
