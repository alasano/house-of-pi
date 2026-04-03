import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { withLinearAuth, linearGraphQL } from '../client';
import { PaginationParams, FilterParam } from '../params';
import { TEAM_SELECTION } from '../selections';
import type { LinearTeam, JsonObject } from '../types';
import { compactObject, asObject } from '../util';

export function teamTools() {
  return [
    defineTool({
      name: 'linear_list_teams',
      label: 'Linear List Teams',
      description:
        'List Linear teams and states. Supports full teams query args: after, before, filter, first, includeArchived, last, orderBy.',
      parameters: Type.Object({
        ...PaginationParams,
        ...FilterParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const variables = compactObject({
            after: params.after,
            before: params.before,
            filter: asObject(params.filter),
            first: params.first,
            includeArchived: params.includeArchived,
            last: params.last,
            orderBy: params.orderBy,
          });

          const data = await linearGraphQL<{ teams: { nodes: LinearTeam[] } }>(
            apiKey,
            `query ListTeams(
              $after: String
              $before: String
              $filter: TeamFilter
              $first: Int
              $includeArchived: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
            ) {
              teams(
                after: $after
                before: $before
                filter: $filter
                first: $first
                includeArchived: $includeArchived
                last: $last
                orderBy: $orderBy
              ) {
                nodes {
                  id
                  key
                  name
                  states(first: 50) {
                    nodes {
                      id
                      name
                      type
                    }
                  }
                }
              }
            }`,
            variables,
            signal,
          );

          const teams = data.teams.nodes;
          return {
            content: [{ type: 'text', text: JSON.stringify({ teams }, null, 2) }],
            details: { teams },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_get_team',
      label: 'Linear Get Team',
      description: 'Get a specific team by id.',
      parameters: Type.Object({
        teamId: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{ team: JsonObject | null }>(
            apiKey,
            `query GetTeam($id: String!) {
              team(id: $id) {
                ${TEAM_SELECTION}
              }
            }`,
            { id: params.teamId },
            signal,
          );

          const team = data.team;
          return {
            content: [{ type: 'text', text: JSON.stringify({ team }, null, 2) }],
            details: { team },
          };
        });
      },
    }),
  ];
}
