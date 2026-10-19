#!/usr/bin/env bash
# Rebuild the site exactly as the last deploy did, then compare every file.
#
#   scripts/rebuild-and-compare.sh            site only (reuses build/book.pdf)
#   scripts/rebuild-and-compare.sh --book     rebuild the book PDF too
#
# The build time is pinned to the last book build's recorded timestamp, so
# an unchanged family rebuilds byte for byte. The comparison is against
# work/deployed/hashes.json, which deploy.sh writes after every publish, so
# it works only for a site published with the Worker.
set -euo pipefail

site="$(cd "$(dirname "$0")/.." && pwd)"
engine="$(cd "$site/.." && pwd)"
family="$(cd "$site" && node --input-type=module -e "import('./flyleaf-settings.mjs').then((m) => console.log(m.familyRoot()))")"
hosting="$(cd "$site" && node --input-type=module -e "import('./flyleaf-settings.mjs').then((m) => console.log(m.siteHosting()))")"
if [ "$hosting" != worker ]; then
  echo "flyleaf gate compares a rebuild with the last deploy, which only a Worker" >&2
  echo "site has. This family's site is static (site.hosting in flyleaf.json)." >&2
  exit 2
fi
book=false
[ "${1:-}" = "--book" ] && book=true

SOURCE_DATE_EPOCH="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).toolchain.creationTimestamp)" "$family/build/book-publication.json")"
export SOURCE_DATE_EPOCH
echo "Build time pinned to $SOURCE_DATE_EPOCH"

if $book; then
  # The same Python as the flyleaf command.
  py="${PYTHON:-}"
  if [ -z "$py" ]; then
    for candidate in "$family/.venv/bin/python3" "$engine/.venv/bin/python3" python3; do
      if command -v "$candidate" > /dev/null; then py="$candidate"; break; fi
    done
  fi
  "$py" "$engine/flyleaf" book --family "$family"
fi
cd "$site"
npm run build > /dev/null
npm run prepare:hosting > /dev/null
npx wrangler deploy --dry-run --outdir work/worker-bundle > /dev/null
node scripts/build-hashes.mjs --compare work/deployed/hashes.json
