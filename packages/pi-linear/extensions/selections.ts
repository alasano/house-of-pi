export const ISSUE_SELECTION = `
  id
  identifier
  number
  title
  description
  priority
  url
  branchName
  dueDate
  createdAt
  updatedAt
  estimate
  priorityLabel
  completedAt
  startedAt
  archivedAt
  trashed
  state {
    id
    name
    type
  }
  team {
    id
    key
    name
  }
  assignee {
    id
    name
    email
  }
  labels {
    nodes {
      id
      name
    }
  }
  project {
    id
    name
  }
  parent {
    id
    identifier
    title
  }
  cycle {
    id
    name
    number
  }
  creator {
    id
    name
    email
  }
`;

export const WORKFLOW_STATE_SELECTION = `
    id
    name
    type
    color
    position
    description
    createdAt
    updatedAt
    team {
      id
      key
      name
    }
  `;

export const ISSUE_LABEL_SELECTION = `
    id
    name
    description
    color
    isGroup
    createdAt
    updatedAt
    retiredAt
    team {
      id
      key
      name
    }
    parent {
      id
      name
    }
  `;

export const PROJECT_SELECTION = `
    id
    name
    description
    color
    icon
    state
    priority
    slugId
    startDate
    targetDate
    completedAt
    canceledAt
    health
    progress
    startedAt
    archivedAt
    trashed
    priorityLabel
    createdAt
    updatedAt
    url
    teams {
      nodes {
        id
        key
        name
      }
    }
    lead {
      id
      name
      email
    }
    members {
      nodes {
        id
        name
        email
      }
    }
    status {
      id
      name
    }
  `;

export const PROJECT_LABEL_SELECTION = `
    id
    name
    description
    color
    isGroup
    createdAt
    updatedAt
    retiredAt
    parent {
      id
      name
    }
  `;

export const DOCUMENT_SELECTION = `
    id
    title
    content
    color
    icon
    slugId
    sortOrder
    hiddenAt
    trashed
    summary
    archivedAt
    createdAt
    updatedAt
    url
    team {
      id
      key
      name
    }
    project {
      id
      name
    }
    issue {
      id
      identifier
      title
    }
    initiative {
      id
      name
    }
  `;

export const COMMENT_SELECTION = `
    id
    body
    quotedText
    createdAt
    updatedAt
    editedAt
    resolvedAt
    url
    issue {
      id
      identifier
      title
    }
    parent {
      id
    }
    user {
      id
      name
      email
    }
  `;

export const INITIATIVE_SELECTION = `
    id
    name
    description
    content
    status
    color
    icon
    targetDate
    targetDateResolution
    sortOrder
    health
    completedAt
    startedAt
    archivedAt
    trashed
    createdAt
    updatedAt
    url
    owner {
      id
      name
      email
    }
  `;

export const MILESTONE_SELECTION = `
    id
    name
    description
    status
    progress
    targetDate
    sortOrder
    createdAt
    updatedAt
    project {
      id
      name
      url
    }
  `;

export const ISSUE_RELATION_SELECTION = `
    id
    createdAt
    updatedAt
    type
    issue {
      id
      identifier
      title
    }
    relatedIssue {
      id
      identifier
      title
    }
  `;

export const PROJECT_RELATION_SELECTION = `
    id
    createdAt
    updatedAt
    type
    anchorType
    relatedAnchorType
    project {
      id
      name
    }
    projectMilestone {
      id
      name
    }
    relatedProject {
      id
      name
    }
    relatedProjectMilestone {
      id
      name
    }
  `;

export const TEAM_SELECTION = `
    id
    key
    name
    description
    color
    icon
    private
    createdAt
    updatedAt
  `;

export const USER_SELECTION = `
    id
    name
    displayName
    email
    active
    admin
    guest
    isAssignable
    createdAt
    updatedAt
    url
  `;
