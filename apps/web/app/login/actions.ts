'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  API_URL,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookie,
  refreshCookie,
  type TokenPair,
} from '@/lib/session';

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
  } catch {
    return { error: 'The server cannot be reached. Try again in a moment.' };
  }
  if (res.status === 401) return { error: 'That email and password do not match.' };
  if (res.status === 429) return { error: 'Too many attempts. Wait a minute and try again.' };
  if (!res.ok) return { error: 'Sign-in failed. Try again.' };

  const tokens = (await res.json()) as TokenPair;
  const jar = await cookies();
  jar.set(accessCookie(tokens));
  jar.set(refreshCookie(tokens));
  redirect(String(form.get('next') ?? '').startsWith('/') ? String(form.get('next')) : '/');
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    // Best effort: the API revokes the whole token family.
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch(() => undefined);
  }
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  redirect('/login');
}
