/**
 * Embed a feature record into a normalized 768-dim vector.
 * Sign-hash each feature key/value into sparse dimensions (feature hashing),
 * then L2-normalize so cosine distance in pgvector is well-defined.
 */
export declare function embedFeatures(features: Record<string, unknown>): number[];
//# sourceMappingURL=embedding.d.ts.map