export type JsonObject = Record<string, unknown>;

export type LinearGraphQLError = {
  message: string;
};

export type LinearIssue = {
  id: string;
  identifier: string;
  number?: number | null;
  title: string;
  description?: string | null;
  priority?: number | null;
  url?: string | null;
  branchName?: string | null;
  dueDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
  state?: { id: string; name: string; type?: string | null } | null;
  team?: { id: string; key: string; name: string } | null;
  assignee?: { id: string; name?: string | null; email?: string | null } | null;
};

export type LinearTeam = {
  id: string;
  key: string;
  name: string;
  states?: {
    nodes: Array<{ id: string; name: string; type?: string | null }>;
  };
};
