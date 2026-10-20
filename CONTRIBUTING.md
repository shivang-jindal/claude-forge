# Contributing to claude-forge

Thanks for helping make forge better. The goal: a **model-agnostic, zero-dependency**
orchestration engine that static config toolkits can't match. Contributions that add a
provider, a grader, an agent/skill, or a capability are all welcome.

## Ground rules

- **Zero runtime dependencies.** Use Node built-ins (`node:test`, `node:util`, `node:fs`,
  global `fetch`). If you're tempted to add a package, open an issue first.
- **Native TypeScript only.** Code must run via `node file.ts` (Node 24+). That means
  **erasable syntax only**: no `enum`, no `namespace`, no constructor parameter properties
  (`constructor(private x)`), and relative imports **must** end in `.ts`. Use `import type`
  for type-only imports.
- **Everything is tested.** Add or extend a test in `tests/*.test.ts`. Run `npm test`.
- **Docs are tests.** Every API example in `README.md` is mirrored in `tests/readme.test.ts`.
  If you change an API, update both — the test suite will tell you if you forget.
- **Stay model-agnostic.** All capabilities talk to the `LLMProvider` interface, never a
  concrete SDK.

## Run it

```bash
node src/cli.ts --help
npm test          # node --test tests/*.test.ts
node src/cli.ts ci   # tests + eval gate
```

## Renaming the project

If you fork this and want it under a different name, do it in one step rather
than by hand:

```bash
node scripts/rename.ts <repo-name> \
  --pkg @yourhandle/<repo-name> \
  --bin <cli-name> \
  --owner <github-handle> \
  --dir .<state-dir>
```

It rewrites every file that mentions the old name (word-boundary aware, so
words like "forget" are never mangled), updates `package.json` structurally,
renames `forge.config.json` and the CI workflow, and leaves the `configs/`
agent-and-skill library alone. Then re-run the test suite and `node src/cli.ts ci`
to confirm nothing broke.

## Publishing a release

```bash
# 1. Bump the version and update CHANGELOG.md
# 2. Verify everything
npm test
node src/cli.ts ci

# 3. Tag and push — the release workflow does the rest
git tag v0.3.0 && git push origin v0.3.0
```

The `release` workflow then: verifies the tag matches `package.json`, runs the test gate,
**packs the tarball and smoke-tests the installed binary**, publishes to npm with
provenance, and creates a GitHub release.

**npm auth** — either set an `NPM_TOKEN` repository secret, or use npm Trusted Publishing
(OIDC) and grant this workflow `id-token: write` on npmjs.com. Trusted Publishing is
preferable: no long-lived token.

**The npm package name is `claude-forge-cli`, not `claude-forge`.** The unscoped
`claude-forge` name on npm is already taken by an unrelated project, and the GitHub
repository name and the npm package name do not have to match. If you publish under your
own scope instead, change `name` in `package.json` to `@yourhandle/claude-forge` and update
the `repository` / `homepage` / `bugs` URLs to match your fork.

## Ways to contribute

### 1. Add a provider
Implement `LLMProvider` in `src/core/llm.ts` (or a new file) with an injectable `fetchFn`
so it's testable offline. Then wire it into `makeProvider` and add pricing to `PRICING` in
`src/core/tokens.ts`. Add a test in `tests/providers.test.ts` using a fake `fetch`.

```ts
export class MyProvider implements LLMProvider {
  readonly name = "myprovider";
  async complete(req: CompleteRequest): Promise<CompleteResponse> { /* … */ }
}
```

### 2. Add a grader
Add an entry to `graders` in `src/eval/graders.ts`:
`(output, expected, ctx) => { passed, score, reason }`. Register a name and test it.

Graders that need configuration take it through `ctx.opts`, which comes from
the grader spec: `resolveGrader({ type: "similarity", threshold: 0.9 })`.

### 3. Add an agent or skill
Drop a markdown file in `configs/agents/` or `configs/skills/<name>/SKILL.md` with
frontmatter (`name`, `description`, and for agents `tools`/`model`). `node src/cli.ts config list`
should list it. Keep the body focused and actionable.

### 4. Add a hook
Hooks are either programmatic (`src/core/hooks.ts`) or config-driven. To add a
config-driven hook, drop a JSON file in `configs/hooks/`:

```json
{
  "name": "my-check",
  "phases": ["step:end"],
  "command": "node -e \"process.exit(0)\"",
  "priority": 10,
  "blockOnFail": true
}
```

`phases` must be valid hook phases (see the list in the README). The command
gets `FORGE_PHASE`, `FORGE_RUN_ID`, `FORGE_STEP_ID`, `FORGE_TOOL`, `FORGE_DATA`
and `FORGE_DATA_OUTPUT` in its environment. Exit non-zero blocks the step.

### 5. Add a policy rule
Add a rule to `PolicyEngine.defaults()` in `src/core/policy.ts`, or construct a
`PolicyEngine` with your own rules. A rule is
`{ id, description, effect: "deny" | "require-approval", match }` where `match`
holds optional `tool` / `command` / `path` / `contains` regexes — the rule fires
when **any** of them hits. Add a test for the rule firing *and* for a near-miss
that must not fire.

### 6. Add a capability
Bigger feature (new orchestration strategy, better compaction, etc.). Open an issue first
to align on design, then ship it with tests.

## Where things live

| I want to… | Look in |
|---|---|
| Add a model backend | `src/core/llm.ts` (implement `LLMProvider`) |
| Add a way to score output | `src/eval/graders.ts` |
| Add a run-time guard | `src/core/policy.ts` (rules) or `src/core/hooks.ts` (behaviour) |
| Add a new agent/skill/command/rule | `configs/` |
| Add a dataset | `evals/*.dataset.json` (+ a line in `evals/README.md`) |
| Wire a new CLI verb | `src/cli.ts` (add to `USAGE` **and** the `switch`) |
| Add a workflow | `workflows/*.json` |

## Frontmatter gotcha

The mini parser treats `key: value` as a comma-list **only when every segment is a bare
token** (so `tools: Read, Grep` is a list, but a prose `description` with commas stays a
string). Quote a value if you need to force a literal string.

## Pull requests

- Keep them focused; one idea per PR.
- Describe **what**, **why**, and **how you tested it**.
- Make sure `npm test` and `node src/cli.ts ci` pass locally.
- No secrets, API keys, machine-specific paths, or committed `.forge/` state.

## Code style

- `snake_case` functions/vars, `PascalCase` classes, `UPPER_SNAKE` constants.
- Prefer small, well-named functions; explicit error handling; no `any` leaking into
  public signatures.
- Comment the *why*, not the *what*.

Questions? Open an issue. Thanks for contributing.
