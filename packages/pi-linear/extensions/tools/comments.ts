import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { withLinearAuth, linearGraphQL } from '../client';
import { PaginationParams, FilterParam, RawInputParam } from '../params';
import { COMMENT_SELECTION } from '../selections';
import type { JsonObject } from '../types';
import { compactObject, asObject, asString, GenericObjectSchema } from '../util';

export function commentTools() {
  return [
    defineTool({
      name: 'linear_list_comments',
      label: 'Linear List Comments',
      description: 'List comments. Supports full comments query args.',
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
            comments: { nodes: Array<JsonObject> };
          }>(
            apiKey,
            `query ListComments(
              $after: String
              $before: String
              $filter: CommentFilter
              $first: Int
              $includeArchived: Boolean
              $last: Int
              $orderBy: PaginationOrderBy
            ) {
              comments(
                after: $after
                before: $before
                filter: $filter
                first: $first
                includeArchived: $includeArchived
                last: $last
                orderBy: $orderBy
              ) {
                nodes {
                  ${COMMENT_SELECTION}
                }
              }
            }`,
            variables,
            signal,
          );

          const comments = data.comments.nodes;
          return {
            content: [{ type: 'text', text: JSON.stringify({ comments }, null, 2) }],
            details: { comments },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_create_comment',
      label: 'Linear Create Comment',
      description: 'Create a comment via commentCreate using top-level fields and/or raw input.',
      parameters: Type.Object({
        body: Type.Optional(Type.String()),
        bodyData: Type.Optional(GenericObjectSchema),
        createAsUser: Type.Optional(Type.String()),
        createOnSyncedSlackThread: Type.Optional(Type.Boolean()),
        createdAt: Type.Optional(Type.String()),
        displayIconUrl: Type.Optional(Type.String()),
        doNotSubscribeToIssue: Type.Optional(Type.Boolean()),
        documentContentId: Type.Optional(Type.String()),
        id: Type.Optional(Type.String()),
        initiativeUpdateId: Type.Optional(Type.String()),
        issueId: Type.Optional(Type.String()),
        parentId: Type.Optional(Type.String()),
        postId: Type.Optional(Type.String()),
        projectUpdateId: Type.Optional(Type.String()),
        quotedText: Type.Optional(Type.String()),
        subscriberIds: Type.Optional(Type.Array(Type.String())),
        ...RawInputParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const rawInput = asObject(params.input) || {};
          const input = {
            ...rawInput,
            ...compactObject({
              body: params.body,
              bodyData: asObject(params.bodyData),
              createAsUser: params.createAsUser,
              createOnSyncedSlackThread: params.createOnSyncedSlackThread,
              createdAt: params.createdAt,
              displayIconUrl: params.displayIconUrl,
              doNotSubscribeToIssue: params.doNotSubscribeToIssue,
              documentContentId: params.documentContentId,
              id: params.id,
              initiativeUpdateId: params.initiativeUpdateId,
              issueId: params.issueId,
              parentId: params.parentId,
              postId: params.postId,
              projectUpdateId: params.projectUpdateId,
              quotedText: params.quotedText,
              subscriberIds: params.subscriberIds,
            }),
          };

          if (!asString(input.body) && !asObject(input.bodyData)) {
            throw new Error('Comment body or bodyData is required for commentCreate.');
          }

          const data = await linearGraphQL<{
            commentCreate: { success: boolean; comment?: JsonObject | null };
          }>(
            apiKey,
            `mutation CreateComment($input: CommentCreateInput!) {
              commentCreate(input: $input) {
                success
                comment {
                  ${COMMENT_SELECTION}
                }
              }
            }`,
            { input },
            signal,
          );

          if (!data.commentCreate.success || !data.commentCreate.comment) {
            throw new Error('Linear commentCreate did not succeed.');
          }

          const comment = data.commentCreate.comment;
          return {
            content: [{ type: 'text', text: JSON.stringify({ comment }, null, 2) }],
            details: { comment },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_update_comment',
      label: 'Linear Update Comment',
      description: 'Update a comment by id.',
      parameters: Type.Object({
        id: Type.String(),
        body: Type.Optional(Type.String()),
        quotedText: Type.Optional(Type.String()),
        ...RawInputParam,
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const rawInput = asObject(params.input) || {};
          const input = {
            ...rawInput,
            ...compactObject({
              body: params.body,
              quotedText: params.quotedText,
            }),
          };

          if (Object.keys(input).length === 0) {
            throw new Error('No update fields were provided.');
          }

          const data = await linearGraphQL<{
            commentUpdate: { success: boolean; comment?: JsonObject | null };
          }>(
            apiKey,
            `mutation UpdateComment($id: String!, $input: CommentUpdateInput!) {
              commentUpdate(id: $id, input: $input) {
                success
                comment {
                  ${COMMENT_SELECTION}
                }
              }
            }`,
            { id: params.id, input },
            signal,
          );

          if (!data.commentUpdate.success || !data.commentUpdate.comment) {
            throw new Error('Linear commentUpdate did not succeed.');
          }

          const comment = data.commentUpdate.comment;
          return {
            content: [{ type: 'text', text: JSON.stringify({ comment }, null, 2) }],
            details: { comment },
          };
        });
      },
    }),
    defineTool({
      name: 'linear_delete_comment',
      label: 'Linear Delete Comment',
      description: 'Delete a comment by id.',
      parameters: Type.Object({
        id: Type.String(),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return withLinearAuth(ctx, signal, async (apiKey) => {
          const data = await linearGraphQL<{
            commentDelete: { success: boolean };
          }>(
            apiKey,
            `mutation DeleteComment($id: String!) {
              commentDelete(id: $id) {
                success
              }
            }`,
            { id: params.id },
            signal,
          );

          if (!data.commentDelete.success) {
            throw new Error('Linear commentDelete did not succeed.');
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
