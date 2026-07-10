/**
 * Route-path coverage matching, extracted verbatim from DriftWatcher.ts so the
 * rescan differ can reuse the exact drift semantics without importing vscode.
 * Pure — zero vscode imports, fully vitest-importable.
 */

function segmentsMatch(route: string[], candidate: string[]): boolean {
  if (route.length !== candidate.length) {
    return false;
  }
  for (let i = 0; i < route.length; i++) {
    const r = route[i];
    const c = candidate[i];
    if (r.startsWith(':') || r === '*' || c.startsWith(':')) {
      continue;
    }
    if (r.toLowerCase() !== c.toLowerCase()) {
      return false;
    }
  }
  return true;
}

/**
 * A candidate is covered when some route matches it segment-wise (:param and *
 * are wildcards). A route may carry a base prefix the client omits (Retrofit
 * relative paths), so a route whose tail matches the candidate also counts.
 */
export function isPathCovered(candidate: string, routePaths: string[]): boolean {
  const c = candidate.split('/').filter(Boolean);
  return routePaths.some((routePath) => {
    const r = routePath.split('/').filter(Boolean);
    if (r.length > 0 && r[r.length - 1] === '*' && c.length >= r.length - 1) {
      return segmentsMatch(r.slice(0, -1), c.slice(0, r.length - 1));
    }
    if (r.length < c.length) {
      return false;
    }
    return segmentsMatch(r.slice(r.length - c.length), c);
  });
}
