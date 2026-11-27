"""Rebuilds every model in viz/assets/ from scratch.

    blender --background --python viz/blender/build_all.py
    blender --background --python viz/blender/build_all.py -- batter slip   (only those)

Needs Blender 5.3 (or a version with the same Python API). Each model is built
in an emptied scene and exported as its own .glb. It can also be run inside an
open Blender (it empties the open file), which leaves the last model on screen.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
for stale in ("lib", "textures", "figures", "stumps", "backdrops", "stadium"):
    sys.modules.pop(stale, None)  # an open Blender would otherwise keep the copies from its last build

import backdrops  # noqa: E402
import figures  # noqa: E402
import stumps  # noqa: E402
import stadium  # noqa: E402
from lib import export, reset, stats  # noqa: E402

ASSETS = HERE.parent / "assets"
DATA = HERE.parent / "data" / "trajectories.json"


def constant(name, default):
    """Sizes come from the same constants the page reads."""
    try:
        return json.loads(DATA.read_text())["meta"]["constants"][name]
    except (OSError, KeyError, ValueError):
        return default


MODELS = [
    ("batter", lambda: figures.build_batter(constant("bat_half_width", 0.054)), True),
    ("bowler", figures.build_bowler, True),
    ("stumps", lambda: stumps.build_stumps(constant("stump_half_width", 0.1143), constant("stump_height", 0.711)), True),
    ("slip", figures.build_slip, True),
    ("fielder", figures.build_fielder, True),
    ("lords", backdrops.build_lords, False),
    ("perth", backdrops.build_perth, False),
    ("newlands", backdrops.build_newlands, False),
    ("stadium", stadium.build_stadium, False),
]


def main():
    """Builds every model, or only those named after `--` on the command line."""
    ASSETS.mkdir(exist_ok=True)
    wanted = set(sys.argv[sys.argv.index("--") + 1:]) if "--" in sys.argv else None
    report = []
    for name, build, animated in MODELS:
        if wanted and name not in wanted:
            continue
        reset()
        build()
        path = ASSETS / f"{name}.glb"
        export(path, animations=animated)
        report.append((name, stats(path)))
    print("\nMODEL        BYTES  TRIANGLES  NODES  TEXTURES  CLIPS AND EXTRAS")
    for name, s in report:
        print(f"{name:<10} {s['bytes']:>7} {s['triangles']:>10} {s['nodes']:>6} {s['textures']:>9}  {', '.join(s['clips'])} {s['extras'] or ''}")


main()
