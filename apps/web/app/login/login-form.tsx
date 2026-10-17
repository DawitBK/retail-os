'use client';

import { useActionState } from 'react';
import { Notice } from '@/components/ui';
import { login, type LoginState } from './actions';

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="card space-y-4 p-5">
      <input type="hidden" name="next" value={next ?? ''} />
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Email</span>
        <input
          className="input"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Password</span>
        <input
          className="input"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      <button className="btn btn-primary w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
