import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import {
  withLinearAuth,
  linearGraphQL,
  resolveIssueId,
  resolveTeamId,
  fetchIssueByIdentifier,
} from '../client';
import {
  PaginationParams,
  FilterParam,
  SortParam,
  TeamConvenienceParams,
  RawInputParam,
} from '../params';
import { ISSUE_SELECTION } from '../selections';
import type { LinearIssue, JsonObject } from '../types';
import { compactObject, asObject, asObjectArray, asString, mergeFilters } from '../util';

export function issueTools() {
  return [
    defineTool({
      name: 'linear_list_issues',
      label: 'Linear List Issues',
      description:
        'List Linear issues. Supports full issues query args (after, before, filter, first, includeArchived, last, orderBy, sort) and convenience filters (query, teamKey, teamId, stateName, assigneeId).',
      parameters: Type.Object({
        query: Type.Optional(
          Type.String({
            description: 'Convenience filter: title contains this text (containsIgnoreCase).',
          }),
        ),
        stateName: Type.Optional(
          Type.String({
            description: 'Convenience filter: state name equals this value.',
          }),
        ),
        assigneeId: Type.Optional(
          Type.String({
            description: 'Convenience filter: assignee id equals this value.',
          }),
        ),
        ...TeamConvenienceParams,
        ...PaginationParams,
        ...FilterParam,
        ...SortParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const convenienceFilter = compactObject({
            title: params.query ? { containsIgnoreCase: params.query } : undefined,
            team: params.teamKey
              ? { key: { eq: params.teamKey } }
              : params.teamId
                ? { id: { eq: params.teamId } }
                : undefined,
            state: params.stateName ? { name: { eq: params.stateName } } : undefined,
            assignee: params.assigneeId ? { id: { eq: params.assigneeId } } : undefined,
          }) as JsonObject;

          const filter = mergeFilters(
            asObject(params.filter),
            Object.keys(convenienceFilter).length ? convenienceFilter : undefined,
          );

          const variables = compactObject({
            after: params.after,
            before: params.before,
            filter,
            first: params.first ?? 20,
            includeArchived: params.includeArchived,
            last: params.last,
            orderBy: params.orderBy,
            sort: asObjectArray(params.sort),
          });

          const data = await linearGraphQL<{ issues: { nodes: LinearIssue[] } }>(
            apiKey,
            `query ListIssues(
              $after: String
              $before: String
              $filter: IssueFilter
              $first: Int
              $includeArchived: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
              $sort: [IssueSortInput!]
            ) {
              issues(
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
                  ${ISSUE_SELECTION}
                }
              }
            }`,
            variables,
            signal,
          );

          const issues = data.issues.nodes;
          return {
            content: [{ type: 'text', text: JSON.stringify({ issues }, null, 2) }],
            details: { issues },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_get_issue',
      label: 'Linear Get Issue',
      description: 'Get full details for a Linear issue by identifier (e.g. ENG-123) or issue id.',
      parameters: Type.Object({
        issue: Type.String({
          description: 'Issue identifier (ENG-123) or issue id.',
        }),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const issueRef = params.issue.trim();
          const identifierIssue = await fetchIssueByIdentifier(apiKey, issueRef, signal);

          const issue =
            identifierIssue ||
            (
              await linearGraphQL<{ issue: LinearIssue | null }>(
                apiKey,
                `query GetIssueById($id: String!) {
                  issue(id: $id) {
                    ${ISSUE_SELECTION}
                  }
                }`,
                { id: issueRef },
                signal,
              )
            ).issue;

          return {
            content: [{ type: 'text', text: JSON.stringify({ issue: issue ?? null }, null, 2) }],
            details: { issue: issue ?? null },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_create_issue',
      label: 'Linear Create Issue',
      description:
        'Create a Linear issue. Supports all IssueCreateInput fields via top-level params and/or input object. Provide teamId or teamKey (or teamId inside input).',
      parameters: Type.Object({
        ...TeamConvenienceParams,
        title: Type.Optional(Type.String({ description: 'Issue title.' })),
        description: Type.Optional(Type.String({ description: 'Issue description in markdown.' })),
        assigneeId: Type.Optional(Type.String({ description: 'IssueCreateInput.assigneeId' })),
        completedAt: Type.Optional(Type.String({ description: 'IssueCreateInput.completedAt' })),
        createAsUser: Type.Optional(Type.String({ description: 'IssueCreateInput.createAsUser' })),
        createdAt: Type.Optional(Type.String({ description: 'IssueCreateInput.createdAt' })),
        cycleId: Type.Optional(Type.String({ description: 'IssueCreateInput.cycleId' })),
        delegateId: Type.Optional(Type.String({ description: 'IssueCreateInput.delegateId' })),
        descriptionData: Type.Optional(Type.Record(Type.String(), Type.Any())),
        displayIconUrl: Type.Optional(
          Type.String({ description: 'IssueCreateInput.displayIconUrl' }),
        ),
        dueDate: Type.Optional(
          Type.String({ description: 'IssueCreateInput.dueDate (YYYY-MM-DD)' }),
        ),
        estimate: Type.Optional(Type.Integer({ description: 'IssueCreateInput.estimate' })),
        id: Type.Optional(Type.String({ description: 'IssueCreateInput.id' })),
        labelIds: Type.Optional(
          Type.Array(Type.String(), { description: 'IssueCreateInput.labelIds' }),
        ),
        lastAppliedTemplateId: Type.Optional(
          Type.String({ description: 'IssueCreateInput.lastAppliedTemplateId' }),
        ),
        parentId: Type.Optional(Type.String({ description: 'IssueCreateInput.parentId' })),
        preserveSortOrderOnCreate: Type.Optional(
          Type.Boolean({
            description: 'IssueCreateInput.preserveSortOrderOnCreate',
          }),
        ),
        priority: Type.Optional(
          Type.Number({
            minimum: 0,
            maximum: 4,
            description: 'IssueCreateInput.priority (0 none, 1 urgent, 2 high, 3 normal, 4 low).',
          }),
        ),
        prioritySortOrder: Type.Optional(
          Type.Number({ description: 'IssueCreateInput.prioritySortOrder' }),
        ),
        projectId: Type.Optional(Type.String({ description: 'IssueCreateInput.projectId' })),
        projectMilestoneId: Type.Optional(
          Type.String({ description: 'IssueCreateInput.projectMilestoneId' }),
        ),
        referenceCommentId: Type.Optional(
          Type.String({ description: 'IssueCreateInput.referenceCommentId' }),
        ),
        slaBreachesAt: Type.Optional(
          Type.String({ description: 'IssueCreateInput.slaBreachesAt' }),
        ),
        slaStartedAt: Type.Optional(Type.String({ description: 'IssueCreateInput.slaStartedAt' })),
        slaType: Type.Optional(Type.String({ description: 'IssueCreateInput.slaType' })),
        sortOrder: Type.Optional(Type.Number({ description: 'IssueCreateInput.sortOrder' })),
        sourceCommentId: Type.Optional(
          Type.String({ description: 'IssueCreateInput.sourceCommentId' }),
        ),
        sourcePullRequestCommentId: Type.Optional(
          Type.String({
            description: 'IssueCreateInput.sourcePullRequestCommentId',
          }),
        ),
        stateId: Type.Optional(Type.String({ description: 'IssueCreateInput.stateId' })),
        subIssueSortOrder: Type.Optional(
          Type.Number({ description: 'IssueCreateInput.subIssueSortOrder' }),
        ),
        subscriberIds: Type.Optional(
          Type.Array(Type.String(), {
            description: 'IssueCreateInput.subscriberIds',
          }),
        ),
        templateId: Type.Optional(Type.String({ description: 'IssueCreateInput.templateId' })),
        useDefaultTemplate: Type.Optional(
          Type.Boolean({ description: 'IssueCreateInput.useDefaultTemplate' }),
        ),
        ...RawInputParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const rawInput = asObject(params.input) || {};
          const rawInputTeamId = asString(rawInput.teamId);

          const teamId = await resolveTeamId(
            apiKey,
            {
              teamId: params.teamId || rawInputTeamId,
              teamKey: params.teamKey,
            },
            signal,
          );

          const convenienceInput = compactObject({
            assigneeId: params.assigneeId,
            completedAt: params.completedAt,
            createAsUser: params.createAsUser,
            createdAt: params.createdAt,
            cycleId: params.cycleId,
            delegateId: params.delegateId,
            description: params.description,
            descriptionData: asObject(params.descriptionData),
            displayIconUrl: params.displayIconUrl,
            dueDate: params.dueDate,
            estimate: params.estimate,
            id: params.id,
            labelIds: params.labelIds,
            lastAppliedTemplateId: params.lastAppliedTemplateId,
            parentId: params.parentId,
            preserveSortOrderOnCreate: params.preserveSortOrderOnCreate,
            priority: params.priority,
            prioritySortOrder: params.prioritySortOrder,
            projectId: params.projectId,
            projectMilestoneId: params.projectMilestoneId,
            referenceCommentId: params.referenceCommentId,
            slaBreachesAt: params.slaBreachesAt,
            slaStartedAt: params.slaStartedAt,
            slaType: params.slaType,
            sortOrder: params.sortOrder,
            sourceCommentId: params.sourceCommentId,
            sourcePullRequestCommentId: params.sourcePullRequestCommentId,
            stateId: params.stateId,
            subIssueSortOrder: params.subIssueSortOrder,
            subscriberIds: params.subscriberIds,
            teamId,
            templateId: params.templateId,
            title: params.title,
            useDefaultTemplate: params.useDefaultTemplate,
          });

          const input = {
            ...rawInput,
            ...convenienceInput,
            teamId,
          };

          if (!asString(input.title)) {
            throw new Error('Issue title is required for issueCreate (title).');
          }

          const data = await linearGraphQL<{
            issueCreate: { success: boolean; issue?: LinearIssue | null };
          }>(
            apiKey,
            `mutation CreateIssue($input: IssueCreateInput!) {
              issueCreate(input: $input) {
                success
                issue {
                  ${ISSUE_SELECTION}
                }
              }
            }`,
            { input },
            signal,
          );

          if (!data.issueCreate.success || !data.issueCreate.issue) {
            throw new Error('Linear issueCreate did not succeed.');
          }

          const issue = data.issueCreate.issue;
          return {
            content: [{ type: 'text', text: JSON.stringify({ issue }, null, 2) }],
            details: { issue },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_update_issue',
      label: 'Linear Update Issue',
      description:
        'Update a Linear issue by identifier (ENG-123) or issue id. Supports all IssueUpdateInput fields via top-level params and/or input object. Use clearDueDate=true (or dueDate=null in input) to clear due date.',
      parameters: Type.Object({
        issue: Type.String({
          description: 'Issue identifier (ENG-123) or issue id.',
        }),
        title: Type.Optional(Type.String({ description: 'IssueUpdateInput.title' })),
        description: Type.Optional(Type.String({ description: 'IssueUpdateInput.description' })),
        priority: Type.Optional(
          Type.Number({
            minimum: 0,
            maximum: 4,
            description: 'IssueUpdateInput.priority (0 none, 1 urgent, 2 high, 3 normal, 4 low).',
          }),
        ),
        stateId: Type.Optional(Type.String({ description: 'IssueUpdateInput.stateId' })),
        assigneeId: Type.Optional(Type.String({ description: 'IssueUpdateInput.assigneeId' })),
        dueDate: Type.Optional(
          Type.String({
            description: 'IssueUpdateInput.dueDate (YYYY-MM-DD). Empty string clears.',
          }),
        ),
        clearDueDate: Type.Optional(
          Type.Boolean({ description: 'If true, dueDate is set to null.' }),
        ),
        addedLabelIds: Type.Optional(
          Type.Array(Type.String(), {
            description: 'IssueUpdateInput.addedLabelIds',
          }),
        ),
        autoClosedByParentClosing: Type.Optional(
          Type.Boolean({
            description: 'IssueUpdateInput.autoClosedByParentClosing',
          }),
        ),
        cycleId: Type.Optional(Type.String({ description: 'IssueUpdateInput.cycleId' })),
        delegateId: Type.Optional(Type.String({ description: 'IssueUpdateInput.delegateId' })),
        descriptionData: Type.Optional(Type.Record(Type.String(), Type.Any())),
        estimate: Type.Optional(Type.Integer({ description: 'IssueUpdateInput.estimate' })),
        labelIds: Type.Optional(
          Type.Array(Type.String(), { description: 'IssueUpdateInput.labelIds' }),
        ),
        lastAppliedTemplateId: Type.Optional(
          Type.String({ description: 'IssueUpdateInput.lastAppliedTemplateId' }),
        ),
        parentId: Type.Optional(Type.String({ description: 'IssueUpdateInput.parentId' })),
        prioritySortOrder: Type.Optional(
          Type.Number({ description: 'IssueUpdateInput.prioritySortOrder' }),
        ),
        projectId: Type.Optional(Type.String({ description: 'IssueUpdateInput.projectId' })),
        projectMilestoneId: Type.Optional(
          Type.String({ description: 'IssueUpdateInput.projectMilestoneId' }),
        ),
        removedLabelIds: Type.Optional(
          Type.Array(Type.String(), {
            description: 'IssueUpdateInput.removedLabelIds',
          }),
        ),
        slaBreachesAt: Type.Optional(
          Type.String({ description: 'IssueUpdateInput.slaBreachesAt' }),
        ),
        slaStartedAt: Type.Optional(Type.String({ description: 'IssueUpdateInput.slaStartedAt' })),
        slaType: Type.Optional(Type.String({ description: 'IssueUpdateInput.slaType' })),
        snoozedById: Type.Optional(Type.String({ description: 'IssueUpdateInput.snoozedById' })),
        snoozedUntilAt: Type.Optional(
          Type.String({ description: 'IssueUpdateInput.snoozedUntilAt' }),
        ),
        sortOrder: Type.Optional(Type.Number({ description: 'IssueUpdateInput.sortOrder' })),
        subIssueSortOrder: Type.Optional(
          Type.Number({ description: 'IssueUpdateInput.subIssueSortOrder' }),
        ),
        subscriberIds: Type.Optional(
          Type.Array(Type.String(), {
            description: 'IssueUpdateInput.subscriberIds',
          }),
        ),
        teamId: Type.Optional(Type.String({ description: 'IssueUpdateInput.teamId' })),
        trashed: Type.Optional(Type.Boolean({ description: 'IssueUpdateInput.trashed' })),
        ...RawInputParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const issueId = await resolveIssueId(apiKey, params.issue, signal);
          const rawInput = asObject(params.input) || {};

          const dueDate =
            params.clearDueDate || params.dueDate === ''
              ? null
              : params.dueDate !== undefined
                ? params.dueDate
                : undefined;

          const convenienceInput = compactObject({
            addedLabelIds: params.addedLabelIds,
            assigneeId: params.assigneeId,
            autoClosedByParentClosing: params.autoClosedByParentClosing,
            cycleId: params.cycleId,
            delegateId: params.delegateId,
            description: params.description,
            descriptionData: asObject(params.descriptionData),
            dueDate,
            estimate: params.estimate,
            labelIds: params.labelIds,
            lastAppliedTemplateId: params.lastAppliedTemplateId,
            parentId: params.parentId,
            priority: params.priority,
            prioritySortOrder: params.prioritySortOrder,
            projectId: params.projectId,
            projectMilestoneId: params.projectMilestoneId,
            removedLabelIds: params.removedLabelIds,
            slaBreachesAt: params.slaBreachesAt,
            slaStartedAt: params.slaStartedAt,
            slaType: params.slaType,
            snoozedById: params.snoozedById,
            snoozedUntilAt: params.snoozedUntilAt,
            sortOrder: params.sortOrder,
            stateId: params.stateId,
            subIssueSortOrder: params.subIssueSortOrder,
            subscriberIds: params.subscriberIds,
            teamId: params.teamId,
            title: params.title,
            trashed: params.trashed,
          });

          const input = {
            ...rawInput,
            ...convenienceInput,
          };

          if (Object.keys(input).length === 0) {
            throw new Error('No update fields were provided.');
          }

          const data = await linearGraphQL<{
            issueUpdate: { success: boolean; issue?: LinearIssue | null };
          }>(
            apiKey,
            `mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
              issueUpdate(id: $id, input: $input) {
                success
                issue {
                  ${ISSUE_SELECTION}
                }
              }
            }`,
            { id: issueId, input },
            signal,
          );

          if (!data.issueUpdate.success || !data.issueUpdate.issue) {
            throw new Error('Linear issueUpdate did not succeed.');
          }

          const issue = data.issueUpdate.issue;
          return {
            content: [{ type: 'text', text: JSON.stringify({ issue }, null, 2) }],
            details: { issue },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_delete_issue',
      label: 'Linear Delete Issue',
      description: 'Delete an issue by identifier (ENG-123) or id. Admins can permanently delete.',
      parameters: Type.Object({
        issue: Type.String({
          description: 'Issue identifier (ENG-123) or issue id.',
        }),
        permanentlyDelete: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const issueId = await resolveIssueId(apiKey, params.issue, signal);

          const data = await linearGraphQL<{
            issueDelete: { success: boolean };
          }>(
            apiKey,
            `mutation DeleteIssue($id: String!, $permanentlyDelete: Boolean) {
              issueDelete(id: $id, permanentlyDelete: $permanentlyDelete) {
                success
              }
            }`,
            { id: issueId, permanentlyDelete: params.permanentlyDelete },
            signal,
          );

          if (!data.issueDelete.success) {
            throw new Error('Linear issueDelete did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }],
            details: { success: true },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_archive_issue',
      label: 'Linear Archive Issue',
      description:
        'Archive an issue by identifier (ENG-123) or id. Use trash=true to trash instead.',
      parameters: Type.Object({
        issue: Type.String({
          description: 'Issue identifier (ENG-123) or issue id.',
        }),
        trash: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const issueId = await resolveIssueId(apiKey, params.issue, signal);

          const data = await linearGraphQL<{
            issueArchive: { success: boolean };
          }>(
            apiKey,
            `mutation ArchiveIssue($id: String!, $trash: Boolean) {
              issueArchive(id: $id, trash: $trash) {
                success
              }
            }`,
            { id: issueId, trash: params.trash },
            signal,
          );

          if (!data.issueArchive.success) {
            throw new Error('Linear issueArchive did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }],
            details: { success: true },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_unarchive_issue',
      label: 'Linear Unarchive Issue',
      description: 'Unarchive an issue by identifier (ENG-123) or id.',
      parameters: Type.Object({
        issue: Type.String({
          description: 'Issue identifier (ENG-123) or issue id.',
        }),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const issueId = await resolveIssueId(apiKey, params.issue, signal);

          const data = await linearGraphQL<{
            issueUnarchive: { success: boolean };
          }>(
            apiKey,
            `mutation UnarchiveIssue($id: String!) {
              issueUnarchive(id: $id) {
                success
              }
            }`,
            { id: issueId },
            signal,
          );

          if (!data.issueUnarchive.success) {
            throw new Error('Linear issueUnarchive did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }],
            details: { success: true },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_search_issues',
      label: 'Linear Search Issues',
      description: 'Search issues by text. Supports searching in comments and boosting by team.',
      parameters: Type.Object({
        term: Type.String({ description: 'Search text.' }),
        includeComments: Type.Optional(Type.Boolean({ description: 'Search in comments too.' })),
        teamId: Type.Optional(Type.String({ description: 'Team UUID to boost results for.' })),
        ...PaginationParams,
        ...FilterParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const variables = compactObject({
            term: params.term,
            includeComments: params.includeComments,
            teamId: params.teamId,
            after: params.after,
            before: params.before,
            filter: asObject(params.filter),
            first: params.first ?? 20,
            includeArchived: params.includeArchived,
            last: params.last,
            orderBy: params.orderBy,
          });

          const data = await linearGraphQL<{
            searchIssues: { nodes: LinearIssue[] };
          }>(
            apiKey,
            `query SearchIssues(
              $term: String!
              $includeComments: Boolean
              $teamId: String
              $after: String
              $before: String
              $filter: IssueFilter
              $first: Int
              $includeArchived: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
            ) {
              searchIssues(
                term: $term
                includeComments: $includeComments
                teamId: $teamId
                after: $after
                before: $before
                filter: $filter
                first: $first
                includeArchived: $includeArchived
                last: $last
                orderBy: $orderBy
              ) {
                nodes {
                  ${ISSUE_SELECTION}
                }
              }
            }`,
            variables,
            signal,
          );

          const issues = data.searchIssues.nodes;
          return {
            content: [{ type: 'text', text: JSON.stringify({ issues }, null, 2) }],
            details: { issues },
          };
        });
      },
    }),
  ];
}
