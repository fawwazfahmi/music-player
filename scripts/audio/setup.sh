#!/usr/bin/env bash
# Reproducible setup for Phase 6 audio-feature analysis.
# Creates a Python venv with Essentia (+ TensorFlow) and downloads the
# pre-trained MTG MusiCNN-MSD models used by scripts/audio/extract_features.py.
#
# Usage: bash scripts/audio/setup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# The venv lives OUTSIDE the repo: a Python venv's symlinks break Turbopack's
# project scan during `next build`. Point AUDIO_ANALYZER_PY at it (see .env).
PY="${AUDIO_PYTHON:-python3.12}"
VENV="${AUDIO_VENV:-$HOME/.cache/kyowave/audio-venv}"
MODELS="$ROOT/models/audio"
BASE_URL="https://essentia.upf.edu/models/classifiers"

echo "→ Creating venv at $VENV ($($PY --version))"
mkdir -p "$(dirname "$VENV")"
"$PY" -m venv "$VENV"
"$VENV/bin/python" -m pip install --quiet --upgrade pip
echo "→ Installing essentia-tensorflow (this is large, ~1GB)"
"$VENV/bin/python" -m pip install --quiet essentia-tensorflow numpy

echo "→ Downloading pre-trained models to $MODELS"
mkdir -p "$MODELS"
for name in danceability mood_happy mood_sad mood_relaxed mood_aggressive mood_party; do
  for ext in pb json; do
    curl -fsSL -o "$MODELS/${name}-musicnn-msd-2.${ext}" \
      "$BASE_URL/${name}/${name}-musicnn-msd-2.${ext}"
  done
  echo "  ✓ $name"
done

echo "→ Verifying"
"$VENV/bin/python" -c "import essentia.standard as es; assert hasattr(es,'TensorflowPredictMusiCNN'); print('essentia OK')"
echo "Done. Extract with: $VENV/bin/python scripts/audio/extract_features.py <file>"
