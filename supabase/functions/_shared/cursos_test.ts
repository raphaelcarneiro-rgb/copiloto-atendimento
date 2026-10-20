// Testes da identificação de curso com os 37 nomes REAIS do catálogo e as
// conversas dos prints do Raphael (2026-10-08 e 2026-10-19).
// Rodam em Node (>= 22.6, strip-types) e em Deno:
//   node --test supabase/functions/_shared/cursos_test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extrairDisciplinasDePagina,
  identificarCursosNaConversa,
  validarCursosForcados,
  type MensagemCurso,
} from "./cursos.ts";

const CATALOGO = [
  "Faculdade EAD Live em Análise e Desenvolvimento de Sistemas: Agentes de IA",
  "Faculdade EAD Live em Análise e Desenvolvimento de Sistemas: Full Stack e Automação",
  "Faculdade EAD Live em Banco de Dados (Engenharia de Dados)",
  "Faculdade EAD Live em Ciência de Dados (e Inteligência Artificial)",
  "Faculdade EAD Live em Design Gráfico (Design Digital)",
  "Faculdade EAD Live em Design Gráfico de Animação",
  "Faculdade EAD Live em Engenharia de Cibersegurança",
  "Faculdade EAD Live em Engenharia de Cloud Computing",
  "Faculdade EAD Live em Engenharia de Dados com IA",
  "Faculdade EAD Live em Engenharia de Inteligência Artificial",
  "Faculdade EAD Live em Engenharia de Software",
  "Faculdade EAD Live em Jogos Digitais",
  "Faculdade EAD Live em Marketing (Digital)",
  "Faculdade EAD Live em Redes de Computadores (Cloud e Segurança)",
  "Faculdade EAD Live em Segurança da Informação",
  "Faculdade EAD Live em Tecnologia da Informação (Infra, Programação e Dados)",
  "MBA em  Gestão de TI, Governança e Estratégia",
  "MBA em Arquitetura de Software: Cloud, Dados e IA",
  "MBA em Data Science (Ciência de Dados) com IA",
  "MBA em Engenharia de Banco de Dados e Data Warehouse com IA",
  "MBA em Engenharia de Cibersegurança",
  "MBA em Engenharia de Cloud Computing",
  "MBA em Engenharia de Dados: Big Data e IA",
  "MBA em Engenharia de IA, Machine Learning e Deep Learning",
  "MBA em Engenharia de Produtos Digitais com IA: Gestão e Estratégia",
  "MBA em Engenharia de Redes de Computadores",
  "MBA em Engenharia de Software com .NET",
  "MBA em Engenharia de Software com Java",
  "MBA em Engenharia e Desenvolvimento Web Full Stack com IA",
  "MBA em Engenharia Front-end e Desenvolvimento Mobile com IA",
  "MBA em Gestão de Projetos e Processos: Scrum, BPM, PMBOK e Metodologias Ágeis",
  "MBA em Gestão de Riscos, Compliance e Segurança da Informação",
  "MBA em Gestão de Sistemas de Informação com SAP",
  "MBA em Inteligência Artificial e Automação de Processos",
  "MBA em Marketing Digital e Growth Marketing: Tráfego Pago, Redes Sociais e SEO",
  "MBA em UX Design, UI e Product Design com IA",
  "MFA em Design Gráfico e Digital com IA",
];

const lead = (texto: string): MensagemCurso => ({ autor: "lead", texto });
const atend = (texto: string): MensagemCurso => ({ autor: "atendente", texto });

test("print 11: MBA de Engenharia de Dados não empata com o de Banco de Dados e Data Warehouse", () => {
  const r = identificarCursosNaConversa(CATALOGO, [
    atend("Seu interesse seria no MBA em Engenharia de Dados: Big Data e IA, certo?"),
    lead("Isso"),
  ]);
  assert.deepEqual(r.cursos, ["MBA em Engenharia de Dados: Big Data e IA"]);
  assert.equal(r.confianca, "exata");
});

test("print 10: lista de disciplinas na mensagem do atendente não faz o MBA de Redes empatar com a graduação", () => {
  const r = identificarCursosNaConversa(CATALOGO, [
    lead("Quero saber sobre o MBA em redes"),
    atend(
      "Ossian, estas são as disciplinas do MBA em Engenharia de Redes de Computadores: Disciplinas:• CCNA - Fundamentos, Protocolos, Computação e Roteamento• CCNA - Administração• Infraestrutura e Fundamentos de Cloud• Administração do Azure• LPIC-1 - Fundamentos e Administração• Gerenciamento de Serviços de TI com ITIL• Segurança de RedesQuer que eu te envie os valores e as formas de pagamento?",
    ),
    lead("Sim."),
  ]);
  assert.deepEqual(r.cursos, ["MBA em Engenharia de Redes de Computadores"]);
});

test("print 8/Antonio: nome parafraseado pelo atendente (sem 'com IA') e lead só diz 'Sim'", () => {
  const r = identificarCursosNaConversa(CATALOGO, [
    lead("Me passa a lista de todas as Pós e os preços já com os descontos aplicados da Nexdom"),
    atend("Nós não temos uma tabela de preços compartilhável. Quer que eu te envie o investimento do MBA em Data Science (Ciência de Dados), agora?"),
    lead("Sim"),
  ]);
  assert.deepEqual(r.cursos, ["MBA em Data Science (Ciência de Dados) com IA"]);
});

test("print 8: 'esse MBA' sem nome na última mensagem usa o curso citado antes na conversa", () => {
  const r = identificarCursosNaConversa(CATALOGO, [
    lead("Tenho interesse no MBA em Engenharia de IA, Machine Learning e Deep Learning"),
    atend("Perfeito! A Faculdade Infnet é especializada em tecnologia."),
    lead("Já conheço"),
    atend("Diogo, posso te apresentar as condições de investimento e o benefício do convênio da Nexdom para esse MBA?"),
    lead("sim"),
  ]);
  assert.deepEqual(r.cursos, ["MBA em Engenharia de IA, Machine Learning e Deep Learning"]);
});

test("print 9: graduação + pós na mesma mensagem, lead pede a graduação antes", () => {
  const r = identificarCursosNaConversa(CATALOGO, [
    atend("Você se interessou pelo MBA em Engenharia de IA, Machine Learning e Deep Learning e pela graduação em Engenharia de Inteligência Artificial, certo?"),
    lead("Bom dia! Isso mesmo.."),
    atend("Moacir, veja as disciplinas do MBA em Engenharia de IA, Machine Learning e Deep Learning:Disciplinas:• Fundamentos de Machine Learning com Scikit-LearnQuer que eu te envie os valores e as formas de pagamento?"),
    lead("Se puder dá graduação antes..."),
    lead("Agradeço"),
  ]);
  assert.deepEqual(r.cursos, [
    "Faculdade EAD Live em Engenharia de Inteligência Artificial",
    "MBA em Engenharia de IA, Machine Learning e Deep Learning",
  ]);
});

test("sem pedido de ordem: segue a ordem em que o lead/atendente mencionou", () => {
  const r = identificarCursosNaConversa(CATALOGO, [
    atend("Você se interessou pelo MBA em Engenharia de IA, Machine Learning e Deep Learning e pela graduação em Engenharia de Inteligência Artificial, certo?"),
    lead("Isso mesmo"),
  ]);
  assert.deepEqual(r.cursos, [
    "MBA em Engenharia de IA, Machine Learning e Deep Learning",
    "Faculdade EAD Live em Engenharia de Inteligência Artificial",
  ]);
});

test("'MBA em Engenharia de Software' genérico é ambíguo (Java x .NET) — pergunta ao atendente", () => {
  const r = identificarCursosNaConversa(CATALOGO, [lead("Quero o MBA em Engenharia de Software")]);
  assert.equal(r.confianca, "ambigua");
  assert.ok(r.candidatos.includes("MBA em Engenharia de Software com Java"));
  assert.ok(r.candidatos.includes("MBA em Engenharia de Software com .NET"));
  assert.ok(!r.candidatos.includes("Faculdade EAD Live em Engenharia de Software"), "citou MBA: não é a graduação");
});

test("'graduação em Engenharia de Software' resolve para a graduação", () => {
  const r = identificarCursosNaConversa(CATALOGO, [lead("Quero a graduação em Engenharia de Software")]);
  assert.deepEqual(r.cursos, ["Faculdade EAD Live em Engenharia de Software"]);
});

test("palavras soltas: 'MBA em redes' escolhe o MBA de Redes (cobertura do nome), não o de Marketing", () => {
  const r = identificarCursosNaConversa(CATALOGO, [lead("Quero saber sobre o MBA em redes")]);
  assert.deepEqual(r.cursos, ["MBA em Engenharia de Redes de Computadores"]);
  assert.equal(r.confianca, "inferida");
});

test("assunto vago ('dados') não vira pergunta nem curso", () => {
  const r = identificarCursosNaConversa(CATALOGO, [lead("Trabalho com dados na minha empresa")]);
  assert.equal(r.cursos.length, 0);
  assert.notEqual(r.confianca, "exata");
});

test("conversa sem curso nenhum", () => {
  const r = identificarCursosNaConversa(CATALOGO, [lead("Boa tarde"), atend("Boa tarde! Seu interesse seria na graduação ou pós?")]);
  assert.equal(r.confianca, "nenhuma");
  assert.deepEqual(r.cursos, []);
});

test("mensagem que enumera 3+ cursos (cardápio) não decide nada", () => {
  const r = identificarCursosNaConversa(CATALOGO, [
    atend("Temos o MBA em Engenharia de Cloud Computing, o MBA em Engenharia de Cibersegurança e o MBA em Engenharia de Redes de Computadores."),
    lead("Quero saber mais"),
  ]);
  assert.deepEqual(r.cursos, []);
});

test("cursos escolhidos pelo atendente: só nomes que existem no catálogo, no máximo 2", () => {
  assert.deepEqual(validarCursosForcados(CATALOGO, ["MBA em Engenharia de Redes de Computadores", "Inventado", "MBA em Data Science (Ciência de Dados) com IA", "MBA em Engenharia de Cloud Computing"]), [
    "MBA em Engenharia de Redes de Computadores",
    "MBA em Data Science (Ciência de Dados) com IA",
  ]);
  assert.deepEqual(validarCursosForcados(CATALOGO, "nao-e-lista"), []);
});

test("grade: extrai as 8 disciplinas do MBA de Engenharia de Dados mesmo com trechos sobrepostos", () => {
  const trecho0 =
    "Pós-Graduação MBA\n\nDisciplinas e competências\n\nSQL Avançado para Engenharia de Dados\n\n• Otimizar a performance\n\n• Implementar lógicas analíticas\n\nTransformação e Qualidade de Dados com dbt\n\n• Construir pipelines de transformação\n\n• Implementar testes automatizados";
  const trecho1 =
    "Transformação e Qualidade de Dados com dbt\n\n• Construir pipelines de transformação\n\n• Implementar testes automatizados\n\n• Desenvolver documentação\n\nProcessamento de Big Data com Spark SQL\n\n• Realizar o processamento inicial\n\nImplementação de Data Lakehouse com Delta Lake\n\n• Arquitetar ambientes Lakehouse\n\nPipelines ETL com AWS Glue Studio\n\n• Implementar soluções de ingestão\n\nOrquestração de Pipelines de Dados com AWS Step Functions\n\n• Arquitetar soluções\n\nData Streaming e Processamento em Tempo Real com Kafka\n\n• Explicar a finalidade do Apache Kafka\n\n• Processar dados com Apache Kafka utilizando Python";
  const trecho2 =
    "• Processar dados com Apache Kafka utilizando Python\n\n• Implementar pipelines de streaming\n\nEngenharia de Dados para IA Generativa e Sistemas Agênticos\n\n• Estruturar plataformas de dados\n\nSobre o MBA\n\nDuração :\n\n1 ano\n\nPróxima turma:\n\n01/02/2027";
  const titulos = extrairDisciplinasDePagina([trecho0, trecho1, trecho2]);
  assert.equal(titulos.length, 8);
  assert.equal(titulos[0], "SQL Avançado para Engenharia de Dados");
  assert.equal(titulos[7], "Engenharia de Dados para IA Generativa e Sistemas Agênticos");
});

test("grade: página sem o formato esperado devolve vazio (cai no texto dos trechos)", () => {
  assert.deepEqual(extrairDisciplinasDePagina(["Matriz curricular\n\nFundamentos do Processamento de Dados\n\nIntrodução à Visualização de Dados e SQL:"]), []);
});
