"""The game's one-shot sound effects, made with the film's own sound design.

Loads the synth primitives from vg-showcase-demo/battle/sfx.py (its score is
not run) and renders each game sound the way the film layers that moment,
then writes assets/sfx/<name>.wav (converted to .m4a by the caller).

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/make-sfx.py
"""
import os
import sys

import numpy as np

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BATTLE = os.path.join(os.path.dirname(APP), "vg-showcase-demo", "battle")
sys.path.insert(0, BATTLE)
src = open(os.path.join(BATTLE, "sfx.py")).read()
src = src[: src.index("if True:  # run under blender -P")]
S = {"__file__": os.path.join(BATTLE, "sfx.py"), "__name__": "sfx_lib"}
exec(compile(src, "sfx.py", "exec"), S)

SR = S["SR"]
T, band, noise, norm = S["T"], S["band"], S["noise"], S["norm"]
whoosh, metal, clash, boom, scrape = S["whoosh"], S["metal"], S["clash"], S["boom"], S["scrape"]


def mixdown(layers, d, verb=0.3, rt=1.6):
    """layers: (mono, gain, at_seconds, pan) -> stereo with a touch of the film's room."""
    n = int(d * SR)
    dry = np.zeros((2, n))
    for x, g, at, pan in layers:
        i = int(at * SR)
        m = min(len(x), n - i)
        a = (pan + 1) * np.pi / 4
        dry[0, i : i + m] += x[:m] * g * np.cos(a)
        dry[1, i : i + m] += x[:m] * g * np.sin(a)
    wet = S["reverb"](dry, rt) if verb else 0
    y = dry + wet * verb
    y = np.tanh(y / (np.max(np.abs(y)) or 1) * 1.2)
    y *= 10 ** (-1 / 20) / (np.max(np.abs(y)) or 1)
    # short fade so nothing clicks at the cut
    k = int(0.03 * SR)
    y[:, -k:] *= np.linspace(1, 0, k)
    return y


def stereo_clash(d, base, seed, body=0.5):
    return [(clash(d, base, seed, body), 0.75, 0.0, -0.45), (clash(d, base * 1.013, seed + 100, body), 0.75, 0.004, 0.45)]


SOUNDS = {
    # a blade cutting air (the exchange's swings)
    "swing": lambda: mixdown([(whoosh(0.34, 700, 5000, 0.4), 0.9, 0, -0.2), (whoosh(0.3, 800, 5200, 0.4), 0.6, 0.01, 0.3)], 0.42, 0.15),
    # steel on steel, a light hit (hit1..hit3)
    "hit": lambda: mixdown(stereo_clash(1.3, 2700, 21) + [(boom(0.4, 150, 60, 0.08, 0.3), 0.3, 0, 0)], 1.3, 0.35),
    # the thrust landing (hit4) with more weight
    "heavy": lambda: mixdown(stereo_clash(1.5, 3300, 25) + [(boom(0.9, 120, 40, 0.3), 0.55, 0, 0)], 1.5, 0.35),
    # a blow caught on the guard: a short ring and a scrape
    "block": lambda: mixdown(stereo_clash(0.8, 3100, 24, 0.2) + [(scrape(0.3, 2500, 9000), 0.25, 0.02, 0)], 0.9, 0.25),
    # the clash (a parry): the film's first big hit
    "clash": lambda: mixdown(
        stereo_clash(2.4, 2300, 1) + [(metal(2.6, 1150, 0.8, seed=2), 0.35, 0, 0), (boom(1.6, 120, 34, 0.5), 0.8, 0, 0), (scrape(0.62, 2500, 9000), 0.28, 0.18, 0)],
        2.6,
        0.5,
    ),
    # the slam and the ground wave launching
    "slam": lambda: mixdown(
        [
            (boom(1.4, 100, 30, 0.45), 0.75, 0, 0.2),
            (band(noise(0.25), 300, 3000) * np.exp(-T(0.25) / 0.06), 0.4, 0, 0.2),
            (whoosh(0.22, 300, 1800, 1.4), 0.55, 0.01, 0),
            (norm(band(noise(0.2), 40, 200)) * np.linspace(0.2, 1, int(0.2 * SR)), 0.35, 0.01, 0),
        ],
        1.5,
        0.3,
    ),
    # the wave landing
    "wave": lambda: mixdown(
        [(boom(1.2, 130, 36, 0.4), 0.8, 0, -0.3)] + stereo_clash(1.4, 2000, 31) + [(scrape(0.62, 900, 4500), 0.3, 0.05, -0.4)], 1.4, 0.3
    ),
    # the dash: two whooshes and a push-off thump
    "dash": lambda: mixdown(
        [(whoosh(0.55, 250, 2800, 0.5), 0.45, 0, -0.6), (whoosh(0.55, 230, 2500, 0.5), 0.45, 0.02, 0.6), (boom(0.6, 90, 40, 0.15, 0.8), 0.35, 0.05, 0)],
        0.7,
        0.15,
    ),
    # a fighter going down
    "down": lambda: mixdown([(boom(1.6, 70, 28, 0.6), 0.7, 0, 0), (metal(1.4, 3300, 1.0, seed=77) * np.exp(-T(1.4) / 0.3), 0.18, 0.1, -0.3)], 1.6, 0.5),
}

out = os.path.join(APP, "assets", "sfx")
os.makedirs(out, exist_ok=True)
for name, make in SOUNDS.items():
    S["write"](os.path.join(out, name + ".wav"), make())
    print("[sfx]", name)
