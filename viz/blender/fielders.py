"""The fielders: first slip, a ring fielder and the wicketkeeper, each crouched in
the bind pose (the pose a page that plays no clip shows), with a bone `catch`
between the hands.
"""
from figures import (FOREARM, UPPER_ARM, bake_all, build_figure, check_continuations, fixed_arms, hand, look_for,
                     mirrored, sample, solve)

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

# The wicketkeeper: a low, balanced squat with the mitts together near the ground; he rises
# with the bounce and takes the ball between waist and chest height in front of him, the
# mitts giving a little into the body; then springs upright with both arms aloft. Every key
# has its arms fixed by angle, so the gloves-on-target keys blend into the arms-up ones.
KCROUCH = fixed_arms({
    "torso": (0.5, 0, 0), "head": (-0.45, 0, 0),
    "legL": (-1.35, 0, 0.45), "shinL": (2.15, 0, 0), "legR": (-1.35, 0, -0.45), "shinR": (2.15, 0, 0),
    "hands": ((0.08, 0.3, 0.42), (-0.08, 0.3, 0.42)),
})
KCROUCH_LEFT = fixed_arms({
    **KCROUCH, "root": (0.03, 0), "lift": (0.01,), "torso": (0.5, 0.05, -0.06), "head": (-0.45, -0.04, 0.05),
    "legL": (-1.4, 0, 0.4), "shinL": (2.2, 0, 0), "legR": (-1.3, 0, -0.5), "shinR": (2.05, 0, 0),
    "hands": ((0.1, 0.31, 0.43), (-0.06, 0.3, 0.42)),
})
KRISE = fixed_arms({
    "torso": (0.42, 0, 0), "head": (-0.38, 0, 0),
    "legL": (-0.95, 0, 0.36), "shinL": (1.45, 0, 0), "legR": (-0.95, 0, -0.36), "shinR": (1.45, 0, 0),
    "hands": ((0.08, 0.6, 0.46), (-0.08, 0.6, 0.46)),
})
KTAKE = fixed_arms({
    "torso": (0.3, 0, 0), "head": (-0.25, 0, 0),
    "legL": (-0.55, 0, 0.26), "shinL": (0.85, 0, 0), "legR": (-0.55, 0, -0.26), "shinR": (0.85, 0, 0),
    "hands": ((0.075, 1.02, 0.42), (-0.075, 1.02, 0.42)),
})
KGIVE = fixed_arms({**KTAKE, "torso": (0.26, 0, 0), "hands": ((0.07, 1.0, 0.32), (-0.07, 1.0, 0.32))})
KSPRING = {**KGIVE, "torso": (0.2, 0, 0), "head": (-0.15, 0, 0),
           "legL": (-0.75, 0, 0.2), "shinL": (1.15, 0, 0), "legR": (-0.75, 0, -0.2), "shinR": (1.15, 0, 0),
           "armL": (-1.9, 0, 0.3), "foreL": (-0.6, 0, 0), "armR": (-1.9, 0, -0.3), "foreR": (-0.6, 0, 0)}
KLEAP = {"lift": (0.12,), "torso": (-0.12, 0, 0), "head": (-0.3, 0, 0),
         "legL": (0.05, 0, 0.1), "shinL": (0.5, 0, 0), "legR": (0.05, 0, -0.1), "shinR": (0.5, 0, 0),
         "armL": (-2.85, 0, 0.4), "foreL": (-0.15, 0, 0), "armR": (-2.85, 0, -0.4), "foreR": (-0.15, 0, 0)}
KALOFT = {**KLEAP, "lift": (0,), "torso": (-0.05, 0, 0), "head": (-0.2, 0, 0),
          "legL": (-0.1, 0, 0.1), "shinL": (0.15, 0, 0), "legR": (-0.1, 0, -0.1), "shinR": (0.15, 0, 0)}
TAKE_TIME = 0.32  # into Gather, when the ball is in the gloves
KEEPER_CLIPS = {
    "Idle_Crouch": ([(0, KCROUCH), (0.7, KCROUCH_LEFT), (1.4, KCROUCH), (2.1, mirrored(KCROUCH_LEFT)), (2.8, KCROUCH)], True),
    "Gather": ([(0, KCROUCH), (0.15, KRISE), (TAKE_TIME, KTAKE), (0.5, KGIVE)], False),
    "Celebrate": ([(0, KGIVE), (0.2, KSPRING), (0.45, KLEAP), (1.0, KALOFT)], False),
}



def build_slip():
    """First slip in a sun hat, crouched (also the bind pose), with Idle_Crouch and
    a bone called `catch` between the hands."""
    rig, _, rest = build_figure("slip", look_for("slip", hat="sunhat"), CROUCH, ["catch"])
    bake_all(rig, SLIP_CLIPS, rest)


def build_fielder():
    """A ring fielder (cover or mid-off) in a cap, walking in, with Idle_Crouch."""
    rig, _, rest = build_figure("fielder", look_for("fielder", hat="cap"), READY, ["catch"])
    bake_all(rig, FIELDER_CLIPS, rest)


def build_keeper():
    """The wicketkeeper in a cap, keeper's pads and webbed mitts, crouched (also the bind
    pose), with Idle_Crouch, Gather and Celebrate and a bone called `catch` between the mitts."""
    rig, _, rest = build_figure("keeper", look_for("keeper", hat="cap", pads="keeper", gloves="keeper"), KCROUCH, ["catch"])
    check_continuations(KEEPER_CLIPS, {"Celebrate": "Gather"}, rest)
    taken = solve(sample(KEEPER_CLIPS["Gather"][0], TAKE_TIME, False))
    mitts = (hand(taken, "L") - hand(taken, "R")).length
    catch = taken["catch"].translation
    hips = taken["hips"].translation.y
    assert mitts < 0.2 and hips < catch.y < hips + 0.45, \
        f"the ball is taken {catch.y:.2f} m up with the mitts {mitts:.2f} m apart, not together between waist and chest"
    bake_all(rig, KEEPER_CLIPS, rest)
    rig["take_time"] = TAKE_TIME
    rig["upper_arm"] = UPPER_ARM
    rig["forearm"] = FOREARM
    rig["catch_at_take"] = [round(c, 3) for c in catch]
