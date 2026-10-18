import { z } from 'zod';

export const closeYearSchema = z
  .object({ year: z.number().int().min(1990).max(2200).describe('The financial year to close') })
  .strict();
export type CloseYear = z.output<typeof closeYearSchema>;

export const periodCloseSchema = z.object({
  fiscalYear: z.number().int(),
  closedThrough: z.iso.date(),
  netProfitMinor: z
    .number()
    .int()
    .describe('Profit moved into retained earnings (negative for a loss)'),
  entryNumber: z
    .string()
    .nullable()
    .describe('The closing journal entry, when the year had any activity'),
  closedAt: z.iso.datetime(),
});
export type PeriodCloseDto = z.output<typeof periodCloseSchema>;

export const periodsSchema = z.object({
  closedThrough: z.iso.date().nullable().describe('Nothing may be posted on or before this date'),
  closes: z.array(periodCloseSchema),
});
