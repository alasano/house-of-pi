import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { withLinearAuth, linearGraphQL } from '../client';
import { PaginationParams } from '../params';
import { ISSUE_RELATION_SELECTION } from '../selections';
import type { JsonObject } from '../types';
import { compactObject } from '../util';

export function issueRelationTools() {
  return [
    defineTool({
      name: 'linear_list_issue_relations',
      label: 'Linear List Issue Relations',
      description: 'List issue relations. Supports pagination.',
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
            issueRelations: { nodes: Array<JsonObject> };
          }>(
            apiKey,
            `query ListIssueRelations(
              $after: String
              $before: String
              $first: Int
              $includeArchived: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
            ) {
              issueRelations(
                after: $after
                before: $before
                first: $first
                includeArchived: $includeArchived
                last: $last
                orderBy: $orderBy
              ) {
                nodes {
                  ${ISSUE_RELATION_SELECTION}
                }
              }
            }`,
            variables,
            signal,
          );

          const issueRelations = data.issueRelations.nodes;
          return {
            content: [{ type: 'text', text: JSON.stringify({ issueRelations }, null, 2) }],
            details: { issueRelations },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_create_issue_relation',
      label: 'Linear Create Issue Relation',
      description: 'Create a relation between two issues.',
      parameters: Type.Object({
        issueId: Type.String({
          description: 'Issue identifier (e.g. ENG-123) or UUID.',
        }),
        relatedIssueId: Type.String({
          description: 'Related issue identifier (e.g. ENG-456) or UUID.',
        }),
        type: Type.String({
          description: 'Relation type: blocks, duplicate, related, or similar.',
        }),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const input = {
            issueId: params.issueId,
            relatedIssueId: params.relatedIssueId,
            type: params.type,
          };

          const data = await linearGraphQL<{
            issueRelationCreate: {
              success: boolean;
              issueRelation?: JsonObject | null;
            };
          }>(
            apiKey,
            `mutation CreateIssueRelation($input: IssueRelationCreateInput!) {
              issueRelationCreate(input: $input) {
                success
                issueRelation {
                  ${ISSUE_RELATION_SELECTION}
                }
              }
            }`,
            { input },
            signal,
          );

          const issueRelation = data.issueRelationCreate.issueRelation;
          if (!data.issueRelationCreate.success || !issueRelation) {
            throw new Error('Linear issueRelationCreate did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ issueRelation }, null, 2) }],
            details: { issueRelation },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_update_issue_relation',
      label: 'Linear Update Issue Relation',
      description: 'Update an issue relation by id.',
      parameters: Type.Object({
        id: Type.String(),
        type: Type.Optional(Type.String()),
        issueId: Type.Optional(Type.String()),
        relatedIssueId: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const input = compactObject({
            type: params.type,
            issueId: params.issueId,
            relatedIssueId: params.relatedIssueId,
          });

          if (Object.keys(input).length === 0) {
            throw new Error('No update fields were provided.');
          }

          const data = await linearGraphQL<{
            issueRelationUpdate: {
              success: boolean;
              issueRelation?: JsonObject | null;
            };
          }>(
            apiKey,
            `mutation UpdateIssueRelation($id: String!, $input: IssueRelationUpdateInput!) {
              issueRelationUpdate(id: $id, input: $input) {
                success
                issueRelation {
                  ${ISSUE_RELATION_SELECTION}
                }
              }
            }`,
            { id: params.id, input },
            signal,
          );

          const issueRelation = data.issueRelationUpdate.issueRelation;
          if (!data.issueRelationUpdate.success || !issueRelation) {
            throw new Error('Linear issueRelationUpdate did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ issueRelation }, null, 2) }],
            details: { issueRelation },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_delete_issue_relation',
      label: 'Linear Delete Issue Relation',
      description: 'Delete an issue relation by id.',
      parameters: Type.Object({
        id: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            issueRelationDelete: { success: boolean };
          }>(
            apiKey,
            `mutation DeleteIssueRelation($id: String!) {
              issueRelationDelete(id: $id) {
                success
              }
            }`,
            { id: params.id },
            signal,
          );

          if (!data.issueRelationDelete.success) {
            throw new Error('Linear issueRelationDelete did not succeed.');
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
