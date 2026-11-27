# Reference force model: gravity, quadratic drag and seam side force, no Magnus term

The reference trajectory needs a fixed set of forces before the kernel can be judged against it. In flight a delivery is subject to gravity, quadratic aerodynamic drag, and a seam-induced side force `F_s = ½ ρ A C_s v_rel²` that acts horizontally and perpendicular to the ball's air-relative velocity. Wind is one constant vector per venue. There is no Magnus term, because seam-bowling swing is caused by the angled seam tripping the boundary layer on one side of the ball, not by spin.

## Considered options

- **Add Magnus lift from backspin**: rejected. It is real but small for a seamer, and it adds a spin vector that commentary data cannot calibrate, leaving a free parameter with no evidence behind it.
- **Call the lateral force "Magnus swing"**, as the original brief did: rejected as wrong physics that a cricket-literate reader would catch.

## Consequences

- Venue, ball type and ball age act on swing only through the swing coefficient `C_s`; its sign gives the swing direction.
- Late swing needs no special case: a constant side force gives lateral displacement that grows with the square of flight time.
- All aerodynamic forces use air-relative velocity, so wind changes drag and swing together and is never added as a separate push.
- Spin bowling is out of scope. Supporting it would mean reopening this decision, not adding a parameter.
- What happens at the bounce is a separate decision.
