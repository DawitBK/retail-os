import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Validates and parses a request part with a Zod schema; a ZodError becomes a 400 problem. */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    return this.schema.parse(value);
  }
}
