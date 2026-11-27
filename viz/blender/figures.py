"""Low-poly Test cricketers in 1970s to 1990s whites: cream sweater with navy and
burgundy trim, flannels, cap or sun hat, and for the batter pads, gloves and a bat.

Each figure is a tree of named, parented parts (one object per joint, its origin
at the joint) so the page can pose it. Figures are authored in a rig frame,
+Y up, facing +Z, left hand on +X, which is the frame the .glb ends up in.
Limbs hang down their joint's -Y axis, so on a hanging limb a negative X
rotation swings it forward and a positive Z rotation swings it to the left.
"""
from math import sqrt

import bpy
from mathutils import Matrix, Vector

from lib import Shape, empty, scaled

# Rig (x, y, z) is Blender (x, -z, y).
TO_BLENDER = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
DOWN = Vector((0, -1, 0))

HIP, THIGH, SHIN = 0.92, 0.45, 0.47
SHOULDER_X, SHOULDER_Y, UPPER_ARM, FOREARM = 0.22, 0.44, 0.29, 0.3
HANDLE, BLADE = 0.3, 0.56

SWEATER, FLANNEL, NAVY, BURGUNDY = 0xF2EAD0, 0xFAF5E4, 0x1C2A55, 0x7C1F2E
CAP_GREEN, SKIN, HAIR, WHITE, WILLOW, CANE = 0x1D4A32, 0xD8A47E, 0x3A2A1E, 0xFFFFFF, 0xE6D29C, 0x8B5A2B

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


def euler(angles):
    """Rotation matrix for XYZ Euler angles, the order Three.js uses."""
    x, y, z = angles
    return Matrix.Rotation(x, 4, "X") @ Matrix.Rotation(y, 4, "Y") @ Matrix.Rotation(z, 4, "Z")


def to_blender_rotation(rotation):
    return (TO_BLENDER @ rotation.to_3x3() @ TO_BLENDER.transposed()).to_quaternion()


def place(center, rot=(0, 0, 0)):
    return Matrix.Translation(TO_BLENDER @ Vector(center)) @ to_blender_rotation(euler(rot)).to_matrix().to_4x4()


def box(shape, size, center, color, rot=(0, 0, 0)):
    width, height, depth = size
    shape.cube(scaled(place(center, rot), width, depth, height), color)


def prism(shape, top, bottom, height, center, color, sides=6, squash=1.0):
    shape.cone(bottom, top, height, sides, scaled(place(center), 1, squash, 1), color)


# Parts, each in its own joint's frame ----------------------------------------

def hips_part():
    shape = Shape()
    box(shape, (0.3, 0.17, 0.19), (0, -0.03, 0), FLANNEL)
    return shape


def torso_part():
    shape = Shape()
    prism(shape, 0.2, 0.165, 0.42, (0, 0.27, 0), SWEATER, squash=0.62)
    prism(shape, 0.168, 0.168, 0.032, (0, 0.045, 0), NAVY, squash=0.64)  # waist trim
    prism(shape, 0.168, 0.168, 0.032, (0, 0.078, 0), BURGUNDY, squash=0.64)
    for side in (-1, 1):  # the V of the neck
        box(shape, (0.026, 0.17, 0.012), (side * 0.04, 0.4, 0.118), NAVY, rot=(0, 0, side * 0.42))
    box(shape, (0.46, 0.09, 0.2), (0, 0.455, 0), SWEATER)
    return shape


def head_part(hat, hat_color):
    shape = Shape()
    box(shape, (0.16, 0.19, 0.17), (0, 0.1, 0), SKIN)
    box(shape, (0.07, 0.05, 0.07), (0, -0.01, 0), SKIN)
    if hat == "cap":
        prism(shape, 0.092, 0.1, 0.07, (0, 0.225, 0), hat_color)
        box(shape, (0.14, 0.016, 0.1), (0, 0.195, 0.12), hat_color)
    elif hat == "sunhat":
        prism(shape, 0.21, 0.21, 0.014, (0, 0.195, 0), WHITE, sides=8)
        prism(shape, 0.085, 0.095, 0.08, (0, 0.235, 0), WHITE)
    else:
        box(shape, (0.17, 0.05, 0.18), (0, 0.21, -0.005), HAIR)
    return shape


def arm_part():
    shape = Shape()
    prism(shape, 0.054, 0.047, UPPER_ARM, (0, -UPPER_ARM / 2, 0), SWEATER, sides=5)
    return shape


def forearm_part(gloves):
    shape = Shape()
    prism(shape, 0.046, 0.04, 0.25, (0, -0.125, 0), SWEATER, sides=5)
    prism(shape, 0.043, 0.043, 0.03, (0, -0.225, 0), NAVY, sides=5)  # cuff trim
    size = 0.085 if gloves else 0.065
    box(shape, (size, 0.1, size), (0, -FOREARM, 0), WHITE if gloves else SKIN)
    return shape


def leg_part():
    shape = Shape()
    prism(shape, 0.082, 0.066, THIGH, (0, -THIGH / 2, 0), FLANNEL, sides=5)
    return shape


def shin_part(pads):
    shape = Shape()
    prism(shape, 0.062, 0.05, 0.42, (0, -0.21, 0), FLANNEL, sides=5)
    box(shape, (0.1, 0.07, 0.25), (0, -0.435, 0.05), WHITE)  # boot
    if pads:
        box(shape, (0.15, 0.44, 0.07), (0, -0.2, 0.075), WHITE)
        box(shape, (0.15, 0.16, 0.075), (0, 0.07, 0.085), WHITE)  # knee roll
    return shape


def bat_part(half_width):
    """Handle down -Y from the origin, then the blade; the face looks along +Z."""
    shape = Shape()
    prism(shape, 0.018, 0.018, HANDLE, (0, -HANDLE / 2, 0), CANE)
    box(shape, (2 * half_width, BLADE, 0.04), (0, -HANDLE - BLADE / 2, 0), WILLOW)
    box(shape, (half_width, BLADE * 0.8, 0.03), (0, -HANDLE - BLADE / 2, -0.03), WILLOW)  # spine
    return shape


def build_figure(name, hat="none", hat_color=NAVY, pads=False, gloves=False):
    root = empty(name)
    parts = {
        "body": None,
        "hips": hips_part(), "torso": torso_part(), "head": head_part(hat, hat_color),
        "armL": arm_part(), "foreL": forearm_part(gloves), "armR": arm_part(), "foreR": forearm_part(gloves),
        "legL": leg_part(), "shinL": shin_part(pads), "legR": leg_part(), "shinR": shin_part(pads),
    }
    objects = {}
    for joint, (parent, _) in JOINTS.items():
        owner = objects[parent] if parent else root
        objects[joint] = parts[joint].finish(joint, owner) if parts[joint] else empty(joint, owner)
    return root, objects


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
    return top, Matrix((x, y, z)).transposed().to_4x4()


def solve(pose):
    """Joint transforms for a pose: { joint: (offset, rotation) } in the rig frame,
    with the body lifted so the lower foot rests on the ground and, when the
    pose holds a bat, both hands on the handle."""
    local = {joint: (Vector(offset), euler(pose.get(joint, (0, 0, 0)))) for joint, (_, offset) in JOINTS.items()}
    x, z = pose.get("root", (0, 0))
    local["body"] = (Vector((x, 0, z)), Matrix.Identity(4))
    world = forward(local)
    lowest = min((world[shin] @ Vector((0, -SHIN, 0))).y for shin in ("shinL", "shinR"))
    local["body"] = (Vector((x, -lowest, z)), Matrix.Identity(4))
    if "bat_top" in pose:
        world = forward(local)
        top, rotation = bat_transform(pose)
        pole = Vector((0.2, -1, -0.5))
        reach(local, world, "L", top + rotation @ Vector((0, -0.06, 0)), pole)  # top hand
        reach(local, world, "R", top + rotation @ Vector((0, -0.19, 0)), pole)  # bottom hand
    return local


def apply(objects, local, bat=None, pose=None):
    for joint, (offset, rotation) in local.items():
        objects[joint].location = TO_BLENDER @ offset
        objects[joint].rotation_quaternion = to_blender_rotation(rotation)
    if bat is not None:
        top, rotation = bat_transform(pose)
        bat.location = TO_BLENDER @ top
        bat.rotation_quaternion = to_blender_rotation(rotation)


def record(targets, name):
    """Keys the current transforms as a one-frame action per object and stacks it
    on an NLA track called `name`; the exporter merges tracks of one name into one clip."""
    for obj in targets:
        data = obj.animation_data or obj.animation_data_create()
        data.action = bpy.data.actions.new(f"{name}.{obj.name}")
        obj.keyframe_insert("location", frame=1)
        obj.keyframe_insert("rotation_quaternion", frame=1)
        action = data.action
        track = data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 1, action)
        data.action = None


# Poses --------------------------------------------------------------------------
# For the batter +Z is the off side and +X points up the pitch at the bowler.
# Bat points are (x, height above the ground, z) of the top of the handle and the toe.

STANCE = {
    "torso": (0.34, 0, 0), "head": (-0.22, 1.2, 0),
    "legL": (-0.36, 0, 0.17), "shinL": (0.56, 0, 0), "legR": (-0.36, 0, -0.17), "shinR": (0.56, 0, 0),
    "bat_top": (0.02, 0.86, 0.34), "bat_toe": (-0.2, 0.03, 0.3), "bat_face": (1, 0, 0),
}

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

# A right-armer at the point of release: front leg braced, bowling arm over the top.
DELIVERY_STRIDE = {
    "torso": (0.16, 0.2, -0.14), "head": (-0.15, -0.15, 0),
    "legL": (-0.5, 0, 0.05), "shinL": (0.05, 0, 0), "legR": (0.4, 0, 0), "shinR": (0.9, 0, 0),
    "armR": (-3.05, 0, 0.1), "foreR": (-0.03, 0, 0), "armL": (0.55, 0, 0.3), "foreL": (-1.3, 0, 0),
}

CROUCH = {
    "torso": (0.75, 0, 0), "head": (-0.55, 0, 0),
    "legL": (-1.25, 0, 0.3), "shinL": (1.95, 0, 0), "legR": (-1.25, 0, -0.3), "shinR": (1.95, 0, 0),
    "armL": (-1.0, 0, -0.3), "foreL": (-0.5, 0, 0), "armR": (-1.0, 0, 0.3), "foreR": (-0.5, 0, 0),
}


# The three figures ----------------------------------------------------------------

def build_batter(bat_half_width):
    """A right-hander with three pose clips: stance, forward_defensive, shouldering_arms."""
    root, objects = build_figure("batter", hat="cap", hat_color=CAP_GREEN, pads=True, gloves=True)
    bat = bat_part(bat_half_width).finish("bat", root)
    targets = [*objects.values(), bat]
    # stance goes on last, so it is also the pose the file opens in
    for name, pose in (("forward_defensive", FORWARD_DEFENSIVE), ("shouldering_arms", SHOULDERING_ARMS), ("stance", STANCE)):
        apply(objects, solve(pose), bat, pose)
        record(targets, name)


def build_bowler():
    """Delivery stride, with an empty called `release` in the bowling hand."""
    root, objects = build_figure("bowler")
    apply(objects, solve(DELIVERY_STRIDE))
    release = empty("release", objects["foreR"])
    release.location = TO_BLENDER @ Vector((0, -FOREARM, 0))


def build_slip():
    """First slip in a crouch, with an empty called `catch` between the hands."""
    root, objects = build_figure("slip", hat="sunhat")
    local = solve(CROUCH)
    apply(objects, local)
    world = forward(local)
    hands = [world[fore] @ Vector((0, -FOREARM, 0)) for fore in ("foreL", "foreR")]
    catch = empty("catch", root)
    catch.location = TO_BLENDER @ ((hands[0] + hands[1]) / 2)

