import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { withLinearAuth, linearGraphQL, resolveTeamId } from '../client';
import { PaginationParams, FilterParam, RawInputParam, TeamConvenienceParams } from '../params';
import { DOCUMENT_SELECTION } from '../selections';
import type { JsonObject } from '../types';
import { compactObject, asObject, asString } from '../util';

export function documentTools() {
  return [
    defineTool({
      name: 'linear_list_documents',
      label: 'Linear List Documents',
      description: 'List documents. Supports full documents query args.',
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
            documents: { nodes: Array<JsonObject> };
          }>(
            apiKey,
            `query ListDocuments(
              $after: String
              $before: String
              $filter: DocumentFilter
              $first: Int
              $includeArchived: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
            ) {
              documents(
                after: $after
                before: $before
                filter: $filter
                first: $first
                includeArchived: $includeArchived
                last: $last
                orderBy: $orderBy
              ) {
                nodes {
                  ${DOCUMENT_SELECTION}
                }
              }
            }`,
            variables,
            signal,
          );

          const documents = data.documents.nodes;
          return {
            content: [{ type: 'text', text: JSON.stringify({ documents }, null, 2) }],
            details: { documents },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_get_document',
      label: 'Linear Get Document',
      description: 'Get a specific document by id.',
      parameters: Type.Object({
        documentId: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{ document: JsonObject | null }>(
            apiKey,
            `query GetDocument($id: String!) {
              document(id: $id) {
                ${DOCUMENT_SELECTION}
              }
            }`,
            { id: params.documentId },
            signal,
          );

          const document = data.document;
          return {
            content: [
              { type: 'text', text: JSON.stringify({ document: document ?? null }, null, 2) },
            ],
            details: { document: document ?? null },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_create_document',
      label: 'Linear Create Document',
      description:
        'Create a document. Supports top-level DocumentCreateInput fields and raw input.',
      parameters: Type.Object({
        color: Type.Optional(Type.String()),
        content: Type.Optional(Type.String()),
        cycleId: Type.Optional(Type.String()),
        icon: Type.Optional(Type.String()),
        id: Type.Optional(Type.String()),
        initiativeId: Type.Optional(Type.String()),
        issueId: Type.Optional(Type.String()),
        lastAppliedTemplateId: Type.Optional(Type.String()),
        projectId: Type.Optional(Type.String()),
        releaseId: Type.Optional(Type.String()),
        resourceFolderId: Type.Optional(Type.String()),
        sortOrder: Type.Optional(Type.Number()),
        subscriberIds: Type.Optional(Type.Array(Type.String())),
        ...TeamConvenienceParams,
        title: Type.Optional(Type.String()),
        ...RawInputParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const rawInput = asObject(params.input) || {};
          const rawInputTeamId = asString(rawInput.teamId);
          const teamId =
            params.teamId || params.teamKey || rawInputTeamId
              ? await resolveTeamId(
                  apiKey,
                  {
                    teamId: params.teamId || rawInputTeamId,
                    teamKey: params.teamKey,
                  },
                  signal,
                )
              : undefined;

          const input = {
            ...rawInput,
            ...compactObject({
              color: params.color,
              content: params.content,
              cycleId: params.cycleId,
              icon: params.icon,
              id: params.id,
              initiativeId: params.initiativeId,
              issueId: params.issueId,
              lastAppliedTemplateId: params.lastAppliedTemplateId,
              projectId: params.projectId,
              releaseId: params.releaseId,
              resourceFolderId: params.resourceFolderId,
              sortOrder: params.sortOrder,
              subscriberIds: params.subscriberIds,
              teamId,
              title: params.title,
            }),
          };

          if (!asString(input.title)) {
            throw new Error('Document title is required for documentCreate (title).');
          }

          const data = await linearGraphQL<{
            documentCreate: { success: boolean; document?: JsonObject | null };
          }>(
            apiKey,
            `mutation CreateDocument($input: DocumentCreateInput!) {
              documentCreate(input: $input) {
                success
                document {
                  ${DOCUMENT_SELECTION}
                }
              }
            }`,
            { input },
            signal,
          );

          if (!data.documentCreate.success || !data.documentCreate.document) {
            throw new Error('Linear documentCreate did not succeed.');
          }

          const document = data.documentCreate.document;
          return {
            content: [{ type: 'text', text: JSON.stringify({ document }, null, 2) }],
            details: { document },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_update_document',
      label: 'Linear Update Document',
      description:
        'Update a document by id. Supports top-level DocumentUpdateInput fields and raw input.',
      parameters: Type.Object({
        documentId: Type.String(),
        color: Type.Optional(Type.String()),
        content: Type.Optional(Type.String()),
        cycleId: Type.Optional(Type.String()),
        hiddenAt: Type.Optional(Type.String()),
        icon: Type.Optional(Type.String()),
        initiativeId: Type.Optional(Type.String()),
        issueId: Type.Optional(Type.String()),
        lastAppliedTemplateId: Type.Optional(Type.String()),
        projectId: Type.Optional(Type.String()),
        releaseId: Type.Optional(Type.String()),
        resourceFolderId: Type.Optional(Type.String()),
        sortOrder: Type.Optional(Type.Number()),
        subscriberIds: Type.Optional(Type.Array(Type.String())),
        ...TeamConvenienceParams,
        title: Type.Optional(Type.String()),
        trashed: Type.Optional(Type.Boolean()),
        ...RawInputParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const rawInput = asObject(params.input) || {};
          const rawInputTeamId = asString(rawInput.teamId);
          const teamId =
            params.teamId || params.teamKey || rawInputTeamId
              ? await resolveTeamId(
                  apiKey,
                  {
                    teamId: params.teamId || rawInputTeamId,
                    teamKey: params.teamKey,
                  },
                  signal,
                )
              : undefined;

          const input = {
            ...rawInput,
            ...compactObject({
              color: params.color,
              content: params.content,
              cycleId: params.cycleId,
              hiddenAt: params.hiddenAt,
              icon: params.icon,
              initiativeId: params.initiativeId,
              issueId: params.issueId,
              lastAppliedTemplateId: params.lastAppliedTemplateId,
              projectId: params.projectId,
              releaseId: params.releaseId,
              resourceFolderId: params.resourceFolderId,
              sortOrder: params.sortOrder,
              subscriberIds: params.subscriberIds,
              teamId,
              title: params.title,
              trashed: params.trashed,
            }),
          };

          if (Object.keys(input).length === 0) {
            throw new Error('No document update fields were provided.');
          }

          const data = await linearGraphQL<{
            documentUpdate: { success: boolean; document?: JsonObject | null };
          }>(
            apiKey,
            `mutation UpdateDocument($id: String!, $input: DocumentUpdateInput!) {
              documentUpdate(id: $id, input: $input) {
                success
                document {
                  ${DOCUMENT_SELECTION}
                }
              }
            }`,
            {
              id: params.documentId,
              input,
            },
            signal,
          );

          if (!data.documentUpdate.success || !data.documentUpdate.document) {
            throw new Error('Linear documentUpdate did not succeed.');
          }

          const document = data.documentUpdate.document;
          return {
            content: [{ type: 'text', text: JSON.stringify({ document }, null, 2) }],
            details: { document },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_delete_document',
      label: 'Linear Delete Document',
      description: 'Delete a document by id.',
      parameters: Type.Object({
        documentId: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            documentDelete: { success: boolean };
          }>(
            apiKey,
            `mutation DeleteDocument($id: String!) {
              documentDelete(id: $id) {
                success
              }
            }`,
            { id: params.documentId },
            signal,
          );

          if (!data.documentDelete.success) {
            throw new Error('Linear documentDelete did not succeed.');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }],
            details: { success: true },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_unarchive_document',
      label: 'Linear Unarchive Document',
      description: 'Restore an archived document by id.',
      parameters: Type.Object({
        documentId: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            documentUnarchive: { success: boolean };
          }>(
            apiKey,
            `mutation UnarchiveDocument($id: String!) {
              documentUnarchive(id: $id) {
                success
              }
            }`,
            { id: params.documentId },
            signal,
          );

          if (!data.documentUnarchive.success) {
            throw new Error('Linear documentUnarchive did not succeed.');
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
