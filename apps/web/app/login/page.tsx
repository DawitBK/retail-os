import type { Metadata } from 'next';
import { ssoConfig } from '@/lib/sso';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const sso = await ssoConfig();
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="mb-6">
        <div className="text-2xl font-semibold tracking-tight">Retail OS</div>
        <p className="mt-1 text-sm text-muted">Sign in to the till and the back office.</p>
      </div>
      <LoginForm next={next} />
      {sso.enabled ? (
        <a
          className="btn mt-3 w-full text-center"
          href={`/login/sso${next ? `?next=${encodeURIComponent(next)}` : ''}`}
        >
          Sign in with SSO
        </a>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error === 'no-account'
            ? 'Your single sign-on account has no access here. Ask the owner to add you.'
            : 'Single sign-on did not complete. Try again.'}
        </p>
      ) : null}
    </main>
  );
}
