// Autenticação Google via conta de serviço + domain-wide delegation.
// A conta de serviço "se passa por" (impersona) um usuário real do Workspace
// da Infnet (GOOGLE_IMPERSONATED_USER), autorizado no Admin Console em
// Segurança > Controle de dados e acesso > Delegação em todo o domínio.
// Ver docs/setup/02-planilhas-fonte.md para o histórico dessa decisão.
//
// Implementado com Web Crypto (RS256), sem depender de google-auth-library.

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

let cachedToken: { token: string; expiresAt: number; scopeKey: string } | null = null;

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function loadServiceAccount(): ServiceAccountKey {
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY não configurada (Secret da Edge Function). " +
        "Cole o conteúdo do JSON baixado no Cloud Console.",
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY não é um JSON válido.");
  }
}

/**
 * Retorna um access_token OAuth2 para os escopos pedidos, impersonando
 * GOOGLE_IMPERSONATED_USER. Cacheado em memória do processo (Edge Functions
 * podem reaproveitar a instância entre invocações próximas).
 */
export async function getGoogleAccessToken(scopes: string[]): Promise<string> {
  const scopeKey = scopes.slice().sort().join(" ");
  const now = Math.floor(Date.now() / 1000);

  if (cachedToken && cachedToken.scopeKey === scopeKey && cachedToken.expiresAt - 60 > now) {
    return cachedToken.token;
  }

  const serviceAccount = loadServiceAccount();
  // .trim() por segurança: um espaço/tab colado ao copiar o valor do Secret
  // já foi visto causar "Invalid impersonation sub field" no Google.
  const impersonatedUser = Deno.env.get("GOOGLE_IMPERSONATED_USER")?.trim();
  if (!impersonatedUser) {
    throw new Error("GOOGLE_IMPERSONATED_USER não configurada (Secret da Edge Function).");
  }

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    scope: scopeKey,
    aud: "https://oauth2.googleapis.com/token",
    sub: impersonatedUser,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const key = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Falha ao obter token Google (${response.status}): ${body}`);
  }

  const data = await response.json();
  cachedToken = { token: data.access_token, expiresAt: now + data.expires_in, scopeKey };
  return data.access_token;
}

export const SCOPE_SHEETS_READONLY = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const SCOPE_DRIVE_READONLY = "https://www.googleapis.com/auth/drive.readonly";
