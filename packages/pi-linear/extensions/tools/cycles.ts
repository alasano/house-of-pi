import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { withLinearAuth, linearGraphQL, resolveTeamId } from '../client';
import { PaginationParams, paginationVariables, FilterParam } from '../params';
import { CYCLE_SELECTION } from '../selections';
import type { JsonObject, LinearConnection } from '../types';
import { compactObject, asObject } from '../util';
import {
  renderLinearCycleListCall,
  renderLinearCycleListResult,
  renderLinearCycleMutationCall,
  renderLinearCycleMutationResult,
} from '../renderers/cycles';

export function cycleTools() {
  return [
    defineTool({
      name: 'linear_list_cycles',
      label: 'Linear List Cycles',
      description:
        'List Linear cycles. Supports full cycles query args (filter, first, orderBy, includeArchived).',
      parameters: Type.Object({
        ...PaginationParams,
        ...FilterParam,
        teamId: Type.Optional(Type.String({ description: 'Team id to scope cycles.' })),
        teamKey: Type.Optional(
          Type.String({ description: 'Team key (e.g. ENG). Resolved to a team id.' }),
        ),
      }),
      renderCall: renderLinearCycleListCall,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const teamId = params.teamId
            ? params.teamId
            : params.teamKey
              ? await resolveTeamId(apiKey, { teamKey: params.teamKey }, signal)
              : undefined;

          const filter = compactObject({
            ...asObject(params.filter),
            team: teamId ? { id: { eq: teamId } } : undefined,
          });

          const variables = compactObject({
            ...paginationVariables(params, 50),
            filter: Object.keys(filter).length ? filter : undefined,
          });

          const data = await linearGraphQL<{
            cycles: LinearConnection<JsonObject>;
          }>(
            apiKey,
            `query ListCycles(
              $after: String
              $before: String
              $filter: CycleFilter
              $first: Int
              $includeArchived: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
            ) {
              cycles(
                after: $after
                before: $before
                filter: $filter
                first: $first
                includeArchived: $includeArchived
                last: $last
                orderBy: $orderBy
              ) {
                nodes {
                  ${CYCLE_SELECTION}
                }
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  startCursor
                  endCursor
                }
              }
            }`,
            variables,
            signal,
          );

          const cycles = data.cycles.nodes;
          const pageInfo = data.cycles.pageInfo;
          return {
            content: [{ type: 'text', text: JSON.stringify({ cycles, pageInfo }, null, 2) }],
            details: { cycles, pageInfo },
          };
        });
      },
      renderResult: renderLinearCycleListResult,
    }),

    defineTool({
      name: 'linear_create_cycle',
      label: 'Linear Create Cycle',
      description:
        'Create a Linear cycle for a team. Provide teamId/teamKey, startsAt and endsAt (ISO 8601 datetimes). Optionally name it (e.g. "W33").',
      parameters: Type.Object({
        teamId: Type.Optional(Type.String({ description: 'Team id.' })),
        teamKey: Type.Optional(
          Type.String({ description: 'Team key (e.g. ENG). Resolved to a team id.' }),
        ),
        name: Type.Optional(Type.String({ description: 'Cycle name (e.g. W33).' })),
        description: Type.Optional(Type.String({ description: 'Cycle description.' })),
        startsAt: Type.String({
          description: 'Start datetime (ISO 8601, e.g. 2026-08-10T00:00:00.000Z).',
        }),
        endsAt: Type.String({ description: 'End datetime (ISO 8601).' }),
      }),
      renderCall: (args, theme) =>
        renderLinearCycleMutationCall('linear_create_cycle', args, theme),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const teamId = params.teamId
            ? params.teamId
            : params.teamKey
              ? await resolveTeamId(apiKey, { teamKey: params.teamKey }, signal)
              : undefined;
          if (!teamId) {
            throw new Error('Provide either teamId or teamKey.');
          }

          const input = compactObject({
            teamId,
            name: params.name,
            description: params.description,
            startsAt: params.startsAt,
            endsAt: params.endsAt,
          });

          const data = await linearGraphQL<{
            cycleCreate: { cycle: JsonObject };
          }>(
            apiKey,
            `mutation CreateCycle($input: CycleCreateInput!) {
              cycleCreate(input: $input) {
                cycle {
                  ${CYCLE_SELECTION}
                }
              }
            }`,
            { input },
            signal,
          );

          const cycle = data.cycleCreate.cycle;
          return {
            content: [{ type: 'text', text: JSON.stringify({ cycle }, null, 2) }],
            details: { cycle },
          };
        });
      },
      renderResult: renderLinearCycleMutationResult,
    }),

    defineTool({
      name: 'linear_update_cycle',
      label: 'Linear Update Cycle',
      description:
        'Update a Linear cycle by id. Accepts name, description, startsAt, endsAt, completedAt.',
      parameters: Type.Object({
        id: Type.String({ description: 'Cycle id.' }),
        name: Type.Optional(Type.String({ description: 'Cycle name (e.g. W33).' })),
        description: Type.Optional(Type.String({ description: 'Cycle description.' })),
        startsAt: Type.Optional(Type.String({ description: 'Start datetime (ISO 8601).' })),
        endsAt: Type.Optional(Type.String({ description: 'End datetime (ISO 8601).' })),
        completedAt: Type.Optional(
          Type.String({ description: 'Completion datetime (ISO 8601) to close the cycle.' }),
        ),
      }),
      renderCall: (args, theme) =>
        renderLinearCycleMutationCall('linear_update_cycle', args, theme),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const input = compactObject({
            name: params.name,
            description: params.description,
            startsAt: params.startsAt,
            endsAt: params.endsAt,
            completedAt: params.completedAt,
          });

          const data = await linearGraphQL<{
            cycleUpdate: { cycle: JsonObject };
          }>(
            apiKey,
            `mutation UpdateCycle($id: String!, $input: CycleUpdateInput!) {
              cycleUpdate(id: $id, input: $input) {
                cycle {
                  ${CYCLE_SELECTION}
                }
              }
            }`,
            { id: params.id, input },
            signal,
          );

          const cycle = data.cycleUpdate.cycle;
          return {
            content: [{ type: 'text', text: JSON.stringify({ cycle }, null, 2) }],
            details: { cycle },
          };
        });
      },
      renderResult: renderLinearCycleMutationResult,
    }),
  ];
}
