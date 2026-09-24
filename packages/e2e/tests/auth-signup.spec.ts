// ─── Signup — through the real better-auth sign-up endpoint ─────────────────
// The dashboard ships no /signup page (login only); account creation is
// exposed by the API at /api/auth/sign-up/email, reached here through the
// dashboard's /api/* rewrite — the same path a future signup form would use.
// There is no confirm-password field in better-auth's sign-up payload, so a
// "mismatch" case does not exist in this app.

import { test, expect } from '@playwright/test';
import { makeUser, signUpViaApi, psql } from './helpers';

function userRow(email: string): string {
  return psql(`SELECT id FROM auth_user WHERE email='${email.replace(/'/g, "''")}';`);
}

test.describe('signup', () => {
  test('creates a new account successfully', async ({ request }) => {
    const user = makeUser('Signup');
    const { status, body } = await signUpViaApi(request, user);

    expect(status).toBe(200);
    expect(JSON.stringify(body)).toContain(user.email);
    expect(userRow(user.email).length).toBeGreaterThan(0);
  });

  test('rejects an invalid email', async ({ request }) => {
    const user = { ...makeUser('Signup Bad Email'), email: 'not-an-email' };
    const { status } = await signUpViaApi(request, user);

    expect(status).not.toBe(200);
    expect(status).not.toBe(201);
    expect(userRow(user.email)).toBe('');
  });

  test('rejects a short password', async ({ request }) => {
    const user = { ...makeUser('Signup Short Pass'), password: 'short1' };
    const { status } = await signUpViaApi(request, user);

    expect(status).not.toBe(200);
    expect(status).not.toBe(201);
    expect(userRow(user.email)).toBe('');
  });

  test('rejects a duplicate email', async ({ request }) => {
    const user = makeUser('Signup Dup');
    const first = await signUpViaApi(request, user);
    expect(first.status).toBe(200);

    const second = await signUpViaApi(request, { ...user, name: 'Someone Else' });
    expect(second.status).not.toBe(200);
    expect(second.status).not.toBe(201);
  });

  test('rejects a missing name', async ({ request }) => {
    const user = makeUser('Signup No Name');
    const res = await request.post('/api/auth/sign-up/email', {
      data: { email: user.email, password: user.password },
    });

    expect(res.status()).not.toBe(200);
    expect(res.status()).not.toBe(201);
    expect(userRow(user.email)).toBe('');
  });
});
