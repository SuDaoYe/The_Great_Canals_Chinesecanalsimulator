// Temporary Node type-stripping resolver for extensionless TS imports.
// Used only because the sandbox blocks tsx/esbuild child processes.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const candidates = [specifier, `${specifier}.ts`, `${specifier}/index.ts`];
    for (const candidate of candidates) {
      const url = new URL(candidate, context.parentURL);
      if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context);
    }
  }
  return nextResolve(specifier, context);
}
