import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { withLinearAuth, linearGraphQL, resolveTeamId } from '../client';
import { PaginationParams, paginationVariables, FilterParam } from '../params';
import { CYCLE_SELECTION } from '../selections';
import type { JsonObject, LinearConnection } from '../types';
import { compactObject, asObject } from '../util';
import {
  renderLinearArchiveCycleCall,
  renderLinearArchiveCycleResult,
  renderLinearGetCycleCall,
  renderLinearGetCycleResult,
  renderLinearCycleListCall,
  renderLinearCycleListResult,
  renderLinearCycleMutationCall,
  renderLinearCycleMutationResult,
} from '../renderers/cycles';

type CycleMutationPayload = {
  success: boolean;
  cycle: JsonObject | null;
};

type CycleArchivePayload = {
  success: boolean;
  entity: JsonObject | null;
};

function requireCycle(payload: CycleMutationPayload, operation: 'create' | 'update'): JsonObject {
  if (!payload.success) {
    throw new Error(`Linear failed to ${operation} the cycle.`);
  }
  if (!payload.cycle) {
    throw new Error(
      `Linear reported that it ${operation === 'create' ? 'created' : 'updated'} the cycle but returned no cycle.`,
    );
  }
  return payload.cycle;
}

function requireArchivedCycle(payload: CycleArchivePayload): JsonObject {
  if (!payload.success) {
    throw new Error('Linear failed to archive the cycle.');
  }
  if (!payload.entity) {
    throw new Error('Linear reported that it archived the cycle but returned no cycle.');
  }
  return payload.entity;
}

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
            ...(teamId ? { team: { id: { eq: teamId } } } : {}),
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
      name: 'linear_get_cycle',
      label: 'Linear Get Cycle',
      description: 'Get a Linear cycle by ID or slug.',
      parameters: Type.Object({
        id: Type.String({ description: 'Cycle ID or slug.' }),
      }),
      renderCall: renderLinearGetCycleCall,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{ cycle: JsonObject }>(
            apiKey,
            `query GetCycle($id: String!) {
              cycle(id: $id) {
                ${CYCLE_SELECTION}
              }
            }`,
            { id: params.id },
            signal,
          );

          const cycle = data.cycle;
          return {
            content: [{ type: 'text', text: JSON.stringify({ cycle }, null, 2) }],
            details: { cycle },
          };
        });
      },
      renderResult: renderLinearGetCycleResult,
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

          const data = await linearGraphQL<{ cycleCreate: CycleMutationPayload }>(
            apiKey,
            `mutation CreateCycle($input: CycleCreateInput!) {
              cycleCreate(input: $input) {
                success
                cycle {
                  ${CYCLE_SELECTION}
                }
              }
            }`,
            { input },
            signal,
          );

          const cycle = requireCycle(data.cycleCreate, 'create');
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, cycle }, null, 2) }],
            details: { success: true, cycle },
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

          const data = await linearGraphQL<{ cycleUpdate: CycleMutationPayload }>(
            apiKey,
            `mutation UpdateCycle($id: String!, $input: CycleUpdateInput!) {
              cycleUpdate(id: $id, input: $input) {
                success
                cycle {
                  ${CYCLE_SELECTION}
                }
              }
            }`,
            { id: params.id, input },
            signal,
          );

          const cycle = requireCycle(data.cycleUpdate, 'update');
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, cycle }, null, 2) }],
            details: { success: true, cycle },
          };
        });
      },
      renderResult: renderLinearCycleMutationResult,
    }),

    defineTool({
      name: 'linear_archive_cycle',
      label: 'Linear Archive Cycle',
      description:
        'Immediately archive a Linear cycle by ID. Archiving unlinks every issue currently assigned to the cycle. Linear normally auto-archives eligible cycles according to team settings. Never call this tool automatically for a completed, past, or eligible cycle; use it only when the user explicitly requests that exact cycle be archived.',
      parameters: Type.Object({
        id: Type.String({ description: 'Exact ID of the cycle the user requested to archive.' }),
      }),
      renderCall: renderLinearArchiveCycleCall,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{ cycleArchive: CycleArchivePayload }>(
            apiKey,
            `mutation ArchiveCycle($id: String!) {
              cycleArchive(id: $id) {
                success
                entity {
                  ${CYCLE_SELECTION}
                }
              }
            }`,
            { id: params.id },
            signal,
          );

          const cycle = requireArchivedCycle(data.cycleArchive);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, cycle }, null, 2) }],
            details: { success: true, cycle },
          };
        });
      },
      renderResult: renderLinearArchiveCycleResult,
    }),
  ];
}
