#!/usr/bin/env bash
# Put the web book back to the last deployed state before re-anchoring.
#
#   scripts/reset-web-book.sh           stop if the annotations have edits
#   scripts/reset-web-book.sh --force   throw those edits away
#
# Restores the committed book annotations and the web book that deploy.sh
# saved after its last successful publish (work/deployed/native-book). Run it
# before `BOOK_REANCHOR=1 npm run prepare:data` when a chapter changed.
set -euo pipefail

force=false
for arg in "$@"; do
  case "$arg" in
    --force) force=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

site="$(cd "$(dirname "$0")/.." && pwd)"
content="$(cd "$site" && node --input-type=module -e "import('./flyleaf-settings.mjs').then((m) => console.log(m.contentRoot()))")"
saved="$site/work/deployed/native-book"
annotations=(book-annotations.json book-annotations/)

if ! compgen -G "$saved/*.json" > /dev/null; then
  echo "No deployed web book saved at $saved. Deploy once first." >&2
  exit 1
fi
# Restoring the committed annotations throws away any edit not yet committed.
if ! changes="$(git -C "$content" status --porcelain --untracked-files=no -- "${annotations[@]}" 2>&1)"; then
  echo "The site content folder $content must be a git checkout: $changes" >&2
  exit 1
fi
if [ -n "$changes" ] && ! $force; then
  echo "These book annotations have edits that are not committed:" >&2
  echo "$changes" >&2
  echo "Commit them first, or run again with --force to throw the edits away." >&2
  exit 1
fi
git -C "$content" checkout -- "${annotations[@]}"
rm -f "$site"/public/data/native-book/*.json
cp "$saved"/*.json "$site/public/data/native-book/"
ls "$site/public/data/native-book/"
