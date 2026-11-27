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
from math import asin, atan2, cos, hypot, inf, pi, sin, sqrt

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
    if look.get("gloves"):
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
    if look.get("pads"):
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


def page_scale(release_height):
    """The size bowler.js gives the figure so its hand reaches the page's release height."""
    return min(max(PAGE_RELEASE_HEIGHT / max(release_height, 0.5), 0.85), 1.3)


def bowling_arm(pose, ahead, near):
    """The pose with the bowling arm straight and its hand `ahead` page metres in front of
    the front toe and over the front foot's lane; the arm's angle is kept within a turn of
    `near`, so the windmill keeps turning the same way."""
    world = solve(pose)
    shoulder = world["armR"].translation
    toe = sole(world)[1]
    length, size = UPPER_ARM + FOREARM, 1.0
    for _ in range(5):  # the page's scale depends on the height the hand ends up at
        tx, tz = toe.x, toe.z + ahead / size
        level = (tx - shoulder.x) ** 2 + (tz - shoulder.z) ** 2
        assert level < length ** 2, "the release point is out of the bowling arm's reach"
        ty = shoulder.y + sqrt(length ** 2 - level)
        size = page_scale(ty)
    local = world["torso"].to_3x3().inverted() @ (Vector((tx, ty, tz)) - shoulder).normalized()
    az = asin(local.x)
    ax = atan2(-local.z / cos(az), -local.y / cos(az))
    ax += 2 * pi * round((near - ax) / (2 * pi))
    return {**pose, "armR": (ax, 0, az), "foreR": (0, 0, 0)}


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


# Poses --------------------------------------------------------------------------
# For the batter +Z is the off side and +X points up the pitch at the bowler; the
# page keeps the body's edge at least 0.15 m to the leg side of middle stump and the
# fourth-stump corridor runs out to 0.28 m on the off side, so the body is kept at
# rig z <= 0.25 and the middle of the bat's face reaches at least 0.43 m past the body's edge.
# Bat points are (x, height above the ground, z) of the top of the handle and the toe.

BAT_LINE, BODY_LIMIT, MIN_REACH = 0.67, 0.25, 0.43

STANCE = {
    "root": (0.0, -0.12),
    "torso": (0.3, 0.05, 0), "head": (-0.22, 1.15, 0),
    "legL": (-0.32, 0, 0.17), "shinL": (0.5, 0, 0), "legR": (-0.32, 0, -0.17), "shinR": (0.5, 0, 0),
    "bat_top": (0.05, 0.88, 0.12), "bat_toe": (-0.13, 0.03, 0.15), "bat_face": (1, 0, 0),
}
TAP = {**STANCE, "bat_top": (0.06, 0.92, 0.12), "bat_toe": (-0.15, 0.14, 0.15)}
FLEX = {**STANCE, "torso": (0.3, 0.05, 0), "legL": (-0.4, 0, 0.17), "shinL": (0.64, 0, 0), "legR": (-0.4, 0, -0.17), "shinR": (0.64, 0, 0)}
BACKLIFT = {**STANCE, "torso": (0.28, 0.05, 0), "bat_top": (-0.06, 1.0, 0.16), "bat_toe": (-0.45, 1.26, 0.1), "bat_face": (1, 0.3, 0)}


def aimed(pose, line):
    """The pose with its bat slid across so the middle of the face is at rig z `line`."""
    middle = bat_transform(pose) @ Vector((0, -HANDLE - BLADE / 2, BAT_FACE))
    dz = line - middle.z
    return {**pose, "bat_top": (pose["bat_top"][0], pose["bat_top"][1], pose["bat_top"][2] + dz),
            "bat_toe": (pose["bat_toe"][0], pose["bat_toe"][1], pose["bat_toe"][2] + dz)}


# A long front stride down the pitch with the front knee over the foot, the trunk leaning
# towards the bowler (not out over the off side), and the bat angled down from hands held
# out ahead of the blade, its toe no wider than the hands.
FORWARD_DEFENSIVE = aimed({
    "root": (0.2, -0.033),
    "torso": (0.225, 0.012, -0.306), "head": (-0.5, 1.09, 0.2),
    "legL": (0.0, 0, 0.846), "shinL": (0.7, 0, -0.677), "legR": (0.02, 0, -0.784), "shinR": (0.1, 0, 0),
    "bat_top": (0.307, 1.042, 0.6), "bat_toe": (-0.105, 0.287, 0.6), "bat_face": (1, -0.3, 0), "pole": (0.3, -1, 0.2),
}, BAT_LINE)

# Bat lifted high over the front shoulder, the head left where it was, letting the ball go.
# The bat comes up in front of the front shoulder and tips back on the bowler's side
# of the head, so it never crosses the head or cap.
LEAVE_LIFT = {
    **STANCE, "torso": (0.3, 0.12, 0), "head": (-0.22, 1.08, 0),
    "bat_top": (0.2, 1.08, 0.27), "bat_toe": (-0.55, 1.36, 0.33), "bat_face": (0.2, 0.4, 1), "pole": (0.5, -0.8, 0.3),
}
LEAVE_RISE = {
    **LEAVE_LIFT, "torso": (0.3, 0.2, 0), "head": (-0.22, 1.0, 0),
    "bat_top": (0.35, 1.29, 0.36), "bat_toe": (0.43, 2.09, 0.27), "bat_face": (1, 0, 0.3), "pole": (0.6, -0.6, 0.5),
}
# the hands held well out towards the bowler and the off side, so from behind the stumps the gloves stay clear
# of the head; the shoulders turn a little towards the bowler so the bottom hand reaches across
SHOULDERING_ARMS = {
    **LEAVE_RISE, "torso": (0.3, 0.25, 0), "head": (-0.22, 0.95, 0),
    "bat_top": (0.38, 1.36, 0.42), "bat_toe": (0.26, 2.14, 0.0), "pole": (0.4, -0.7, 0.8),
}

# The same stride with the hands pushed a little further out and the face of the bat
# opened; then the head turns to follow the edge.
EDGE_PUSH = aimed({
    **FORWARD_DEFENSIVE, "root": (0.18, -0.04),
    "bat_top": (0.27, 1.05, 0.6), "bat_toe": (-0.07, 0.25, 0.6), "bat_face": (1, -0.2, 0.4),
}, BAT_LINE)
EDGE_LOOK = {**EDGE_PUSH, "head": (-0.5, 0.6, 0.2)}

CONTACT_TIME = 0.3  # into Forward_Defensive and Edge_Flash, when the bat meets the ball

BATTER_CLIPS = {
    "Forward_Defensive": ([(0, STANCE), (0.13, BACKLIFT), (CONTACT_TIME, FORWARD_DEFENSIVE), (0.6, FORWARD_DEFENSIVE)], False),
    "Leave_Shoulder_Arms": ([(0, STANCE), (0.12, LEAVE_LIFT), (0.25, LEAVE_RISE), (0.4, SHOULDERING_ARMS),
                             (0.6, SHOULDERING_ARMS)], False),
    "Edge_Flash": ([(0, STANCE), (0.13, BACKLIFT), (CONTACT_TIME, EDGE_PUSH), (0.45, EDGE_PUSH), (0.65, EDGE_LOOK), (0.8, EDGE_LOOK)], False),
    # the idle goes on last, so it is also the pose the file opens in
    "Idle_Stance": ([(0, STANCE), (0.3, TAP), (0.6, STANCE), (0.9, FLEX), (1.2, STANCE)], True),
}

# A right-armer. The bowling arm's X angle runs on past a full turn: down is 0,
# straight back is pi/2, over the top is pi.
RUN = {
    "torso": (0.3, -0.15, 0), "head": (-0.25, 0.1, 0),
    "legL": (-0.8, 0, 0), "shinL": (0.35, 0, 0), "legR": (0.45, 0, 0), "shinR": (1.2, 0, 0), "footL": (-0.2, 0, 0), "footR": (0.9, 0, 0),
    "armR": (-0.7, 0, 0), "foreR": (-1.3, 0, 0), "armL": (0.6, 0, 0), "foreL": (-1.2, 0, 0),
}
RUN_PASS = {
    "lift": (0.06,), "torso": (0.3, 0, 0), "head": (-0.25, 0, 0),
    "legL": (0, 0, 0), "shinL": (0.3, 0, 0), "legR": (-0.3, 0, 0), "shinR": (1.6, 0, 0), "footR": (0.5, 0, 0),
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
# The front foot lands at plant_time on FRONT_FOOT (its ankle, from the root, and its turn)
# and stays there, flat, through the release and the follow-through. The page stands the
# figure so the release bone is on the ball's first point, so where the foot is relative
# to the hand decides the no-ball: the toe is FOOT_BEHIND (page metres) behind the hand.
# Over the wicket, the hand is over the front foot's lane and the body to its left (+X).
PAGE_RELEASE_HEIGHT = 2.08  # the ball's first point above the ground, which bowler.js scales the hand to
FOOT_BEHIND, FOOT_BEHIND_RANGE = 0.17, (0.12, 0.22)
FRONT_FOOT = (-0.2, 0.2, 0.0)
PLANT = planted({  # front foot down, front arm pulling in, bowling arm coming up behind
    "hips": (0, -0.1, 0), "torso": (0.15, -0.15, -0.08), "head": (-0.15, 0.2, 0),
    "legL": (-0.4, 0, -0.25), "shinL": (0.25, 0, 0), "legR": (0.3, 0, 0), "shinR": (0.7, 0, 0),
    "armL": (-1.2, 0, 0.2), "foreL": (-1.0, 0, 0), "armR": (2.2, 0, 0.1), "foreR": (-0.05, 0, 0),
}, FRONT_FOOT)
RELEASE = bowling_arm(planted({  # front leg braced, trunk over it and tilted away from the arm, arm straight beside the head
    "torso": (0.38, 0.2, -0.1), "head": (-0.3, -0.15, 0.05),
    "legL": (-0.22, 0, -0.3), "shinL": (0.03, 0, 0), "legR": (0.5, 0, 0), "shinR": (0.9, 0, 0),
    "armL": (0.55, 0, 0.3), "foreL": (-1.3, 0, 0),
}, FRONT_FOOT), FOOT_BEHIND, 2 * pi - 3.05)
FOLLOW = planted({  # the arm finishes across the body, the back leg swings through, the front foot still down
    "hips": (0, 0.3, 0), "torso": (0.85, 0.5, 0), "head": (-0.6, -0.3, 0),
    "legR": (-0.9, 0, 0), "shinR": (1.0, 0, 0), "legL": (-0.1, 0, -0.2), "shinL": (0.15, 0, 0),
    "armR": (5.2, 0, -0.3), "foreR": (-0.3, 0, 0), "armL": (1.0, 0, 0.2), "foreL": (-0.8, 0, 0),
}, FRONT_FOOT)
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

# First slip: a deep, wide crouch, hands cupped low in front, weight rocking side to side.
CROUCH = {
    "torso": (1.0, 0, 0), "head": (-0.9, 0, 0),
    "legL": (-1.1, 0, 0.42), "shinL": (1.65, 0, 0), "legR": (-1.1, 0, -0.42), "shinR": (1.65, 0, 0),
    "hands": ((0.09, 0.42, 0.5), (-0.09, 0.42, 0.5)),
}
CROUCH_LEFT = {**CROUCH, "root": (0.035, 0), "lift": (0.01,), "torso": (1.0, 0.05, -0.07), "head": (-0.9, -0.04, 0.06),
               "legL": (-1.16, 0, 0.36), "shinL": (1.75, 0, 0), "legR": (-1.04, 0, -0.46), "shinR": (1.55, 0, 0),
               "hands": ((0.12, 0.43, 0.51), (-0.06, 0.42, 0.5))}
SLIP_CLIPS = {"Idle_Crouch": ([(0, CROUCH), (0.6, CROUCH_LEFT), (1.2, CROUCH), (1.8, mirrored(CROUCH_LEFT)), (2.4, CROUCH)], True)}

# A ring fielder walking in: half crouched, hands low and ready, rocking from foot to foot.
READY = {
    "torso": (0.52, 0, 0), "head": (-0.44, 0, 0),
    "legL": (-0.6, 0, 0.14), "shinL": (0.9, 0, 0), "legR": (-0.6, 0, -0.14), "shinR": (0.9, 0, 0),
    "hands": ((0.11, 0.66, 0.42), (-0.11, 0.66, 0.42)),
}
READY_LEFT = {**READY, "root": (0.03, 0.02), "lift": (0.015,), "torso": (0.52, 0.06, -0.05), "head": (-0.44, -0.05, 0.04),
              "legL": (-0.68, 0, 0.12), "shinL": (1.0, 0, 0), "legR": (-0.45, 0, -0.16), "shinR": (0.8, 0, 0),
              "hands": ((0.13, 0.67, 0.44), (-0.08, 0.66, 0.42))}
FIELDER_CLIPS = {"Idle_Crouch": ([(0, READY), (0.4, READY_LEFT), (0.8, READY), (1.2, mirrored(READY_LEFT)), (1.6, READY)], True)}


# The four figures -----------------------------------------------------------------

def _look(figure, **kit):
    return {"face": figure, **FACES[figure], **kit}


def _bake_all(rig, clips, rest):
    for clip, (keys, loop) in clips.items():
        bake(rig, clip, frames(keys, loop, rest))


def build_batter(bat_half_width):
    """A right-hander in a cap, with Idle_Stance, Forward_Defensive,
    Leave_Shoulder_Arms and Edge_Flash; bat_line and body_edge measured."""
    rig, mesh, rest = build_figure("batter", _look("batter", hat="cap", pads=True, gloves=True, bat=bat_half_width), STANCE, ["bat"])
    for clip, (keys, loop) in BATTER_CLIPS.items():
        for i in range(round(keys[-1][0] * FPS) + 1):
            gap = grip_gap(sample(keys, i / FPS, loop))
            assert gap <= GRIP_TOLERANCE, f"{clip} frame {i}: a hand is {gap * 100:.1f} cm off the handle (out of reach)"
    edge = body_edge(rig, mesh, BATTER_CLIPS.values(), rest)
    assert edge <= BODY_LIMIT, f"the batter's body reaches rig z {edge:.3f}, past {BODY_LIMIT}"
    contact = solve(sample(BATTER_CLIPS["Forward_Defensive"][0], CONTACT_TIME, False))
    line = (contact["bat"] @ Vector((0, -HANDLE - BLADE / 2, BAT_FACE))).z
    assert abs(line - BAT_LINE) < 0.02, f"the bat meets the ball at rig z {line:.3f}, not {BAT_LINE}"
    assert line - edge >= MIN_REACH, f"the bat reaches only {line - edge:.3f} m past the body, not {MIN_REACH}"
    _bake_all(rig, BATTER_CLIPS, rest)
    rig["contact_time"] = CONTACT_TIME
    rig["bat_line"] = round(line, 3)
    rig["body_edge"] = round(edge, 3)


def build_bowler():
    """A right-arm fast bowler with RunUp_Stride, Bound_And_Deliver and
    Appeal_Celebrate, and a bone called `release` in the bowling hand."""
    rig, _, rest = build_figure("bowler", _look("bowler", hat="none"), RUN, ["release"])
    behind, height, lane = delivery_checks()
    _bake_all(rig, BOWLER_CLIPS, rest)
    rig["release_time"] = RELEASE_TIME
    rig["plant_time"] = PLANT_TIME
    rig["front_foot_behind_release"] = round(behind, 3)
    rig["release_height"] = round(height, 3)
    print(f"bowler: toe {behind:.3f} m behind the hand at the page's scale {page_scale(height):.3f}, "
          f"hand {height:.3f} m up and {lane:.3f} m to the right of the body's centre line")


def delivery_checks():
    """Asserts the front foot lands flat at plant_time and stays put to the release, with
    its toe FOOT_BEHIND behind the hand. Returns that distance (page metres), the release
    bone's height, and how far the hand is to the right of the hips (rig X)."""
    keys = BOWLER_CLIPS["Bound_And_Deliver"][0]
    at_release = solve(sample(keys, RELEASE_TIME, False))
    hand = at_release["release"].translation
    behind = (hand.z - sole(at_release)[1].z) * page_scale(hand.y)
    low, high = FOOT_BEHIND_RANGE
    assert low <= behind <= high, f"the front toe is {behind:.3f} m behind the hand at release, not {low} to {high}"
    landed = sole(solve(sample(keys, PLANT_TIME, False)))
    times = [PLANT_TIME + (RELEASE_TIME - PLANT_TIME) * i / 20 for i in range(21)]
    times += [i / FPS for i in range(round(PLANT_TIME * FPS), round(RELEASE_TIME * FPS) + 1) if PLANT_TIME <= i / FPS <= RELEASE_TIME]
    for t in times:
        points = sole(solve(sample(keys, t, False)))
        assert all(abs(p.y) <= 0.01 for p in points), f"the front sole is off the ground at {t:.3f} s"
        moved = max((p - q).length for p, q in zip(points, landed))
        assert moved <= 0.01, f"the front foot has moved {moved * 100:.1f} cm by {t:.3f} s"
    return behind, hand.y, at_release["hips"].translation.x - hand.x


def build_slip():
    """First slip in a sun hat, crouched (also the bind pose), with Idle_Crouch and
    a bone called `catch` between the hands."""
    rig, _, rest = build_figure("slip", _look("slip", hat="sunhat"), CROUCH, ["catch"])
    _bake_all(rig, SLIP_CLIPS, rest)


def build_fielder():
    """A ring fielder (cover or mid-off) in a cap, walking in, with Idle_Crouch."""
    rig, _, rest = build_figure("fielder", _look("fielder", hat="cap"), READY, ["catch"])
    _bake_all(rig, FIELDER_CLIPS, rest)
