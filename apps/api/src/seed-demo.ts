import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseEnv } from '@retail/kit';
import { z } from 'zod';
import { AppModule } from './app.module.js';
import { configureTimezone } from './common/time.js';
import { envSchema } from './config.js';
import { seedDemo } from './seed/demo.js';

/**
 * Fill a database with a connected demo business: six months of trading, replayed through the real
 * services so the stock, the books and the reports agree. Safe to run again (it steps over what is
 * done), never deletes anything, and refuses a production database unless told to.
 *
 *   DATABASE_URL=... JWT_SECRET=... node dist/seed-demo.js [--days=180] [--allow-production]
 *
 * It needs an owner (owner:bootstrap). Staff it has to create get DEMO_STAFF_PASSWORD.
 */
const env = parseEnv(
  envSchema.extend({
    DEMO_STAFF_PASSWORD: z.string().min(12).max(128).optional(),
    DEMO_STAFF_EMAIL_DOMAIN: z.string().min(3).default('retail.example'),
  }),
);
const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}`));
const days = Number(flag('days')?.split('=')[1] ?? 180);
if (!Number.isInteger(days) || days < 30 || days > 400) {
  process.stderr.write('--days must be a whole number from 30 to 400\n');
  process.exit(2);
}
if (env.NODE_ENV === 'production' && !flag('allow-production')) {
  process.stderr.write(
    'NODE_ENV is production. The demo seed only fills a database that is meant to hold demo data;\n' +
      'if this one is, run it again with --allow-production.\n',
  );
  process.exit(2);
}

configureTimezone(env.BUSINESS_TIMEZONE);
const app = await NestFactory.createApplicationContext(
  AppModule.register(env.DATABASE_URL, {
    jwtSecret: env.JWT_SECRET,
    accessTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
  }),
  { logger: ['error', 'warn'] },
);
try {
  const report = await seedDemo(app, {
    days,
    log: (line) => process.stdout.write(`${line}\n`),
    staffPassword: env.DEMO_STAFF_PASSWORD,
    staffEmailDomain: env.DEMO_STAFF_EMAIL_DOMAIN,
  });
  if (report.alreadySeeded) {
    process.stdout.write('The demo data is already in this database; nothing was changed.\n');
  } else {
    process.stdout.write(
      `Replayed ${report.days} days.\n${JSON.stringify(report.counts, null, 2)}\n`,
    );
    for (const c of report.checks)
      process.stdout.write(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name} (${c.detail})\n`);
    if (report.checks.some((c) => !c.ok)) process.exitCode = 1;
  }
} finally {
  await app.close();
}
