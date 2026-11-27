"""Low-poly Test cricketers in 1970s to 1990s whites, in late-90s console
proportions (about six heads tall, broad shoulders, a chest tapering to the
waist): cream cable-knit sweater with navy and crimson trim, flannels, cap or
sun hat, and for the batter pads, gloves and a bat.

Each figure is one mesh, rigidly skinned: every part follows exactly one bone, as
on a PlayStation. Parts are lofts, rings of points joined into a closed solid,
and every face is mapped onto a painted panel of the shared kit atlas. Figures
are authored in a rig frame, +Y up, facing +Z, left hand on +X, which is the
frame the .glb ends up in. Limbs hang down their joint's -Y axis, so on a hanging
limb a negative X rotation swings it forward and a positive Z rotation swings it
to the left.

A pose is a dict of joint Euler angles, plus `root` (x, z), `lift` (height off
the ground), the bat's position, and optionally `hands`, two points the hands
reach for. A clip is a list of timed poses, sampled at every frame through a
spline and baked, so the hands stay on the bat between the poses.
"""
from math import cos, hypot, inf, pi, sin, sqrt

import bpy
from mathutils import Matrix, Vector

from lib import FPS, Shape, armature, bake, pose
from textures import FACES, kit_atlas

# Rig (x, y, z) is Blender (x, -z, y).
TO_BLENDER = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
DOWN = Vector((0, -1, 0))

HIP, THIGH, SHIN, ANKLE = 0.92, 0.44, 0.48, 0.42  # SHIN runs from the knee to the sole, ANKLE to the ankle
HEEL, TOE = -0.065, 0.19  # the sole's ends, in the foot's frame
SHOULDER_X, SHOULDER_Y, UPPER_ARM, FOREARM = 0.215, 0.475, 0.34, 0.35  # FOREARM ends at the middle of the hand (the grip)
GRIPS = {"L": -0.06, "R": -0.19}  # where each hand holds the handle, down the bat from its top
GRIP_TOLERANCE = 0.01  # how far a hand may end up from its place on the handle
HANDLE, BLADE = 0.3, 0.56
BAT_REST = Vector((0.36, 0.95, 0.1))  # where the bat hangs when no pose holds it
BAT_FACE = 0.018  # the face of the blade, in front of the bat's axis

# name: (parent, offset from the parent joint), parents first
JOINTS = {
    "body": (None, (0, 0, 0)),  # carries the pose offset and the lift that grounds the feet
    "hips": ("body", (0, HIP, 0)),
    "torso": ("hips", (0, 0, 0)),
    "head": ("torso", (0, 0.54, 0)),
    "armL": ("torso", (SHOULDER_X, SHOULDER_Y, 0)),
    "foreL": ("armL", (0, -UPPER_ARM, 0)),
    "armR": ("torso", (-SHOULDER_X, SHOULDER_Y, 0)),
    "foreR": ("armR", (0, -UPPER_ARM, 0)),
    "legL": ("hips", (0.092, 0, 0)),
    "shinL": ("legL", (0, -THIGH, 0)),
    "legR": ("hips", (-0.092, 0, 0)),
    "shinR": ("legR", (0, -THIGH, 0)),
    "footL": ("shinL", (0, -ANKLE, 0)),
    "footR": ("shinR", (0, -ANKLE, 0)),
}
# how far each bone's tail lies from its head, along the joint's Y
BONE_LENGTH = {
    "body": 0.1, "hips": 0.12, "torso": 0.5, "head": 0.3, "armL": -UPPER_ARM, "foreL": -FOREARM,
    "armR": -UPPER_ARM, "foreR": -FOREARM, "legL": -THIGH, "shinL": -ANKLE, "legR": -THIGH, "shinR": -ANKLE,
    "footL": ANKLE - SHIN, "footR": ANKLE - SHIN,
    "bat": -(HANDLE + BLADE), "release": -0.08, "catch": 0.08,
}
EXTRA_PARENT = {"bat": "body", "release": "foreR", "catch": "body"}
BODY_PARTS = ("head", "torso", "hips", "legL", "shinL", "legR", "shinR", "footL", "footR")  # what must stay off the line of the ball


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


# Lofts --------------------------------------------------------------------------------
# A ring is a list of (x, z) points going anticlockwise seen from above. Faces
# whose outward normal points within about 67 degrees of +Z take the front panel,
# of -Z the back panel, the rest a side panel; each panel is wrapped round its
# run of faces by arc length on every ring, so the painting follows the form.

def octo(hw, hd, cz=0.0, c=0.6):
    """A chamfered box, half-width `hw` across and half-depth `hd` front to back."""
    return [(c * hw, cz + hd), (-c * hw, cz + hd), (-hw, cz + 0.45 * hd), (-hw, cz - 0.45 * hd),
            (-c * hw, cz - hd), (c * hw, cz - hd), (hw, cz - 0.45 * hd), (hw, cz + 0.45 * hd)]


def hexa(hw, hd, cz=0.0):
    return [(0.5 * hw, cz + hd), (-0.5 * hw, cz + hd), (-hw, cz), (-0.5 * hw, cz - hd), (0.5 * hw, cz - hd), (hw, cz)]


def circle(radius, sides=12):
    return [(radius * cos(2 * pi * (k + 0.5) / sides), radius * sin(2 * pi * (k + 0.5) / sides)) for k in range(sides)]


def scaled_ring(ring, sx=1.0, sz=1.0, dz=0.0):
    return [(x * sx, z * sz + dz) for x, z in ring]


def _panels(ring):
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1]))
    out = []
    for (x0, z0), (x1, z1) in zip(ring, ring[1:] + ring[:1]):
        nx, nz = (z1 - z0, x0 - x1) if area > 0 else (z0 - z1, x1 - x0)
        nz /= max(hypot(nx, nz), 1e-9)
        out.append("front" if nz > 0.38 else "back" if nz < -0.38 else "side")
    return out


def _runs(panels):
    """Runs of neighbouring faces on the same panel, as lists of face indices."""
    n = len(panels)
    if len(set(panels)) == 1:
        return [(panels[0], list(range(n)))]
    runs = []
    for i in range(n):
        if panels[i] != panels[i - 1]:
            run = [i]
            while panels[(run[-1] + 1) % n] == panels[i]:
                run.append((run[-1] + 1) % n)
            runs.append((panels[i], run))
    return runs


def _arc(ring, panel, run):
    """u at each point of a run on one ring, 0 at the run's start or end as the panel wants."""
    n = len(ring)
    points = [run[0]] + [(i + 1) % n for i in run]
    lengths = [0.0]
    for a, b in zip(points, points[1:]):
        lengths.append(lengths[-1] + hypot(ring[b][0] - ring[a][0], ring[b][1] - ring[a][1]))
    first, last = ring[points[0]], ring[points[-1]]
    flip = {"front": first[0] > last[0], "back": first[0] < last[0], "side": first[1] < last[1]}[panel]
    total = lengths[-1] or 1.0
    return {p: (1 - s / total) if flip else s / total for p, s in zip(points, lengths)}


def loft(shape, rings, tile, center=(0, 0, 0), rot=(0, 0, 0), v=None, ends=("cap", "cap")):
    """A closed solid through `rings`, [(y, ring), ...] bottom first, in the part's
    frame moved by `center` and `rot`. `v` gives each ring's height on the panels
    (by default its y); `ends` the panel of the bottom and top caps, or
    (panel, (u, v)) to paint a cap in one colour, or None to leave it open."""
    n = len(rings[0][1])
    points = [tuple(TO_BLENDER @ Vector((x, y, z))) for y, ring in rings for x, z in ring]
    ys = [y for y, _ in rings]
    vs = v or [(y - ys[0]) / ((ys[-1] - ys[0]) or 1) for y in ys]
    runs = _runs(_panels(rings[len(rings) // 2][1]))
    faces, uvs = [], []
    for k in range(len(rings) - 1):
        for panel, run in runs:
            low, high = _arc(rings[k][1], panel, run), _arc(rings[k + 1][1], panel, run)
            for i in run:
                j = (i + 1) % n
                a, b, c, d = k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i
                faces.append([a, b, c, d])
                uvs.append((panel, {a: (low[i], vs[k]), b: (low[j], vs[k]), c: (high[j], vs[k + 1]), d: (high[i], vs[k + 1])}))
    for end, (y, ring), offset in zip(ends, (rings[0], rings[-1]), (0, (len(rings) - 1) * n)):
        if end is None:
            continue
        index = list(range(offset, offset + n))
        if isinstance(end, tuple):
            uvs.append((end[0], {i: end[1] for i in index}))
        else:
            xs, zs = [p[0] for p in ring], [p[1] for p in ring]
            w, d = (max(xs) - min(xs)) or 1, (max(zs) - min(zs)) or 1
            uvs.append((end, {offset + i: ((x - min(xs)) / w, (max(zs) - z) / d) for i, (x, z) in enumerate(ring)}))
        faces.append(index)
    shape.solid(points, faces, place(center, rot), tile, uvs)


def wedge(shape, base, tip, tile):
    """A three-sided pyramid: a lock of hair, a nose."""
    points = [tuple(TO_BLENDER @ Vector(p)) for p in (*base, tip)]
    shape.solid(points, [[0, 1, 2], [0, 1, 3], [1, 2, 3], [2, 0, 3]], Matrix.Identity(4), tile)


# Parts, each in its own joint's frame ---------------------------------------------

def hips_part(shape, _look):
    loft(shape, [(-0.10, octo(0.15, 0.095)), (0.03, octo(0.165, 0.105)), (0.12, octo(0.155, 0.1))], "seat",
         ends=("cap", None))


def torso_part(shape, _look):
    loft(shape, [
        (0.05, octo(0.168, 0.11)), (0.24, octo(0.17, 0.113, 0.004)),
        (0.40, octo(0.228, 0.13, 0.014)), (0.50, octo(0.25, 0.114)), (0.56, octo(0.135, 0.086)),
        (0.585, octo(0.07, 0.06, 0.005)),
    ], "sweater", ends=(None, "cap"))


def hair_locks(shape, hair, front, y, xs):
    """Chunky locks hanging over the forehead from `y`, lying on the face at depth `front`."""
    for i, x in enumerate(xs):
        drop = 0.03 + 0.012 * (i % 2)
        wedge(shape, [(x - 0.024, y, front), (x + 0.024, y, front), (x, y + 0.01, front - 0.03)],
              (x + 0.006, y - drop, front + 0.006), hair)


def head_part(shape, look):
    skin, hair, hat = f"skin_{look['skin']}", f"hair_{look['hair']}", look["hat"]
    loft(shape, [(0.0, hexa(0.06, 0.062)), (0.10, hexa(0.056, 0.058, 0.005))], skin, ends=(None, None))
    loft(shape, [
        (0.05, octo(0.058, 0.05, 0.06)), (0.10, octo(0.096, 0.094, 0.026)), (0.17, octo(0.104, 0.108, 0.012)),
        (0.235, octo(0.108, 0.112, 0.006)), (0.31, octo(0.096, 0.104, -0.004)), (0.35, octo(0.05, 0.058, -0.01)),
    ], f"face_{look['face']}", ends=(("front", (0.5, 0.01)), "cap"))
    wedge(shape, [(0, 0.19, 0.113), (-0.022, 0.13, 0.113), (0.022, 0.13, 0.113)], (0, 0.136, 0.15), skin)  # nose
    nape = 0.095 if look.get("long_hair") else 0.14
    back = [(0.104, -0.04), (-0.104, -0.04), (-0.1, -0.084), (-0.052, -0.122), (0.052, -0.122), (0.1, -0.084)]
    loft(shape, [(nape, scaled_ring(back, 0.92, 0.94)), (0.245, back)], hair, ends=("cap", None))
    if hat == "cap":
        hair_locks(shape, hair, 0.119, 0.232, (-0.062, -0.022, 0.02, 0.06))
        loft(shape, [(0.226, octo(0.118, 0.124)), (0.30, octo(0.126, 0.13, -0.004)), (0.37, octo(0.072, 0.076))],
             "cap", ends=(None, "cap"))
        peak = [(-0.112, -0.035), (0.112, -0.035), (0.098, 0.03), (0.05, 0.075), (-0.05, 0.075), (-0.098, 0.03)]
        loft(shape, [(-0.012, peak), (0.0, peak)], "peak", center=(0, 0.232, 0.12), rot=(0.18, 0, 0),
             ends=(("front", (0.5, 0.5)), "cap"))
    elif hat == "sunhat":
        hair_locks(shape, hair, 0.119, 0.226, (-0.06, -0.02, 0.024, 0.062))
        loft(shape, [(0.222, octo(0.118, 0.124)), (0.32, octo(0.11, 0.116, -0.004)), (0.372, octo(0.068, 0.072))],
             "sunhat", ends=(None, "cap"))
        inner, outer = circle(0.122), circle(0.245)
        loft(shape, [(0.228, inner), (0.188, outer), (0.198, outer), (0.24, inner)], "brim",
             v=[0.0, 0.33, 0.42, 1.0], ends=(None, None))
    else:
        hair_locks(shape, hair, 0.12, 0.262, (-0.066, -0.026, 0.016, 0.058))
        loft(shape, [(0.245, octo(0.114, 0.118, 0.003)), (0.31, octo(0.105, 0.113, -0.004)),
                     (0.355, octo(0.076, 0.083, -0.008)), (0.378, octo(0.036, 0.04, -0.01))], hair)


def arm_part(shape, _look):
    loft(shape, [(-UPPER_ARM - 0.01, hexa(0.048, 0.049)), (-0.12, hexa(0.066, 0.062, 0.004)),
                 (0.03, hexa(0.08, 0.072)), (0.08, hexa(0.042, 0.048))], "sleeve", ends=(None, "cap"))


def forearm_part(shape, look):
    """The sleeve down to the cuff, then the hand, whose middle is the grip at -FOREARM."""
    wrist = -FOREARM + 0.045
    loft(shape, [(wrist, hexa(0.044, 0.042)), (wrist + 0.055, hexa(0.042, 0.04)), (-0.08, hexa(0.06, 0.057)),
                 (0.035, hexa(0.048, 0.05))], "cuff", ends=(None, None))
    g = -FOREARM
    if look.get("gloves") == "keeper":  # big webbed mitts, wide across the palm
        loft(shape, [(g - 0.14, hexa(0.04, 0.078)), (g - 0.06, hexa(0.072, 0.115)),
                     (g + 0.02, hexa(0.076, 0.1)), (g + 0.08, hexa(0.064, 0.064))], "kglove", ends=("cap", None))
    elif look.get("gloves"):
        loft(shape, [(g - 0.085, hexa(0.024, 0.04)), (g - 0.04, hexa(0.04, 0.06)),
                     (g + 0.03, hexa(0.05, 0.058)), (g + 0.065, hexa(0.05, 0.05))], "glove", ends=("cap", None))
    else:
        loft(shape, [(g - 0.07, hexa(0.014, 0.028)), (g - 0.035, hexa(0.026, 0.046)), (g + 0.06, hexa(0.03, 0.036))],
             f"skin_{look['skin']}", ends=("cap", None))


def leg_part(shape, _look):
    loft(shape, [(-0.46, hexa(0.056, 0.062)), (-0.22, hexa(0.085, 0.09, 0.006)),
                 (-0.03, hexa(0.096, 0.102, 0.004)), (0.07, hexa(0.086, 0.092))], "flannel", ends=(None, None))


SOLE = [(0.035, 0.19), (-0.035, 0.19), (-0.054, 0.03), (-0.046, -0.065), (0.046, -0.065), (0.054, 0.03)]
PAD = [(0.045, 0.128), (-0.045, 0.128), (-0.088, 0.07), (-0.08, 0.012), (0.08, 0.012), (0.088, 0.07)]


def shin_part(shape, look):
    loft(shape, [(-0.40, hexa(0.043, 0.045)), (-0.11, hexa(0.068, 0.078, -0.01)), (0.04, hexa(0.06, 0.066))],
         "flannel", ends=(None, None))
    if look.get("pads") == "keeper":  # lighter and shorter, with a small roll over the knee
        light = scaled_ring(PAD, 0.85, 0.8)
        loft(shape, [(-0.39, scaled_ring(light, 0.9, 0.9, 0.02)), (-0.12, light), (0.02, scaled_ring(light, 0.94, 0.94))],
             "kpad", ends=("cap", None))
        loft(shape, [(0.0, scaled_ring(light, 0.95, 1.0)), (0.07, scaled_ring(light, 1.0, 1.1))], "kneeroll",
             ends=(None, "cap"))
    elif look.get("pads"):
        loft(shape, [(-0.40, scaled_ring(PAD, 0.9, 0.9, 0.025)), (-0.12, PAD), (0.03, scaled_ring(PAD, 0.94, 0.94))],
             "pad", ends=("cap", None))
        roll = scaled_ring(PAD, 1.05, 1.15)
        loft(shape, [(0.02, scaled_ring(roll, 0.95, 0.95)), (0.07, scaled_ring(roll, 1.08, 1.08)),
                     (0.13, scaled_ring(roll, 0.85, 0.85))], "kneeroll", ends=(None, "cap"))


def foot_part(shape, _look):
    """The boot, its sole at -(SHIN - ANKLE) below the ankle."""
    sole = ANKLE - SHIN
    toe = [(x * 0.95, min(z, 0.175)) for x, z in SOLE]
    ankle = [(x * 0.9, -0.06 + (z + 0.065) * 0.5) for x, z in SOLE]
    loft(shape, [(sole, SOLE), (sole + 0.018, scaled_ring(SOLE, 1.03, 1.02)), (sole + 0.05, toe), (sole + 0.095, ankle)],
         "boot", v=[0.0, 0.17, 0.55, 1.0], ends=("cap", None))


def blade_ring(hw, spine, face=BAT_FACE):
    return [(hw, face), (-hw, face), (-hw, -0.004), (-0.45 * hw, -spine), (0.45 * hw, -spine), (hw, -0.004)]


def bat_part(shape, look):
    """Handle down -Y from the origin, then the blade; the face looks along +Z."""
    hw = look["bat"]
    loft(shape, [(-HANDLE - 0.02, hexa(0.017, 0.017)), (0.0, hexa(0.017, 0.017))], "grip")
    loft(shape, [(-HANDLE - BLADE, blade_ring(hw * 0.97, 0.027, 0.016)), (-HANDLE - 0.2, blade_ring(hw, 0.04)),
                 (-HANDLE - 0.06, blade_ring(hw, 0.032)), (-HANDLE, blade_ring(hw * 0.55, 0.022, 0.012))], "blade",
         v=[0.0, 0.36, 0.89, 1.0])


PARTS = {
    "hips": hips_part, "torso": torso_part, "head": head_part, "armL": arm_part, "foreL": forearm_part,
    "armR": arm_part, "foreR": forearm_part, "legL": leg_part, "shinL": shin_part, "legR": leg_part, "shinR": shin_part,
    "footL": foot_part, "footR": foot_part,
}


# Posing -------------------------------------------------------------------------

def forward(local):
    world = {}
    for joint, (parent, _) in JOINTS.items():
        offset, rotation = local[joint]
        matrix = Matrix.Translation(offset) @ rotation
        world[joint] = world[parent] @ matrix if parent else matrix
    return world


def two_bone(local, world, upper, lower, lengths, target, pole):
    """Turns a hanging limb so its end lands on `target` (or as near as it reaches), the
    middle joint bending towards `pole`."""
    a, b = lengths
    root = world[upper].translation
    to_target = target - root
    distance = min(max(to_target.length, abs(a - b) + 0.02), a + b - 0.005)
    direction = to_target.normalized()
    along = (a ** 2 - b ** 2 + distance ** 2) / (2 * distance)
    out = sqrt(max(a ** 2 - along ** 2, 0))
    bend = (pole - direction * pole.dot(direction)).normalized()
    middle = root + direction * along + bend * out
    end = root + direction * distance
    parent = world[JOINTS[upper][0]].to_quaternion()
    first = DOWN.rotation_difference(middle - root)
    second = DOWN.rotation_difference(end - middle)
    local[upper] = (local[upper][0], (parent.inverted() @ first).to_matrix().to_4x4())
    local[lower] = (local[lower][0], (first.inverted() @ second).to_matrix().to_4x4())


def reach(local, world, side, target, pole):
    """Turns one arm so its hand lands on `target`, elbow towards `pole`."""
    two_bone(local, world, "arm" + side, "fore" + side, (UPPER_ARM, FOREARM), target, pole)


def bat_transform(pose):
    top, toe, face = (Vector(pose[key]) for key in ("bat_top", "bat_toe", "bat_face"))
    y = (top - toe).normalized()
    z = (face - y * face.dot(y)).normalized()
    x = y.cross(z)
    return Matrix.Translation(top) @ Matrix((x, y, z)).transposed().to_4x4()


def hand(world, side):
    return world["fore" + side] @ Vector((0, -FOREARM, 0))


def solve(pose):
    """Joint frames for a pose, in the rig frame: the body lifted so the lower foot
    rests on the ground (plus `lift`); when the pose holds a bat, both hands on the
    handle; with `hands`, each hand on its point (relative to `root`). The bat, the
    bowling hand and the point between the hands are joints too."""
    local = {joint: (Vector(offset), euler(pose.get(joint, (0, 0, 0)))) for joint, (_, offset) in JOINTS.items()}
    x, z = pose.get("root", (0, 0))
    local["body"] = (Vector((x, 0, z)), Matrix.Identity(4))
    world = forward(local)
    for foot in ("footL", "footR"):  # a foot's angles turn it from flat on the ground, square to the hips
        flat = world["shin" + foot[-1]].to_quaternion().inverted() @ world["hips"].to_quaternion()
        local[foot] = (local[foot][0], flat.to_matrix().to_4x4() @ local[foot][1])
    world = forward(local)
    plant = pose.get("plant")  # the front foot held flat on the ground at (x, z) from the root, turned by yaw
    grounded = ("footL",) if plant else ("footL", "footR")
    lowest = min((world[foot] @ Vector((0, ANKLE - SHIN, end))).y for foot in grounded for end in (HEEL, TOE))
    local["body"] = (Vector((x, max(pose.get("lift", (0,))[0], 0) - lowest, z)), Matrix.Identity(4))
    if plant:
        world = forward(local)
        ankle = Vector((plant[0] + x, SHIN - ANKLE, plant[1] + z))
        two_bone(local, world, "legL", "shinL", (THIGH, ANKLE), ankle, Vector((0, 0, 1)))
        world = forward(local)
        turned = Matrix.Rotation(plant[2], 4, "Y")
        local["footL"] = (local["footL"][0], world["shinL"].to_3x3().to_4x4().inverted() @ turned)
    bat = Matrix.Translation(BAT_REST)
    if "bat_top" in pose:
        world = forward(local)
        bat = bat_transform(pose)
        pole = Vector(pose.get("pole", NEUTRAL["pole"]))
        for side, down in GRIPS.items():  # top hand, then bottom hand
            reach(local, world, side, bat @ Vector((0, down, 0)), pole)
    elif "hands" in pose:
        world = forward(local)
        left, right = (Vector(p) + Vector((x, 0, z)) for p in pose["hands"])
        reach(local, world, "L", left, Vector((0.6, -0.4, -0.3)))
        reach(local, world, "R", right, Vector((-0.6, -0.4, -0.3)))
    world = forward(local)
    world["bat"] = bat
    world["release"] = world["foreR"] @ Matrix.Translation((0, -FOREARM, 0))
    world["catch"] = Matrix.Translation((hand(world, "L") + hand(world, "R")) / 2)
    return world


def angles(matrix):
    """The Euler angles `euler` turns back into `matrix` (it applies Rx @ Ry @ Rz, Blender's ZYX)."""
    e = matrix.to_euler("ZYX")
    return (e.x, e.y, e.z)


def sole(world, foot="footL"):
    """The heel and toe of a foot's sole."""
    return [world[foot] @ Vector((0, ANKLE - SHIN, end)) for end in (HEEL, TOE)]


def planted(pose, plant):
    """The pose with its front foot planted at `plant`, its leg angles set to what the
    plant solves to, so neighbouring unplanted keys blend into it without a jump."""
    world = solve({**pose, "plant": plant})
    return {
        **pose, "plant": plant,
        "legL": angles(world["hips"].inverted() @ world["legL"]),
        "shinL": angles(world["legL"].inverted() @ world["shinL"]),
        "footL": angles(world["hips"].inverted() @ world["footL"]),  # the foot's turn from flat
    }


def fixed_arms(pose):
    """The pose with the arms set to the angles its `hands` targets solve to, so it
    blends into poses whose arms are set by angle."""
    world = solve(pose)
    out = {key: value for key, value in pose.items() if key != "hands"}
    for side in "LR":
        out["arm" + side] = angles(world["torso"].inverted() @ world["arm" + side])
        out["fore" + side] = angles(world["arm" + side].inverted() @ world["fore" + side])
    return out


def check_continuations(clips, continues, rest):
    """Each continuation clip's first frame is the last frame of the clip it follows, bone
    for bone, so a page can cut from one to the other without a jump."""
    for clip, parent in continues.items():
        last = frames(*clips[parent], rest)[-1]
        first = frames(*clips[clip], rest)[0]
        worst = max(max(abs(a - b) for ra, rb in zip(last[j], first[j]) for a, b in zip(ra, rb)) for j in first)
        assert worst < 1e-4, f"{clip} does not start where {parent} ends (off by {worst:.5f})"


def grip_gap(pose):
    """How far the hands of a bat-holding pose end up from their places on the handle:
    zero unless a target was out of the arm's reach."""
    world = solve(pose)
    return max((hand(world, side) - world["bat"] @ Vector((0, down, 0))).length for side, down in GRIPS.items())


def mirrored(pose):
    """The same pose with left and right exchanged."""
    out = {}
    for key, value in pose.items():
        other = key[:-1] + {"L": "R", "R": "L"}[key[-1]] if key[-1] in "LR" else key
        if key == "hands":
            out[key] = tuple((-x, y, z) for x, y, z in reversed(value))
        elif key in ("root", "pole"):
            out[key] = (-value[0], *value[1:])
        else:
            out[other] = value if key == "lift" else (value[0], -value[1], -value[2])
    return out


def spline(p0, p1, p2, p3, t):
    """Catmull-Rom: passes through p1 at t = 0 and p2 at t = 1."""
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3)


NEUTRAL = {"root": (0, 0), "lift": (0,), "pole": (0.2, -1, -0.5)}  # what a key leaves out; joint angles default to zero


def _flat(value):
    return [c for item in value for c in item] if isinstance(value[0], tuple) else list(value)


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
    if poses[1] is poses[2]:  # a held pose stays put
        return dict(poses[1])
    if poses[2] is poses[3]:  # ease into a hold, so the spline never overshoots it
        poses[3] = poses[1]
    if poses[0] is poses[1]:  # and out of one
        poses[0] = poses[2]
    out = {}
    if poses[1].get("plant") is not None and poses[1].get("plant") == poses[2].get("plant"):
        out["plant"] = poses[1]["plant"]  # a foot planted at both ends stays exactly where it is
    for name in set().union(*poses) - {"plant"}:
        values = [_flat(p.get(name, NEUTRAL.get(name, (0, 0, 0)))) for p in poses]
        mixed = [spline(*(v[i] for v in values), t) for i in range(len(values[0]))]
        out[name] = (tuple(mixed[:3]), tuple(mixed[3:])) if name == "hands" else tuple(mixed)
    return out


def frames(keys, loop, rest):
    """One dict of Blender-space joint frames per frame of the clip, for a rig whose
    bind pose is `rest` (rig-frame joint frames): each carries the bind pose's
    vertices of its bone to where the pose puts them."""
    count = round(keys[-1][0] * FPS)
    out = []
    for i in range(count + 1):
        world = solve(sample(keys, i / FPS, loop))
        out.append({joint: to_blender(m) @ to_blender(rest[joint]).inverted() @ Matrix.Translation(TO_BLENDER @ rest[joint].translation)
                    for joint, m in world.items()})
    return out


def build_figure(name, look, rest_pose, extras=()):
    """The figure's mesh, modelled in `rest_pose` (its bind pose, which a page that
    plays no clip shows) on an armature called `name`."""
    shape = Shape(kit_atlas())
    world = solve(rest_pose)
    parts = dict(PARTS)
    if look.get("bat"):
        parts["bat"] = bat_part
    for joint, draw in parts.items():
        shape.part(to_blender(world[joint]), joint)
        draw(shape, look)
    mesh = shape.finish(f"{name}_mesh")
    bones = {}
    for joint in [*JOINTS, *extras]:
        if joint not in parts and joint != "body" and joint not in extras:
            continue
        head = TO_BLENDER @ world[joint].translation
        tail = head + TO_BLENDER @ (world[joint].to_3x3() @ Vector((0, BONE_LENGTH[joint], 0)))
        parent = EXTRA_PARENT.get(joint) or JOINTS[joint][0]
        bones[joint] = (parent, head, tail)
        if joint == "bat":  # its Y runs down the handle to the toe, its Z is the way the face looks
            bones[joint] += (TO_BLENDER @ (world[joint].to_3x3() @ Vector((0, 0, 1))),)
    return armature(name, bones, mesh), mesh, world


def body_edge(rig, mesh, clips, rest):
    """The largest rig Z any body part reaches over the clips, measured on the
    deformed mesh frame by frame (before the clips are baked, so nothing overrides the pose)."""
    groups = {g.index for g in mesh.vertex_groups if g.name in BODY_PARTS}
    body = [v.index for v in mesh.data.vertices if any(e.group in groups for e in v.groups)]
    edge = -inf
    for keys, loop in clips:
        for joints in frames(keys, loop, rest):
            pose(rig, joints)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            depsgraph.update()
            evaluated = mesh.evaluated_get(depsgraph)
            deformed = evaluated.to_mesh()
            edge = max(edge, max(-deformed.vertices[i].co.y for i in body))  # rig z is Blender -y
            evaluated.to_mesh_clear()
    return edge


def look_for(figure, **kit):
    return {"face": figure, **FACES[figure], **kit}


def bake_all(rig, clips, rest):
    for clip, (keys, loop) in clips.items():
        bake(rig, clip, frames(keys, loop, rest))
