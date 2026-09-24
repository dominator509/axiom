import { beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../index.js';

const { generate, withContext, audit } = vi.hoisted(() => ({
  generate: vi.fn(),
  withContext: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('../inbox-agent-draft.js', () => ({ generateAssignedLlmDraft: generate }));
vi.mock('./helpers.js', async (original) => ({
  ...(await original<typeof import('./helpers.js')>()),
  withOrgContext: withContext,
  writeAudit: audit,
}));

import { inboxRepliesRouter } from './inbox-replies.js';

const id = '11111111-1111-4111-8111-111111111111';
const body = {
  connectionId: id,
  counterpartUuid: id,
  intentKey: id,
  conversationKey: 'default',
  actor: { type: 'llm', ref: 'grok-roleplayer' },
  prompt: 'Draft one bounded reply.',
  confirm: true,
};

function request(
  role: AppBindings['Variables']['role'] = 'operator',
  authenticated = true,
  payload: unknown = body,
) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    if (authenticated) {
      c.set('orgId', id);
      c.set('userId', 'operator-1');
    }
    c.set('role', role);
    await next();
  });
  app.route('/', inboxRepliesRouter);
  return app.request(`/models/${id}/inbox/replies/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  generate.mockReset();
  withContext.mockReset();
  audit.mockReset();
});

it('requires authentication and the management role before invoking the draft service', async () => {
  expect((await request('operator', false)).status).toBe(401);
  expect((await request('chatter')).status).toBe(403);
  expect((await request('operator', true, { ...body, confirm: false })).status).toBe(400);
  expect(generate).not.toHaveBeenCalled();
});

it('maps a created private draft without exposing provider internals', async () => {
  generate.mockResolvedValue({
    outcome: 'created',
    record: {
      id,
      modelId: id,
      connectionId: id,
      counterpartUuid: id,
      intentKey: id,
      body: 'Warm reply.',
      draftSource: 'llm',
    },
  });
  const response = await request();
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    data: expect.objectContaining({ draftSource: 'llm', body: 'Warm reply.' }),
  });
  expect(generate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      userId: 'operator-1',
      actorRef: 'grok-roleplayer',
      prompt: body.prompt,
    }),
  );
});

it('keeps uncertain provider outcomes non-sendable', async () => {
  generate.mockResolvedValue({ outcome: 'uncertain' });
  const response = await request();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('provider');
});

it('requires a pending assigned-LLM draft and records one human approval without sending', async () => {
  const unapproved = {
    id,
    modelId: id,
    connectionId: id,
    counterpartUuid: id,
    draftSource: 'llm',
    approvedByUserId: null,
    state: 'pending',
  };
  const approved = {
    ...unapproved,
    approvedByUserId: 'operator-1',
    approvedAt: '2026-09-19T00:00:00Z',
  };
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [unapproved] }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [approved] }) }) }),
  };
  withContext.mockImplementation(async (_org: string, callback: (value: unknown) => unknown) =>
    callback(tx),
  );
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('orgId', id);
    c.set('userId', 'operator-1');
    c.set('role', 'operator');
    await next();
  });
  app.route('/', inboxRepliesRouter);
  const response = await app.request(`/models/${id}/inbox/replies/${id}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  });
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ data: approved });
  expect(audit).toHaveBeenCalledOnce();
  expect(generate).not.toHaveBeenCalled();
});
