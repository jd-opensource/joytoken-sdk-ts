# Contributing

Thank you for helping improve the JoyToken TypeScript SDKs.

## Before opening a change

- Search existing issues and pull requests before starting substantial work.
- Do not include API keys, access tokens, customer data, or production responses in commits, tests, or issue reports.
- Keep public API changes documented and add regression tests for behavior changes.
- Use pnpm for workspace operations and package publishing.

## Local checks

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

Publish from the workspace with `pnpm publish -r --access public`; this rewrites the Agent SDK's `workspace:*` dependency to the released Client SDK version.

Pull requests should explain the user-visible behavior, compatibility impact, and test coverage. Contributions are licensed under the repository license unless a separate written agreement says otherwise.
