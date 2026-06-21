import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { withLinearAuth, linearGraphQL, resolveIssueId } from '../client';
import { PaginationParams, paginationVariables } from '../params';
import { ISSUE_RELATION_SELECTION } from '../selections';
import type { JsonObject, LinearConnection } from '../types';
import { compactObject } from '../util';
import {
  renderLinearCreateIssueRelationCall,
  renderLinearDeleteIssueRelationCall,
  renderLinearDeleteIssueRelationResult,
  renderLinearIssueRelationListCall,
  renderLinearIssueRelationListResult,
  renderLinearIssueRelationResult,
  renderLinearUpdateIssueRelationCall,
} from '../renderers/issue-relations';

export function issueRelationTools() {
  return [
    defineTool({
      name: 'linear_list_issue_relations',
      label: 'Linear List Issue Relations',
      description: 'List issue relations. Supports pagination.',
      parameters: Type.Object({
        ...PaginationParams,
      }),
      renderCall: renderLinearIssueRelationListCall,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const variables = paginationVariables(params, 20);

          const data = await linearGraphQL<{
            issueRelations: LinearConnection<JsonObject>;
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

          const issueRelations = data.issueRelations.nodes;
          const pageInfo = data.issueRelations.pageInfo;
          return {
            content: [
              { type: 'text', text: JSON.stringify({ issueRelations, pageInfo }, null, 2) },
            ],
            details: { issueRelations, pageInfo },
          };
        });
      },
      renderResult: renderLinearIssueRelationListResult,
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
      renderCall: renderLinearCreateIssueRelationCall,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const input = {
            issueId: await resolveIssueId(apiKey, params.issueId, signal),
            relatedIssueId: await resolveIssueId(apiKey, params.relatedIssueId, signal),
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
      renderResult: renderLinearIssueRelationResult('Created issue relation'),
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
      renderCall: renderLinearUpdateIssueRelationCall,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const [resolvedIssueId, resolvedRelatedIssueId] = await Promise.all([
            params.issueId ? resolveIssueId(apiKey, params.issueId, signal) : undefined,
            params.relatedIssueId
              ? resolveIssueId(apiKey, params.relatedIssueId, signal)
              : undefined,
          ]);

          const input = compactObject({
            type: params.type,
            issueId: resolvedIssueId,
            relatedIssueId: resolvedRelatedIssueId,
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
      renderResult: renderLinearIssueRelationResult('Updated issue relation'),
    }),
    defineTool({
      name: 'linear_delete_issue_relation',
      label: 'Linear Delete Issue Relation',
      description: 'Delete an issue relation by id.',
      parameters: Type.Object({
        id: Type.String(),
      }),
      renderCall: renderLinearDeleteIssueRelationCall,
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
      renderResult: renderLinearDeleteIssueRelationResult,
    }),
  ];
}
