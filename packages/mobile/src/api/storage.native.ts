import * as SecureStore from 'expo-secure-store';

const COOKIE_KEY = 'axiom.session.cookie';

export async function loadSessionCookie(): Promise<string | null> {
  return SecureStore.getItemAsync(COOKIE_KEY);
}

export async function saveSessionCookie(cookie: string): Promise<void> {
  await SecureStore.setItemAsync(COOKIE_KEY, cookie);
}

export async function removeSessionCookie(): Promise<void> {
  await SecureStore.deleteItemAsync(COOKIE_KEY);
}
