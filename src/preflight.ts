/** Evaluated before anything else: a clear message beats a stack trace from a missing API. */
const MIN_NODE = 22;

export function nodeVersionProblem(versions: NodeJS.ProcessVersions = process.versions): string | null {
  if (versions.bun) return null; // standalone binary: Bun ships its own runtime
  const major = Number(versions.node.split('.')[0]);
  if (major >= MIN_NODE) return null;
  return `Crate Digger needs Node ${MIN_NODE} or newer, found ${versions.node}.\nInstall it from https://nodejs.org, or with nvm: nvm install ${MIN_NODE} && nvm use ${MIN_NODE}`;
}

const problem = nodeVersionProblem();
if (problem) {
  console.error(problem);
  process.exit(2);
}
