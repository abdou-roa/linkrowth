const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "npm-shrinkwrap.json",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "composer.lock",
  "go.sum",
  "Bun.lockb",
  "bun.lock",
]);

const META_NAMES = new Set([".gitignore", ".gitattributes", ".editorconfig"]);

const ASSET_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".mp4",
  ".mov",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
]);

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? path;
}

function extname(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i).toLowerCase();
}

/** True if this single path is lockfile / ignore meta / static asset. */
export function isNonArchitecturalPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  const base = basename(normalized);

  if (LOCKFILE_NAMES.has(base)) return true;
  if (META_NAMES.has(base)) return true;
  if (ASSET_EXTENSIONS.has(extname(normalized))) return true;
  return false;
}

/**
 * True when every touched path is non-architectural (or there are no paths).
 * Empty path list does NOT auto-drop — extract may omit stats; leave to other rules.
 */
export function isNonArchitecturalOnly(paths: string[]): boolean {
  if (paths.length === 0) return false;
  return paths.every(isNonArchitecturalPath);
}
