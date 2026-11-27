"""Rebuilds every model in viz/assets/ from scratch.

    blender --background --python viz/blender/build_all.py

Needs Blender 5.3 (or a version with the same Python API). Each model is built
in an empty scene and exported as its own .glb.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts

import backdrops  # noqa: E402
import figures  # noqa: E402
from lib import export, reset, stats  # noqa: E402

ASSETS = HERE.parent / "assets"
DATA = HERE.parent / "data" / "trajectories.json"


def bat_half_width():
    """The bat's width comes from the same constants the page reads."""
    try:
        return json.loads(DATA.read_text())["meta"]["constants"]["bat_half_width"]
    except (OSError, KeyError, ValueError):
        return 0.054


MODELS = [
    ("batter", lambda: figures.build_batter(bat_half_width()), True),
    ("bowler", figures.build_bowler, False),
    ("slip", figures.build_slip, False),
    ("lords", backdrops.build_lords, False),
    ("perth", backdrops.build_perth, False),
    ("newlands", backdrops.build_newlands, False),
]


def main():
    ASSETS.mkdir(exist_ok=True)
    report = []
    for name, build, animated in MODELS:
        reset()
        build()
        path = ASSETS / f"{name}.glb"
        export(path, animations=animated)
        report.append((name, stats(path)))
    print("\nMODEL        BYTES  TRIANGLES  NODES  CLIPS")
    for name, s in report:
        print(f"{name:<10} {s['bytes']:>7} {s['triangles']:>10} {s['nodes']:>6}  {', '.join(s['clips'])}")


main()
