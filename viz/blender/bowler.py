"""The bowler: a right-arm fast bowler, bareheaded, and his clips.

The page stands the figure so its `release` bone is on the ball's first point at
release_time, scaled so the hand reaches the release height; the front foot's
place relative to the hand therefore decides the no-ball.
"""
from math import asin, atan2, cos, pi, sqrt

from mathutils import Vector

from figures import (FOREARM, FPS, UPPER_ARM, bake_all, build_figure, look_for, mirrored, planted, sample,
                     sole, solve)


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
# After the follow-through the bowler runs on in two strides, each shorter and slower than
# the last, the trunk coming up and the bowling arm swinging down by his side. The clip
# stays in place; the page carries the root forward.
STRIDE_ONE = {  # the back foot lands well ahead, the front leg trails off its toe
    "hips": (0, 0.15, 0), "torso": (0.55, 0.25, 0), "head": (-0.4, -0.15, 0),
    "legR": (-0.6, 0, 0), "shinR": (0.25, 0, 0), "legL": (0.5, 0, 0), "shinL": (0.9, 0, 0), "footL": (0.6, 0, 0),
    "armR": (5.75, 0, -0.2), "foreR": (-0.4, 0, 0), "armL": (0.5, 0, 0.15), "foreL": (-0.9, 0, 0),
}
STRIDE_PASS = {
    "lift": (0.03,), "hips": (0, 0.05, 0), "torso": (0.4, 0.1, 0), "head": (-0.3, -0.05, 0),
    "legR": (0.1, 0, 0), "shinR": (0.25, 0, 0), "legL": (-0.25, 0, 0), "shinL": (1.15, 0, 0), "footL": (0.3, 0, 0),
    "armR": (6.0, 0, -0.1), "foreR": (-0.5, 0, 0), "armL": (0.2, 0, 0.1), "foreL": (-0.7, 0, 0),
}
STRIDE_TWO = {  # a shorter step onto the front foot, nearly upright
    "torso": (0.28, 0, 0), "head": (-0.2, 0, 0),
    "legL": (-0.35, 0, 0), "shinL": (0.15, 0, 0), "legR": (0.3, 0, 0), "shinR": (0.55, 0, 0), "footR": (0.35, 0, 0),
    "armR": (6.15, 0, -0.05), "foreR": (-0.45, 0, 0), "armL": (-0.1, 0, 0.1), "foreL": (-0.6, 0, 0),
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
FIST_UP = {  # the bowling arm comes down bent, the fist up by the face
    "torso": (0.05, -0.15, 0), "head": (-0.25, 0.1, 0),
    "legL": (-0.08, 0, 0.08), "shinL": (0.15, 0, 0), "legR": (-0.08, 0, -0.08), "shinR": (0.15, 0, 0),
    "armR": (2 * pi - 2.1, 0, -0.25), "foreR": (-1.7, 0, 0), "armL": (0.15, 0, 0.15), "foreL": (-0.5, 0, 0),
}
FIST_PUMP = {**FIST_UP, "torso": (0.25, -0.2, 0), "head": (-0.1, 0.1, 0),  # and pumps down, the elbow driven in
             "legL": (-0.25, 0, 0.1), "shinL": (0.45, 0, 0), "legR": (-0.25, 0, -0.1), "shinR": (0.45, 0, 0),
             "armR": (2 * pi - 1.1, 0, -0.15), "foreR": (-2.1, 0, 0)}

RELEASE_TIME, PLANT_TIME = 0.55, 0.45  # into Bound_And_Deliver

BOWLER_CLIPS = {
    "RunUp_Stride": ([(0, RUN), (0.1, RUN_PASS), (0.2, mirrored(RUN)), (0.3, mirrored(RUN_PASS)), (0.4, RUN)], True),
    "Appeal_Celebrate": ([(0, SETTLE), (0.18, SPRING), (0.4, LEAP), (0.6, ARMS_UP), (0.82, FIST_UP), (1.0, FIST_PUMP),
                          (1.2, FIST_PUMP)], False),
    "Bound_And_Deliver": ([(0, RUN), (0.15, GATHER), (0.3, BACK_FOOT), (PLANT_TIME, PLANT), (RELEASE_TIME, RELEASE),
                           (0.75, FOLLOW), (0.92, STRIDE_ONE), (1.1, STRIDE_PASS), (1.3, STRIDE_TWO), (1.55, SETTLE)], False),
}


def build_bowler():
    """A right-arm fast bowler with RunUp_Stride, Bound_And_Deliver and
    Appeal_Celebrate, and a bone called `release` in the bowling hand."""
    rig, _, rest = build_figure("bowler", look_for("bowler", hat="none"), RUN, ["release"])
    behind, height, lane = delivery_checks()
    bake_all(rig, BOWLER_CLIPS, rest)
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


