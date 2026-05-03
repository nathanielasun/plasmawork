# Paper-extraction tool template

Starting point for a paper-extraction tool — extracts text, equations,
and parameters from a paper file (PDF / `.md` / `.tex`).

Phase 3 provides only the template; the full extraction stack lands in
Phase 4 (Agent-Assisted Paper Ingestion). Until then, this template
returns the raw text and empty equations / parameters tables.

**Critical rule (plan §22):** extracted parameters MUST carry units. If
the paper omits units, flag the row with a `placeholder:` entry in
`coefficient_sources` rather than fabricating a unit. The runtime will
later refuse unsourced rates so the user sees the gap explicitly.
