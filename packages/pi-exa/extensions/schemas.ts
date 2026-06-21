import { Type } from 'typebox';

const JsonObjectSchema = Type.Object({}, { additionalProperties: true });

export const SearchTypeSchema = Type.Union([
  Type.Literal('auto'),
  Type.Literal('fast'),
  Type.Literal('instant'),
]);

export const CategorySchema = Type.Union([
  Type.Literal('company'),
  Type.Literal('research paper'),
  Type.Literal('news'),
  Type.Literal('pdf'),
  Type.Literal('github'),
  Type.Literal('personal site'),
  Type.Literal('people'),
  Type.Literal('financial report'),
]);

export const WebSearchParamsSchema = Type.Object({
  query: Type.String({
    description:
      'Natural language search query. Prefer a specific description of the desired page over short keywords. Optional category:<type> hints are supported for company, people, news, research paper, and personal site.',
  }),
  numResults: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 100, description: 'Number of search results to return.' }),
  ),
});

export const WebSearchAdvancedParamsSchema = Type.Object({
  query: Type.String({ description: 'Search query.' }),
  numResults: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 100, description: 'Number of search results to return.' }),
  ),
  type: Type.Optional(SearchTypeSchema),
  category: Type.Optional(CategorySchema),
  includeDomains: Type.Optional(Type.Array(Type.String())),
  excludeDomains: Type.Optional(Type.Array(Type.String())),
  startPublishedDate: Type.Optional(Type.String({ description: 'YYYY-MM-DD or ISO date.' })),
  endPublishedDate: Type.Optional(Type.String({ description: 'YYYY-MM-DD or ISO date.' })),
  startCrawlDate: Type.Optional(Type.String({ description: 'YYYY-MM-DD or ISO date.' })),
  endCrawlDate: Type.Optional(Type.String({ description: 'YYYY-MM-DD or ISO date.' })),
  includeText: Type.Optional(Type.Array(Type.String())),
  excludeText: Type.Optional(Type.Array(Type.String())),
  userLocation: Type.Optional(Type.String({ description: 'ISO country code, for example US.' })),
  moderation: Type.Optional(Type.Boolean()),
  additionalQueries: Type.Optional(Type.Array(Type.String())),
  textMaxCharacters: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        'Maximum text characters per result. Omit to request uncapped text from advanced search.',
    }),
  ),
  contextMaxCharacters: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: 'Maximum characters for Exa response-level context string.',
    }),
  ),
  enableSummary: Type.Optional(Type.Boolean()),
  summaryQuery: Type.Optional(Type.String()),
  enableHighlights: Type.Optional(
    Type.Boolean({
      description: 'Set true to request highlights in addition to text. Defaults to false.',
    }),
  ),
  highlightsMaxCharacters: Type.Optional(
    Type.Integer({ minimum: 1, description: 'Maximum total highlight characters per URL.' }),
  ),
  highlightsQuery: Type.Optional(Type.String()),
  maxAgeHours: Type.Optional(
    Type.Integer({
      minimum: -1,
      description:
        'Maximum cache age in hours. Use 0 to force fresh crawl where supported, -1 for cache-only where supported.',
    }),
  ),
  livecrawlTimeout: Type.Optional(Type.Integer({ minimum: 1 })),
  subpages: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
  subpageTarget: Type.Optional(Type.Array(Type.String())),
});

export const WebFetchParamsSchema = Type.Object({
  urls: Type.Array(Type.String({ minLength: 1 }), {
    description: 'URLs to read. Batch multiple URLs in one call.',
  }),
  maxCharacters: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: 'Maximum characters to extract per page. Defaults to 3000.',
    }),
  ),
});

export const WebAnswerParamsSchema = Type.Object({
  query: Type.String({ minLength: 1, description: 'Natural-language question to answer.' }),
  text: Type.Optional(
    Type.Boolean({
      description: 'Whether to include full text for citations. Defaults to false.',
    }),
  ),
  outputSchema: Type.Optional(
    Type.Object({}, { additionalProperties: true, description: 'JSON Schema Draft 7 object.' }),
  ),
});

export const AgentEffortSchema = Type.Union([
  Type.Literal('minimal'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('xhigh'),
  Type.Literal('auto'),
]);

export const AgentRunIdSchema = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: '^[A-Za-z0-9_.:-]+$',
  description: 'Exa Agent run ID, usually prefixed with agent_run_.',
});

export const WebAgentParamsSchema = Type.Object({
  query: Type.String({
    minLength: 1,
    description: 'Natural-language research, list-building, or enrichment task for Exa Agent.',
  }),
  systemPrompt: Type.Optional(
    Type.String({
      description:
        'Additional behavior guidance, source preferences, disambiguation rules, novelty/deduping constraints, or output constraints.',
    }),
  ),
  effort: Type.Optional(
    Type.Union([AgentEffortSchema], {
      description:
        'Cost/quality/runtime preference. Defaults to auto. Use medium for standard single-entity research, auto for variable-scope list building.',
    }),
  ),
  input: Type.Optional(
    Type.Object(
      {
        data: Type.Optional(
          Type.Array(JsonObjectSchema, {
            description: 'Records the agent should process or enrich.',
          }),
        ),
        exclusion: Type.Optional(
          Type.Array(JsonObjectSchema, {
            description: 'Records or entities the agent should avoid returning.',
          }),
        ),
      },
      {
        additionalProperties: false,
        description: 'Structured input rows or exclusions for the run.',
      },
    ),
  ),
  outputSchema: Type.Optional(
    Type.Object(
      {},
      {
        additionalProperties: true,
        description:
          'JSON Schema for validated structured output in output.structured. Supports draft-07, 2019-09, and 2020-12 via $schema. Bound arrays with maxItems when possible.',
      },
    ),
  ),
  previousRunId: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        'Completed same-team Agent run ID to continue from. Exa documents continuations as sharing the supplied previousRunId.',
    }),
  ),
  metadata: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: 'Caller-provided key-value metadata for tracking.',
    }),
  ),
  mode: Type.Optional(
    Type.Union([Type.Literal('wait'), Type.Literal('background')], {
      description:
        'wait streams or polls until completion; background returns the run ID immediately and watches it in the session. Do not manually poll background runs unless the user asks.',
    }),
  ),
  monitor: Type.Optional(
    Type.Union([Type.Literal('stream'), Type.Literal('poll')], {
      description:
        'Only applies when mode=wait. stream uses server-sent events; poll uses GET /agent/runs/{id}. Ignored for mode=background.',
    }),
  ),
  pollIntervalMs: Type.Optional(
    Type.Integer({
      minimum: 1000,
      maximum: 60000,
      description: 'Polling interval for poll mode or background tracking.',
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Integer({
      minimum: 1000,
      maximum: 3600000,
      description:
        'Foreground wait timeout. If reached, the run keeps going and can be inspected later.',
    }),
  ),
});

export const WebAgentRunParamsSchema = Type.Object({
  runId: AgentRunIdSchema,
});

export const WebAgentListParamsSchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  cursor: Type.Optional(Type.String({ minLength: 1 })),
});

export const WebAgentEventsParamsSchema = Type.Object({
  runId: AgentRunIdSchema,
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  cursor: Type.Optional(Type.String({ minLength: 1 })),
  replay: Type.Optional(
    Type.Boolean({
      description:
        'Replay stored events as server-sent events instead of listing JSON events. Use only for progress/history inspection.',
    }),
  ),
  lastEventId: Type.Optional(
    Type.String({
      minLength: 1,
      description: 'For replay=true, return only events after this Last-Event-ID value.',
    }),
  ),
});
