/** Exact changed span, retaining common Unicode code-point prefix and suffix.
 * Multiple scattered edits are grouped; this is not a semantic minimality claim.
 */
export function promptDiff(previous: string, proposed: string) {
  const before = Array.from(previous), after = Array.from(proposed);
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length, endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--; endAfter--;
  }
  return { prefix: before.slice(0, start).join(''), removed: before.slice(start, endBefore).join(''),
    added: after.slice(start, endAfter).join(''), suffix: before.slice(endBefore).join('') };
}
