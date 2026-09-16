// Portal admin (Etapa 12, pedido do Raphael 2026-09-16): cadastro de
// conteúdo pro RAG (arquivo PDF/TXT/MD ou URL) e edição dos trechos de
// prompt seguros de expor — tudo restrito a admin (US6 do spec). Sem
// framework, DOM direto (mesmo estilo do side panel da extensão).
import { getSessao, iniciarLogin, logout, type SessaoUsuario } from "./lib/auth";
import {
  alternarFonteAtiva,
  criarFonteArquivo,
  criarFonteUrl,
  excluirFonte,
  listarFontes,
  listarPrompts,
  salvarPrompt,
  subirArquivoFontesPdf,
  type Fonte,
  type PromptEditavel,
} from "./lib/api";

const app = document.getElementById("app")!;

const RÓTULOS_PROMPT: Record<string, string> = {
  prompt_tom_geral: "Tom geral (fim do prompt do suggest e do ask)",
  prompt_suggest_abertura_resposta: "Suggest — abertura (respondendo o lead)",
  prompt_suggest_abertura_followup: "Suggest — abertura (follow-up)",
  prompt_suggest_fechamento_resposta: "Suggest — fechamento (respondendo o lead)",
  prompt_suggest_fechamento_followup: "Suggest — fechamento (follow-up)",
  prompt_ask_instrucoes: "Ask — instrução extra",
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  filhos: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const f of filhos) node.append(f);
  return node;
}

function renderLogin() {
  app.innerHTML = "";
  const btn = el("button", { textContent: "Entrar com Google", onclick: () => iniciarLogin() });
  app.append(el("div", { className: "login-box" }, [el("h1", { textContent: "Copiloto Infnet — Admin" }), btn]));
}

function renderAcessoNegado(sessao: SessaoUsuario, mensagem: string) {
  app.innerHTML = "";
  const btnSair = el("button", { textContent: "Sair", onclick: async () => { await logout(); location.reload(); } });
  app.append(
    el("div", { className: "acesso-negado" }, [
      el("h1", { textContent: "Copiloto Infnet — Admin" }),
      el("p", { textContent: `Logado como ${sessao.usuario.email}.` }),
      el("p", { className: "erro", textContent: mensagem }),
      btnSair,
    ]),
  );
}

// --- Aba Conteúdo -------------------------------------------------------

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

async function renderTabelaFontes(container: HTMLElement, sessao: SessaoUsuario) {
  container.innerHTML = "Carregando fontes…";
  let fontes: Fonte[];
  try {
    ({ fontes } = await listarFontes(sessao.access_token));
  } catch (err) {
    container.textContent = `Erro ao listar fontes: ${err instanceof Error ? err.message : err}`;
    return;
  }

  container.innerHTML = "";
  const tabela = el("table", { className: "tabela-fontes" });
  tabela.append(
    el("thead", {}, [
      el("tr", {}, [
        el("th", { textContent: "Nome" }),
        el("th", { textContent: "Tipo" }),
        el("th", { textContent: "Categoria" }),
        el("th", { textContent: "Status" }),
        el("th", { textContent: "Última sync" }),
        el("th", { textContent: "Ativa" }),
        el("th", { textContent: "Ações" }),
      ]),
    ]),
  );
  const corpo = el("tbody");
  for (const f of fontes) {
    const btnAlternar = el("button", {
      textContent: f.ativo ? "Desativar" : "Ativar",
      onclick: async () => {
        await alternarFonteAtiva(sessao.access_token, f.id, !f.ativo);
        renderTabelaFontes(container, sessao);
      },
    });
    const btnExcluir = el("button", {
      textContent: "Excluir",
      className: "btn-perigo",
      onclick: async () => {
        if (!confirm(`Excluir a fonte "${f.nome}" e todo o conteúdo indexado dela?`)) return;
        await excluirFonte(sessao.access_token, f.id);
        renderTabelaFontes(container, sessao);
      },
    });
    corpo.append(
      el("tr", {}, [
        el("td", { textContent: f.nome }),
        el("td", { textContent: f.tipo }),
        el("td", { textContent: f.categoria ?? "—" }),
        el("td", { className: `status status-${f.status}`, textContent: f.erro ? `${f.status}: ${f.erro}` : f.status }),
        el("td", { textContent: formatarData(f.ultima_sync) }),
        el("td", { textContent: f.ativo ? "sim" : "não" }),
        el("td", { className: "acoes" }, [btnAlternar, btnExcluir]),
      ]),
    );
  }
  tabela.append(corpo);
  container.append(tabela);
}

function renderFormNovaFonte(container: HTMLElement, sessao: SessaoUsuario, aoCriar: () => void) {
  container.innerHTML = "";

  const tipoArquivo = el("input", { type: "radio", name: "tipo-fonte", value: "arquivo", checked: true }) as HTMLInputElement;
  const tipoUrl = el("input", { type: "radio", name: "tipo-fonte", value: "url" }) as HTMLInputElement;
  const campoArquivo = el("input", { type: "file", accept: ".pdf,.txt,.md" }) as HTMLInputElement;
  const campoUrl = el("input", { type: "url", placeholder: "https://...", hidden: true }) as HTMLInputElement;
  const campoNome = el("input", { type: "text", placeholder: "Nome da fonte (ex.: Manual de Vendas 2026)" }) as HTMLInputElement;
  const campoCategoria = el("input", { type: "text", placeholder: "Categoria (opcional, ex.: manual_comercial)" }) as HTMLInputElement;
  const status = el("p", { className: "status-form" });
  const btnEnviar = el("button", { type: "submit", textContent: "Cadastrar e indexar agora" });

  tipoArquivo.onchange = () => {
    campoArquivo.hidden = false;
    campoUrl.hidden = true;
  };
  tipoUrl.onchange = () => {
    campoArquivo.hidden = true;
    campoUrl.hidden = false;
  };

  const form = el("form", { className: "form-nova-fonte" }, [
    el("div", { className: "campo-radio" }, [
      el("label", {}, [tipoArquivo, " Arquivo (PDF, TXT ou MD)"]),
      el("label", {}, [tipoUrl, " Página da web (URL)"]),
    ]),
    campoArquivo,
    campoUrl,
    campoNome,
    campoCategoria,
    btnEnviar,
    status,
  ]);

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    if (!campoNome.value.trim()) {
      status.textContent = "Informe um nome para a fonte.";
      return;
    }
    btnEnviar.disabled = true;
    status.textContent = "Enviando…";
    try {
      if (tipoArquivo.checked) {
        const file = campoArquivo.files?.[0];
        if (!file) throw new Error("Escolha um arquivo.");
        status.textContent = "Subindo arquivo…";
        const storagePath = await subirArquivoFontesPdf(sessao.access_token, file);
        status.textContent = "Indexando…";
        await criarFonteArquivo(sessao.access_token, {
          storagePath,
          nome: campoNome.value.trim(),
          categoria: campoCategoria.value.trim(),
        });
      } else {
        if (!campoUrl.value.trim()) throw new Error("Informe a URL.");
        status.textContent = "Indexando…";
        await criarFonteUrl(sessao.access_token, {
          ref: campoUrl.value.trim(),
          nome: campoNome.value.trim(),
          categoria: campoCategoria.value.trim(),
        });
      }
      status.textContent = "Pronto — fonte indexada.";
      form.reset();
      campoArquivo.hidden = false;
      campoUrl.hidden = true;
      aoCriar();
    } catch (err) {
      status.textContent = `Erro: ${err instanceof Error ? err.message : err}`;
    } finally {
      btnEnviar.disabled = false;
    }
  };

  container.append(form);
}

function renderAbaConteudo(sessao: SessaoUsuario): HTMLElement {
  const secao = el("section", { className: "aba-conteudo" });
  const tituloForm = el("h2", { textContent: "Nova fonte" });
  const formEl = el("div");
  const tituloTabela = el("h2", { textContent: "Fontes cadastradas" });
  const tabelaEl = el("div");

  renderFormNovaFonte(formEl, sessao, () => renderTabelaFontes(tabelaEl, sessao));
  renderTabelaFontes(tabelaEl, sessao);

  secao.append(tituloForm, formEl, tituloTabela, tabelaEl);
  return secao;
}

// --- Aba Prompts ---------------------------------------------------------

function renderAbaPrompts(sessao: SessaoUsuario): HTMLElement {
  const secao = el("section", { className: "aba-prompts" });
  const lista = el("div", { textContent: "Carregando prompts…" });
  secao.append(el("h2", { textContent: "Prompts editáveis" }), lista);

  listarPrompts(sessao.access_token)
    .then(({ prompts }) => {
      lista.innerHTML = "";
      for (const p of prompts) {
        lista.append(renderCampoPrompt(sessao, p));
      }
    })
    .catch((err) => {
      lista.textContent = `Erro ao carregar prompts: ${err instanceof Error ? err.message : err}`;
    });

  return secao;
}

function renderCampoPrompt(sessao: SessaoUsuario, prompt: PromptEditavel): HTMLElement {
  const textarea = el("textarea", { value: prompt.valor, rows: 4 }) as HTMLTextAreaElement;
  const status = el("span", { className: "status-form" });
  const btnSalvar = el("button", {
    textContent: "Salvar",
    onclick: async () => {
      btnSalvar.disabled = true;
      status.textContent = "Salvando…";
      try {
        await salvarPrompt(sessao.access_token, prompt.chave, textarea.value);
        status.textContent = "Salvo ✓";
        setTimeout(() => (status.textContent = ""), 2500);
      } catch (err) {
        status.textContent = `Erro: ${err instanceof Error ? err.message : err}`;
      } finally {
        btnSalvar.disabled = false;
      }
    },
  });

  return el("div", { className: "campo-prompt" }, [
    el("label", { textContent: RÓTULOS_PROMPT[prompt.chave] ?? prompt.chave }),
    prompt.descricao ? el("p", { className: "descricao-prompt", textContent: prompt.descricao }) : "",
    textarea,
    el("div", { className: "acoes-prompt" }, [btnSalvar, status]),
  ]);
}

// --- Layout principal ------------------------------------------------------

function renderApp(sessao: SessaoUsuario) {
  app.innerHTML = "";

  const header = el("header", {}, [
    el("h1", { textContent: "Copiloto Infnet — Admin" }),
    el("div", { className: "auth-area" }, [
      el("span", { textContent: sessao.usuario.email }),
      el("button", { textContent: "Sair", onclick: async () => { await logout(); location.reload(); } }),
    ]),
  ]);

  const tabConteudoBtn = el("button", { textContent: "Conteúdo", className: "tab-btn tab-ativa" });
  const tabPromptsBtn = el("button", { textContent: "Prompts", className: "tab-btn" });
  const nav = el("nav", { className: "tabs" }, [tabConteudoBtn, tabPromptsBtn]);

  const conteudoSecao = renderAbaConteudo(sessao);
  const promptsSecao = renderAbaPrompts(sessao);
  promptsSecao.hidden = true;

  tabConteudoBtn.onclick = () => {
    conteudoSecao.hidden = false;
    promptsSecao.hidden = true;
    tabConteudoBtn.classList.add("tab-ativa");
    tabPromptsBtn.classList.remove("tab-ativa");
  };
  tabPromptsBtn.onclick = () => {
    conteudoSecao.hidden = true;
    promptsSecao.hidden = false;
    tabPromptsBtn.classList.add("tab-ativa");
    tabConteudoBtn.classList.remove("tab-ativa");
  };

  app.append(header, nav, conteudoSecao, promptsSecao);
}

(async () => {
  const sessao = await getSessao();
  if (!sessao) {
    renderLogin();
    return;
  }
  // Não há endpoint "quem sou eu" dedicado — a checagem de papel é a mesma
  // allowlist do backend (RF09): tenta listar fontes e usa o 403 do próprio
  // `fontes` pra decidir entre mostrar o portal ou "acesso restrito".
  try {
    await listarFontes(sessao.access_token);
  } catch (err) {
    renderAcessoNegado(sessao, err instanceof Error ? err.message : "Acesso restrito a admin.");
    return;
  }
  renderApp(sessao);
})();
