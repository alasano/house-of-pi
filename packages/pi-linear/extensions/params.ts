import { Type } from '@sinclair/typebox';
import { GenericObjectSchema } from './util';

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
    Type.String({
      description: 'PaginationOrderBy enum value (for example: updatedAt, createdAt).',
    }),
  ),
};

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
