import { defineTool } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { Type } from 'typebox';
import { withLinearAuth, linearGraphQL, resolveTeamId } from '../client';
import { PaginationParams, paginationVariables, filterParam } from '../params';
import { CUSTOM_VIEW_SELECTION } from '../selections';
import type { JsonObject, LinearConnection } from '../types';
import { compactObject, asObject, asString, GenericObjectSchema } from '../util';
import {
  cleanOneLine,
  expandedJson,
  renderLinearToolCall,
  shouldShowJson,
  textContent,
} from '../renderers/common';
import {
  renderLinearCustomViewListCall,
  renderLinearCustomViewListResult,
  renderLinearCustomViewMutationCall,
  renderLinearCustomViewMutationResult,
  renderLinearGetViewResult,
} from '../renderers/custom-views';

type CustomViewMutationPayload = {
  success: boolean;
  customView: JsonObject | null;
};

function requireView(
  payload: CustomViewMutationPayload,
  operation: 'create' | 'update',
): JsonObject {
  if (!payload.success) {
    throw new Error(`Linear failed to ${operation} the view.`);
  }
  if (!payload.customView) {
    throw new Error(
      `Linear reported that it ${operation === 'create' ? 'created' : 'updated'} the view but returned no view.`,
    );
  }
  return payload.customView;
}

export function customViewTools() {
  return [
    defineTool({
      name: 'linear_list_views',
      label: 'Linear List Custom Views',
      description:
        "List Linear custom views of any type (issues, projects, initiatives, updates). Supports full customViews query args (filter, first, orderBy, includeArchived). Views attached to a project or initiative page are excluded by Linear's API and cannot be listed; linear_get_view can fetch one when the user provides its ID, slug, or URL.",
      parameters: Type.Object({
        ...PaginationParams,
        filter: filterParam('CustomViewFilter'),
      }),
      renderCall: renderLinearCustomViewListCall,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const variables = compactObject({
            ...paginationVariables(params, 50),
            filter: asObject(params.filter),
          });

          const data = await linearGraphQL<{
            customViews: LinearConnection<JsonObject>;
          }>(
            apiKey,
            `query ListCustomViews(
              $after: String
              $before: String
              $filter: CustomViewFilter
              $first: Int
              $includeArchived: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
            ) {
              customViews(
                after: $after
                before: $before
                filter: $filter
                first: $first
                includeArchived: $includeArchived
                last: $last
                orderBy: $orderBy
              ) {
                nodes {
                  ${CUSTOM_VIEW_SELECTION}
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

          const views = data.customViews.nodes;
          const pageInfo = data.customViews.pageInfo;
          return {
            content: [{ type: 'text', text: JSON.stringify({ views, pageInfo }, null, 2) }],
            details: { views, pageInfo },
          };
        });
      },
      renderResult: renderLinearCustomViewListResult,
    }),

    defineTool({
      name: 'linear_get_view',
      label: 'Linear Get Custom View',
      description:
        'Get a Linear custom view by ID or slug. Works for any view type, including views attached to a project or initiative page.',
      parameters: Type.Object({
        id: Type.String({ description: 'Custom view ID or slug.' }),
      }),
      renderCall: (args, theme) =>
        renderLinearToolCall('linear_get_view', args, theme, [['id', 'id']]),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{ customView: JsonObject }>(
            apiKey,
            `query GetCustomView($id: String!) {
              customView(id: $id) {
                ${CUSTOM_VIEW_SELECTION}
              }
            }`,
            { id: params.id },
            signal,
          );

          const view = data.customView;
          return {
            content: [{ type: 'text', text: JSON.stringify({ view }, null, 2) }],
            details: { view },
          };
        });
      },
      renderResult: renderLinearGetViewResult,
    }),

    defineTool({
      name: 'linear_create_view',
      label: 'Linear Create Custom View',
      description:
        'Create a Linear custom view. Provide name plus exactly one filter: filterData (IssueFilter JSON, issues view), projectFilterData (ProjectFilter JSON, projects view), initiativeFilterData (InitiativeFilter JSON, initiatives view, Linear alpha), or feedItemFilterData (FeedItemFilter JSON, updates view). Optional teamId/teamKey, icon, color, shared. Omit teamId for a workspace-level view.',
      parameters: Type.Object({
        name: Type.String({ description: 'View name.' }),
        filterData: Type.Optional(GenericObjectSchema),
        projectFilterData: Type.Optional(GenericObjectSchema),
        initiativeFilterData: Type.Optional(GenericObjectSchema),
        feedItemFilterData: Type.Optional(GenericObjectSchema),
        teamId: Type.Optional(
          Type.String({ description: 'Team id. Omit for a workspace-level view.' }),
        ),
        teamKey: Type.Optional(
          Type.String({ description: 'Team key (e.g. ENG). Resolved to a team id.' }),
        ),
        description: Type.Optional(Type.String({ description: 'View description.' })),
        icon: Type.Optional(
          Type.String({ description: 'View icon name (e.g. Calendar, Search).' }),
        ),
        color: Type.Optional(Type.String({ description: 'View color hex (e.g. #5E6AD2).' })),
        shared: Type.Optional(Type.Boolean({ description: 'Whether the view is shared.' })),
      }),
      renderCall: (args, theme) =>
        renderLinearCustomViewMutationCall('linear_create_view', args, theme),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const teamId = params.teamId
            ? params.teamId
            : params.teamKey
              ? await resolveTeamId(apiKey, { teamKey: params.teamKey }, signal)
              : undefined;

          const input = compactObject({
            name: params.name,
            description: params.description,
            icon: params.icon,
            color: params.color,
            shared: params.shared,
            teamId,
            filterData: asObject(params.filterData),
            projectFilterData: asObject(params.projectFilterData),
            initiativeFilterData: asObject(params.initiativeFilterData),
            feedItemFilterData: asObject(params.feedItemFilterData),
          });

          const data = await linearGraphQL<{
            customViewCreate: CustomViewMutationPayload;
          }>(
            apiKey,
            `mutation CreateCustomView($input: CustomViewCreateInput!) {
              customViewCreate(input: $input) {
                success
                customView {
                  ${CUSTOM_VIEW_SELECTION}
                }
              }
            }`,
            { input },
            signal,
          );

          const view = requireView(data.customViewCreate, 'create');
          return {
            content: [{ type: 'text', text: JSON.stringify({ view }, null, 2) }],
            details: { view },
          };
        });
      },
      renderResult: renderLinearCustomViewMutationResult('Created'),
    }),

    defineTool({
      name: 'linear_update_view',
      label: 'Linear Update Custom View',
      description:
        'Update a Linear custom view by id. Accepts name, description, icon, color, shared, and the filter matching the view type: filterData (issues), projectFilterData (projects), initiativeFilterData (initiatives, Linear alpha), feedItemFilterData (updates).',
      parameters: Type.Object({
        id: Type.String({ description: 'Custom view id.' }),
        name: Type.Optional(Type.String({ description: 'View name.' })),
        filterData: Type.Optional(GenericObjectSchema),
        projectFilterData: Type.Optional(GenericObjectSchema),
        initiativeFilterData: Type.Optional(GenericObjectSchema),
        feedItemFilterData: Type.Optional(GenericObjectSchema),
        description: Type.Optional(Type.String({ description: 'View description.' })),
        icon: Type.Optional(
          Type.String({ description: 'View icon name (e.g. Calendar, Search).' }),
        ),
        color: Type.Optional(Type.String({ description: 'View color hex (e.g. #5E6AD2).' })),
        shared: Type.Optional(Type.Boolean({ description: 'Whether the view is shared.' })),
      }),
      renderCall: (args, theme) =>
        renderLinearCustomViewMutationCall('linear_update_view', args, theme),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const input = compactObject({
            name: params.name,
            description: params.description,
            icon: params.icon,
            color: params.color,
            shared: params.shared,
            filterData: asObject(params.filterData),
            projectFilterData: asObject(params.projectFilterData),
            initiativeFilterData: asObject(params.initiativeFilterData),
            feedItemFilterData: asObject(params.feedItemFilterData),
          });

          const data = await linearGraphQL<{
            customViewUpdate: CustomViewMutationPayload;
          }>(
            apiKey,
            `mutation UpdateCustomView($id: String!, $input: CustomViewUpdateInput!) {
              customViewUpdate(id: $id, input: $input) {
                success
                customView {
                  ${CUSTOM_VIEW_SELECTION}
                }
              }
            }`,
            { id: params.id, input },
            signal,
          );

          const view = requireView(data.customViewUpdate, 'update');
          return {
            content: [{ type: 'text', text: JSON.stringify({ view }, null, 2) }],
            details: { view },
          };
        });
      },
      renderResult: renderLinearCustomViewMutationResult('Updated'),
    }),

    defineTool({
      name: 'linear_delete_view',
      label: 'Linear Delete Custom View',
      description: 'Delete a Linear custom view by id.',
      parameters: Type.Object({
        id: Type.String({ description: 'Custom view id.' }),
      }),
      renderCall: (args, theme) =>
        renderLinearCustomViewMutationCall('linear_delete_view', args, theme),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            customViewDelete: { success: boolean };
          }>(
            apiKey,
            `mutation DeleteCustomView($id: String!) {
              customViewDelete(id: $id) {
                success
              }
            }`,
            { id: params.id },
            signal,
          );

          const success = data.customViewDelete.success;
          return {
            content: [{ type: 'text', text: JSON.stringify({ success }, null, 2) }],
            details: { success },
          };
        });
      },
      renderResult: (result, options, theme, context) => {
        if (options.isPartial) return new Text(theme.fg('warning', 'Deleting…'), 0, 0);
        if (shouldShowJson(options, context)) return expandedJson(result, theme);
        const id = asString((context.args as { id?: unknown } | undefined)?.id);
        const target = id ? `view ${id}` : 'view';
        if (context.isError) {
          const message = cleanOneLine(textContent(result)) || `Failed to delete ${target}.`;
          return new Text(theme.fg('error', `✗ ${message}`), 0, 0);
        }
        const success = (result.details as { success?: boolean } | undefined)?.success;
        return new Text(
          success === true
            ? `${theme.fg('success', '✓ Deleted')} ${theme.fg('toolOutput', target)}`
            : theme.fg('error', `✗ Failed to delete ${target}`),
          0,
          0,
        );
      },
    }),

    defineTool({
      name: 'linear_set_view_preferences',
      label: 'Linear Set Custom View Preferences',
      description:
        'Set display preferences (grouping and columns) for a Linear custom view. Accepts a preferences object with keys like issueGrouping (e.g. "assignee", "status", "priority", "cycle", "project"), fieldEstimate, fieldPriority, fieldDueDate, fieldStatus, fieldProject, showEmptyGroups.',
      parameters: Type.Object({
        viewId: Type.String({ description: 'Custom view id.' }),
        preferences: Type.Object({
          issueGrouping: Type.Optional(
            Type.String({
              description:
                'Group issues by: assignee, status, priority, cycle, project, labels, none.',
            }),
          ),
          issueSubGrouping: Type.Optional(
            Type.String({
              description:
                'Sub-group by: assignee, status, priority, cycle, project, labels, none.',
            }),
          ),
          showEmptyGroups: Type.Optional(Type.Boolean({ description: 'Show empty groups.' })),
          fieldEstimate: Type.Optional(Type.Boolean({ description: 'Show Estimate column.' })),
          fieldPriority: Type.Optional(Type.Boolean({ description: 'Show Priority column.' })),
          fieldDueDate: Type.Optional(Type.Boolean({ description: 'Show Due date column.' })),
          fieldStatus: Type.Optional(Type.Boolean({ description: 'Show Status column.' })),
          fieldProject: Type.Optional(Type.Boolean({ description: 'Show Project column.' })),
          fieldAssignee: Type.Optional(Type.Boolean({ description: 'Show Assignee column.' })),
          fieldLabels: Type.Optional(Type.Boolean({ description: 'Show Labels column.' })),
        }),
      }),
      renderCall: (args, theme) =>
        renderLinearToolCall('linear_set_view_preferences', args, theme, [
          ['viewId', 'view'],
          ['preferences', 'prefs'],
        ]),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            viewPreferencesCreate: {
              viewPreferences: JsonObject;
            };
          }>(
            apiKey,
            `mutation SetViewPreferences($input: ViewPreferencesCreateInput!) {
              viewPreferencesCreate(input: $input) {
                viewPreferences {
                  id
                  type
                  viewType
                }
              }
            }`,
            {
              input: {
                type: 'user',
                viewType: 'customView',
                customViewId: params.viewId,
                preferences: params.preferences,
              },
            },
            signal,
          );

          const viewPreferences = data.viewPreferencesCreate.viewPreferences;
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ viewPreferences, preferences: params.preferences }, null, 2),
              },
            ],
            details: { viewPreferences, preferences: params.preferences },
          };
        });
      },
      renderResult: (result, options, theme, context) => {
        if (options.isPartial) return new Text(theme.fg('warning', 'Setting preferences…'), 0, 0);
        if (shouldShowJson(options, context)) return expandedJson(result, theme);
        if (context.isError) {
          const message = cleanOneLine(textContent(result)) || 'Failed to update view preferences.';
          return new Text(theme.fg('error', `✗ ${message}`), 0, 0);
        }
        const prefs = (result.details as { preferences?: Record<string, unknown> } | undefined)
          ?.preferences;
        const viewId = asString((context.args as { viewId?: unknown } | undefined)?.viewId);
        const parts = [
          viewId ? `view ${viewId}` : undefined,
          ...Object.entries(prefs ?? {}).map(([key, value]) => `${key}: ${String(value)}`),
        ].filter((part): part is string => !!part);
        const lines = [`${theme.fg('success', '✓')} View preferences updated`];
        if (parts.length) lines.push(theme.fg('dim', parts.join(' · ')));
        return new Text(lines.join('\n'), 0, 0);
      },
    }),
  ];
}
