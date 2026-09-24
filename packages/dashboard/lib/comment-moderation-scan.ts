export interface CommentModerationScanProgress {
  key: string;
  cursor: string;
}

export function moderationScanRequest(
  connectionId: string,
  postId: string,
  progress: CommentModerationScanProgress | null,
): { key: string; body: { connectionId: string; postId: string; cursor?: string } } {
  const normalizedPostId = postId.trim();
  const key = `${connectionId}\u001f${normalizedPostId}`;
  const cursor = progress?.key === key ? progress.cursor : undefined;
  return {
    key,
    body: { connectionId, postId: normalizedPostId, ...(cursor ? { cursor } : {}) },
  };
}

export function nextModerationScanProgress(key: string, nextCursor: unknown): CommentModerationScanProgress | null {
  return typeof nextCursor === 'string' && nextCursor.length > 0 ? { key, cursor: nextCursor } : null;
}
