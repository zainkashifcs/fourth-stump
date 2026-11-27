"""The wicket: three ash stumps and two bails on one armature, with the clip
Stumps_Shatter (the off and middle stumps knocked backwards, the bails spinning up).

Authored in the page's data axes, which are Blender's own: +x is the off side
of a right-hander, +y points up the pitch at the bowler, +z is up. The origin is
the base of the middle stump.
"""
from math import pi

from mathutils import Matrix, Vector

from lib import FPS, Shape, armature, bake
from textures import kit_atlas

STUMP_RADIUS = 0.019
BAIL_RADIUS = 0.018  # stouter than life, like the ball, so they can be seen flying
GRAVITY = -9.81
DURATION = 1.0


def flight(centre, velocity, lands_at, time):
    """Where something knocked into the air at time 0 is at `time`, and how much
    of its flight is done (0 to 1): a parabola that stops when the centre meets
    the height `lands_at`."""
    a, b, c = 0.5 * GRAVITY, velocity.z, centre.z - lands_at
    landing = (-b - (b * b - 4 * a * c) ** 0.5) / (2 * a)
    t = min(time, landing)
    return centre + velocity * t + Vector((0, 0, a * t * t)), t / landing


def build_stumps(half_width, height):
    outer = half_width - STUMP_RADIUS  # the off stump's outer edge sits at stump_half_width
    stumps = {"leg": -outer, "middle": 0.0, "off": outer}
    bail_z = height + BAIL_RADIUS
    bails = {"bail_leg": (-outer / 2, Vector((-1.0, -1.1, 3.6)), -9.0), "bail_off": (outer / 2, Vector((1.3, -1.6, 3.2)), 11.0)}

    shape = Shape(kit_atlas())
    bones = {}
    for name, x in stumps.items():
        shape.part(Matrix.Translation((x, 0, 0)), name)
        shape.cone(STUMP_RADIUS, STUMP_RADIUS, height, 6, Matrix.Translation((0, 0, height / 2)), "ash")
        bones[name] = (None, Vector((x, 0, 0)), Vector((x, 0, height)))
    for name, (x, _, _) in bails.items():
        shape.part(Matrix.Translation((x, 0, bail_z)), name)
        shape.cone(BAIL_RADIUS, BAIL_RADIUS, outer * 0.96, 5, Matrix.Rotation(pi / 2, 4, "Y"), "bail")
        bones[name] = (None, Vector((x, 0, bail_z)), Vector((x + 0.05, 0, bail_z)))
    rig = armature("stumps", bones, shape.finish("stumps_mesh"))

    half = Vector((0, 0, height / 2))
    frames = []
    for frame in range(round(DURATION * FPS) + 1):
        t = frame / FPS
        # off stump: out of the ground and cartwheeling back, to lie flat behind the wicket
        centre, done = flight(Vector((outer, 0, 0)) + half, Vector((0.5, -3.0, 2.4)), 0.04, t)
        joints = {"off": Matrix.Translation(centre) @ Matrix.Rotation(1.5 * pi * done, 4, "X") @ Matrix.Translation(-half)}
        # middle stump: knocked flat backwards about its base
        fall = min(t / 0.45, 1) ** 2
        joints["middle"] = Matrix.Rotation(0.48 * pi * fall, 4, "X") @ Matrix.Rotation(0.2 * fall, 4, "Y")
        # leg stump: left standing, rocking once
        rock = -0.12 * min(t / 0.05, 1) * (1 - min(t / 0.6, 1))
        joints["leg"] = Matrix.Translation((-outer, 0, 0)) @ Matrix.Rotation(rock, 4, "Y")
        for name, (x, velocity, spin) in bails.items():
            centre, done = flight(Vector((x, 0, bail_z)), velocity, BAIL_RADIUS, t)
            joints[name] = Matrix.Translation(centre) @ Matrix.Rotation(spin * done, 4, "X") @ Matrix.Rotation(0.6 * spin * done, 4, "Z")
        frames.append(joints)
    bake(rig, "Stumps_Shatter", frames)
