#!/usr/bin/env bash
# Build and publish the family website named in flyleaf.json.
#
#   scripts/deploy.sh             rebuild the book PDF and site, test, publish
#   scripts/deploy.sh --skip-book reuse the current build/book.pdf
#   scripts/deploy.sh --dry-run   build and test only; publish nothing
#
# Credentials come from cloudflare.env in deploy.credentials_dir (flyleaf.json).
set -euo pipefail

skip_book=false
dry_run=false
for arg in "$@"; do
  case "$arg" in
    --skip-book) skip_book=true ;;
    --dry-run) dry_run=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

site="$(cd "$(dirname "$0")/.." && pwd)"
# The Flyleaf engine (code) and the family folder (flyleaf.json, content, build).
engine="$(cd "$site/.." && pwd)"
family="$(cd "$site" && node --input-type=module -e "import('./flyleaf-settings.mjs').then((m) => console.log(m.familyRoot()))")"
export FLYLEAF_FAMILY="$family"
# The same Python as the flyleaf command: a .venv in the family folder, else
# one in Flyleaf's folder, else python3.
python="${PYTHON:-}"
if [ -z "$python" ]; then
  for candidate in "$family/.venv/bin/python3" "$engine/.venv/bin/python3" python3; do
    if command -v "$candidate" > /dev/null; then python="$candidate"; break; fi
  done
fi
export PYTHON="$python"
setting() { node -e "const s=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log($1)" "$family/flyleaf.json"; }
hosting="$(cd "$site" && node --input-type=module -e "import('./flyleaf-settings.mjs').then((m) => console.log(m.siteHosting()))")"
if [ "$hosting" = static ]; then
  echo "This family's site is static (site.hosting in flyleaf.json). Build it with" >&2
  echo "flyleaf site build, then publish website/dist/client with any static host." >&2
  exit 2
fi
# CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, in deploy.credentials_dir.
# Only wrangler and the archive upload read them, each from the file itself.
credentials="$(setting "s.deploy?.credentials_dir || '~/.config/flyleaf'")"
env_file="${credentials/#\~/$HOME}/cloudflare.env"
wrangler() { node --env-file="$env_file" "$site/node_modules/wrangler/bin/wrangler.js" "$@"; }
domain="$(setting s.site.domain)"
database="$(setting s.cloudflare.submissions_db.name)"

step() { printf '\n== %s\n' "$*"; }
# Settings that work but should not stay on a live site, such as a Clerk
# development key. Printed last, so a long log cannot hide them.
warnings() {
  node --input-type=module -e "import('./scripts/write-wrangler.mjs').then((m) => m.deployWarnings().forEach((w) => console.warn('\nWarning: ' + w)))"
}

# Publish only committed work, so the live site always matches a commit: all
# of Flyleaf's folder, and every family path the builds read.
if ! $dry_run; then
  (cd "$site" && node scripts/check-committed.mjs)
fi

# The same build as `flyleaf book`: the PDF, then the citation map that the
# site build checks against the stories.
if ! $skip_book; then
  step "Building the book"
  "$python" "$engine/flyleaf" book --family "$family"
fi

cd "$site"
# Exactly the packages package-lock.json names.
step "Installing the website's packages"
npm ci

step "Building the site"
npm run build

# The same suites as `flyleaf test`, the type and lint checks, the sign-in
# page tests, and the family-text check.
step "Testing"
(cd "$family" && "$python" "$engine/scripts/check-family-text.py")
npm run typecheck
npm run lint
npm run worker:typecheck
npm run worker:lint
npm run archive:lint
node --test tests/login-branding.test.mjs
"$python" "$engine/flyleaf" test --family "$family"

step "Packaging for hosting"
npm run prepare:hosting

if $dry_run; then
  step "Dry run: checking the Worker bundle"
  npx wrangler deploy --dry-run --outdir work/worker-bundle
  echo "Dry run finished. Nothing was published."
  warnings
  exit 0
fi

# The upload stops if the archive bucket or the submissions bucket has a
# public address, or if a file it holds has different contents from the
# local file of the same name.
step "Uploading new archive files"
node --env-file="$env_file" scripts/upload-new-originals.mjs

# Database changes only add to what is there, so the running site keeps working.
step "Applying database changes"
wrangler d1 migrations apply "$database" --remote

step "Bundling the Worker"
wrangler deploy --dry-run --outdir work/worker-bundle

step "Publishing the Worker and site files"
message="$(git -C "$family" log -1 --format='%h %s' | cut -c1-100)"
wrangler deploy --message "$message"

# Without a session, the home page must send a visitor to sign in, and the
# family tree and an original must be refused.
step "Checking the live site is closed to visitors who have not signed in"
node scripts/verify-live.mjs --signed-out

# The next re-anchor starts from exactly what is live now.
step "Saving the deployed web book"
rm -rf work/deployed/native-book
mkdir -p work/deployed/native-book
cp public/data/native-book/*.json work/deployed/native-book/

# Every published file must match the local package: each static file byte
# for byte, and each original by its size and MD5. A fresh deploy can take a
# minute to reach every edge, so a mismatch gets one retry.
step "Checking every live file matches the build"
if ! node scripts/verify-live.mjs; then
  echo "Retrying in 60 seconds, in case the new files are still spreading." >&2
  sleep 60
  node scripts/verify-live.mjs
fi

# The hash of every published file is the baseline the next build is
# compared against (scripts/build-hashes.mjs --compare work/deployed/hashes.json).
node scripts/build-hashes.mjs --write work/deployed/hashes.json
echo "Published https://$domain/"
warnings
