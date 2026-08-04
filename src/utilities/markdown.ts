export function extractCodeBlockMessage(raw: string): string {
  const cleaned = raw.trim();
  const withoutCodeBlocks = cleaned.replace(/```[a-z]*\n|```/g, '');
  const withoutQuotes = withoutCodeBlocks.replace(/^["'`]|["'`]$/g, '');
  return withoutQuotes.trim();
}
