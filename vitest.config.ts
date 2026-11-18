import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import { sharedConfig } from './vitest.shared.ts'

// Repo-specific overrides. Shared defaults (coverage 90/90/85/90, no .only, ...) come from
// strutvane-tooling.
// - Many tests start real child processes (Node itself, a stand-in strut.js): give a slow laptop
//   room.
// - src/bin.ts only wires main() to the real process (exit code, re-raising a signal); the
//   end-to-end tests run it as a child process, which coverage cannot see.
export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      exclude: [...configDefaults.exclude, '**/*.perf.test.ts'],
      testTimeout: 30_000,
      hookTimeout: 30_000,
      coverage: { exclude: ['src/bin.ts'] },
    },
  }),
)
