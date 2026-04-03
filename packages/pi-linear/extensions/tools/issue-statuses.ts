import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { withLinearAuth, linearGraphQL } from '../client';
import { PaginationParams, FilterParam } from '../params';
import { WORKFLOW_STATE_SELECTION } from '../selections';
import type { JsonObject } from '../types';
import { compactObject, asObject } from '../util';

export function issueStatusTools() {
  return [
    defineTool({
      name: 'linear_list_issue_statuses',
      label: 'Linear List Issue Statuses',
      description:
        'List workflow states (issue statuses). Supports full workflowStates query args.',
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
            workflowStates: { nodes: Array<JsonObject> };
          }>(
            apiKey,
            `query ListIssueStatuses(
              $after: String
              $before: String
              $filter: WorkflowStateFilter
              $first: Int
              $includeArchived: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
            ) {
              workflowStates(
                after: $after
                before: $before
                filter: $filter
                first: $first
                includeArchived: $includeArchived
                last: $last
                orderBy: $orderBy
              ) {
                nodes {
                  ${WORKFLOW_STATE_SELECTION}
                }
              }
            }`,
            variables,
            signal,
          );

          const states = data.workflowStates.nodes;
          return {
            content: [{ type: 'text', text: JSON.stringify({ states }, null, 2) }],
            details: { states },
          };
        });
      },
    }),
  ];
}
