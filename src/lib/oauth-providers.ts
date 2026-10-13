import { encodeQuery } from "./oauth-pkce";

export type OAuthProviderId = "anthropic" | "openai" | "xai";

export interface OAuthProvider {
  id: OAuthProviderId;
  title: string;
  clientId: string;
  authorizeEndpoint: string;
  tokenEndpoint: string;
  tokenContentType: "json" | "form";
  bindHost: string;
  redirectUri: string;
  callbackPath: string;
  port: number;
  scope: string;
}

export const OAUTH_PROVIDERS: OAuthProvider[] = [
  {
    id: "anthropic",
    title: "Claude",
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    authorizeEndpoint: "https://claude.ai/oauth/authorize",
    tokenEndpoint: "https://console.anthropic.com/v1/oauth/token",
    tokenContentType: "json",
    bindHost: "127.0.0.1",
    redirectUri: "http://localhost:54545/callback",
    callbackPath: "/callback",
    port: 54545,
    scope: "user:profile user:inference user:sessions:claude_code",
  },
  {
    id: "openai",
    title: "ChatGPT",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    authorizeEndpoint: "https://auth.openai.com/oauth/authorize",
    tokenEndpoint: "https://auth.openai.com/oauth/token",
    tokenContentType: "json",
    bindHost: "127.0.0.1",
    redirectUri: "http://localhost:1455/auth/callback",
    callbackPath: "/auth/callback",
    port: 1455,
    scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
  },
  {
    id: "xai",
    title: "Grok",
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
    authorizeEndpoint: "https://auth.x.ai/oauth2/authorize",
    tokenEndpoint: "https://auth.x.ai/oauth2/token",
    tokenContentType: "form",
    bindHost: "127.0.0.1",
    redirectUri: "http://127.0.0.1:56121/callback",
    callbackPath: "/callback",
    port: 56121,
    scope: "openid profile email offline_access grok-cli:access api:access",
  },
];

export function oauthProvider(id: OAuthProviderId): OAuthProvider {
  const found = OAUTH_PROVIDERS.find((provider) => provider.id === id);
  if (!found) throw new Error(`No OAuth provider ${id}`);
  return found;
}

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return OAUTH_PROVIDERS.some((provider) => provider.id === value);
}

export function authorizeUrl(input: {
  provider: OAuthProvider;
  challenge: string;
  state: string;
  nonce: string;
}): string {
  const { provider } = input;
  const shared: [string, string][] = [
    ["response_type", "code"],
    ["client_id", provider.clientId],
    ["redirect_uri", provider.redirectUri],
    ["scope", provider.scope],
    ["code_challenge", input.challenge],
    ["code_challenge_method", "S256"],
  ];
  const extra: [string, string][] =
    provider.id === "openai"
      ? [
          ["id_token_add_organizations", "true"],
          ["codex_cli_simplified_flow", "true"],
          ["state", input.state],
          ["originator", "codex_cli_rs"],
        ]
      : provider.id === "xai"
        ? [
            ["state", input.state],
            ["nonce", input.nonce],
            ["plan", "generic"],
            ["referrer", "personal-ai"],
          ]
        : [["state", input.state]];
  return `${provider.authorizeEndpoint}?${encodeQuery([...shared, ...extra])}`;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn?: number;
  scope?: string;
}

export function credentialPath(provider: OAuthProviderId, home: string): string {
  if (provider === "anthropic") return `${home}/.claude/.credentials.json`;
  if (provider === "openai") return `${home}/.codex/auth.json`;
  return `${home}/.grok/auth.json`;
}

export function credentialDocument(provider: OAuthProviderId, tokens: OAuthTokens, now = new Date()): unknown {
  if (provider === "anthropic") {
    const scopes = (tokens.scope ?? oauthProvider(provider).scope).split(/\s+/).filter(Boolean);
    return {
      claudeAiOauth: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? "",
        expiresAt: now.getTime() + (tokens.expiresIn ?? 3600) * 1000,
        scopes,
      },
    };
  }
  if (provider === "openai") {
    const accountId = accountIdFromIdToken(tokens.idToken);
    return {
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken ?? "",
        id_token: tokens.idToken ?? "",
        ...(accountId ? { account_id: accountId } : {}),
      },
      last_refresh: now.toISOString(),
    };
  }
  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken ?? "",
    expires_in: tokens.expiresIn ?? 3600,
    token_type: "Bearer",
    "https://accounts.x.ai/sign-in": { key: tokens.accessToken },
  };
}

export function accessTokenFromCredential(provider: OAuthProviderId, raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (provider === "anthropic") {
      const oauth = parsed.claudeAiOauth;
      if (!oauth || typeof oauth !== "object") return undefined;
      const token = (oauth as Record<string, unknown>).accessToken;
      return typeof token === "string" && token ? token : undefined;
    }
    if (provider === "openai") {
      const tokens = parsed.tokens;
      if (!tokens || typeof tokens !== "object") return undefined;
      const token = (tokens as Record<string, unknown>).access_token;
      return typeof token === "string" && token ? token : undefined;
    }
    const direct = parsed.access_token;
    if (typeof direct === "string" && direct) return direct;
    const session = parsed["https://accounts.x.ai/sign-in"];
    if (!session || typeof session !== "object") return undefined;
    const key = (session as Record<string, unknown>).key;
    return typeof key === "string" && key ? key : undefined;
  } catch {
    return undefined;
  }
}

export function accountIdFromIdToken(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined;
  const payload = idToken.split(".")[1];
  if (!payload) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = parsed["https://api.openai.com/auth"];
    if (!auth || typeof auth !== "object") return undefined;
    const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
    return typeof accountId === "string" && accountId ? accountId : undefined;
  } catch {
    return undefined;
  }
}
