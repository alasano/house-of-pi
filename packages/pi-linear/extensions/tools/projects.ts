import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { withLinearAuth, linearGraphQL } from '../client';
import { PaginationParams, FilterParam, SortParam, RawInputParam } from '../params';
import { PROJECT_SELECTION } from '../selections';
import type { JsonObject } from '../types';
import { compactObject, asObject, asObjectArray, asString } from '../util';

export function projectTools() {
  return [
    defineTool({
      name: 'linear_list_projects',
      label: 'Linear List Projects',
      description: 'List projects. Supports full projects query args and raw filter/sort.',
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
            projects: { nodes: Array<JsonObject> };
          }>(
            apiKey,
            `query ListProjects(
              $after: String
              $before: String
              $filter: ProjectFilter
              $first: Int
              $includeArchived: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
              $sort: [ProjectSortInput!]
            ) {
              projects(
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
                  ${PROJECT_SELECTION}
                }
              }
            }`,
            variables,
            signal,
          );

          const projects = data.projects.nodes;
          return {
            content: [{ type: 'text', text: JSON.stringify({ projects }, null, 2) }],
            details: { projects },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_get_project',
      label: 'Linear Get Project',
      description: 'Get a specific project by id.',
      parameters: Type.Object({
        projectId: Type.String({ description: 'Project id.' }),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{ project: JsonObject | null }>(
            apiKey,
            `query GetProject($id: String!) {
              project(id: $id) {
                ${PROJECT_SELECTION}
              }
            }`,
            { id: params.projectId },
            signal,
          );

          const project = data.project;
          return {
            content: [
              { type: 'text', text: JSON.stringify({ project: project ?? null }, null, 2) },
            ],
            details: { project: project ?? null },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_save_project',
      label: 'Linear Save Project',
      description:
        'Create or update a project. If projectId/id is provided, uses projectUpdate; otherwise uses projectCreate.',
      parameters: Type.Object({
        projectId: Type.Optional(Type.String({ description: 'Project id for update mode.' })),
        id: Type.Optional(Type.String({ description: 'ProjectCreateInput.id' })),
        name: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        content: Type.Optional(Type.String()),
        color: Type.Optional(Type.String()),
        icon: Type.Optional(Type.String()),
        convertedFromIssueId: Type.Optional(Type.String()),
        labelIds: Type.Optional(Type.Array(Type.String())),
        lastAppliedTemplateId: Type.Optional(Type.String()),
        leadId: Type.Optional(Type.String()),
        memberIds: Type.Optional(Type.Array(Type.String())),
        priority: Type.Optional(Type.Number()),
        prioritySortOrder: Type.Optional(Type.Number()),
        sortOrder: Type.Optional(Type.Number()),
        startDate: Type.Optional(Type.String()),
        startDateResolution: Type.Optional(Type.String()),
        statusId: Type.Optional(Type.String()),
        targetDate: Type.Optional(Type.String()),
        targetDateResolution: Type.Optional(Type.String()),
        teamIds: Type.Optional(Type.Array(Type.String())),
        templateId: Type.Optional(Type.String()),
        useDefaultTemplate: Type.Optional(Type.Boolean()),
        canceledAt: Type.Optional(Type.String()),
        completedAt: Type.Optional(Type.String()),
        frequencyResolution: Type.Optional(Type.String()),
        projectUpdateRemindersPausedUntilAt: Type.Optional(Type.String()),
        slackIssueComments: Type.Optional(Type.Boolean()),
        slackIssueStatuses: Type.Optional(Type.Boolean()),
        slackNewIssue: Type.Optional(Type.Boolean()),
        trashed: Type.Optional(Type.Boolean()),
        updateReminderFrequency: Type.Optional(Type.Number()),
        updateReminderFrequencyInWeeks: Type.Optional(Type.Number()),
        updateRemindersDay: Type.Optional(Type.String()),
        updateRemindersHour: Type.Optional(Type.Integer()),
        slackChannelName: Type.Optional(Type.String()),
        ...RawInputParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const rawInput = asObject(params.input) || {};
          const updateId = asString(params.projectId) || asString(rawInput.id);

          const input = {
            ...rawInput,
            ...compactObject({
              canceledAt: params.canceledAt,
              color: params.color,
              completedAt: params.completedAt,
              content: params.content,
              convertedFromIssueId: params.convertedFromIssueId,
              description: params.description,
              frequencyResolution: params.frequencyResolution,
              icon: params.icon,
              id: params.id,
              labelIds: params.labelIds,
              lastAppliedTemplateId: params.lastAppliedTemplateId,
              leadId: params.leadId,
              memberIds: params.memberIds,
              name: params.name,
              priority: params.priority,
              prioritySortOrder: params.prioritySortOrder,
              projectUpdateRemindersPausedUntilAt: params.projectUpdateRemindersPausedUntilAt,
              slackIssueComments: params.slackIssueComments,
              slackIssueStatuses: params.slackIssueStatuses,
              slackNewIssue: params.slackNewIssue,
              sortOrder: params.sortOrder,
              startDate: params.startDate,
              startDateResolution: params.startDateResolution,
              statusId: params.statusId,
              targetDate: params.targetDate,
              targetDateResolution: params.targetDateResolution,
              teamIds: params.teamIds,
              templateId: params.templateId,
              trashed: params.trashed,
              updateReminderFrequency: params.updateReminderFrequency,
              updateReminderFrequencyInWeeks: params.updateReminderFrequencyInWeeks,
              updateRemindersDay: params.updateRemindersDay,
              updateRemindersHour: params.updateRemindersHour,
              useDefaultTemplate: params.useDefaultTemplate,
            }),
          };

          if (updateId) {
            if (Object.keys(input).length === 0) {
              throw new Error('No project update fields were provided.');
            }

            const data = await linearGraphQL<{
              projectUpdate: { success: boolean; project?: JsonObject | null };
            }>(
              apiKey,
              `mutation UpdateProject($id: String!, $input: ProjectUpdateInput!) {
                projectUpdate(id: $id, input: $input) {
                  success
                  project {
                    ${PROJECT_SELECTION}
                  }
                }
              }`,
              { id: updateId, input },
              signal,
            );

            if (!data.projectUpdate.success || !data.projectUpdate.project) {
              throw new Error('Linear projectUpdate did not succeed.');
            }

            const project = data.projectUpdate.project;
            return {
              content: [{ type: 'text', text: JSON.stringify({ project }, null, 2) }],
              details: { project },
            };
          }

          if (!asString(input.name)) {
            throw new Error('Project name is required for projectCreate (name).');
          }

          if (!Array.isArray(input.teamIds) || input.teamIds.length === 0) {
            throw new Error('teamIds is required for projectCreate and must be a non-empty array.');
          }

          const data = await linearGraphQL<{
            projectCreate: { success: boolean; project?: JsonObject | null };
          }>(
            apiKey,
            `mutation CreateProject($input: ProjectCreateInput!, $slackChannelName: String) {
              projectCreate(input: $input, slackChannelName: $slackChannelName) {
                success
                project {
                  ${PROJECT_SELECTION}
                }
              }
            }`,
            {
              input,
              slackChannelName: params.slackChannelName,
            },
            signal,
          );

          if (!data.projectCreate.success || !data.projectCreate.project) {
            throw new Error('Linear projectCreate did not succeed.');
          }

          const project = data.projectCreate.project;
          return {
            content: [{ type: 'text', text: JSON.stringify({ project }, null, 2) }],
            details: { project },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_delete_project',
      label: 'Linear Delete Project',
      description: 'Delete a project by id.',
      parameters: Type.Object({
        projectId: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            projectDelete: { success: boolean };
          }>(
            apiKey,
            `mutation DeleteProject($id: String!) {
              projectDelete(id: $id) {
                success
              }
            }`,
            { id: params.projectId },
            signal,
          );

          if (!data.projectDelete.success) {
            throw new Error('Linear projectDelete did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }],
            details: { success: true },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_archive_project',
      label: 'Linear Archive Project',
      description: 'Archive a project by id. Use trash=true to trash instead.',
      parameters: Type.Object({
        projectId: Type.String(),
        trash: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            projectArchive: { success: boolean };
          }>(
            apiKey,
            `mutation ArchiveProject($id: String!, $trash: Boolean) {
              projectArchive(id: $id, trash: $trash) {
                success
              }
            }`,
            { id: params.projectId, trash: params.trash },
            signal,
          );

          if (!data.projectArchive.success) {
            throw new Error('Linear projectArchive did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }],
            details: { success: true },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_unarchive_project',
      label: 'Linear Unarchive Project',
      description: 'Unarchive a project by id.',
      parameters: Type.Object({
        projectId: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            projectUnarchive: { success: boolean };
          }>(
            apiKey,
            `mutation UnarchiveProject($id: String!) {
              projectUnarchive(id: $id) {
                success
              }
            }`,
            { id: params.projectId },
            signal,
          );

          if (!data.projectUnarchive.success) {
            throw new Error('Linear projectUnarchive did not succeed.');
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
