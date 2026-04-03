import { Type } from '@sinclair/typebox';
import type { JsonObject } from './types';

export function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function asObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

export function asObjectArray(value: unknown): JsonObject[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const mapped = value.map(asObject).filter((item): item is JsonObject => Boolean(item));
  return mapped.length ? mapped : [];
}

export function compactObject<T extends Record<string, unknown>>(input: T): Partial<T> {
  const output: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key as keyof T] = value as T[keyof T];
    }
  }
  return output;
}

export function mergeFilters(base?: JsonObject, extra?: JsonObject): JsonObject | undefined {
  if (base && extra) {
    return { and: [base, extra] };
  }
  return base || extra;
}

export const GenericObjectSchema = Type.Record(Type.String(), Type.Any());
