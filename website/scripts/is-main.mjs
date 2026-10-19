import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** True when the module at `url` is the script node was asked to run. Node
 * names a module by its real path, so the command's path is resolved the
 * same way (a temporary folder on macOS is reached through a link). */
export function isMain(url) {
  let main = false;
  try {
    main =
      !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(url);
  } catch {
    return false;
  }
  if (main) plainFamilyErrors();
  return main;
}

/** A problem the family can fix (FamilyError, in flyleaf-settings.mjs)
 * prints as its message alone; anything else keeps its stack trace. */
export function plainFamilyErrors() {
  const stop = (error) => {
    console.error(error?.name === 'FamilyError' ? error.message : error);
    process.exit(1);
  };
  process.on('uncaughtException', stop);
  process.on('unhandledRejection', stop);
}
