#!/usr/bin/env bash
# Publish the grvocab CSV: copy it into this repo, commit if it changed, push.
set -euo pipefail

SRC="/Users/nikitayuriev/Library/CloudStorage/Dropbox-Personal/Greek/Εξετάσεις/Claude-gr/greek_vocab.csv"
cd "$(dirname "$0")"

cp "$SRC" vocab.csv
# Also refresh Clio's copy (desktop avatar); never let it block publishing the flashcards.
bash "/Users/nikitayuriev/Library/CloudStorage/Dropbox-Personal/Claude-code-projects/Coding-projects/_Desktop-avatar/tools/sync-greek-vocab.sh" "$SRC" \
  || echo "Clio vocab sync failed (flashcards unaffected)"
if git diff --quiet -- vocab.csv; then
  echo "vocab.csv already up to date"
else
  words=$(( $(grep -c . vocab.csv) - 1 ))
  git add vocab.csv
  git commit -q -m "Update vocab: $words words" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- vocab.csv
  echo "Committed: $words words"
fi
git push -q origin main
echo "Pushed to GitHub"
