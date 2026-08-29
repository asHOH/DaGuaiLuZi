# Development

Use the Node.js version in `.node-version` and the pnpm version in `package.json`. Enable Corepack if `pnpm --version` does not match, then run `pnpm install`.

| Command | Purpose |
| --- | --- |
| `pnpm format` | Format supported files with Prettier. |
| `pnpm format:check` | Check formatting without changes. |
| `pnpm lint` | Run Oxlint correctness and type-aware rules. |
| `pnpm lint:fix` | Apply safe Oxlint fixes. |
| `pnpm typecheck` | Run package TypeScript checks. |
| `pnpm test` | Run package tests. |
| `pnpm build` | Build all packages and apps. |
| `pnpm check` | Run the complete local/CI gate. |

Prettier owns code/config formatting; Markdown is excluded to keep tables compact. Oxlint owns lint rules; TypeScript remains the typecheck authority. Lefthook checks staged formatting and lint before commit, then runs `pnpm check` before push. Run `pnpm exec lefthook install` if hooks are missing. GitHub Actions runs the same gate after a frozen-lockfile install.

Pin exact tool versions and upgrade them deliberately.
