// Cliente mínimo da API do HubSpot (CRM + Conversations), pra resolver
// nome/cargo/estado/empresa de verdade a partir do threadId — em vez de
// tentar ler isso da tela (achado real, 2026-09-15: o texto do cabeçalho da
// conversa às vezes reflete o campo de texto livre "Nome da empresa" do
// Contato, não a Empresa de fato associada via CRM; e o nome do contato
// vinha concatenado com "{Cargo} @ {Empresa}" quando esses campos existiam).
export interface ContextoLead {
  nome: string | null;
  cargo: string | null;
  estado: string | null;
  /** Nome da Empresa associada de verdade (associação de CRM), não o campo de texto livre do contato. */
  empresa: string | null;
}

interface HubspotContact {
  properties: {
    firstname?: string | null;
    lastname?: string | null;
    jobtitle?: string | null;
    state?: string | null;
    phone?: string | null;
    mobilephone?: string | null;
  };
  associations?: {
    companies?: { results: Array<{ id: string; type: string }> };
  };
}

// DDD → UF (plano de numeração da Anatel, dado público e estável — não é
// informação institucional da Infnet, então não precisa de confirmação ao
// vivo como o resto do projeto exige para fatos de negócio).
const UF_POR_DDD: Record<string, string> = {
  "11": "SP", "12": "SP", "13": "SP", "14": "SP", "15": "SP", "16": "SP", "17": "SP", "18": "SP", "19": "SP",
  "21": "RJ", "22": "RJ", "24": "RJ",
  "27": "ES", "28": "ES",
  "31": "MG", "32": "MG", "33": "MG", "34": "MG", "35": "MG", "37": "MG", "38": "MG",
  "41": "PR", "42": "PR", "43": "PR", "44": "PR", "45": "PR", "46": "PR",
  "47": "SC", "48": "SC", "49": "SC",
  "51": "RS", "53": "RS", "54": "RS", "55": "RS",
  "61": "DF", "62": "GO", "64": "GO",
  "63": "TO",
  "65": "MT", "66": "MT",
  "67": "MS",
  "68": "AC",
  "69": "RO",
  "71": "BA", "73": "BA", "74": "BA", "75": "BA", "77": "BA",
  "79": "SE",
  "81": "PE", "87": "PE",
  "82": "AL",
  "83": "PB",
  "84": "RN",
  "85": "CE", "88": "CE",
  "86": "PI", "89": "PI",
  "91": "PA", "93": "PA", "94": "PA",
  "92": "AM", "97": "AM",
  "95": "RR",
  "96": "AP",
  "98": "MA", "99": "MA",
};

/**
 * DDD do telefone é um indicativo forte de onde o lead mora, mas não
 * definitivo (número antigo, portado, celular comprado em outro estado) —
 * por isso só é usado como fallback quando o CRM não tem o campo `state`
 * preenchido, nunca sobrepõe um valor já confirmado.
 */
function inferirEstadoPorTelefone(...numeros: Array<string | null | undefined>): string | null {
  for (const numero of numeros) {
    if (!numero) continue;
    // Pega só o primeiro número quando o campo vem com vários separados por "|".
    const digitos = numero.split("|")[0].replace(/\D/g, "");
    // Com código do país (55 + DDD + número, 12-13 dígitos) ou sem (DDD +
    // número, 10-11 dígitos) — nunca adivinha o DDD quando o tamanho não bate.
    let ddd: string | null = null;
    if (digitos.length >= 12 && digitos.startsWith("55")) {
      ddd = digitos.slice(2, 4);
    } else if (digitos.length === 10 || digitos.length === 11) {
      ddd = digitos.slice(0, 2);
    }
    if (ddd && UF_POR_DDD[ddd]) return UF_POR_DDD[ddd];
  }
  return null;
}

export async function buscarContextoLead(threadId: string): Promise<ContextoLead | null> {
  const token = Deno.env.get("HUBSPOT_API_KEY");
  if (!token) {
    throw new Error("HUBSPOT_API_KEY não configurada (Secret da Edge Function).");
  }
  const headers = { Authorization: `Bearer ${token}` };

  const threadRes = await fetch(`https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}`, {
    headers,
  });
  if (!threadRes.ok) return null;
  const thread = await threadRes.json();
  const contactId = thread.associatedContactId as string | undefined;
  if (!contactId) return null;

  const contactRes = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,jobtitle,state,phone,mobilephone&associations=companies`,
    { headers },
  );
  if (!contactRes.ok) return null;
  const contact = (await contactRes.json()) as HubspotContact;

  const nome = [contact.properties.firstname, contact.properties.lastname].filter(Boolean).join(" ") || null;
  const cargo = contact.properties.jobtitle || null;
  // O campo `state` do CRM é a fonte oficial quando preenchido (pode ter sido
  // setado por automação/chatbot) — o DDD do telefone só entra como
  // fallback determinístico quando ninguém preencheu esse campo ainda.
  const estado = contact.properties.state || inferirEstadoPorTelefone(contact.properties.mobilephone, contact.properties.phone);

  let empresa: string | null = null;
  const companyResults = contact.associations?.companies?.results;
  if (companyResults && companyResults.length > 0) {
    // Prefere o tipo de associação "empresa_conveniada" (label específico
    // visto nesse portal) — senão, o primeiro resultado.
    const preferido = companyResults.find((c) => c.type === "empresa_conveniada") ?? companyResults[0];
    const companyRes = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${preferido.id}?properties=name`, {
      headers,
    });
    if (companyRes.ok) {
      const company = await companyRes.json();
      empresa = company.properties?.name ?? null;
    }
  }

  return { nome, cargo, estado, empresa };
}
