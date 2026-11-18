# NEXT.md: `strutvane` (npx guard), branch `v2/npx`

Status of this branch for the next session. Facts here are checked against git and the gate output;
anything not re-run by the coordinator is marked *(agent-reported)*.

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
- Canonical files copied verbatim from `packages/tooling/canonical` (configs, `.npmrc`,
  `.gitignore`, `.claude/` synced files) so the gate runs; `.github/` deliberately not written.

## Next

1. **Tooling:** add this repo to `packages/tooling/manifest.json` as a library target
   (`{ "name": "npx", "profile": "library" }`), run `node packages/tooling/scripts/sync.mjs`; that
   writes `.github/workflows`, `.github/scripts`, `dependabot.yml` and `RELEASE-READINESS.md`.
   The copied config files should then show no drift.
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
