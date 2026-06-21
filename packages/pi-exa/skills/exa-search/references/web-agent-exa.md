# Exa Agent Tool Reference

Use Exa Agent for async, higher-compute web workflows that need more than a search result set or one fetched page. Agent is best for multi-hop research, structured list building, row enrichment, entity research across many fields, and tasks where the output should be validated against a JSON Schema.

Prefer `web_search_exa`, `web_search_advanced_exa`, `web_fetch_exa`, or `web_answer_exa` for simpler lookups. If Agent is a plausible but more expensive option, recommend it to the user before using it unless the user already asked for deep research, enrichment, or list building.

## Tools

- `web_agent_exa`: create a run. Use `mode: "wait"` for foreground work and `mode: "background"` for long-running work.
- `web_agent_get_exa`: retrieve a known run by ID, including output, sources, usage, and cost.
- `web_agent_list_exa`: list recent runs when you need to find a run ID or inspect statuses.
- `web_agent_cancel_exa`: cancel a queued or running run.
- `web_agent_delete_exa`: delete a stored run only when explicitly requested.
- `web_agent_events_exa`: list stored lifecycle events for a run, or replay stored events with `replay: true` and optional `lastEventId`.

## When Agent Is Best

Use Agent when the task has one or more of these properties:

- It requires multi-hop discovery: find entities first, then enrich each one.
- It needs many structured fields with citations or evidence.
- It processes `input.data` rows supplied by the user or another system.
- It needs exclusions or continuation from `previousRunId`.
- It is expected to take longer than normal search but return a high-value structured result.

Do not use Agent just because a question mentions the web. Normal search plus selected fetches is usually better for quick factual lookup, source discovery, official docs, current news checks, or one-page extraction.

## Modes

Foreground:

```json
{
  "query": "Research Acme Corp as a potential vendor. Verify identity, summarize business lines, list recent public signals, and cite sources.",
  "effort": "medium",
  "mode": "wait",
  "monitor": "stream"
}
```

Use foreground when the user needs the result in the current answer. `monitor: "stream"` is the default and surfaces lifecycle events while the run works. `monitor: "poll"` is available if streaming is not desirable. `monitor` applies only to `mode: "wait"`. A completed foreground run returns the full Agent result payload to the agent, including `output.text`, `output.structured`, `output.grounding`, usage, cost, and run metadata.

Background:

```json
{
  "query": "Find up to 25 current sales leaders at companies matching these criteria and return cited profile evidence.",
  "effort": "auto",
  "mode": "background",
  "outputSchema": {
    "type": "object",
    "required": ["people"],
    "properties": {
      "people": {
        "type": "array",
        "maxItems": 25,
        "items": {
          "type": "object",
          "required": ["name", "company", "title", "profile_url", "evidence_urls"],
          "properties": {
            "name": { "type": "string" },
            "company": { "type": "string" },
            "title": { "type": "string" },
            "profile_url": { "type": "string", "format": "uri" },
            "evidence_urls": {
              "type": "array",
              "maxItems": 3,
              "items": { "type": "string", "format": "uri" }
            }
          }
        }
      }
    }
  }
}
```

Use background for long-running, expensive, or broad workflows. Save the returned run ID. Background mode ignores `monitor`; it always returns promptly, then the extension tracks the run during the session with lightweight status polling, shows an active-run UI indicator, and sends a compact follow-up when it reaches a terminal status. That follow-up is only a completion notice and summary. Before answering with detailed findings from a background run, call `web_agent_get_exa` for the full stored result. Do not repeatedly call `web_agent_get_exa` or `web_agent_events_exa` after starting a background run unless the user explicitly asks for progress/history or the completion notice has arrived.

## System Prompt

Use `systemPrompt` for behavior rules that should be separate from the task itself:

- source preferences, such as primary sources, official docs, SEC filings, or IR pages
- disambiguation rules, such as exact company domain or avoiding similarly named entities
- novelty or deduplication constraints
- evidence standards, such as public proof of current employment
- output tone or omission rules

## Effort

- `minimal`: very narrow factual tasks with one or two shallow fields.
- `low`: simple lookups where cost and latency matter.
- `medium`: default for standard single-entity research.
- `high`: harder research, larger schemas, stricter verification.
- `xhigh`: high-value, complex, completeness-sensitive tasks.
- `auto`: variable-scope list building or workflows where entity count and work are not known ahead of time.

Use fixed effort when predictable request/compute cost matters. Search calls and contact enrichment can still add cost. Use `auto` when scope can vary significantly.

Agent runs can time out after one hour. Agent concurrency is limited by account QPS; on default pay-as-you-go limits, expect about two active Agent runs at a time.

## Structured Output

Use `outputSchema` when the answer needs to be machine-readable or when a bounded result set is important. Agent supports JSON Schema draft-07, 2019-09, and 2020-12 via `$schema`. Standard string formats are supported, plus `phone`. Always bound arrays with `maxItems` when possible.

Example single-entity profile:

```json
{
  "query": "Research Example Inc. Verify the company identity and return concise public intelligence with citations.",
  "effort": "medium",
  "outputSchema": {
    "type": "object",
    "required": ["company"],
    "properties": {
      "company": {
        "type": "object",
        "required": ["name", "domain", "identity_verified", "summary", "source_urls"],
        "properties": {
          "name": { "type": "string" },
          "domain": { "type": "string" },
          "identity_verified": { "type": "boolean" },
          "summary": { "type": "string" },
          "recent_signals": {
            "type": "array",
            "maxItems": 5,
            "items": { "type": "string" }
          },
          "source_urls": {
            "type": "array",
            "maxItems": 8,
            "items": { "type": "string", "format": "uri" }
          }
        }
      }
    }
  }
}
```

Example row enrichment:

```json
{
  "query": "For each input company, produce a concise research brief with current public evidence. Return one report per input row.",
  "effort": "medium",
  "input": {
    "data": [
      { "company": "Ramp", "domain": "ramp.com" },
      { "company": "Mercury", "domain": "mercury.com" }
    ]
  },
  "outputSchema": {
    "type": "object",
    "required": ["reports"],
    "properties": {
      "reports": {
        "type": "array",
        "maxItems": 2,
        "items": {
          "type": "object",
          "required": ["company", "domain", "overview", "source_urls"],
          "properties": {
            "company": { "type": "string" },
            "domain": { "type": "string" },
            "overview": { "type": "string" },
            "source_urls": {
              "type": "array",
              "maxItems": 5,
              "items": { "type": "string", "format": "uri" }
            }
          }
        }
      }
    }
  }
}
```

## Contact Fields

Contact-oriented schemas can trigger separate email or phone enrichment costs. Only request contact fields when the user asked for them or the workflow clearly requires them. Bound result arrays with `maxItems`.

```json
{
  "query": "Find current developer relations leaders at companies matching these criteria. Include only people with public evidence of current role.",
  "effort": "auto",
  "outputSchema": {
    "type": "object",
    "required": ["people"],
    "properties": {
      "people": {
        "type": "array",
        "maxItems": 10,
        "items": {
          "type": "object",
          "required": ["name", "title", "company", "profile_url", "evidence_urls"],
          "properties": {
            "name": { "type": "string" },
            "title": { "type": "string" },
            "company": { "type": "string" },
            "contact_email": { "type": "string", "format": "email" },
            "profile_url": { "type": "string", "format": "uri" },
            "evidence_urls": {
              "type": "array",
              "maxItems": 3,
              "items": { "type": "string", "format": "uri" }
            }
          }
        }
      }
    }
  }
}
```

## Continuation And Exclusions

Use `previousRunId` when a follow-up should continue from an earlier completed run. The previous run must be completed and belong to the same team. Exa documents follow-up runs as sharing the same run ID as the supplied `previousRunId`, so do not assume a continuation creates a brand-new ID.

Use `input.exclusion` to avoid returning records already known to the user or entities known to be wrong matches.

```json
{
  "query": "Find 10 additional companies that match the previous criteria, excluding companies already returned.",
  "previousRunId": "agent_run_01j...",
  "input": {
    "exclusion": [{ "company": "Existing Result", "domain": "existing.example" }]
  }
}
```

## Events

Use `web_agent_events_exa` for lifecycle inspection, debugging, or replaying event history. Events are not the final research output; use `web_agent_get_exa` for the completed run output.

JSON event listing:

```json
{
  "runId": "agent_run_01j...",
  "limit": 20
}
```

Stored SSE replay:

```json
{
  "runId": "agent_run_01j...",
  "replay": true,
  "lastEventId": "1"
}
```

Use replay when a stream was interrupted or when you need to reconstruct the lifecycle timeline after a known event ID. Do not replay events repeatedly for a background run that pi-exa is already tracking.

## Output Discipline

When returning Agent results to the user:

- Summarize the result first.
- Include run ID, status, and cost when relevant.
- Cite or preserve source URLs for claims that depend on web evidence.
- Do not paste every field from large structured output unless the user asked for the raw payload.
- Use `web_agent_get_exa` for full stored output when a background follow-up was compact.

## Production Checklist

- Give Agent a specific `query` that names the unit of work and desired source quality.
- Use `input.data` for known records instead of embedding rows in the prompt.
- Use `input.exclusion` for records that should not be returned again.
- Add `outputSchema` whenever downstream code consumes the result.
- Use `maxItems` on arrays when you need predictable scope and cost.
- Store the returned run ID so you can inspect costs, replay events, or continue from the run later.
- Add explicit disambiguation for people, companies, job boards, and similarly named entities.
