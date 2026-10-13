import { OAuth } from "@raycast/api";
import { type SubscriptionProviderId } from "./lib/subscription-login";

const clients: Record<SubscriptionProviderId, OAuth.PKCEClient> = {
  anthropic: new OAuth.PKCEClient({
    redirectMethod: OAuth.RedirectMethod.Web,
    providerName: "Claude",
    providerId: "anthropic",
    description: "Claude subscription signed in from Add AI. This settings page shows the account.",
  }),
  openai: new OAuth.PKCEClient({
    redirectMethod: OAuth.RedirectMethod.Web,
    providerName: "ChatGPT",
    providerId: "openai",
    description: "ChatGPT subscription signed in from Add AI. This settings page shows the account.",
  }),
  xai: new OAuth.PKCEClient({
    redirectMethod: OAuth.RedirectMethod.Web,
    providerName: "Grok",
    providerId: "xai",
    description: "Grok subscription signed in from Add AI. This settings page shows the account.",
  }),
};

export function oauthClient(provider: SubscriptionProviderId): OAuth.PKCEClient {
  return clients[provider];
}

export async function showSubscriptionAccount(provider: SubscriptionProviderId): Promise<void> {
  await oauthClient(provider).setTokens({ accessToken: "subscription-login" });
}
