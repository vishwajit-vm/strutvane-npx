import { defineConfig } from 'tsdown'

// One entry: the `strutvane` bin. The package has no library API (only `./package.json` is
// exported), so no type declarations are emitted.
export default defineConfig({
  entry: { bin: 'src/bin.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  fixedExtension: true,
  dts: false,
  sourcemap: true,
  clean: true,
})
