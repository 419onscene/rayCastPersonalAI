const ACCOUNT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function detectedAccountName(home: string): string {
  return home.split("/").filter(Boolean).pop() ?? "";
}

export function accountHome(name: string): string | undefined {
  const user = name.trim();
  if (!ACCOUNT_NAME.test(user) || user.includes("..")) return undefined;
  return `/Users/${user}`;
}
