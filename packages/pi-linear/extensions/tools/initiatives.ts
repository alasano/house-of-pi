import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { withLinearAuth, linearGraphQL } from '../client';
import { PaginationParams, FilterParam, SortParam, RawInputParam } from '../params';
import { INITIATIVE_SELECTION } from '../selections';
import type { JsonObject } from '../types';
import { compactObject, asObject, asObjectArray, asString } from '../util';

export function initiativeTools() {
  return [
    defineTool({
      name: 'linear_list_initiatives',
      label: 'Linear List Initiatives',
      description: 'List initiatives. Supports full initiatives query args.',
      parameters: Type.Object({
        ...PaginationParams,
        ...FilterParam,
        ...SortParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const variables = compactObject({
            after: params.after,
            before: params.before,
            filter: asObject(params.filter),
            first: params.first ?? 20,
            includeArchived: params.includeArchived,
            last: params.last,
            orderBy: params.orderBy,
            sort: asObjectArray(params.sort),
          });

          const data = await linearGraphQL<{
            initiatives: { nodes: Array<JsonObject> };
          }>(
            apiKey,
            `query ListInitiatives(
              $after: String
              $before: String
              $filter: InitiativeFilter
              $first: Int
              $includeArchived: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
              $sort: [InitiativeSortInput!]
            ) {
              initiatives(
                after: $after
                before: $before
                filter: $filter
                first: $first
                includeArchived: $includeArchived
                last: $last
                orderBy: $orderBy
                sort: $sort
              ) {
                nodes {
                  ${INITIATIVE_SELECTION}
                }
              }
            }`,
            variables,
            signal,
          );

          const initiatives = data.initiatives.nodes;
          return {
            content: [{ type: 'text', text: JSON.stringify({ initiatives }, null, 2) }],
            details: { initiatives },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_get_initiative',
      label: 'Linear Get Initiative',
      description: 'Get a specific initiative by id.',
      parameters: Type.Object({
        initiativeId: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{ initiative: JsonObject | null }>(
            apiKey,
            `query GetInitiative($id: String!) {
              initiative(id: $id) {
                ${INITIATIVE_SELECTION}
              }
            }`,
            { id: params.initiativeId },
            signal,
          );

          const initiative = data.initiative;
          return {
            content: [
              { type: 'text', text: JSON.stringify({ initiative: initiative ?? null }, null, 2) },
            ],
            details: { initiative: initiative ?? null },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_save_initiative',
      label: 'Linear Save Initiative',
      description:
        'Create or update an initiative. If initiativeId is provided, uses initiativeUpdate; otherwise uses initiativeCreate.',
      parameters: Type.Object({
        initiativeId: Type.Optional(Type.String()),
        color: Type.Optional(Type.String()),
        content: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        icon: Type.Optional(Type.String()),
        id: Type.Optional(Type.String()),
        name: Type.Optional(Type.String()),
        ownerId: Type.Optional(Type.String()),
        sortOrder: Type.Optional(Type.Number()),
        status: Type.Optional(Type.String()),
        targetDate: Type.Optional(Type.String()),
        targetDateResolution: Type.Optional(Type.String()),
        frequencyResolution: Type.Optional(Type.String()),
        trashed: Type.Optional(Type.Boolean()),
        updateReminderFrequency: Type.Optional(Type.Number()),
        updateReminderFrequencyInWeeks: Type.Optional(Type.Number()),
        updateRemindersDay: Type.Optional(Type.String()),
        updateRemindersHour: Type.Optional(Type.Integer()),
        ...RawInputParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const rawInput = asObject(params.input) || {};
          const updateId = asString(params.initiativeId);

          const input = {
            ...rawInput,
            ...compactObject({
              color: params.color,
              content: params.content,
              description: params.description,
              frequencyResolution: params.frequencyResolution,
              icon: params.icon,
              id: params.id,
              name: params.name,
              ownerId: params.ownerId,
              sortOrder: params.sortOrder,
              status: params.status,
              targetDate: params.targetDate,
              targetDateResolution: params.targetDateResolution,
              trashed: params.trashed,
              updateReminderFrequency: params.updateReminderFrequency,
              updateReminderFrequencyInWeeks: params.updateReminderFrequencyInWeeks,
              updateRemindersDay: params.updateRemindersDay,
              updateRemindersHour: params.updateRemindersHour,
            }),
          };

          if (updateId) {
            if (Object.keys(input).length === 0) {
              throw new Error('No initiative update fields were provided.');
            }

            const data = await linearGraphQL<{
              initiativeUpdate: {
                success: boolean;
                initiative?: JsonObject | null;
              };
            }>(
              apiKey,
              `mutation UpdateInitiative($id: String!, $input: InitiativeUpdateInput!) {
                initiativeUpdate(id: $id, input: $input) {
                  success
                  initiative {
                    ${INITIATIVE_SELECTION}
                  }
                }
              }`,
              { id: updateId, input },
              signal,
            );

            if (!data.initiativeUpdate.success || !data.initiativeUpdate.initiative) {
              throw new Error('Linear initiativeUpdate did not succeed.');
            }

            const initiative = data.initiativeUpdate.initiative;
            return {
              content: [{ type: 'text', text: JSON.stringify({ initiative }, null, 2) }],
              details: { initiative },
            };
          }

          if (!asString(input.name)) {
            throw new Error('Initiative name is required for initiativeCreate (name).');
          }

          const data = await linearGraphQL<{
            initiativeCreate: {
              success: boolean;
              initiative?: JsonObject | null;
            };
          }>(
            apiKey,
            `mutation CreateInitiative($input: InitiativeCreateInput!) {
              initiativeCreate(input: $input) {
                success
                initiative {
                  ${INITIATIVE_SELECTION}
                }
              }
            }`,
            { input },
            signal,
          );

          if (!data.initiativeCreate.success || !data.initiativeCreate.initiative) {
            throw new Error('Linear initiativeCreate did not succeed.');
          }

          const initiative = data.initiativeCreate.initiative;
          return {
            content: [{ type: 'text', text: JSON.stringify({ initiative }, null, 2) }],
            details: { initiative },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_delete_initiative',
      label: 'Linear Delete Initiative',
      description: 'Delete an initiative by id.',
      parameters: Type.Object({
        initiativeId: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            initiativeDelete: { success: boolean };
          }>(
            apiKey,
            `mutation DeleteInitiative($id: String!) {
              initiativeDelete(id: $id) {
                success
              }
            }`,
            { id: params.initiativeId },
            signal,
          );

          if (!data.initiativeDelete.success) {
            throw new Error('Linear initiativeDelete did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }],
            details: { success: true },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_archive_initiative',
      label: 'Linear Archive Initiative',
      description: 'Archive an initiative by id.',
      parameters: Type.Object({
        initiativeId: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            initiativeArchive: { success: boolean };
          }>(
            apiKey,
            `mutation ArchiveInitiative($id: String!) {
              initiativeArchive(id: $id) {
                success
              }
            }`,
            { id: params.initiativeId },
            signal,
          );

          if (!data.initiativeArchive.success) {
            throw new Error('Linear initiativeArchive did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }],
            details: { success: true },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_unarchive_initiative',
      label: 'Linear Unarchive Initiative',
      description: 'Unarchive an initiative by id.',
      parameters: Type.Object({
        initiativeId: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            initiativeUnarchive: { success: boolean };
          }>(
            apiKey,
            `mutation UnarchiveInitiative($id: String!) {
              initiativeUnarchive(id: $id) {
                success
              }
            }`,
            { id: params.initiativeId },
            signal,
          );

          if (!data.initiativeUnarchive.success) {
            throw new Error('Linear initiativeUnarchive did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }],
            details: { success: true },
          };
        });
      },
    }),
  ];
}
