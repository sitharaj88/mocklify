import type * as vscode from 'vscode';
import { API_FILE_GLOB, SCAN_EXCLUDE_GLOB } from './heuristics.js';

/**
 * Two-pass workspace enumeration for the inclusive (blocklist-gated) scans.
 *
 * findFiles applies its maxResults cap BEFORE any shouldScanPath filtering and
 * returns files in unspecified order, so a single findFiles('**\/*', …, cap)
 * on a big repo can spend the whole cap on assets/fixtures and never surface
 * the actual source files. This helper guarantees the known source extensions
 * are always in the pool: pass 1 enumerates the legacy API_FILE_GLOB
 * whitelist (every hit is a source file), pass 2 tops the pool up with
 * '**\/*' for unknown extensions until maxResults is reached.
 *
 * vscode is required lazily so modules importing this stay loadable under
 * vitest (same pattern as workspaceTools/projectProfile).
 */
export async function enumerateScanCandidates(
  maxResults: number,
  root?: vscode.Uri
): Promise<vscode.Uri[]> {
  // Lazy so importers' pure exports stay usable outside the extension host.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vs: typeof import('vscode') = require('vscode');
  const pattern = (glob: string): vscode.GlobPattern =>
    root ? new vs.RelativePattern(root, glob) : glob;

  const known = await vs.workspace.findFiles(
    pattern(API_FILE_GLOB),
    SCAN_EXCLUDE_GLOB,
    maxResults
  );
  const byKey = new Map<string, vscode.Uri>();
  for (const uri of known) {
    byKey.set(uri.toString(), uri);
  }
  if (byKey.size < maxResults) {
    const rest = await vs.workspace.findFiles(pattern('**/*'), SCAN_EXCLUDE_GLOB, maxResults);
    for (const uri of rest) {
      if (byKey.size >= maxResults) {
        break;
      }
      const key = uri.toString();
      if (!byKey.has(key)) {
        byKey.set(key, uri);
      }
    }
  }
  return [...byKey.values()];
}
