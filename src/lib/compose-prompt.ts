export function composePrompt(templateBody: string | undefined, typed: string): string {
  const template = templateBody?.trim() ?? "";
  const extra = typed.trim();
  if (template && extra) return `${template}\n\n${extra}`;
  return template || extra;
}
