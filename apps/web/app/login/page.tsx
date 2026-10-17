import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="mb-6">
        <div className="text-2xl font-semibold tracking-tight">Retail OS</div>
        <p className="mt-1 text-sm text-muted">Sign in to the till and the back office.</p>
      </div>
      <LoginForm next={next} />
    </main>
  );
}
