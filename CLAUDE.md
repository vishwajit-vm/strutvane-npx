# CLAUDE.md: strutvane-npx (`strutvane`)

Project memory for Claude Code in this repository. Keep it short, accurate and current.

## Ecosystem memory (shared by every Strutvane repo)

@.claude/ECOSYSTEM.md

## What this repo is

The unscoped `strutvane` npm package: the `npx strutvane` guard (hub `docs/18-v2-blueprint.md`
"`npx strutvane` also works"; catalogue entry `id: strutvane`). Inside a project it runs exactly what
`node strut <args>` runs, with the project's own `@strutvane/framework`; outside one it only prints.
It never installs or downloads anything. Zero runtime dependencies. Branch status: `NEXT.md`.

## Code map (`src/`, one concept per file)

| File | Role |
|---|---|
| `bin.ts` | Process wiring only (the one file allowed to use `console`) |
| `main.ts` | The decision: old Node, loop guard, find project, run or print |
| `project.ts` | Nearest `strut.js` / framework package.json, walking up |
| `boundary.ts` | Root / temp / above-home / ownership rules, mirrored from the framework's `console/project/boundary.ts`: keep in step |
| `target.ts` | What to run (`strut.js` or the framework bin) and the real-path containment checks |
| `child.ts` | Spawn without a shell, exit codes, signal forwarding |
| `manifest.ts`, `messages.ts`, `version.ts` | Untrusted JSON reading, every printed text, versions |

## Rules specific to this repo

- Never add a runtime dependency, an install script or a network call: the guard must work (and be
  safe) before anything is installed.
- Every new refusal gets an attack-style test, and its message says how to fix it.
- Release only with the core train (`0.2.0-next.N`), never ahead of the framework.
