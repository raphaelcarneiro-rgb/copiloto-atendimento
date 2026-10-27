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
  "MBA em Engenharia de Contexto e Agentes de IA: RAG, MCP e Multiagentes",
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

test("print 13: 'MBA Live em Engenharia de Cibersegurança' é o MBA, não a graduação", () => {
  const r = identificarCursosNaConversa(CATALOGO, [
    atend("O que despertou seu interesse no MBA Live em Engenharia de Cibersegurança?"),
    lead("Quero saber mais"),
  ]);
  assert.deepEqual(r.cursos, ["MBA em Engenharia de Cibersegurança"]);
});

test("print 13: lead dispensa o curso anterior ('não quero mais esse') e só o novo fica em jogo", () => {
  const r = identificarCursosNaConversa(CATALOGO, [
    lead("3 amigos ficaria quanto?"),
    lead("oi"),
    atend("O que despertou seu interesse no MBA Live em Engenharia de Cibersegurança?"),
    lead("não quero mais esse. Quero informações do novo mba de engenharia de contexto"),
    atend("Raphael, entendido. O *MBA em Engenharia de Contexto e Agentes de IA* prepara profissionais para construir sistemas de IA em produção. *O que você gostaria de conhecer primeiro: a estrutura do curso ou o investimento?*"),
    lead("estrutura do curso"),
    atend("Raphael, estas são as disciplinas do *MBA em Engenharia de Contexto e Agentes de IA*:\n• Context Engineering para Aplicações com IA\n*Quer conhecer os diferenciais e a metodologia da Infnet antes de falarmos sobre os valores?*"),
    lead("sim"),
  ]);
  assert.deepEqual(r.cursos, ["MBA em Engenharia de Contexto e Agentes de IA: RAG, MCP e Multiagentes"]);
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

test("grade da graduação (print 9): blocos, disciplinas com e sem ':', sobreposição e título diferente do projeto", async () => {
  const { extrairGradeGraduacao } = await import("./cursos.ts");
  // formato real da página de Engenharia de Inteligência Artificial (2 trechos que se sobrepõem)
  const trecho0 = [
    "ADMISSÃO E VALORES", "Matriz curricular", "Ciência da Computação",
    "Velocidade e Qualidade com Estruturas de Dados e Algoritmos:", "Avaliar a velocidade de algoritmos introdutórios usando a notação Big O",
    "Sistemas Operacionais com Linux e Python:", "Operar o sistema operacional Linux utilizando a linha de comando",
    "Estruturas de Dados e Algoritmos Avançados:", "Utilizar as estruturas de dados heaps e tries",
    "Programação Distribuída com Redes usando Linux e Python:", "Conectar em rede computadores com Linux",
    "Projeto de Bloco: Ciência da Computação:", "Analisar o desempenho de algoritmos de ordenação",
    "Machine Learning", // título do bloco na página != nome do projeto
    "Inteligência Artificial: Model Lifecycle", "Explicar os conceitos básicos de Machine Learning",
    "Dados para Machine Learning: Feature Engineering", "Manipular dados numéricos para algoritmos",
  ].join("\n\n");
  const trecho1 = [
    "Dados para Machine Learning: Feature Engineering", "Manipular dados numéricos para algoritmos",
    "Inteligência Artificial: Classificação", "Desenvolver modelos usando Árvores de Decisão",
    "Inteligência Artificial: Clusterização", "Desenvolver modelos usando K-Médias",
    "Projeto de Bloco: Inteligência Artificial e Machine Learning", "Desenvolver todas as etapas de um modelo simples",
    "ADMISSÃO E VALORES", "Duração:", "4 anos",
  ].join("\n\n");
  const blocos = extrairGradeGraduacao([trecho0, trecho1]);
  assert.deepEqual(blocos.map((b) => b.bloco), ["Ciência da Computação", "Inteligência Artificial e Machine Learning"]);
  assert.deepEqual(blocos[1].disciplinas, [
    "Inteligência Artificial: Model Lifecycle",
    "Dados para Machine Learning: Feature Engineering",
    "Inteligência Artificial: Classificação",
    "Inteligência Artificial: Clusterização",
    "Projeto de Bloco: Inteligência Artificial e Machine Learning",
  ]);
  assert.equal(blocos[0].disciplinas.length, 5);
  assert.ok(!blocos.flatMap((b) => b.disciplinas).includes("Machine Learning"), "título do bloco não é disciplina");
});

test("grade da graduação: título grudado na competência e linha em caixa alta (Design de Animação)", async () => {
  const { extrairGradeGraduacao } = await import("./cursos.ts");
  const trecho = [
    "Disciplinas e competências", "Fundamentos da Indústria Criativa", "DISCIPLINAS REGULARES",
    "Design, Estética e Cultura Explicar como referências históricas, culturais e sociais influenciam soluções de design",
    "Aplicar princípios do design em composições gráficas",
    "Comunicação Audiovisual Explicar o conceito de comunicação e a teoria crítica da indústria cultural",
    "Elementos do Design Compreender os elementos do design que compõem a linguagem visual",
    "Princípios da Animação Analisar criticamente estilos, linguagens e contextos da animação",
    "Projeto de Bloco: Introdução à Indústria Criativa Identificar problemas reais relacionados às questões étnico-raciais",
    "Série em Animação 2D",
    "Técnicas de Animação 2D", "Animar personagens com os princípios da animação",
    "Compor cenas narrativas em animação 2D", // competência com verbo em "-por", não é disciplina
    "Projeto de Bloco: Série em Animação 2D",
  ].join("\n\n");
  const blocos = extrairGradeGraduacao([trecho]);
  assert.equal(blocos.length, 2);
  assert.deepEqual(blocos[1].disciplinas, ["Técnicas de Animação 2D", "Projeto de Bloco: Série em Animação 2D"]);
  assert.equal(blocos[0].bloco, "Introdução à Indústria Criativa");
  assert.deepEqual(blocos[0].disciplinas, [
    "Design, Estética e Cultura",
    "Comunicação Audiovisual",
    "Elementos do Design",
    "Princípios da Animação",
    "Projeto de Bloco: Introdução à Indústria Criativa",
  ]);
});

test("grade da graduação: página de MBA (bullets, sem Projeto de Bloco) não vira grade de graduação", async () => {
  const { extrairGradeGraduacao } = await import("./cursos.ts");
  assert.deepEqual(
    extrairGradeGraduacao(["Disciplinas e competências\n\nSQL Avançado\n\n• Otimizar a performance\n\nDbt\n\n• Construir pipelines\n\nSpark\n\n• Processar dados"]),
    [],
  );
});

test("print 13: empresa atual citada pelo lead ('agora sou funcionário da empresa Certsys')", async () => {
  const { extrairEmpresaCitadaPeloLead } = await import("./cursos.ts");
  assert.equal(
    extrairEmpresaCitadaPeloLead([atend("Você é funcionário da empresa Qintess?"), lead("não agora sou funcionario da empresa Certsys")]),
    "Certsys",
  );
  assert.equal(extrairEmpresaCitadaPeloLead([lead("Trabalho na Theos que é conveniada. Qual desconto?")]), "Theos");
  assert.equal(extrairEmpresaCitadaPeloLead([lead("trabalho em uma empresa pequena")]), null);
  assert.equal(extrairEmpresaCitadaPeloLead([lead("quero saber os valores")]), null);
  // a pergunta do atendente ("empresa Qintess") não conta — só o que o lead diz
  assert.equal(extrairEmpresaCitadaPeloLead([atend("Você é funcionário da empresa Qintess?"), lead("sim")]), null);
});
