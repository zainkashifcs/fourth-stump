# Flat-trajectory kernel with a measured error bound

Quadratic drag has no exact closed-form solution in three dimensions, so the kernel must approximate. It uses the flat-trajectory approximation: a delivery is nearly straight, so distance down the pitch `y` replaces time as the independent variable. Speed then decays exponentially with `y`, swing is parabolic in `y`, and the gravity drop has a closed form with one `exp`. The error bound is not chosen in advance; it is the worst error the tests measure against the reference trajectory over the stated envelope.

Swing is parabolic in distance because drag and the seam side force both scale with `v²`: the sideways acceleration and the square of the forward speed fall together, so the curvature per metre travelled stays constant however much the ball slows. This is the result the README leads its derivation with.

## Considered options

- **Constant acceleration per flight leg** (forces frozen at their starting values): rejected. Measured against RK4 at 120–150 km/h it was 53–87 mm out in height and up to 112 mm laterally over an 18 m leg, against a corridor 100 mm wide.
- **Linearised drag solved by matrix exponential**: not measured. The flat-trajectory form was already within millimetres and has the simpler derivation.

## Consequences

- The envelope is part of the claim: 120–150 km/h, a maximum swing coefficient, and a maximum wind speed. Outside it the kernel makes no promise.
- The README reports the measured worst-case error broken down by swing coefficient. A first measurement on 2026-11-26 (one flight leg, no wind, no bounce) gave under 0.5 mm with no swing, about 4 mm at `C_s` = 0.15 and about 10 mm at `C_s` = 0.30.
- The published bound must be measured end to end, at the plane of the batter's stumps, for whole deliveries including the bounce, because an error in the first leg moves the bounce point.
- Wind is the least-tested part of the approximation and was absent from the first measurement. The envelope's wind limit is set by what the tests show, and may be narrow.
- A second-order correction may be added if it tightens the bound cheaply. It must not add a second transcendental call per leg without a benchmark to justify it.
- The kernel calls the platform `exp`, which is consistent with ADR-003: bit-reproducible on one binary, statistically reproducible across platforms.
