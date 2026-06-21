export type JsonObject = Record<string, unknown>;

export type SearchType = 'auto' | 'fast' | 'instant';

export type ExaLink = {
  url?: string;
  title?: string;
  altText?: string;
};

export type ExaExtras = {
  links?: Array<string | ExaLink>;
  imageLinks?: Array<string | ExaLink>;
};

export type ExaGroundingCitation = {
  url?: string;
  title?: string;
};

export type ExaGrounding = {
  field?: string;
  citations?: ExaGroundingCitation[];
  confidence?: string;
};

export type ExaSearchOutput = {
  content?: string | JsonObject;
  grounding?: ExaGrounding[];
};

export type SearchCategory =
  | 'company'
  | 'research paper'
  | 'news'
  | 'pdf'
  | 'github'
  | 'personal site'
  | 'people'
  | 'financial report';

export interface ExaSearchResult {
  id?: string;
  title?: string;
  url?: string;
  publishedDate?: string;
  author?: string | null;
  text?: string;
  highlights?: string[];
  summary?: string | JsonObject;
  score?: number;
  image?: string;
  favicon?: string;
  subpages?: ExaSearchResult[];
  links?: Array<string | ExaLink>;
  imageLinks?: Array<string | ExaLink>;
  extras?: ExaExtras;
  entities?: unknown[];
}

export interface ExaSearchResponse {
  requestId?: string;
  autopromptString?: string;
  resolvedSearchType?: string;
  searchType?: string | null;
  searchTime?: number;
  results?: ExaSearchResult[];
  output?: ExaSearchOutput;
  statuses?: ExaContentsStatus[];
  context?: string;
  autoDate?: string;
  costDollars?: JsonObject;
}

export interface ExaContentsStatus {
  id?: string;
  url?: string;
  status?: string;
  error?:
    | string
    | {
        tag?: string;
        message?: string;
        httpStatusCode?: number | null;
      };
}

export interface ExaContentsResponse {
  requestId?: string;
  results?: ExaSearchResult[];
  statuses?: ExaContentsStatus[];
  costDollars?: JsonObject;
}

export interface ExaAnswerResponse {
  requestId?: string;
  answer?: string | JsonObject;
  citations?: ExaSearchResult[];
  costDollars?: JsonObject;
}

export type ExaAgentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ExaAgentStopReason = 'schema_satisfied' | 'budget_reached' | 'error' | 'cancelled';

export type ExaAgentEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'auto';

export type ExaAgentConfidence = 'low' | 'medium' | 'high';

export interface ExaAgentInput {
  data?: JsonObject[];
  exclusion?: JsonObject[];
}

export interface ExaAgentGroundingCitation {
  url: string;
  title?: string | null;
  [key: string]: unknown;
}

export interface ExaAgentGroundingEntry {
  field?: string;
  citations?: ExaAgentGroundingCitation[];
  score?: number | null;
  confidence?: ExaAgentConfidence | null;
  [key: string]: unknown;
}

export interface ExaAgentOutput {
  text?: string | null;
  structured?: unknown;
  grounding?: ExaAgentGroundingEntry[] | null;
  [key: string]: unknown;
}

export interface ExaAgentUsage {
  agentComputeUnits?: number;
  searches?: number;
  emails?: number;
  phoneNumbers?: number;
  [key: string]: unknown;
}

export interface ExaAgentCostDollars {
  total?: number;
  agentCompute?: number;
  search?: number;
  emails?: number;
  phoneNumbers?: number;
  [key: string]: unknown;
}

export interface ExaAgentError {
  type?: string;
  code?: string;
  message?: string;
  path?: string;
  keyword?: string;
  expected?: unknown;
  actual?: unknown;
  [key: string]: unknown;
}

export interface ExaAgentRunRequest {
  query?: string;
  systemPrompt?: string;
  input?: ExaAgentInput;
  outputSchema?: JsonObject | null;
  effort?: ExaAgentEffort;
  previousRunId?: string;
  metadata?: Record<string, string>;
  [key: string]: unknown;
}

export interface ExaAgentRun {
  id: string;
  object?: string;
  status: ExaAgentRunStatus;
  stopReason?: ExaAgentStopReason | null;
  createdAt?: string;
  completedAt?: string | null;
  request?: ExaAgentRunRequest | null;
  output?: ExaAgentOutput | null;
  usage?: ExaAgentUsage;
  costDollars?: ExaAgentCostDollars;
  error?: ExaAgentError;
  [key: string]: unknown;
}

export interface ExaAgentEvent {
  id?: string;
  event: string;
  data: JsonObject;
  createdAt?: string;
  [key: string]: unknown;
}

export interface ExaAgentRunListResponse {
  object?: string;
  data: ExaAgentRun[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ExaAgentEventListResponse {
  object?: string;
  data: ExaAgentEvent[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ExaDeletedAgentRun {
  id: string;
  object?: string;
  deleted: boolean;
}

export interface PreviewDetails {
  kind: 'search' | 'contents' | 'answer' | 'agent';
  summary: string;
  lines: string[];
  expandedLines?: string[];
  truncated?: boolean;
  fullOutputPath?: string;
}

export interface ExaToolDetails<TResponse = unknown, TRequest = unknown> {
  endpoint: string;
  request: TRequest;
  response: TResponse;
  requestId?: string;
  count?: number;
  costDollars?: JsonObject;
  preview?: PreviewDetails;
  truncated?: boolean;
  truncation?: unknown;
  fullOutputPath?: string;
}
