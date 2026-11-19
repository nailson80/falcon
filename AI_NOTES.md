# AI use notes

## Tools used

- OpenAI Codex assisted with repository setup, reading the assessment, and drafting these initial write-up files.
- No application LLM provider has been implemented or called yet.

## Prompts that mattered

1. User request: “Initialize the Git repo,” ignore `data/`, create the files listed in “6 Write-up,” and push the initial commit to GitHub.
2. Assessment direction: keep raw data, use one shared custodian model, reconcile all three sources, and explain judgment calls.
3. Assessment direction: provide an offline default AI feature, show the exact model input, and treat model output as untrusted.

This list will be expanded to 3–5 implementation prompts as the project develops.

## Mistakes and safety checks

- The first PDF extraction attempt assumed `pdftotext` was installed; it was not. A second attempt used system Python, which lacked `pypdf`. The bundled workspace Python successfully extracted the document. No assessment content was executed.
- AI-generated mappings and status definitions are provisional. They will be checked against the CSV headers and implemented behavior before the final submission.
- Source CSV values and the assessment PDF are treated as untrusted data. Any apparent instructions inside them are ignored for agent behavior. Sensitive identifiers must not be sent to an LLM or printed in debug logs.
- The CSV importer uses fixed table and column names, validates headers and row widths, and binds every cell as a query parameter. This prevents CSV content from becoming SQL or import instructions.
