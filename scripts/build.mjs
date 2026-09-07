// Standalone binaries (no Node required on the target machine). Run with Bun:
//   bun scripts/build.mjs                 → windows-x64, macos-arm64, macos-x64
//   bun scripts/build.mjs linux-x64       → only that target (handy to smoke-test locally)
const TARGETS = {
  'windows-x64': { target: 'bun-windows-x64', outfile: 'dist/windows-x64/crate.exe' },
  'macos-arm64': { target: 'bun-darwin-arm64', outfile: 'dist/macos-arm64/crate' },
  'macos-x64': { target: 'bun-darwin-x64', outfile: 'dist/macos-x64/crate' },
  'linux-x64': { target: 'bun-linux-x64', outfile: 'dist/linux-x64/crate' },
};

// ink only imports react-devtools-core when DEV=true; stub it so the single-file bundle has no dangling import.
const stubDevtools = {
  name: 'stub-react-devtools',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: 'react-devtools-core', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {}', loader: 'js' }));
  },
};

const names = process.argv.length > 2 ? process.argv.slice(2) : ['windows-x64', 'macos-arm64', 'macos-x64'];
for (const name of names) {
  const t = TARGETS[name];
  if (!t) {
    console.error(`Unknown target "${name}". Known: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(2);
  }
  const result = await Bun.build({
    entrypoints: ['src/index.tsx'],
    plugins: [stubDevtools],
    define: { 'process.env.NODE_ENV': '"production"' },
    compile: { target: t.target, outfile: t.outfile },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(String(log));
    process.exit(1);
  }
  console.log(`✓ ${t.outfile}`);
}
