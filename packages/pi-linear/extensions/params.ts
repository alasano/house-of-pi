import { Type, type TSchema, type TUnsafe } from 'typebox';
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

export function nullable<T extends TSchema>(schema: T, description: string) {
  return Type.Optional(Type.Union([schema, Type.Null()], { description }));
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

export const ISSUE_SORT_KEYS = [
  'priority',
  'estimate',
  'title',
  'label',
  'labelGroup',
  'slaStatus',
  'createdAt',
  'updatedAt',
  'completedAt',
  'dueDate',
  'accumulatedStateUpdatedAt',
  'cycle',
  'milestone',
  'assignee',
  'delegate',
  'project',
  'team',
  'manual',
  'workflowState',
  'customer',
  'customerRevenue',
  'customerCount',
  'customerImportantCount',
  'rootIssue',
  'linkCount',
  'release',
] as const;

export const PROJECT_SORT_KEYS = [
  'name',
  'status',
  'priority',
  'manual',
  'targetDate',
  'startDate',
  'createdAt',
  'updatedAt',
  'health',
  'lead',
] as const;

export const INITIATIVE_SORT_KEYS = [
  'name',
  'manual',
  'updatedAt',
  'createdAt',
  'targetDate',
  'health',
  'healthUpdatedAt',
  'owner',
  'priority',
] as const;

export const USER_SORT_KEYS = ['name', 'displayName'] as const;

export const DOCUMENT_SORT_KEYS = [
  'title',
  'creator',
  'project',
  'createdAt',
  'updatedAt',
] as const;

export const SlaDayCountTypeSchema = stringEnum(['all', 'onlyBusinessDays'], {
  description: 'SLA day count type: all (calendar days, default) or onlyBusinessDays.',
});

export const DateResolutionTypeSchema = stringEnum(['month', 'quarter', 'halfYear', 'year'], {
  description: 'Date resolution.',
});

export const FrequencyResolutionTypeSchema = stringEnum(['daily', 'weekly'], {
  description: 'Update reminder frequency resolution (update mode only).',
});

export const DaySchema = stringEnum(
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  { description: 'Day of week for update reminders (update mode only).' },
);

export function filterParam(typeName: string, valueHints?: string) {
  return Type.Optional(
    Type.Record(Type.String(), Type.Any(), {
      description: `Linear ${typeName} object. Fields take comparators, e.g. { "field": { "eq": value } } (eq, neq, in, nin, contains, null, and/or compounds).${valueHints ? ` ${valueHints}` : ''}`,
    }),
  );
}

export function sortParam(typeName: string, keys: readonly string[], note?: string) {
  return Type.Optional(
    Type.Array(GenericObjectSchema, {
      description: `${typeName} array, e.g. [{ "updatedAt": { "order": "Descending", "nulls": "last" } }] (order: Ascending | Descending; nulls: first | last). Keys: ${keys.join(', ')}.${note ? ` ${note}` : ''}`,
    }),
  );
}

export function inputParam(typeClause: string, extra?: string) {
  return Type.Optional(
    Type.Record(Type.String(), Type.Any(), {
      description: `Additional ${typeClause} fields; top-level parameters override matching fields.${extra ? ` ${extra}` : ''}`,
    }),
  );
}

export const TeamConvenienceParams = {
  teamId: Type.Optional(Type.String({ description: 'Team id.' })),
  teamKey: Type.Optional(Type.String({ description: 'Team key (e.g. ENG).' })),
};
