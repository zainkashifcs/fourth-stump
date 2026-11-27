"""The batter: a right-hander in a cap, pads, gloves and a bat, and his clips.

For the batter +Z is the off side and +X points up the pitch at the bowler. The
page keeps the body's edge at least 0.15 m to the leg side of middle stump and the
fourth-stump corridor runs out to 0.28 m on the off side, so the body is kept at
rig z <= 0.25 and the middle of the bat's face reaches at least 0.43 m past the
body's edge. Bat points are (x, height above the ground, z) of the top of the
handle and the toe.
"""
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from figures import (BAT_FACE, BLADE, FOREARM, FPS, GRIP_TOLERANCE, GRIPS, HANDLE, UPPER_ARM, bake_all,
                     bat_transform, body_edge, build_figure, check_continuations, grip_gap, look_for, sample, solve,
                     to_blender)

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


def held_bat(pose, top=(-0.06, 0.12, 0.34), toe=(0.06, -0.72, 0.42), face=(1, 0, 0.2)):
    """The pose holding its bat at points given in its trunk's frame (+Y up the spine,
    +Z out of the chest), so the bat turns with the trunk and stays in the hands' reach."""
    torso = solve(pose)["torso"]
    return {**pose, "bat_top": tuple(torso @ Vector(top)), "bat_toe": tuple(torso @ Vector(toe)),
            "bat_face": tuple(torso.to_3x3() @ Vector(face))}


# A long front stride down the pitch with the front knee over the foot, the trunk leaning
# towards the bowler (not out over the off side), and the bat angled down from hands held
# out ahead of the blade, its toe no wider than the hands.
FORWARD_DEFENSIVE = aimed({
    "root": (0.2, -0.033),
    "torso": (0.225, 0.012, -0.306), "head": (-0.5, 1.09, 0.2),
    "legL": (0.0, 0, 0.846), "shinL": (0.7, 0, -0.677), "legR": (0.02, 0, -0.784), "shinR": (0.1, 0, 0),
    "bat_top": (0.307, 1.042, 0.6), "bat_toe": (-0.105, 0.287, 0.6), "bat_face": (1, -0.3, 0), "pole": (0.3, -1, 0.2),
}, BAT_LINE)

# A clean leave to a good-length ball: a small trigger step across, the bat picked up
# backwards and then lifted straight up, periscope-high, with the hands tucked in close;
# the head stays where it was and turns to watch the ball through to the keeper. The bat
# rises on the bowler's side of the head, so it never crosses the head or cap.
TRIGGER = {**STANCE, "root": (0.0, -0.095), "bat_top": (0.05, 0.92, 0.13), "bat_toe": (-0.15, 0.08, 0.16)}
LEAVE_LIFT = {
    **TRIGGER, "torso": (0.3, 0.15, 0), "head": (-0.22, 1.05, 0),
    "bat_top": (0.2, 1.1, 0.27), "bat_toe": (-0.55, 1.38, 0.33), "bat_face": (0.2, 0.4, 1), "pole": (0.5, -0.8, 0.3),
}
PERISCOPE = {
    **TRIGGER, "torso": (0.3, 0.3, 0), "head": (-0.22, 0.9, 0),
    "bat_top": (0.34, 1.42, 0.3), "bat_toe": (0.32, 2.28, 0.26), "bat_face": (1, 0, 0.2), "pole": (0.4, -0.7, 0.8),
}
WATCH = {**PERISCOPE, "head": (-0.25, 0.92, 0.02)}  # the eyes follow the ball past the off stump

# A bouncer: weight goes late onto the back foot, the knees fold and the trunk sways back
# towards the keeper and inside the line, chin tucked, eyes up on the ball, and the wrists
# drop the bat low and in by the hip.
DUCK_SET = {**TRIGGER, "root": (-0.03, -0.13), "legR": (-0.4, 0, -0.2), "shinR": (0.65, 0, 0)}
DUCK = {
    "root": (-0.14, -0.26),
    "torso": (0.05, 0.3, 0.42), "head": (-0.2, 0.85, -0.25),
    "legL": (-0.55, 0, 0.48), "shinL": (1.0, 0, 0), "legR": (-0.65, 0, -0.45), "shinR": (1.15, 0, 0),
    "bat_top": (-0.02, 0.7, -0.02), "bat_toe": (-0.72, 0.3, -0.12), "bat_face": (0, 1, 0.3), "pole": (0.2, -1, 0.3),
}

# A middled defensive held as a finish: the bat pushed a little further down the line,
# the front elbow high, the head over the front knee.
FINISH = {
    **FORWARD_DEFENSIVE, "torso": (0.22, 0.0, -0.45), "head": (-0.42, 1.12, 0.22),
    "bat_top": (FORWARD_DEFENSIVE["bat_top"][0] - 0.03, 1.05, FORWARD_DEFENSIVE["bat_top"][2] - 0.04),
    "bat_toe": (FORWARD_DEFENSIVE["bat_toe"][0] + 0.16, 0.23, FORWARD_DEFENSIVE["bat_toe"][2]), "pole": (0.3, -0.3, 0.6),
}

# An edge: a tentative half-stride, the hands pushing a little away from the body, the face
# opened just enough; then the head turns to follow the ball to the cordon.
EDGE_PUSH = aimed({
    **FORWARD_DEFENSIVE, "root": (0.14, -0.05),
    "torso": (0.25, 0.05, -0.24), "head": (-0.5, 1.05, 0.15),
    "legL": (0.0, 0, 0.7), "shinL": (0.62, 0, -0.55), "legR": (0.0, 0, -0.62), "shinR": (0.1, 0, 0),
    "bat_top": (0.28, 1.06, 0.6), "bat_toe": (-0.06, 0.27, 0.6), "bat_face": (1, -0.25, 0.25),
}, BAT_LINE - 0.04)  # inside the line by most of the bat's half-width: the outside edge meets the ball
EDGE_LOOK = {**EDGE_PUSH, "head": (-0.5, 0.6, 0.2)}

# Caught behind: a look back at the cordon, the head drops, the bat comes down, a half-turn to go.
HD_LOOK = {**EDGE_LOOK, "root": (0.12, -0.12), "torso": (0.25, -0.1, -0.2), "head": (-0.3, -0.45, 0.1),
           "bat_top": (0.24, 1.0, 0.42), "bat_toe": (0.0, 0.2, 0.48)}
HD_DROP = held_bat({
    **HD_LOOK, "root": (0.06, -0.2), "torso": (0.35, -0.2, -0.1), "head": (0.3, -0.2, 0.05),
    "legL": (-0.3, 0, 0.35), "shinL": (0.4, 0, -0.2), "legR": (-0.1, 0, -0.3), "shinR": (0.3, 0, 0),
    "pole": (0.2, -1, -0.5),
})
HD_TURN = held_bat({
    **HD_DROP, "root": (0.02, -0.25), "hips": (0, -0.45, 0), "torso": (0.3, -0.25, 0), "head": (0.35, -0.1, 0),
    "legL": (-0.2, 0, 0.12), "shinL": (0.3, 0, 0), "legR": (0.15, 0, -0.1), "shinR": (0.35, 0, 0),
})
HD_MID = held_bat(sample([(0, HD_DROP), (1, HD_TURN)], 0.5, False))  # the bat turns with the trunk on the way

# Bowled: after the leave, a recoil and a look back over the shoulder at the broken wicket
# as the bat comes down; after the defensive, frozen on the front stride, then the slow turn.
RECOIL = {**WATCH, "root": (-0.02, -0.14), "legL": (-0.42, 0, 0.17), "shinL": (0.68, 0, 0),
          "legR": (-0.42, 0, -0.17), "shinR": (0.68, 0, 0), "torso": (0.32, 0.3, 0), "head": (-0.15, 0.7, 0),
          "bat_top": (0.34, 1.32, 0.3), "bat_toe": (0.34, 2.18, 0.24)}
BL_LOOK = held_bat({**RECOIL, "torso": (0.3, -0.25, 0), "head": (-0.12, -0.9, 0), "pole": (0.3, -0.8, 0.5)},
                   top=(0.04, 0.32, 0.38), toe=(0.27, 0.85, 1.0), face=(1, -0.5, 0.2))  # tipping forward, away from the head
BL_MID = held_bat(BL_LOOK, top=(-0.04, 0.22, 0.35), toe=(0.2, -0.5, 0.8), face=(1, -0.3, 0.2))  # down through the front
BL_DOWN = held_bat({**BL_LOOK, "pole": (0.2, -1, -0.3)})
BP_LOOK = {**FORWARD_DEFENSIVE, "torso": (0.225, -0.08, -0.306), "head": (-0.3, -0.9, 0.1)}

CONTACT_TIME = 0.3  # into Forward_Defensive and Edge_Flash, when the bat meets the ball

BATTER_CLIPS = {
    "Forward_Defensive": ([(0, STANCE), (0.13, BACKLIFT), (CONTACT_TIME, FORWARD_DEFENSIVE), (0.6, FORWARD_DEFENSIVE)], False),
    "Leave_Shoulder_Arms": ([(0, STANCE), (0.08, TRIGGER), (0.16, LEAVE_LIFT), (0.28, PERISCOPE), (0.38, PERISCOPE),
                             (0.6, WATCH)], False),
    "Edge_Flash": ([(0, STANCE), (0.13, BACKLIFT), (CONTACT_TIME, EDGE_PUSH), (0.45, EDGE_PUSH), (0.65, EDGE_LOOK), (0.8, EDGE_LOOK)], False),
    "Leave_Duck_Sway": ([(0, STANCE), (0.15, DUCK_SET), (0.35, DUCK), (0.6, DUCK)], False),
    "Follow_Through": ([(0, FORWARD_DEFENSIVE), (0.18, FINISH), (0.5, FINISH)], False),
    "Head_Drop": ([(0, EDGE_LOOK), (0.25, HD_LOOK), (0.55, HD_DROP), (0.72, HD_MID), (0.9, HD_TURN)], False),
    "Bowled_After_Leave": ([(0, WATCH), (0.12, RECOIL), (0.5, BL_LOOK), (0.7, BL_MID), (0.9, BL_DOWN)], False),
    "Bowled_After_Play": ([(0, FORWARD_DEFENSIVE), (0.3, FORWARD_DEFENSIVE), (0.9, BP_LOOK)], False),
    # the idle goes on last, so it is also the pose the file opens in
    "Idle_Stance": ([(0, STANCE), (0.3, TAP), (0.6, STANCE), (0.9, FLEX), (1.2, STANCE)], True),
}
AFTER_THE_BALL = ("Head_Drop", "Bowled_After_Leave", "Bowled_After_Play")  # out, not playing or leaving: no body limit
# clip: the clip whose last frame it starts on, so the page can cut from one to the other
CONTINUES = {"Follow_Through": "Forward_Defensive", "Head_Drop": "Edge_Flash",
             "Bowled_After_Leave": "Leave_Shoulder_Arms", "Bowled_After_Play": "Forward_Defensive"}


def head_crossings(mesh, rest, clips):
    """(clip, frame) of every frame on which an edge of an arm, glove or the bat passes
    through a face of the head, neck, hair or cap; the parts are moved rigidly, as the skin does."""
    names = {g.index: g.name for g in mesh.vertex_groups}
    part_of = [names[v.groups[0].group] for v in mesh.data.vertices]
    rest_co = [v.co.copy() for v in mesh.data.vertices]
    inverse = {part: to_blender(rest[part]).inverted() for part in set(part_of)}
    head = [list(p.vertices) for p in mesh.data.polygons if part_of[p.vertices[0]] == "head"]
    edges = [tuple(e.vertices) for e in mesh.data.edges if part_of[e.vertices[0]] in ("armL", "armR", "foreL", "foreR", "bat")]
    found = []
    for clip, (keys, loop) in clips.items():
        for i in range(round(keys[-1][0] * FPS) + 1):
            world = solve(sample(keys, i / FPS, loop))
            moved = {part: to_blender(world[part]) @ inverse[part] for part in inverse}
            co = [moved[part] @ c for part, c in zip(part_of, rest_co)]
            tree = BVHTree.FromPolygons(co, head)
            if any(tree.ray_cast(co[a], (co[b] - co[a]).normalized(), (co[b] - co[a]).length)[0] is not None for a, b in edges):
                found.append((clip, i))
    return found


def build_batter(bat_half_width):
    """A right-hander in a cap, with Idle_Stance, Forward_Defensive, Leave_Shoulder_Arms,
    Edge_Flash, Leave_Duck_Sway and the continuations Follow_Through, Head_Drop,
    Bowled_After_Leave and Bowled_After_Play; bat_line and body_edge measured."""
    rig, mesh, rest = build_figure("batter", look_for("batter", hat="cap", pads=True, gloves=True, bat=bat_half_width), STANCE, ["bat"])
    for clip, (keys, loop) in BATTER_CLIPS.items():
        for i in range(round(keys[-1][0] * FPS) + 1):
            gap = grip_gap(sample(keys, i / FPS, loop))
            assert gap <= GRIP_TOLERANCE, f"{clip} frame {i}: a hand is {gap * 100:.1f} cm off the handle (out of reach)"
    crossings = head_crossings(mesh, rest, BATTER_CLIPS)
    assert not crossings, f"an arm or the bat passes through the head or cap: {crossings[:6]}"
    check_continuations(BATTER_CLIPS, CONTINUES, rest)
    edge = body_edge(rig, mesh, [clip for name, clip in BATTER_CLIPS.items() if name not in AFTER_THE_BALL], rest)
    assert edge <= BODY_LIMIT, f"the batter's body reaches rig z {edge:.3f}, past {BODY_LIMIT}"
    contact = solve(sample(BATTER_CLIPS["Forward_Defensive"][0], CONTACT_TIME, False))
    line = (contact["bat"] @ Vector((0, -HANDLE - BLADE / 2, BAT_FACE))).z
    assert abs(line - BAT_LINE) < 0.02, f"the bat meets the ball at rig z {line:.3f}, not {BAT_LINE}"
    assert line - edge >= MIN_REACH, f"the bat reaches only {line - edge:.3f} m past the body, not {MIN_REACH}"
    bake_all(rig, BATTER_CLIPS, rest)
    rig["contact_time"] = CONTACT_TIME
    rig["bat_line"] = round(line, 3)
    rig["body_edge"] = round(edge, 3)
    # what the page needs to re-aim the bat and re-solve the arms: the bat bone runs from the
    # top of the handle (its head) down its +Y to the toe, its +Z is the way the face looks
    rig["bat_handle"] = HANDLE
    rig["bat_blade"] = BLADE
    rig["bat_half_width"] = bat_half_width
    rig["grip_top"] = -GRIPS["L"]
    rig["grip_bottom"] = -GRIPS["R"]
    rig["upper_arm"] = UPPER_ARM
    rig["forearm"] = FOREARM
    rig["top_hand"] = "left"


