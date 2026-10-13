import { createHash, randomBytes } from "crypto";

export function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createOAuthState(): string {
  return base64Url(randomBytes(16));
}

export function encodeQuery(params: [string, string][]): string {
  return params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}
