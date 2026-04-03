import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { withLinearAuth, linearGraphQL } from '../client';
import { PaginationParams, FilterParam, RawInputParam } from '../params';
import { MILESTONE_SELECTION } from '../selections';
import type { JsonObject } from '../types';
import { compactObject, asObject, asString, GenericObjectSchema } from '../util';

export function milestoneTools() {
  return [
    defineTool({
      name: 'linear_list_milestones',
      label: 'Linear List Milestones',
      description: 'List project milestones. Supports full projectMilestones query args.',
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
            first: params.first ?? 20,
            includeArchived: params.includeArchived,
            last: params.last,
            orderBy: params.orderBy,
          });

          const data = await linearGraphQL<{
            projectMilestones: { nodes: Array<JsonObject> };
          }>(
            apiKey,
            `query ListMilestones(
              $after: String
              $before: String
              $filter: ProjectMilestoneFilter
              $first: Int
              $includeArchived: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
            ) {
              projectMilestones(
                after: $after
                before: $before
                filter: $filter
                first: $first
                includeArchived: $includeArchived
                last: $last
                orderBy: $orderBy
              ) {
                nodes {
                  ${MILESTONE_SELECTION}
                }
              }
            }`,
            variables,
            signal,
          );

          const milestones = data.projectMilestones.nodes;
          return {
            content: [{ type: 'text', text: JSON.stringify({ milestones }, null, 2) }],
            details: { milestones },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_get_milestone',
      label: 'Linear Get Milestone',
      description: 'Get a specific project milestone by id.',
      parameters: Type.Object({
        milestoneId: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            projectMilestone: JsonObject | null;
          }>(
            apiKey,
            `query GetMilestone($id: String!) {
              projectMilestone(id: $id) {
                ${MILESTONE_SELECTION}
              }
            }`,
            { id: params.milestoneId },
            signal,
          );

          const milestone = data.projectMilestone;
          return {
            content: [
              { type: 'text', text: JSON.stringify({ milestone: milestone ?? null }, null, 2) },
            ],
            details: { milestone: milestone ?? null },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_save_milestone',
      label: 'Linear Save Milestone',
      description:
        'Create or update a project milestone. If milestoneId is provided, uses projectMilestoneUpdate; otherwise uses projectMilestoneCreate.',
      parameters: Type.Object({
        milestoneId: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        descriptionData: Type.Optional(GenericObjectSchema),
        id: Type.Optional(Type.String()),
        name: Type.Optional(Type.String()),
        projectId: Type.Optional(Type.String()),
        sortOrder: Type.Optional(Type.Number()),
        targetDate: Type.Optional(Type.String()),
        ...RawInputParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const rawInput = asObject(params.input) || {};
          const updateId = asString(params.milestoneId);

          const input = {
            ...rawInput,
            ...compactObject({
              description: params.description,
              descriptionData: asObject(params.descriptionData),
              id: params.id,
              name: params.name,
              projectId: params.projectId,
              sortOrder: params.sortOrder,
              targetDate: params.targetDate,
            }),
          };

          if (updateId) {
            if (Object.keys(input).length === 0) {
              throw new Error('No milestone update fields were provided.');
            }

            const data = await linearGraphQL<{
              projectMilestoneUpdate: {
                success: boolean;
                projectMilestone?: JsonObject | null;
              };
            }>(
              apiKey,
              `mutation UpdateMilestone($id: String!, $input: ProjectMilestoneUpdateInput!) {
                projectMilestoneUpdate(id: $id, input: $input) {
                  success
                  projectMilestone {
                    ${MILESTONE_SELECTION}
                  }
                }
              }`,
              { id: updateId, input },
              signal,
            );

            if (
              !data.projectMilestoneUpdate.success ||
              !data.projectMilestoneUpdate.projectMilestone
            ) {
              throw new Error('Linear projectMilestoneUpdate did not succeed.');
            }

            const milestone = data.projectMilestoneUpdate.projectMilestone;
            return {
              content: [{ type: 'text', text: JSON.stringify({ milestone }, null, 2) }],
              details: { milestone },
            };
          }

          if (!asString(input.name)) {
            throw new Error('Milestone name is required for projectMilestoneCreate (name).');
          }

          if (!asString(input.projectId)) {
            throw new Error('projectId is required for projectMilestoneCreate.');
          }

          const data = await linearGraphQL<{
            projectMilestoneCreate: {
              success: boolean;
              projectMilestone?: JsonObject | null;
            };
          }>(
            apiKey,
            `mutation CreateMilestone($input: ProjectMilestoneCreateInput!) {
              projectMilestoneCreate(input: $input) {
                success
                projectMilestone {
                  ${MILESTONE_SELECTION}
                }
              }
            }`,
            { input },
            signal,
          );

          if (
            !data.projectMilestoneCreate.success ||
            !data.projectMilestoneCreate.projectMilestone
          ) {
            throw new Error('Linear projectMilestoneCreate did not succeed.');
          }

          const milestone = data.projectMilestoneCreate.projectMilestone;
          return {
            content: [{ type: 'text', text: JSON.stringify({ milestone }, null, 2) }],
            details: { milestone },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_delete_milestone',
      label: 'Linear Delete Milestone',
      description: 'Delete a project milestone by id.',
      parameters: Type.Object({
        milestoneId: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            projectMilestoneDelete: { success: boolean };
          }>(
            apiKey,
            `mutation DeleteMilestone($id: String!) {
              projectMilestoneDelete(id: $id) {
                success
              }
            }`,
            { id: params.milestoneId },
            signal,
          );

          if (!data.projectMilestoneDelete.success) {
            throw new Error('Linear projectMilestoneDelete did not succeed.');
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
