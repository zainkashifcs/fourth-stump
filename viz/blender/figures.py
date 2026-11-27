"""Low-poly Test cricketers in 1970s to 1990s whites: cream cable-knit sweater with
navy and burgundy trim, flannels, cap or sun hat, and for the batter pads, gloves
and a bat.

Each figure is one mesh, rigidly skinned: every part follows exactly one bone, as
on a PlayStation. Figures are authored in a rig frame, +Y up, facing +Z, left
hand on +X, which is the frame the .glb ends up in. Limbs hang down their
joint's -Y axis, so on a hanging limb a negative X rotation swings it forward
and a positive Z rotation swings it to the left.

A pose is a dict of joint Euler angles, plus `root` (x, z), `lift` (height off
the ground) and the bat's position. A clip is a list of timed poses, sampled at
every frame through a spline and baked, so the hands stay on the bat between
the poses.
"""
from math import pi, sqrt

from mathutils import Matrix, Vector

from lib import FPS, Shape, armature, bake, empty, scaled
from textures import kit_atlas

# Rig (x, y, z) is Blender (x, -z, y).
TO_BLENDER = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
DOWN = Vector((0, -1, 0))

HIP, THIGH, SHIN = 0.92, 0.45, 0.47
SHOULDER_X, SHOULDER_Y, UPPER_ARM, FOREARM = 0.22, 0.44, 0.29, 0.3
HANDLE, BLADE = 0.3, 0.56
BAT_REST = Vector((0.36, 0.95, 0.1))  # where the bat hangs in the rest pose

# name: (parent, offset from the parent joint), parents first
JOINTS = {
    "body": (None, (0, 0, 0)),  # carries the pose offset and the lift that grounds the feet
    "hips": ("body", (0, HIP, 0)),
    "torso": ("hips", (0, 0, 0)),
    "head": ("torso", (0, 0.5, 0)),
    "armL": ("torso", (SHOULDER_X, SHOULDER_Y, 0)),
    "foreL": ("armL", (0, -UPPER_ARM, 0)),
    "armR": ("torso", (-SHOULDER_X, SHOULDER_Y, 0)),
    "foreR": ("armR", (0, -UPPER_ARM, 0)),
    "legL": ("hips", (0.1, 0, 0)),
    "shinL": ("legL", (0, -THIGH, 0)),
    "legR": ("hips", (-0.1, 0, 0)),
    "shinR": ("legR", (0, -THIGH, 0)),
}
# how far each bone's tail lies from its head, along rig Y
BONE_LENGTH = {
    "body": 0.1, "hips": 0.12, "torso": 0.45, "head": 0.22, "armL": -UPPER_ARM, "foreL": -FOREARM,
    "armR": -UPPER_ARM, "foreR": -FOREARM, "legL": -THIGH, "shinL": -SHIN, "legR": -THIGH, "shinR": -SHIN,
}


def euler(angles):
    """Rotation matrix for XYZ Euler angles, the order Three.js uses."""
    x, y, z = angles
    return Matrix.Rotation(x, 4, "X") @ Matrix.Rotation(y, 4, "Y") @ Matrix.Rotation(z, 4, "Z")


def to_blender_rotation(rotation):
    return (TO_BLENDER @ rotation.to_3x3() @ TO_BLENDER.transposed()).to_quaternion()


def to_blender(matrix):
    """A rig-frame transform as a Blender-frame transform."""
    return Matrix.Translation(TO_BLENDER @ matrix.translation) @ to_blender_rotation(matrix).to_matrix().to_4x4()


def place(center, rot=(0, 0, 0)):
    return Matrix.Translation(TO_BLENDER @ Vector(center)) @ to_blender_rotation(euler(rot)).to_matrix().to_4x4()


def box(shape, size, center, tile, rot=(0, 0, 0)):
    width, height, depth = size
    shape.cube(scaled(place(center, rot), width, depth, height), tile)


def prism(shape, top, bottom, height, center, tile, sides=6, squash=1.0):
    shape.cone(bottom, top, height, sides, scaled(place(center), 1, squash, 1), tile)


# Parts, each in its own joint's frame ----------------------------------------

def hips_part(shape):
    box(shape, (0.3, 0.17, 0.19), (0, -0.03, 0), "flannel")


def torso_part(shape):
    prism(shape, 0.2, 0.165, 0.42, (0, 0.27, 0), "knit", squash=0.62)
    prism(shape, 0.168, 0.168, 0.032, (0, 0.045, 0), "navy", squash=0.64)  # waist trim
    prism(shape, 0.168, 0.168, 0.032, (0, 0.078, 0), "burgundy", squash=0.64)
    for side in (-1, 1):  # the V of the neck, navy outside burgundy
        box(shape, (0.026, 0.17, 0.012), (side * 0.04, 0.4, 0.118), "navy", rot=(0, 0, side * 0.42))
        box(shape, (0.014, 0.13, 0.014), (side * 0.026, 0.405, 0.119), "burgundy", rot=(0, 0, side * 0.42))
    box(shape, (0.46, 0.09, 0.2), (0, 0.455, 0), "knit")


def head_part(shape, face, hat):
    box(shape, (0.16, 0.19, 0.17), (0, 0.1, 0), face)
    box(shape, (0.07, 0.05, 0.07), (0, -0.01, 0), "skin")
    if hat == "cap":
        prism(shape, 0.092, 0.1, 0.07, (0, 0.225, 0), "cap")
        box(shape, (0.14, 0.016, 0.1), (0, 0.195, 0.12), "cap")
    elif hat == "sunhat":
        prism(shape, 0.21, 0.21, 0.014, (0, 0.195, 0), "sunhat", sides=8)
        prism(shape, 0.085, 0.095, 0.08, (0, 0.235, 0), "sunhat")
    else:
        box(shape, (0.17, 0.05, 0.18), (0, 0.21, -0.005), "hair")


def arm_part(shape):
    prism(shape, 0.054, 0.047, UPPER_ARM, (0, -UPPER_ARM / 2, 0), "knit", sides=5)


def forearm_part(shape, gloves):
    prism(shape, 0.046, 0.04, 0.25, (0, -0.125, 0), "knit", sides=5)
    prism(shape, 0.043, 0.043, 0.03, (0, -0.225, 0), "navy", sides=5)  # cuff trim
    size = 0.085 if gloves else 0.065
    box(shape, (size, 0.1, size), (0, -FOREARM, 0), "glove" if gloves else "skin")


def leg_part(shape):
    prism(shape, 0.082, 0.066, THIGH, (0, -THIGH / 2, 0), "flannel", sides=5)


def shin_part(shape, pads):
    prism(shape, 0.062, 0.05, 0.42, (0, -0.21, 0), "flannel", sides=5)
    box(shape, (0.1, 0.07, 0.25), (0, -0.435, 0.05), "boot")
    if pads:
        box(shape, (0.15, 0.44, 0.07), (0, -0.2, 0.075), "pad")
        box(shape, (0.15, 0.16, 0.075), (0, 0.07, 0.085), "pad")  # knee roll


def bat_part(shape, half_width):
    """Handle down -Y from the origin, then the blade; the face looks along +Z."""
    prism(shape, 0.018, 0.018, HANDLE, (0, -HANDLE / 2, 0), "grip")
    box(shape, (2 * half_width, BLADE, 0.04), (0, -HANDLE - BLADE / 2, 0), "blade")
    box(shape, (half_width, BLADE * 0.8, 0.03), (0, -HANDLE - BLADE / 2, -0.03), "blade")  # spine


# Posing -------------------------------------------------------------------------

def forward(local):
    world = {}
    for joint, (parent, _) in JOINTS.items():
        offset, rotation = local[joint]
        matrix = Matrix.Translation(offset) @ rotation
        world[joint] = world[parent] @ matrix if parent else matrix
    return world


def reach(local, world, side, target, pole):
    """Two-bone reach: turns one arm so its hand lands on `target`, elbow towards `pole`."""
    shoulder = world["arm" + side].translation
    to_target = target - shoulder
    distance = min(max(to_target.length, abs(UPPER_ARM - FOREARM) + 0.02), UPPER_ARM + FOREARM - 0.005)
    direction = to_target.normalized()
    along = (UPPER_ARM ** 2 - FOREARM ** 2 + distance ** 2) / (2 * distance)
    out = sqrt(max(UPPER_ARM ** 2 - along ** 2, 0))
    bend = (pole - direction * pole.dot(direction)).normalized()
    elbow = shoulder + direction * along + bend * out
    hand = shoulder + direction * distance
    parent = world["torso"].to_quaternion()
    upper = DOWN.rotation_difference(elbow - shoulder)
    lower = DOWN.rotation_difference(hand - elbow)
    local["arm" + side] = (local["arm" + side][0], (parent.inverted() @ upper).to_matrix().to_4x4())
    local["fore" + side] = (local["fore" + side][0], (upper.inverted() @ lower).to_matrix().to_4x4())


def bat_transform(pose):
    top, toe, face = (Vector(pose[key]) for key in ("bat_top", "bat_toe", "bat_face"))
    y = (top - toe).normalized()
    z = (face - y * face.dot(y)).normalized()
    x = y.cross(z)
    return Matrix.Translation(top) @ Matrix((x, y, z)).transposed().to_4x4()


def solve(pose):
    """Joint frames for a pose, in the rig frame: the body lifted so the lower foot
    rests on the ground (plus `lift`) and, when the pose holds a bat, both hands
    on the handle. The bat and the bowling hand are joints too."""
    local = {joint: (Vector(offset), euler(pose.get(joint, (0, 0, 0)))) for joint, (_, offset) in JOINTS.items()}
    x, z = pose.get("root", (0, 0))
    local["body"] = (Vector((x, 0, z)), Matrix.Identity(4))
    world = forward(local)
    lowest = min((world[shin] @ Vector((0, -SHIN, 0))).y for shin in ("shinL", "shinR"))
    local["body"] = (Vector((x, pose.get("lift", (0,))[0] - lowest, z)), Matrix.Identity(4))
    bat = Matrix.Translation(BAT_REST)
    if "bat_top" in pose:
        world = forward(local)
        bat = bat_transform(pose)
        pole = Vector((0.2, -1, -0.5))
        reach(local, world, "L", bat @ Vector((0, -0.06, 0)), pole)  # top hand
        reach(local, world, "R", bat @ Vector((0, -0.19, 0)), pole)  # bottom hand
    world = forward(local)
    world["bat"] = bat
    world["release"] = world["foreR"] @ Matrix.Translation((0, -FOREARM, 0))
    return world


REST = solve({})


def mirrored(pose):
    """The same pose with left and right exchanged."""
    out = {}
    for key, value in pose.items():
        other = key[:-1] + {"L": "R", "R": "L"}[key[-1]] if key[-1] in "LR" else key
        out[other] = (-value[0], value[1]) if key == "root" else value if key == "lift" else (value[0], -value[1], -value[2])
    return out


def spline(p0, p1, p2, p3, t):
    """Catmull-Rom: passes through p1 at t = 0 and p2 at t = 1."""
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3)


def sample(keys, time, loop):
    """The pose at `time` on a clip of (time, pose) keys."""
    index = max(i for i, (at, _) in enumerate(keys) if at <= time + 1e-9)
    index = min(index, len(keys) - 2)
    last = len(keys) - 1

    def key(i):  # a looping clip's first and last poses are the same
        if loop:
            return keys[(i - 1) % last + 1][1] if i < 0 else keys[(i - last) % last][1] if i > last else keys[i][1]
        return keys[min(max(i, 0), last)][1]

    start, end = keys[index][0], keys[index + 1][0]
    t = (time - start) / (end - start)
    poses = [key(index + i) for i in (-1, 0, 1, 2)]
    out = {}
    for name in set().union(*poses):
        zero = (0, 0) if name == "root" else (0,) if name == "lift" else (0, 0, 0)
        values = [p.get(name, zero) for p in poses]
        out[name] = tuple(spline(*(v[i] for v in values), t) for i in range(len(zero)))
    return out


def frames(keys, loop=False):
    """One dict of Blender-space joint frames per frame of the clip."""
    count = round(keys[-1][0] * FPS)
    return [{joint: to_blender(matrix) for joint, matrix in solve(sample(keys, i / FPS, loop)).items()}
            for i in range(count + 1)]


def build_figure(name, face, hat="none", pads=False, gloves=False, bat=None, pose=None):
    """The figure's mesh. With `pose` it is modelled in that pose and returned as a
    plain mesh; without, it is modelled at rest and returned on an armature."""
    shape = Shape(kit_atlas())
    world = solve(pose) if pose is not None else REST
    parts = {
        "hips": hips_part, "torso": torso_part, "head": lambda s: head_part(s, face, hat),
        "armL": arm_part, "foreL": lambda s: forearm_part(s, gloves), "armR": arm_part, "foreR": lambda s: forearm_part(s, gloves),
        "legL": leg_part, "shinL": lambda s: shin_part(s, pads), "legR": leg_part, "shinR": lambda s: shin_part(s, pads),
    }
    if bat is not None:
        parts["bat"] = lambda s: bat_part(s, bat)
    for joint, draw in parts.items():
        shape.part(to_blender(world[joint]), joint)
        draw(shape)
    if pose is not None:
        return shape.finish(name), world
    mesh = shape.finish(f"{name}_mesh")
    bones = {}
    for joint in [*JOINTS, "bat", "release"]:
        if joint not in parts and joint not in ("body", "release"):
            continue
        head = TO_BLENDER @ REST[joint].translation
        length = BONE_LENGTH.get(joint, -0.08 if joint == "release" else -(HANDLE + BLADE))
        parent = "foreR" if joint == "release" else JOINTS.get(joint, (None,))[0]
        bones[joint] = (parent, head, head + TO_BLENDER @ Vector((0, length, 0)))
    return armature(name, bones, mesh), world


# Poses --------------------------------------------------------------------------
# For the batter +Z is the off side and +X points up the pitch at the bowler.
# Bat points are (x, height above the ground, z) of the top of the handle and the toe.

STANCE = {
    "torso": (0.34, 0, 0), "head": (-0.22, 1.2, 0),
    "legL": (-0.36, 0, 0.17), "shinL": (0.56, 0, 0), "legR": (-0.36, 0, -0.17), "shinR": (0.56, 0, 0),
    "bat_top": (0.02, 0.86, 0.34), "bat_toe": (-0.2, 0.03, 0.3), "bat_face": (1, 0, 0),
}
TAP = {**STANCE, "bat_top": (0.03, 0.9, 0.34), "bat_toe": (-0.22, 0.14, 0.3)}
FLEX = {**STANCE, "torso": (0.38, 0, 0), "legL": (-0.45, 0, 0.17), "shinL": (0.72, 0, 0), "legR": (-0.45, 0, -0.17), "shinR": (0.72, 0, 0)}
BACKLIFT = {**STANCE, "torso": (0.3, 0, 0), "bat_top": (-0.08, 1.0, 0.3), "bat_toe": (-0.5, 1.22, 0.22), "bat_face": (1, 0.3, 0)}

DEFENSIVE_LINE = 0.52  # where the bat comes down, across from the batter's feet

# Front foot down the pitch, head over the ball, bat angled down beside the front pad.
FORWARD_DEFENSIVE = {
    "root": (0.24, 0.15),
    "torso": (0.42, 0.35, -0.34), "head": (-0.3, 0.95, 0.1),
    "legL": (-0.28, 0, 0.62), "shinL": (0.34, 0, -0.5), "legR": (0.02, 0, -0.46), "shinR": (0.08, 0, 0),
    "bat_top": (0.7, 0.84, DEFENSIVE_LINE), "bat_toe": (0.55, 0.05, DEFENSIVE_LINE), "bat_face": (1, -0.25, 0),
}

# Bat lifted high and away, front pad forward, letting the ball go.
SHOULDERING_ARMS = {
    "root": (0.1, -0.04),
    "torso": (0.06, 0, -0.06), "head": (-0.05, 1.3, 0),
    "legL": (-0.14, 0, 0.4), "shinL": (0.2, 0, -0.3), "legR": (-0.04, 0, -0.2), "shinR": (0.1, 0, 0),
    "bat_top": (-0.06, 1.5, 0.1), "bat_toe": (-0.36, 2.2, -0.16), "bat_face": (1, 0, 0.3),
}

# A late push away from the body, the face of the bat open; then the head turns to follow the edge.
EDGE_PUSH = {
    "root": (0.15, 0.12),
    "torso": (0.38, 0.3, -0.25), "head": (-0.3, 0.9, 0.1),
    "legL": (-0.2, 0, 0.5), "shinL": (0.28, 0, -0.4), "legR": (0, 0, -0.4), "shinR": (0.08, 0, 0),
    "bat_top": (0.55, 0.86, 0.6), "bat_toe": (0.42, 0.08, 0.68), "bat_face": (1, -0.2, 0.35),
}
EDGE_LOOK = {**EDGE_PUSH, "torso": (0.3, 0.0, -0.2), "head": (-0.05, -1.0, 0)}

CONTACT_TIME = 0.3  # into Forward_Defensive and Edge_Flash, when the bat meets the ball

BATTER_CLIPS = {
    "Forward_Defensive": ([(0, STANCE), (0.13, BACKLIFT), (CONTACT_TIME, FORWARD_DEFENSIVE), (0.6, FORWARD_DEFENSIVE)], False),
    "Leave_Shoulder_Arms": ([(0, STANCE), (0.13, BACKLIFT), (0.4, SHOULDERING_ARMS), (0.6, SHOULDERING_ARMS)], False),
    "Edge_Flash": ([(0, STANCE), (0.13, BACKLIFT), (CONTACT_TIME, EDGE_PUSH), (0.45, EDGE_PUSH), (0.65, EDGE_LOOK), (0.8, EDGE_LOOK)], False),
    # the idle goes on last, so it is also the pose the file opens in
    "Idle_Stance": ([(0, STANCE), (0.3, TAP), (0.6, STANCE), (0.9, FLEX), (1.2, STANCE)], True),
}

# A right-armer. The bowling arm's X angle runs on past a full turn: down is 0,
# straight back is pi/2, over the top is pi.
RUN = {
    "torso": (0.3, -0.15, 0), "head": (-0.25, 0.1, 0),
    "legL": (-0.8, 0, 0), "shinL": (0.35, 0, 0), "legR": (0.45, 0, 0), "shinR": (1.2, 0, 0),
    "armR": (-0.7, 0, 0), "foreR": (-1.3, 0, 0), "armL": (0.6, 0, 0), "foreL": (-1.2, 0, 0),
}
RUN_PASS = {
    "lift": (0.06,), "torso": (0.3, 0, 0), "head": (-0.25, 0, 0),
    "legL": (0, 0, 0), "shinL": (0.3, 0, 0), "legR": (-0.3, 0, 0), "shinR": (1.6, 0, 0),
    "armR": (-0.05, 0, 0), "foreR": (-1.3, 0, 0), "armL": (0, 0, 0), "foreL": (-1.3, 0, 0),
}
GATHER = {  # the bound: off the ground, ball by the chin, front arm climbing
    "lift": (0.22,), "hips": (0, -0.3, 0), "torso": (0.05, -0.5, 0), "head": (-0.05, 0.7, 0),
    "legL": (-0.5, 0, 0), "shinL": (0.9, 0, 0), "legR": (-0.9, 0, 0), "shinR": (1.5, 0, 0),
    "armL": (-2.2, 0, 0.2), "foreL": (-0.5, 0, 0), "armR": (-1.2, 0, 0), "foreR": (-1.9, 0, 0),
}
BACK_FOOT = {  # landed on the back foot, leaning away, front arm high, bowling arm low behind
    "hips": (0, -0.35, 0), "torso": (-0.12, -0.6, 0), "head": (0.05, 0.9, 0),
    "legR": (0.05, 0, 0), "shinR": (0.3, 0, 0), "legL": (-1.0, 0, 0), "shinL": (0.7, 0, 0),
    "armL": (-2.8, 0, 0.1), "foreL": (-0.15, 0, 0), "armR": (0.9, 0, -0.1), "foreR": (-0.15, 0, 0),
}
PLANT = {  # front foot down and braced, front arm pulling in, bowling arm coming up behind
    "hips": (0, -0.1, 0), "torso": (0.05, -0.15, -0.08), "head": (-0.1, 0.2, 0),
    "legL": (-0.55, 0, 0.05), "shinL": (0.05, 0, 0), "legR": (0.3, 0, 0), "shinR": (0.7, 0, 0),
    "armL": (-1.2, 0, 0.2), "foreL": (-1.0, 0, 0), "armR": (2.2, 0, 0.1), "foreR": (-0.05, 0, 0),
}
RELEASE = {  # front leg braced, bowling arm over the top
    "torso": (0.16, 0.2, -0.14), "head": (-0.15, -0.15, 0),
    "legL": (-0.5, 0, 0.05), "shinL": (0.05, 0, 0), "legR": (0.4, 0, 0), "shinR": (0.9, 0, 0),
    "armR": (2 * pi - 3.05, 0, 0.1), "foreR": (-0.03, 0, 0), "armL": (0.55, 0, 0.3), "foreL": (-1.3, 0, 0),
}
FOLLOW = {  # the arm finishes across the body, the back leg swings through
    "hips": (0, 0.3, 0), "torso": (0.85, 0.5, 0), "head": (-0.6, -0.3, 0),
    "legR": (-0.9, 0, 0), "shinR": (1.0, 0, 0), "legL": (0.1, 0, 0), "shinL": (0.15, 0, 0),
    "armR": (5.2, 0, -0.3), "foreR": (-0.3, 0, 0), "armL": (1.0, 0, 0.2), "foreL": (-0.8, 0, 0),
}
RECOVER = {
    "torso": (0.4, 0.1, 0), "head": (-0.3, 0, 0),
    "legR": (-0.3, 0, 0), "shinR": (0.4, 0, 0), "legL": (0.5, 0, 0), "shinL": (1.0, 0, 0),
    "armR": (6.0, 0, 0), "foreR": (-0.6, 0, 0), "armL": (-0.3, 0, 0), "foreL": (-0.9, 0, 0),
}
SETTLE = {
    "torso": (0.15, 0, 0), "head": (-0.1, 0, 0),
    "legL": (-0.15, 0, 0), "shinL": (0.2, 0, 0), "legR": (0.1, 0, 0), "shinR": (0.25, 0, 0),
    "armR": (2 * pi - 0.1, 0, 0), "foreR": (-0.4, 0, 0), "armL": (0.1, 0, 0), "foreL": (-0.4, 0, 0),
}
# The appeal starts where the delivery ends, the bowling arm one turn on.
SPRING = {
    "torso": (0.35, 0, 0), "head": (-0.2, 0, 0),
    "legL": (-0.6, 0, 0.05), "shinL": (1.0, 0, 0), "legR": (-0.6, 0, -0.05), "shinR": (1.0, 0, 0),
    "armR": (2 * pi + 0.5, 0, -0.1), "foreR": (-0.3, 0, 0), "armL": (0.5, 0, 0.1), "foreL": (-0.3, 0, 0),
}
LEAP = {
    "lift": (0.28,), "torso": (-0.2, 0, 0), "head": (-0.3, 0, 0),
    "legL": (0.1, 0, 0.08), "shinL": (0.7, 0, 0), "legR": (0.1, 0, -0.08), "shinR": (0.7, 0, 0),
    "armR": (2 * pi - 2.9, 0, -0.3), "foreR": (-0.1, 0, 0), "armL": (-2.9, 0, 0.3), "foreL": (-0.1, 0, 0),
}
ARMS_UP = {
    "torso": (-0.1, 0, 0), "head": (-0.25, 0, 0),
    "legL": (-0.3, 0, 0.08), "shinL": (0.55, 0, 0), "legR": (-0.3, 0, -0.08), "shinR": (0.55, 0, 0),
    "armR": (2 * pi - 2.8, 0, -0.35), "foreR": (-0.25, 0, 0), "armL": (-2.8, 0, 0.35), "foreL": (-0.25, 0, 0),
}
ARMS_HIGH = {**ARMS_UP, "legL": (-0.08, 0, 0.08), "shinL": (0.15, 0, 0), "legR": (-0.08, 0, -0.08), "shinR": (0.15, 0, 0)}

RELEASE_TIME, PLANT_TIME = 0.55, 0.45  # into Bound_And_Deliver

BOWLER_CLIPS = {
    "RunUp_Stride": ([(0, RUN), (0.1, RUN_PASS), (0.2, mirrored(RUN)), (0.3, mirrored(RUN_PASS)), (0.4, RUN)], True),
    "Appeal_Celebrate": ([(0, SETTLE), (0.25, SPRING), (0.5, LEAP), (0.75, ARMS_UP), (1.0, ARMS_HIGH)], False),
    "Bound_And_Deliver": ([(0, RUN), (0.15, GATHER), (0.3, BACK_FOOT), (PLANT_TIME, PLANT), (RELEASE_TIME, RELEASE),
                           (0.75, FOLLOW), (1.0, RECOVER), (1.2, SETTLE)], False),
}

CROUCH = {
    "torso": (0.75, 0, 0), "head": (-0.55, 0, 0),
    "legL": (-1.25, 0, 0.3), "shinL": (1.95, 0, 0), "legR": (-1.25, 0, -0.3), "shinR": (1.95, 0, 0),
    "armL": (-1.0, 0, -0.3), "foreL": (-0.5, 0, 0), "armR": (-1.0, 0, 0.3), "foreR": (-0.5, 0, 0),
}


# The three figures ----------------------------------------------------------------

def build_batter(bat_half_width):
    """A right-hander in a cap, with Idle_Stance, Forward_Defensive,
    Leave_Shoulder_Arms and Edge_Flash."""
    rig, _ = build_figure("batter", "face_batter", hat="cap", pads=True, gloves=True, bat=bat_half_width)
    for clip, (keys, loop) in BATTER_CLIPS.items():
        bake(rig, clip, frames(keys, loop))
    rig["contact_time"] = CONTACT_TIME


def build_bowler():
    """A right-arm fast bowler with RunUp_Stride, Bound_And_Deliver and
    Appeal_Celebrate, and a bone called `release` in the bowling hand."""
    rig, _ = build_figure("bowler", "face_bowler")
    for clip, (keys, loop) in BOWLER_CLIPS.items():
        bake(rig, clip, frames(keys, loop))
    rig["release_time"] = RELEASE_TIME
    rig["plant_time"] = PLANT_TIME


def build_slip():
    """First slip in a crouch, with an empty called `catch` between the hands."""
    root = empty("slip")
    mesh, world = build_figure("slip_mesh", "face_slip", hat="sunhat", pose=CROUCH)
    mesh.parent = root
    hands = [world[fore] @ Vector((0, -FOREARM, 0)) for fore in ("foreL", "foreR")]
    catch = empty("catch", root)
    catch.location = TO_BLENDER @ ((hands[0] + hands[1]) / 2)
