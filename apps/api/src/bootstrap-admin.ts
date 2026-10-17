import 'reflect-metadata';
import { parseEnv } from '@retail/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { z } from 'zod';
import { hashPassword } from './auth/auth.service.js';
import { users } from './db/schema.js';

/**
 * Create the first owner (there is no public sign-up). Run once after migrating:
 *   OWNER_EMAIL=... OWNER_PASSWORD=... node dist/bootstrap-admin.js
 * It refuses to run when any owner already exists.
 */
const env = parseEnv(
  z.object({
    DATABASE_URL: z.string().min(1),
    OWNER_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
    OWNER_PASSWORD: z.string().min(12).max(128),
  }),
);

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
try {
  const db = drizzle(pool);
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'owner'), isNull(users.deletedAt)));
  if (existing) {
    process.stderr.write('An owner already exists; nothing to do.\n');
    process.exitCode = 1;
  } else {
    await db.insert(users).values({
      email: env.OWNER_EMAIL,
      passwordHash: await hashPassword(env.OWNER_PASSWORD),
      firstName: 'Retail OS',
      lastName: 'Owner',
      role: 'owner',
    });
    process.stdout.write(`Created owner ${env.OWNER_EMAIL}\n`);
  }
} finally {
  await pool.end();
}
