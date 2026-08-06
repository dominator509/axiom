// ─── Deterministic feature embedding (L3.5 §1.4) ───
// Builds a real vector(768) from the exemplar feature record so the HNSW
// index can do k-NN retrieval. Uses a seeded hashing scheme over the JSON
// feature string — deterministic, tenant-safe, and dependency-free
// (a sentence-transformer can later replace the hash, same contract).

const DIM = 768;

/** Stable 32-bit hash from a string (FNV-1a). */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Embed a feature record into a normalized 768-dim vector.
 * Sign-hash each feature key/value into sparse dimensions (feature hashing),
 * then L2-normalize so cosine distance in pgvector is well-defined.
 */
export function embedFeatures(features: Record<string, unknown>): number[] {
  const vec = new Array<number>(DIM).fill(0);

  const visit = (prefix: string, value: unknown): void => {
    if (value === null || value === undefined) return;
    if (typeof value === 'object') {
      const entries = Array.isArray(value)
        ? value.map((v, i) => [`${prefix}[${i}]`, v])
        : Object.entries(value as Record<string, unknown>).map(([k, v]) => [`${prefix}.${k}`, v]);
      for (const [k, v] of entries) visit(k, v);
      return;
    }
    const h = fnv1a(`${prefix}:${String(value)}`);
    const idx = h % DIM;
    // Sign from the high bit — both positive and negative dimensions.
    vec[idx] += (h & 0x80000000) === 0 ? 1 : -1;
  };

  for (const [key, value] of Object.entries(features)) visit(key, value);

  // L2 normalize.
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return new Array<number>(DIM).fill(0);
  return vec.map((v) => v / norm);
}
