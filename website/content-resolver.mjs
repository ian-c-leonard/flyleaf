// Node module hook: "@content/<file>" imports read the family's site content
// file, or Flyleaf's empty default when the family has none, as the Vite
// plugin does in the build. Registered by flyleaf-globals.mjs.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let content, defaults;

export function initialize(data) {
  ({ content, defaults } = data);
}

export function resolve(specifier, context, next) {
  if (!specifier.startsWith('@content/')) return next(specifier, context);
  const name = specifier.slice('@content/'.length);
  const own = new URL(name, content);
  const fallback = new URL(name, defaults);
  const chosen = existsSync(fileURLToPath(own)) || !existsSync(fileURLToPath(fallback)) ? own : fallback;
  return next(chosen.href, context);
}
