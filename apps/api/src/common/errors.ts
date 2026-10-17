import { conflict, ProblemException } from '@retail/kit';

export const unauthorized = (detail = 'A valid access token is required') =>
  new ProblemException(401, 'unauthorized', 'Unauthorized', detail);
export const forbidden = (detail = 'Your role does not allow this action') =>
  new ProblemException(403, 'forbidden', 'Forbidden', detail);

/** The SQLSTATE of a driver error. Drizzle wraps it, so the code may live on the cause. */
export function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
}

export function versionConflict(entity: string, current: number, sent: number): ProblemException {
  return new ProblemException(
    409,
    'version-conflict',
    'Version conflict',
    `The ${entity} is at version ${current}; you sent ${sent}. Re-read and retry.`,
    { currentVersion: current },
  );
}

export { conflict };

/** Escape LIKE wildcards so a search term is matched as plain text. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (match) => `\\${match}`);
