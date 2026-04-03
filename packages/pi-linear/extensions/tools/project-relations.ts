import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { withLinearAuth, linearGraphQL } from '../client';
import { PaginationParams } from '../params';
import { PROJECT_RELATION_SELECTION } from '../selections';
import type { JsonObject } from '../types';
import { compactObject } from '../util';

export function projectRelationTools() {
  return [
    defineTool({
      name: 'linear_list_project_relations',
      label: 'Linear List Project Relations',
      description: 'List project relations. Supports pagination.',
      parameters: Type.Object({
        ...PaginationParams,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const variables = compactObject({
            after: params.after,
            before: params.before,
            first: params.first ?? 20,
            includeArchived: params.includeArchived,
            last: params.last,
            orderBy: params.orderBy,
          });

          const data = await linearGraphQL<{
            projectRelations: { nodes: Array<JsonObject> };
          }>(
            apiKey,
            `query ListProjectRelations(
              $after: String
              $before: String
              $first: Int
              $includeArchived: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
            ) {
              projectRelations(
                after: $after
                before: $before
                first: $first
                includeArchived: $includeArchived
                last: $last
                orderBy: $orderBy
              ) {
                nodes {
                  ${PROJECT_RELATION_SELECTION}
                }
              }
            }`,
            variables,
            signal,
          );

          const projectRelations = data.projectRelations.nodes;
          return {
            content: [{ type: 'text', text: JSON.stringify({ projectRelations }, null, 2) }],
            details: { projectRelations },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_create_project_relation',
      label: 'Linear Create Project Relation',
      description: 'Create a relation between two projects.',
      parameters: Type.Object({
        projectId: Type.String(),
        relatedProjectId: Type.String(),
        type: Type.String({ description: 'Relation type.' }),
        anchorType: Type.String({ description: 'Anchor type for the project.' }),
        relatedAnchorType: Type.String({
          description: 'Anchor type for the related project.',
        }),
        projectMilestoneId: Type.Optional(Type.String()),
        relatedProjectMilestoneId: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const input = compactObject({
            projectId: params.projectId,
            relatedProjectId: params.relatedProjectId,
            type: params.type,
            anchorType: params.anchorType,
            relatedAnchorType: params.relatedAnchorType,
            projectMilestoneId: params.projectMilestoneId,
            relatedProjectMilestoneId: params.relatedProjectMilestoneId,
          });

          const data = await linearGraphQL<{
            projectRelationCreate: {
              success: boolean;
              projectRelation?: JsonObject | null;
            };
          }>(
            apiKey,
            `mutation CreateProjectRelation($input: ProjectRelationCreateInput!) {
              projectRelationCreate(input: $input) {
                success
                projectRelation {
                  ${PROJECT_RELATION_SELECTION}
                }
              }
            }`,
            { input },
            signal,
          );

          const projectRelation = data.projectRelationCreate.projectRelation;
          if (!data.projectRelationCreate.success || !projectRelation) {
            throw new Error('Linear projectRelationCreate did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ projectRelation }, null, 2) }],
            details: { projectRelation },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_update_project_relation',
      label: 'Linear Update Project Relation',
      description: 'Update a project relation by id.',
      parameters: Type.Object({
        id: Type.String(),
        type: Type.Optional(Type.String()),
        projectId: Type.Optional(Type.String()),
        relatedProjectId: Type.Optional(Type.String()),
        anchorType: Type.Optional(Type.String()),
        relatedAnchorType: Type.Optional(Type.String()),
        projectMilestoneId: Type.Optional(Type.String()),
        relatedProjectMilestoneId: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const input = compactObject({
            type: params.type,
            projectId: params.projectId,
            relatedProjectId: params.relatedProjectId,
            anchorType: params.anchorType,
            relatedAnchorType: params.relatedAnchorType,
            projectMilestoneId: params.projectMilestoneId,
            relatedProjectMilestoneId: params.relatedProjectMilestoneId,
          });

          if (Object.keys(input).length === 0) {
            throw new Error('No update fields were provided.');
          }

          const data = await linearGraphQL<{
            projectRelationUpdate: {
              success: boolean;
              projectRelation?: JsonObject | null;
            };
          }>(
            apiKey,
            `mutation UpdateProjectRelation($id: String!, $input: ProjectRelationUpdateInput!) {
              projectRelationUpdate(id: $id, input: $input) {
                success
                projectRelation {
                  ${PROJECT_RELATION_SELECTION}
                }
              }
            }`,
            { id: params.id, input },
            signal,
          );

          const projectRelation = data.projectRelationUpdate.projectRelation;
          if (!data.projectRelationUpdate.success || !projectRelation) {
            throw new Error('Linear projectRelationUpdate did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ projectRelation }, null, 2) }],
            details: { projectRelation },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_delete_project_relation',
      label: 'Linear Delete Project Relation',
      description: 'Delete a project relation by id.',
      parameters: Type.Object({
        id: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            projectRelationDelete: { success: boolean };
          }>(
            apiKey,
            `mutation DeleteProjectRelation($id: String!) {
              projectRelationDelete(id: $id) {
                success
              }
            }`,
            { id: params.id },
            signal,
          );

          if (!data.projectRelationDelete.success) {
            throw new Error('Linear projectRelationDelete did not succeed.');
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
