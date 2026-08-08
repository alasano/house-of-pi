import { Type, type TUnsafe } from 'typebox';
import { compactObject, GenericObjectSchema } from './util';

export function stringEnum<const T extends readonly string[]>(
  values: T,
  options?: { description?: string },
): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({
    type: 'string',
    enum: [...values],
    ...(options?.description && { description: options.description }),
  });
}

const PAGINATION_ORDER_BY_VALUES = ['createdAt', 'updatedAt'] as const;
type PaginationOrderBy = (typeof PAGINATION_ORDER_BY_VALUES)[number];

export const PaginationParams = {
  after: Type.Optional(Type.String({ description: 'Pagination cursor.' })),
  before: Type.Optional(Type.String({ description: 'Pagination cursor.' })),
  first: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 100,
      description: 'Maximum number of items to fetch.',
    }),
  ),
  last: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 100,
      description: 'Fetch the last N items (with before cursor).',
    }),
  ),
  includeArchived: Type.Optional(Type.Boolean({ description: 'Include archived resources.' })),
  orderBy: Type.Optional(
    stringEnum(PAGINATION_ORDER_BY_VALUES, {
      description: 'Sort order: createdAt (default) or updatedAt.',
    }),
  ),
};

type PaginationVariableParams = {
  after?: string;
  before?: string;
  first?: number;
  includeArchived?: boolean;
  last?: number;
  orderBy?: PaginationOrderBy;
};

export function paginationVariables(
  params: PaginationVariableParams,
  defaultPageSize: number,
): Partial<PaginationVariableParams> {
  const hasForwardPagination = params.after !== undefined || params.first !== undefined;
  const hasBackwardPagination = params.before !== undefined || params.last !== undefined;

  if (hasForwardPagination && hasBackwardPagination) {
    throw new Error(
      'Use either forward pagination (first/after) or backward pagination (last/before), not both.',
    );
  }

  if (hasBackwardPagination) {
    return compactObject({
      before: params.before,
      includeArchived: params.includeArchived,
      last: params.last ?? defaultPageSize,
      orderBy: params.orderBy,
    });
  }

  return compactObject({
    after: params.after,
    first: params.first ?? defaultPageSize,
    includeArchived: params.includeArchived,
    orderBy: params.orderBy,
  });
}

export const SortParam = {
  sort: Type.Optional(Type.Array(GenericObjectSchema, { description: 'Sort input array.' })),
};

export const FilterParam = {
  filter: Type.Optional(GenericObjectSchema),
};

export const RawInputParam = {
  input: Type.Optional(GenericObjectSchema),
};

export const TeamConvenienceParams = {
  teamId: Type.Optional(Type.String({ description: 'Team id.' })),
  teamKey: Type.Optional(Type.String({ description: 'Team key (e.g. ENG).' })),
};
