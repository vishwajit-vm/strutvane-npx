# NEXT.md: `strutvane` (npx guard), branch `v2/npx`

Status of this branch for the next session. Facts here are checked against git and the gate output;
anything not re-run by the coordinator is marked *(agent-reported)*.

## Branch `fix/macos` (2026-11-20): macOS CI fix, not merged, not pushed

- **Cause** (CI runs 44278587225 and 44578698106, both macOS jobs): `npm ci` stopped with
  `ESTRICTALLOWSCRIPTS` on `fsevents@2.3.3`, an optional macOS-only dev dependency (via vite) with
  an install script. Linux and Windows skip it, so only macOS failed; no test ever ran there.
- **Fix:** package.json `"allowScripts": { "fsevents@2.3.3": false }` (refused, same as the
  framework, installer and other repos). Reproduced and checked on Windows with
  `npm ci --os=darwin --cpu=arm64`: exit 1 before, exit 0 after.
- **Regression tests:** `package.test.ts` checks that every lockfile entry with an install script
  has an allowScripts decision (fails on every OS, not only on macOS). The guard code already
  handled macOS's `/var` → `/private/var` temp link correctly (it compares real paths, and refuses
  only a root that is itself a link); new tests pin that with a linked parent folder (junction on
  Windows) in `target`, `project` and `main` tests.
- Gate 3× green (116 passed, 3 skipped; coverage 98.38/94.97/100/99.06), publint, attw,
  check-deps, check-code-rules, check-package OK *(agent-reported)*.
- **Next:** coordinator re-runs the gate, merges into `main` and pushes; then confirm the macOS
  jobs on GitHub CI. No changeset: nothing published changes behaviour.

## Done

- `strutvane` 0.2.0-next.0 (Changesets pre mode `next`, one minor changeset, now under
  `.changeset/pre/`; core train, decision #128). Zero runtime dependencies, one bin
  (`dist/bin.mjs`), Node `>=24.3`, npm `>=11.19` via `devEngines`.
- Behaviour (see README): inside a project, runs the project's `strut.js` (or, without one, the
  installed framework's `strutvane` bin) with the same Node, no shell, cwd = project root; exit code
  passed through, signal re-raised (POSIX) or 128 + n (Windows); SIGTERM/SIGHUP forwarded, SIGINT
  forwarded only without a TTY, nothing forwarded on Windows. Outside: help/`--version` exit 0,
  `new|create|init` print `npm create strutvane@<next|latest>`, anything else exit 2. Refusals exit 1.
- Guards: boundary rules mirrored from the framework's `console/project/boundary.ts` (no root, temp
  dir or folder above home; POSIX ownership); `strut.js` alone not trusted; root that is a link
  refused; `strut.js` link refused; framework dir / bin real path must stay inside the root; bin must
  be a plain relative `.js/.mjs/.cjs`; loop guard `STRUTVANE_NPX_DEPTH`; terminal-safe output.
- Tests: unit + attack tests + end-to-end against `src/bin.ts` (Node type stripping).
- Synced by strutvane-tooling as the `npx` library target (tooling branch
  `feat/npx-and-app-template`; this repo's branch `chore/tooling-sync`): the sync wrote
  `.github/workflows/{ci,release,scorecard}.yml`, `.github/dependabot.yml`, `.github/scripts/*`
  and `RELEASE-READINESS.md`; the earlier hand copies of the configs showed no drift. After the
  sync: `npm run ci` green once (107 passed, 3 skipped; coverage 98.38/94.97/100/99.06; build
  OK), check-deps, check-code-rules and check-package clean *(agent-reported)*. publint/attw not
  re-run after the sync (no package change).

## Next

1. **Merge** `chore/tooling-sync` into `main` after the tooling branch is merged (any push to
   `main` with `RELEASE_ENABLED=true` runs the release workflow: version first, framework first).
   Fill in `RELEASE-READINESS.md` (R1–R9) before the first release.
2. **Repo memory:** add `CLAUDE.md` (and the usual `.claude/` agents/commands) with the
   `new-package-repo` skill's template.
3. **Decisions for the project lead** (also in the report):
   - The framework also declares a `strutvane` bin, so inside a project with dependencies installed
     `npx strutvane` resolves to `node_modules/.bin/strutvane` (the framework program), not to this
     package and not to `strut.js`. This package runs only where that bin is absent (outside a
     project, before `npm install`, or with `npx strutvane@<tag>`). Docker-mode forwarding and
     `setup` therefore differ from `node strut` there. Options: rename the framework bin
     (keep `strutvane-cli`), or accept it.
   - The pointer prints `npm create strutvane@next` while this package is a pre-release (same rule
     as create-strutvane's `releaseTag()`), `@latest` from 1.0; the spec said `@latest`.
   - The framework's `ABSORBED_PACKAGES` lists `strutvane` (doctor fails if it is installed in an
     app). That is consistent with npx-only use; the README says so.
4. Hub docs: the catalogue entry `id: strutvane` (`published: false`, `docs` URL points at the hub)
   and the docs page `versions/0.2.x/packages/strutvane.mdx` can link this repo's README.
5. Release: only with the core train, after the framework is published, and with the project
   lead's 2FA (never from this branch).

## How to verify

```bash
npm ci
npm run ci          # biome, tsc, vitest --coverage, tsdown
npm pack --pack-destination <tmp>
npm exec --yes --package=publint@0.3.25 -- publint run <tmp>/strutvane-0.2.0-next.0.tgz --strict
npm exec --yes --package=@arethetypeswrong/cli@0.18.5 -- attw <tmp>/strutvane-0.2.0-next.0.tgz --profile esm-only
```

On Windows, the file-symlink test skips itself without Developer Mode, and the POSIX signal tests
are skipped; CI on Linux runs them.
