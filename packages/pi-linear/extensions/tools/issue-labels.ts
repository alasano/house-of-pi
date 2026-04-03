import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { withLinearAuth, linearGraphQL, resolveTeamId } from '../client';
import { PaginationParams, FilterParam, RawInputParam, TeamConvenienceParams } from '../params';
import { ISSUE_LABEL_SELECTION } from '../selections';
import type { JsonObject } from '../types';
import { compactObject, asObject, asString, mergeFilters } from '../util';

export function issueLabelTools() {
  return [
    defineTool({
      name: 'linear_list_issue_labels',
      label: 'Linear List Issue Labels',
      description: 'List issue labels. Supports full issueLabels query args.',
      parameters: Type.Object({
        ...TeamConvenienceParams,
        ...PaginationParams,
        ...FilterParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const resolvedTeamId =
            params.teamId || params.teamKey
              ? await resolveTeamId(
                  apiKey,
                  { teamId: params.teamId, teamKey: params.teamKey },
                  signal,
                )
              : undefined;

          const convenienceFilter = resolvedTeamId
            ? ({ team: { id: { eq: resolvedTeamId } } } as JsonObject)
            : undefined;

          const filter = mergeFilters(asObject(params.filter), convenienceFilter);

          const variables = compactObject({
            after: params.after,
            before: params.before,
            filter,
            first: params.first ?? 50,
            includeArchived: params.includeArchived,
            last: params.last,
            orderBy: params.orderBy,
          });

          const data = await linearGraphQL<{
            issueLabels: { nodes: Array<JsonObject> };
          }>(
            apiKey,
            `query ListIssueLabels(
              $after: String
              $before: String
              $filter: IssueLabelFilter
              $first: Int
              $includeArchived: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
            ) {
              issueLabels(
                after: $after
                before: $before
                filter: $filter
                first: $first
                includeArchived: $includeArchived
                last: $last
                orderBy: $orderBy
              ) {
                nodes {
                  ${ISSUE_LABEL_SELECTION}
                }
              }
            }`,
            variables,
            signal,
          );

          const labels = data.issueLabels.nodes;
          return {
            content: [{ type: 'text', text: JSON.stringify({ labels }, null, 2) }],
            details: { labels },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_create_issue_label',
      label: 'Linear Create Issue Label',
      description:
        'Create an issue label via issueLabelCreate. Supports top-level fields and raw input.',
      parameters: Type.Object({
        name: Type.Optional(Type.String()),
        color: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        id: Type.Optional(Type.String()),
        isGroup: Type.Optional(Type.Boolean()),
        parentId: Type.Optional(Type.String()),
        retiredAt: Type.Optional(Type.String()),
        ...TeamConvenienceParams,
        replaceTeamLabels: Type.Optional(Type.Boolean()),
        ...RawInputParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const rawInput = asObject(params.input) || {};
          const teamId =
            params.teamId || params.teamKey || asString(rawInput.teamId)
              ? await resolveTeamId(
                  apiKey,
                  {
                    teamId: params.teamId || asString(rawInput.teamId),
                    teamKey: params.teamKey,
                  },
                  signal,
                )
              : undefined;

          const input = {
            ...rawInput,
            ...compactObject({
              name: params.name,
              color: params.color,
              description: params.description,
              id: params.id,
              isGroup: params.isGroup,
              parentId: params.parentId,
              retiredAt: params.retiredAt,
              teamId,
            }),
          };

          if (!asString(input.name)) {
            throw new Error('Issue label name is required (name).');
          }

          const data = await linearGraphQL<{
            issueLabelCreate: {
              success: boolean;
              issueLabel?: JsonObject | null;
            };
          }>(
            apiKey,
            `mutation CreateIssueLabel($input: IssueLabelCreateInput!, $replaceTeamLabels: Boolean) {
              issueLabelCreate(input: $input, replaceTeamLabels: $replaceTeamLabels) {
                success
                issueLabel {
                  ${ISSUE_LABEL_SELECTION}
                }
              }
            }`,
            {
              input,
              replaceTeamLabels: params.replaceTeamLabels,
            },
            signal,
          );

          const label = data.issueLabelCreate.issueLabel;
          if (!data.issueLabelCreate.success || !label) {
            throw new Error('Linear issueLabelCreate did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ label }, null, 2) }],
            details: { label },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_update_issue_label',
      label: 'Linear Update Issue Label',
      description: 'Update an issue label by id.',
      parameters: Type.Object({
        id: Type.String(),
        name: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        color: Type.Optional(Type.String()),
        parentId: Type.Optional(Type.String()),
        isGroup: Type.Optional(Type.Boolean()),
        retiredAt: Type.Optional(Type.String()),
        replaceTeamLabels: Type.Optional(Type.Boolean()),
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
              retiredAt: params.retiredAt,
            }),
          };

          if (Object.keys(input).length === 0) {
            throw new Error('No update fields were provided.');
          }

          const data = await linearGraphQL<{
            issueLabelUpdate: {
              success: boolean;
              issueLabel?: JsonObject | null;
            };
          }>(
            apiKey,
            `mutation UpdateIssueLabel($id: String!, $input: IssueLabelUpdateInput!, $replaceTeamLabels: Boolean) {
              issueLabelUpdate(id: $id, input: $input, replaceTeamLabels: $replaceTeamLabels) {
                success
                issueLabel {
                  ${ISSUE_LABEL_SELECTION}
                }
              }
            }`,
            {
              id: params.id,
              input,
              replaceTeamLabels: params.replaceTeamLabels,
            },
            signal,
          );

          const label = data.issueLabelUpdate.issueLabel;
          if (!data.issueLabelUpdate.success || !label) {
            throw new Error('Linear issueLabelUpdate did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ label }, null, 2) }],
            details: { label },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_delete_issue_label',
      label: 'Linear Delete Issue Label',
      description: 'Delete an issue label by id.',
      parameters: Type.Object({
        id: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            issueLabelDelete: { success: boolean };
          }>(
            apiKey,
            `mutation DeleteIssueLabel($id: String!) {
              issueLabelDelete(id: $id) {
                success
              }
            }`,
            { id: params.id },
            signal,
          );

          if (!data.issueLabelDelete.success) {
            throw new Error('Linear issueLabelDelete did not succeed.');
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
