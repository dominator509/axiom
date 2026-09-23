import { mutationFetch } from './mutation';
import { readDashboardError, readDashboardJson } from './response';

class ClientApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ClientApiError';
  }
}

async function clientApiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = init.method
    ? await mutationFetch(path, { ...init, credentials: 'same-origin' })
    : await fetch(path, { ...init, credentials: 'same-origin' });
  if (!response.ok) {
    const body = await readDashboardError(response);
    throw new ClientApiError(response.status, body.error?.message ?? body.message ?? `API ${response.status}`);
  }
  return readDashboardJson<T>(response);
}

export const clientApi = {
  models: {
    media: (modelId: string, cursor?: string) => clientApiFetch<{
      data: Array<{
        id: string;
        kind: string;
        origin: string;
        mimeType: string;
        fileSize: number;
        width: number | null;
        height: number | null;
        createdAt: string;
        status: string;
        operationId?: string;
        sourceAssetId?: string;
        resultAssetIds: string[];
      }>;
      meta?: { next_cursor?: string | null };
    }>(`/api/v1/models/${encodeURIComponent(modelId)}/media${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
  },
  social: {
    operate: (modelId: string, connectionId: string, operation: Record<string, unknown>) => clientApiFetch<{ data: Record<string, unknown> }>(
      `/api/v1/models/${encodeURIComponent(modelId)}/social-accounts/${encodeURIComponent(connectionId)}/operations`,
      { method: 'POST', body: JSON.stringify(operation), headers: { 'Content-Type': 'application/json' } },
    ),
    refreshOAuth: (platform: 'fanvue' | 'tiktok' | 'x' | 'youtube' | 'reddit' | 'snapchat', connectionId: string) => clientApiFetch<{
      status?: string;
      success?: boolean;
      platform: string;
      refreshed?: boolean;
    }>(
      `/api/v1/connectors/${platform}/refresh?connectionId=${encodeURIComponent(connectionId)}`,
      { method: 'POST' },
    ),
    connectTelegram: (body: { modelId: string; botToken: string; channelId: string }) => clientApiFetch<{
      status: string;
      platform: 'telegram';
      connectionId: string;
      displayName: string;
      botUsername: string;
    }>('/api/v1/connectors/telegram/manual', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    connectDiscordBot: (body: { modelId: string; botToken: string; channelId: string }) => clientApiFetch<{
      status: string;
      platform: 'discord';
      mode: 'bot';
      connectionId: string;
      displayName: string | null;
      botUsername: string;
      grantedOperations: string[];
    }>('/api/v1/connectors/discord/manual', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
  },
};
