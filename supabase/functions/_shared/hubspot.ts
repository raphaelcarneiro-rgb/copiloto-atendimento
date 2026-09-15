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
  };
  associations?: {
    companies?: { results: Array<{ id: string; type: string }> };
  };
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
    `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,jobtitle,state&associations=companies`,
    { headers },
  );
  if (!contactRes.ok) return null;
  const contact = (await contactRes.json()) as HubspotContact;

  const nome = [contact.properties.firstname, contact.properties.lastname].filter(Boolean).join(" ") || null;
  const cargo = contact.properties.jobtitle || null;
  const estado = contact.properties.state || null;

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
