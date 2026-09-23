/** Match only normalized, operator-authored literal terms; never return the comment text. */
export function matchingModerationKeywords(text: string, keywords: string[]): string[] {
  const tokens = text.normalize('NFKC').toLocaleLowerCase('und').match(/[\p{L}\p{N}\p{M}_]+/gu) ?? [];
  const matched = new Set<string>();
  for (const original of keywords) {
    const keyword = original.normalize('NFKC').trim().toLocaleLowerCase('und');
    const phrase = keyword.match(/[\p{L}\p{N}\p{M}_]+/gu) ?? [];
    if (phrase.length === 0) continue;
    for (let start = 0; start + phrase.length <= tokens.length; start += 1) {
      if (phrase.every((token, offset) => tokens[start + offset] === token)) {
        matched.add(keyword);
        break;
      }
    }
  }
  return [...matched];
}
