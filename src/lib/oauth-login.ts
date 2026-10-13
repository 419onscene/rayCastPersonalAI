import { createServer, type Server } from "http";
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";
import { createOAuthState, createPkce } from "./oauth-pkce";
import {
  accessTokenFromCredential,
  authorizeUrl,
  credentialDocument,
  credentialPath,
  oauthProvider,
  type OAuthProviderId,
  type OAuthTokens,
} from "./oauth-providers";

export interface OAuthLoginResult extends OAuthTokens {
  provider: OAuthProviderId;
  credentialPath: string;
}

export async function runOAuthLogin(input: {
  provider: OAuthProviderId;
  home: string;
  signal?: AbortSignal;
  openUrl: (url: string) => Promise<void>;
}): Promise<OAuthLoginResult> {
  const provider = oauthProvider(input.provider);
  const pkce = createPkce();
  const state = createOAuthState();
  const nonce = createOAuthState();
  const url = authorizeUrl({ provider, challenge: pkce.challenge, state, nonce });
  const code = await waitForCallback({
    host: provider.bindHost,
    port: provider.port,
    path: provider.callbackPath,
    state,
    signal: input.signal,
    onListening: () => input.openUrl(url),
  });
  const tokens = await exchangeCode({
    providerId: input.provider,
    code,
    verifier: pkce.verifier,
    signal: input.signal,
  });
  const path = writeCredential(input.provider, input.home, tokens);
  return { provider: input.provider, credentialPath: path, ...tokens };
}

export function writeCredential(
  provider: OAuthProviderId,
  home: string,
  tokens: OAuthTokens,
  now = new Date(),
): string {
  const path = credentialPath(provider, home);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(credentialDocument(provider, tokens, now), null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export function readStoredAccessToken(provider: OAuthProviderId, home: string): string | undefined {
  try {
    return accessTokenFromCredential(provider, readFileSync(credentialPath(provider, home), "utf8"));
  } catch {
    return undefined;
  }
}

export function removeCredential(provider: OAuthProviderId, home: string): void {
  try {
    unlinkSync(credentialPath(provider, home));
  } catch {
    // Already gone.
  }
}

async function waitForCallback(input: {
  host: string;
  port: number;
  path: string;
  state: string;
  signal?: AbortSignal;
  onListening: () => Promise<void>;
}): Promise<string> {
  const server = createServer();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, code?: string) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        server.close();
        if (error) reject(error);
        else if (code) resolve(code);
      };
      const fail = (error: Error) => finish(error);
      timeout = setTimeout(
        () => {
          fail(new Error("Sign-in timed out. Finish the browser window, then try again."));
        },
        5 * 60 * 1000,
      );
      input.signal?.addEventListener("abort", () => fail(new Error("Sign-in cancelled.")), { once: true });
      server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          fail(new Error(`Port ${input.port} is already in use. Finish the other sign-in window, then try again.`));
          return;
        }
        fail(error);
      });
      server.on("request", (request, response) => {
        const requestUrl = new URL(request.url ?? "/", `http://${input.host}:${input.port}`);
        if (requestUrl.pathname !== input.path) {
          response.writeHead(404, { "Content-Type": "text/plain" });
          response.end("Not found");
          return;
        }
        const oauthError = requestUrl.searchParams.get("error");
        if (oauthError) {
          const description = requestUrl.searchParams.get("error_description") ?? "";
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end(page("Sign-in stopped", "Return to Raycast."));
          fail(new Error(`${oauthError} ${description}`.trim()));
          return;
        }
        const code = requestUrl.searchParams.get("code");
        const returnedState = requestUrl.searchParams.get("state");
        if (!code || returnedState !== input.state) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end(page("Sign-in stopped", "The browser returned an incomplete OAuth response."));
          fail(new Error("The browser returned an incomplete OAuth response."));
          return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(page("Signed in", "Return to Raycast. The credential is saved."));
        finish(undefined, code);
      });
      server.listen(input.port, input.host, () => {
        void input.onListening().catch((error: unknown) => {
          fail(error instanceof Error ? error : new Error("Couldn't open the browser."));
        });
      });
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    await closeServer(server);
  }
}

async function exchangeCode(input: {
  providerId: OAuthProviderId;
  code: string;
  verifier: string;
  signal?: AbortSignal;
}): Promise<OAuthTokens> {
  const provider = oauthProvider(input.providerId);
  const body = {
    grant_type: "authorization_code",
    client_id: provider.clientId,
    code: input.code,
    redirect_uri: provider.redirectUri,
    code_verifier: input.verifier,
  };
  const response = await fetch(provider.tokenEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": provider.tokenContentType === "json" ? "application/json" : "application/x-www-form-urlencoded",
    },
    body: provider.tokenContentType === "json" ? JSON.stringify(body) : new URLSearchParams(body),
    signal: input.signal,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`OAuth token exchange failed (${response.status}). ${clip(text)}`);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("OAuth token exchange returned an unreadable response.");
  }
  const accessToken = parsed.access_token;
  if (typeof accessToken !== "string" || !accessToken)
    throw new Error("OAuth token exchange did not return an access token.");
  return {
    accessToken,
    refreshToken: typeof parsed.refresh_token === "string" ? parsed.refresh_token : undefined,
    idToken: typeof parsed.id_token === "string" ? parsed.id_token : undefined,
    expiresIn: typeof parsed.expires_in === "number" ? parsed.expires_in : undefined,
    scope: typeof parsed.scope === "string" ? parsed.scope : undefined,
  };
}

function page(title: string, message: string): string {
  return `<!doctype html><html><body style="font-family:system-ui;padding:48px"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}

function clip(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 300 ? `${compact.slice(0, 300)}…` : compact;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}
