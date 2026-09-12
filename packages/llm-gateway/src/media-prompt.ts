export interface CharacterLockSnapshot {
  characterLockPrompt: string;
  characterLockVersion: number;
}

/** Jobs without either field predate character locks; never read today's profile. */
export function characterLockSnapshot(value: { characterLockPrompt?: unknown; characterLockVersion?: unknown }): CharacterLockSnapshot {
  if (value.characterLockPrompt === undefined && value.characterLockVersion === undefined)
    return { characterLockPrompt: '', characterLockVersion: 0 };
  if (typeof value.characterLockPrompt !== 'string' || value.characterLockPrompt.length > 2000
    || typeof value.characterLockVersion !== 'number' || !Number.isSafeInteger(value.characterLockVersion)
    || value.characterLockVersion < 0 || value.characterLockVersion > 2147483647)
    throw new Error('Invalid character lock snapshot');
  return { characterLockPrompt: value.characterLockPrompt, characterLockVersion: value.characterLockVersion };
}

/** Preserve every character. Over-limit requests fail instead of truncating identity. */
export function buildMediaPrompt(scene: string, snapshot: CharacterLockSnapshot): string {
  if (typeof scene !== 'string' || !scene.trim()) throw new Error('Scene prompt is required');
  const lock = characterLockSnapshot(snapshot);
  const prompt = lock.characterLockPrompt
    ? `CHARACTER / PERSONA — preserve this identity:\n${lock.characterLockPrompt}\n\nSCENE:\n${scene}` : scene;
  if (prompt.length > 4000) throw new Error('Character lock and scene exceed the 4000-character media prompt limit');
  return prompt;
}
