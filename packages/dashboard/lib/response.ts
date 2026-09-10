import { readBoundedResponseJson } from '@axiom/core';

export interface DashboardErrorBody {
  error?: { message?: string };
  message?: string;
  [key: string]: unknown;
}

/** Parse a dashboard response without allowing an unbounded body allocation. */
export function readDashboardJson<T>(response: Response): Promise<T> {
  return readBoundedResponseJson<T>(response);
}

/** Read an error envelope while keeping malformed/oversized responses safe. */
export async function readDashboardError(response: Response): Promise<DashboardErrorBody> {
  try {
    const body = await readDashboardJson<unknown>(response);
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as DashboardErrorBody)
      : {};
  } catch {
    return {};
  }
}
