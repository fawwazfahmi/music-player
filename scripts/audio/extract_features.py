#!/usr/bin/env python3
"""Extract audio features from local files using Essentia + pre-trained MTG models.

Reads file paths from argv (or stdin, one per line) and prints one JSON object
per line: {"path", "ok", "features"|"error"}. Features:
  - mood_happy / mood_sad / mood_relaxed / mood_aggressive / mood_party : 0..1
    (mean positive-class probability from MusiCNN-MSD models)
  - danceability : 0..1 (ML), danceability_dsp : ~0..3 (DSP)
  - tempo : BPM, key / scale / key_strength
This is the "hearing the song" layer that feeds the mood seeder.
"""
import sys
import os
import json

import numpy as np
from essentia.standard import (
    MonoLoader,
    TensorflowPredictMusiCNN,
    RhythmExtractor2013,
    KeyExtractor,
    Danceability,
)

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "models", "audio")

# The positive class label to read for each model (class order differs per model).
POSITIVE = {
    "danceability": "danceable",
    "mood_happy": "happy",
    "mood_sad": "sad",
    "mood_relaxed": "relaxed",
    "mood_aggressive": "aggressive",
    "mood_party": "party",
}


def load_models():
    models = {}
    for name, pos_label in POSITIVE.items():
        pb = os.path.join(MODELS_DIR, f"{name}-musicnn-msd-2.pb")
        meta = json.load(open(os.path.join(MODELS_DIR, f"{name}-musicnn-msd-2.json")))
        pos_idx = meta["classes"].index(pos_label)
        models[name] = (
            TensorflowPredictMusiCNN(graphFilename=pb, output="model/Sigmoid"),
            pos_idx,
        )
    return models


MODELS = load_models()


def analyze(path):
    out = {}
    audio16 = MonoLoader(filename=path, sampleRate=16000, resampleQuality=4)()
    for name, (model, pos) in MODELS.items():
        preds = model(audio16)  # shape (frames, 2)
        arr = np.asarray(preds)
        out[name] = float(np.mean(arr[:, pos])) if arr.ndim == 2 else float(np.mean(arr))

    audio44 = MonoLoader(filename=path, sampleRate=44100, resampleQuality=4)()
    try:
        bpm = RhythmExtractor2013(method="multifeature")(audio44)[0]
        out["tempo"] = float(bpm)
    except Exception:
        out["tempo"] = None
    try:
        key, scale, strength = KeyExtractor()(audio44)
        out["key"] = key
        out["scale"] = scale
        out["key_strength"] = float(strength)
    except Exception:
        pass
    try:
        out["danceability_dsp"] = float(Danceability()(audio44)[0])
    except Exception:
        pass
    return out


def main():
    paths = sys.argv[1:]
    if not paths:
        paths = [line.strip() for line in sys.stdin if line.strip()]
    for path in paths:
        try:
            feats = analyze(path)
            print(json.dumps({"path": path, "ok": True, "features": feats}))
        except Exception as e:  # noqa: BLE001 — report, keep going
            print(json.dumps({"path": path, "ok": False, "error": str(e)}))
        sys.stdout.flush()


if __name__ == "__main__":
    main()
