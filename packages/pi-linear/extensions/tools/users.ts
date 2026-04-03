import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { withLinearAuth, linearGraphQL } from '../client';
import { PaginationParams, FilterParam, SortParam } from '../params';
import { USER_SELECTION } from '../selections';
import type { JsonObject } from '../types';
import { compactObject, asObject, asObjectArray } from '../util';

export function userTools() {
  return [
    defineTool({
      name: 'linear_list_users',
      label: 'Linear List Users',
      description: 'List users. Supports full users query args.',
      parameters: Type.Object({
        ...PaginationParams,
        ...FilterParam,
        ...SortParam,
        includeDisabled: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const variables = compactObject({
            after: params.after,
            before: params.before,
            filter: asObject(params.filter),
            first: params.first ?? 50,
            includeArchived: params.includeArchived,
            includeDisabled: params.includeDisabled,
            last: params.last,
            orderBy: params.orderBy,
            sort: asObjectArray(params.sort),
          });

          const data = await linearGraphQL<{
            users: { nodes: Array<JsonObject> };
          }>(
            apiKey,
            `query ListUsers(
              $after: String
              $before: String
              $filter: UserFilter
              $first: Int
              $includeArchived: Boolean
              $includeDisabled: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
              $sort: [UserSortInput!]
            ) {
              users(
                after: $after
                before: $before
                filter: $filter
                first: $first
                includeArchived: $includeArchived
                includeDisabled: $includeDisabled
                last: $last
                orderBy: $orderBy
                sort: $sort
              ) {
                nodes {
                  ${USER_SELECTION}
                }
              }
            }`,
            variables,
            signal,
          );

          const users = data.users.nodes;
          return {
            content: [{ type: 'text', text: JSON.stringify({ users }, null, 2) }],
            details: { users },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_get_user',
      label: 'Linear Get User',
      description: 'Get a specific user by id.',
      parameters: Type.Object({
        userId: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{ user: JsonObject | null }>(
            apiKey,
            `query GetUser($id: String!) {
              user(id: $id) {
                ${USER_SELECTION}
              }
            }`,
            { id: params.userId },
            signal,
          );

          const user = data.user;
          return {
            content: [{ type: 'text', text: JSON.stringify({ user }, null, 2) }],
            details: { user },
          };
        });
      },
    }),
  ];
}
