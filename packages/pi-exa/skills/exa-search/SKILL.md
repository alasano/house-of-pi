---
name: exa-search
description: Web research with Exa search, advanced search, URL fetch, and sourced answers. Use when current web information, source discovery, page extraction, or sourced web answers are needed.
---

# Exa Search

Use Exa with a search-first, context-disciplined workflow. Prefer small, high-signal calls that discover sources, then fetch only the pages that are worth reading.

## Tool Choice

- Use `web_search_exa` for normal web searches, current information lookup, source discovery, and quick orientation. It returns compact highlights.
- Use `web_search_advanced_exa` when filters or content controls matter: domains, dates, categories, freshness, summaries, highlights, subpages, response-level context, or extracted text. It returns full per-result text by default; set `textMaxCharacters` when that would be too much.
- Use `web_fetch_exa` after search when a specific URL needs fuller markdown content. Fetch selected URLs only.
- Use `web_answer_exa` when a direct answer with citations is more useful than a result list, especially for factual questions or concise sourced summaries.
- Use `web_agent_exa` only for deeper Agent workflows: multi-hop research, list building, row enrichment, entity research across many fields, or structured outputs that require broader web work than one search/answer/fetch call. Before using `web_agent_exa` or any `web_agent_*_exa` lifecycle tool, read `references/web-agent-exa.md`.
- If the user's task could benefit from Exa Agent but would cost more or run longer than normal search, briefly recommend Agent as an option instead of using it silently.
- After starting `web_agent_exa` with `mode: "background"`, do not repeatedly poll the run. The extension tracks it and sends a compact follow-up when it completes. Treat that follow-up as a notification, not the full result; call `web_agent_get_exa` before answering with detailed findings from the run.

## Search Workflow

1. Start with `web_search_exa` unless you already know you need filters or page text.
2. Read result titles, URLs, and highlights. Identify the best sources before doing another call.
3. Use `web_search_advanced_exa` to narrow by domain, date, category, geography, freshness, or content extraction. Remember that advanced search returns text by default.
4. Use `web_fetch_exa` only for URLs that need closer inspection.
5. Deduplicate similar results before answering. Keep only the best representative source for repeated articles, mirrors, copied docs, or forks.

## Query Patterns

- General research: describe the ideal source, not just keywords. Example: `independent analysis of 2026 US EV tax credit changes`.
- Current events: include names, dates, organizations, and the event type. Use advanced search with date filters when recency matters.
- Official documentation: include the product, API, version, and the exact concept. Prefer `includeDomains` for official domains when the source matters.
- Code examples: include language, framework, major version, package name, and exact API. Example: `TypeScript React 19 useActionState form example`.
- Error/debugging searches: include the exact error string, runtime, library, and version when known.
- Comparison research: search each side explicitly, then dedupe and compare sources instead of relying on one broad query.

## Advanced Search Recipes

- Domain-restricted research: set `includeDomains` for official docs, vendor docs, standards bodies, or trusted publications.
- Exclusions: set `excludeDomains` for sources that are duplicated, low quality, or not relevant to the user.
- Date-sensitive research: use published or crawl date filters when older sources would mislead the answer.
- Category search: use categories such as news, company, people, research paper, GitHub, PDF, financial report, or personal site when the source type matters.
- Text extraction: advanced search requests full text by default. Set `textMaxCharacters` when each result should be bounded, especially for broad queries or many results.
- Response context: set `contextMaxCharacters` when you want Exa to return a compact combined context string in addition to per-result fields.
- Highlights: set `enableHighlights` when you want compact evidence in addition to text. Add `highlightsQuery` when the highlight should focus on a specific claim or API.
- Summaries: set `enableSummary` when a short page-level summary is more useful than reading result text. Add `summaryQuery` to focus the summary.
- Freshness: use `maxAgeHours` when cached content could be stale. Use small values for fast-moving pages and omit it when freshness is not important.
- Subpages: use `subpages` and `subpageTarget` for docs sites where the useful answer may live below a landing page.

## Fetch Guidance

- Fetch after choosing URLs from search results, not as a substitute for search.
- Keep `maxCharacters` tight by default. Increase it only when the selected URL is clearly worth reading in detail.
- For several candidate URLs, fetch the strongest one or two first, then decide whether more context is needed.
- Treat fetched text as more complete than search highlights, and keep track of where it came from.

## Answer Guidance

- Use `web_answer_exa` for direct factual questions, quick sourced summaries, and cases where a sourced answer is enough.
- Use search instead when you need to compare sources, inspect exact wording, evaluate freshness, or gather multiple perspectives.
- Set `text: true` only when citation page text is needed; it can make the result larger.
- Use `outputSchema` when the answer must be structured JSON.

## Agent Guidance

`web_agent_exa` is a higher-compute async workflow tool, not the default search path. Use it when the job genuinely needs Agent behavior, and read `references/web-agent-exa.md` first for effort choices, foreground/background mode, schema design, lifecycle tools, cost notes, background tracking, and examples.

## Context Discipline

- Prefer highlights, summaries, and short fetched excerpts before large text dumps.
- Use one good query before issuing variants. Refine based on observed sources.
- Keep enough source information to support web-dependent claims when the answer needs it.
- Separate what Exa returned from your own synthesis.
- Do not paste raw Exa output when a concise answer with citations is enough.
- If the result set is noisy, narrow the query or filters before fetching.

## Output Guidance

Answer in the format the user asked for. If no format was specified, give a clear, concise response that uses the searched information without dumping raw tool output.

Include source links, excerpts, or uncertainty notes when they are useful for the task, when the user asked for them, or when the answer depends on a specific current source. Keep fetched excerpts short unless the user asks for detail.
