# Changelog

## 0.2.0

- Injected read-only file tools (`file_search`, `list_dir`, `file_read`) into the default local tool set, scoped to `fileWorkspace` (an empty workspace falls back to the current working directory). Behavior change: requests now advertise these tools by default; pass `defaultLocalTools: false` to opt out.
- Added the side-effecting `file_write` tool, which only joins the default set when a `filePermission` callback is configured and is always routed through a fail-safe host approval gate (a denied or throwing callback blocks the write and leaves disk untouched).
- Hardened the file sandbox against symlink escapes: path resolution now compares the real (symlink-resolved) path of the deepest existing ancestor against the sandbox root, not just the lexical form.
- Capped `list_dir` and `file_search` results at `DefaultSearchLimit` (200) with a `truncated` flag so a large tree cannot flood the model's context.
- Shared the file-tool implementations from `client-sdk-ts` and re-exported them through the agent toolkit for a single source of truth.
- Added OpenAI-compatible image generation to the TypeScript Client SDK.
- Clarified consumer installation, project setup, and repository development commands.
- Added a Simplified Chinese README.
- Added the final GitHub repository, homepage, and issue tracker metadata to published packages.
- Aligned the default 60-second request timeout and authentication header behavior with the Go SDK.
- Added a clear local error when an authenticated endpoint is called without an API key.
- Added Anthropic Messages support.
- Added model metadata, model detail, and pricing helpers.
- Added streaming support and production endpoint defaults.
- Added the JoyToken model provider and agent loop helpers.
