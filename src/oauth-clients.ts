import { OAuth } from "@raycast/api";
import { type OAuthProviderId } from "./lib/oauth-providers";

const clients: Record<OAuthProviderId, OAuth.PKCEClient> = {
  anthropic: new OAuth.PKCEClient({
    redirectMethod: OAuth.RedirectMethod.Web,
    providerName: "Claude",
    providerId: "anthropic",
    description: "Claude OAuth from Add AI. Raycast settings keeps this credential and can log it out.",
  }),
  openai: new OAuth.PKCEClient({
    redirectMethod: OAuth.RedirectMethod.Web,
    providerName: "ChatGPT",
    providerId: "openai",
    description: "ChatGPT OAuth from Add AI. Raycast settings keeps this credential and can log it out.",
  }),
  xai: new OAuth.PKCEClient({
    redirectMethod: OAuth.RedirectMethod.Web,
    providerName: "Grok",
    providerId: "xai",
    description: "Grok OAuth from Add AI. Raycast settings keeps this credential and can log it out.",
  }),
};

export function oauthClient(provider: OAuthProviderId): OAuth.PKCEClient {
  return clients[provider];
}
