import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { withLinearAuth, linearGraphQL } from '../client';
import { PaginationParams, FilterParam, RawInputParam } from '../params';
import { PROJECT_LABEL_SELECTION } from '../selections';
import type { JsonObject } from '../types';
import { compactObject, asObject, asString } from '../util';

export function projectLabelTools() {
  return [
    defineTool({
      name: 'linear_list_project_labels',
      label: 'Linear List Project Labels',
      description: 'List project labels. Supports full projectLabels query args.',
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
            first: params.first ?? 50,
            includeArchived: params.includeArchived,
            last: params.last,
            orderBy: params.orderBy,
          });

          const data = await linearGraphQL<{
            projectLabels: { nodes: Array<JsonObject> };
          }>(
            apiKey,
            `query ListProjectLabels(
              $after: String
              $before: String
              $filter: ProjectLabelFilter
              $first: Int
              $includeArchived: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
            ) {
              projectLabels(
                after: $after
                before: $before
                filter: $filter
                first: $first
                includeArchived: $includeArchived
                last: $last
                orderBy: $orderBy
              ) {
                nodes {
                  ${PROJECT_LABEL_SELECTION}
                }
              }
            }`,
            variables,
            signal,
          );

          const labels = data.projectLabels.nodes;
          return {
            content: [{ type: 'text', text: JSON.stringify({ labels }, null, 2) }],
            details: { labels },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_create_project_label',
      label: 'Linear Create Project Label',
      description: 'Create a project label.',
      parameters: Type.Object({
        name: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        color: Type.Optional(Type.String()),
        parentId: Type.Optional(Type.String()),
        isGroup: Type.Optional(Type.Boolean()),
        ...RawInputParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const rawInput = asObject(params.input) || {};
          const input = {
            ...rawInput,
            ...compactObject({
              name: params.name,
              description: params.description,
              color: params.color,
              parentId: params.parentId,
              isGroup: params.isGroup,
            }),
          };

          if (!asString(input.name)) {
            throw new Error('Project label name is required (name).');
          }

          const data = await linearGraphQL<{
            projectLabelCreate: {
              success: boolean;
              projectLabel?: JsonObject | null;
            };
          }>(
            apiKey,
            `mutation CreateProjectLabel($input: ProjectLabelCreateInput!) {
              projectLabelCreate(input: $input) {
                success
                projectLabel {
                  ${PROJECT_LABEL_SELECTION}
                }
              }
            }`,
            { input },
            signal,
          );

          const label = data.projectLabelCreate.projectLabel;
          if (!data.projectLabelCreate.success || !label) {
            throw new Error('Linear projectLabelCreate did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ label }, null, 2) }],
            details: { label },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_update_project_label',
      label: 'Linear Update Project Label',
      description: 'Update a project label by id.',
      parameters: Type.Object({
        id: Type.String(),
        name: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        color: Type.Optional(Type.String()),
        parentId: Type.Optional(Type.String()),
        isGroup: Type.Optional(Type.Boolean()),
        ...RawInputParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const rawInput = asObject(params.input) || {};
          const input = {
            ...rawInput,
            ...compactObject({
              name: params.name,
              description: params.description,
              color: params.color,
              parentId: params.parentId,
              isGroup: params.isGroup,
            }),
          };

          if (Object.keys(input).length === 0) {
            throw new Error('No update fields were provided.');
          }

          const data = await linearGraphQL<{
            projectLabelUpdate: {
              success: boolean;
              projectLabel?: JsonObject | null;
            };
          }>(
            apiKey,
            `mutation UpdateProjectLabel($id: String!, $input: ProjectLabelUpdateInput!) {
              projectLabelUpdate(id: $id, input: $input) {
                success
                projectLabel {
                  ${PROJECT_LABEL_SELECTION}
                }
              }
            }`,
            { id: params.id, input },
            signal,
          );

          const label = data.projectLabelUpdate.projectLabel;
          if (!data.projectLabelUpdate.success || !label) {
            throw new Error('Linear projectLabelUpdate did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ label }, null, 2) }],
            details: { label },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_delete_project_label',
      label: 'Linear Delete Project Label',
      description: 'Delete a project label by id.',
      parameters: Type.Object({
        id: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            projectLabelDelete: { success: boolean };
          }>(
            apiKey,
            `mutation DeleteProjectLabel($id: String!) {
              projectLabelDelete(id: $id) {
                success
              }
            }`,
            { id: params.id },
            signal,
          );

          if (!data.projectLabelDelete.success) {
            throw new Error('Linear projectLabelDelete did not succeed.');
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
