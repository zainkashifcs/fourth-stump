# Fourth Stump EV

Estimates the expected value of a batter's decision to leave or play a delivery in the fourth-stump corridor, by simulating that delivery under the physics of different Test venues.

## Language

**Delivery**:
One ball bowled, from release to the moment it passes or reaches the batter's stumps. The unit of simulation.
_Avoid_: Ball (reserved for the physical object), shot, sample

**Batch**:
An ordered set of deliveries simulated together under one seed.
_Avoid_: Run, sample set, simulation

**Delivery index**:
A delivery's position within its batch. Together with the seed it fully determines that delivery's random draws.
_Avoid_: Sample id, path number

**Random-number policy**:
The compile-time choice of how a delivery's random draws are made from the seed and its delivery index: xoshiro256** with Ziggurat normals (the default, used for calibration), or Philox4x32-10 with Box-Muller normals (ADR-014).
_Avoid_: Policy on its own (that word is avoided for the leave rule), RNG mode, generator setting

**Bit-reproducible**:
Producing identical output, bit for bit, for the same seed and batch. Promised across thread counts on one binary.
_Avoid_: Deterministic (too vague on its own), repeatable

**Statistically reproducible**:
Producing output that agrees within a stated tolerance, without matching bit for bit. Promised across platforms and compilers.
_Avoid_: Approximately deterministic

**Swing**:
Lateral movement of a delivery in flight, caused by the angled seam making the airflow separate unevenly on the two sides of the ball.
_Avoid_: Magnus swing, Magnus effect, drift, curve

**Swing coefficient**:
The dimensionless strength and direction of swing for a given venue, ball type and ball age.
_Avoid_: Magnus coefficient, lift coefficient

**Wind**:
The constant velocity of the air over the pitch at a venue. Aerodynamic forces depend on the ball's velocity relative to it.
_Avoid_: Breeze, gust

**Bounce**:
The single contact between a delivery and the pitch, treated as instantaneous. It separates the two flight legs.
_Avoid_: Pitch (reserved for the playing strip), impact, landing

**Vertical restitution**:
The fraction of a delivery's speed into the pitch that it keeps coming out of the bounce. High at Perth on average; it varies from delivery to delivery (see variable bounce).
_Avoid_: Bounciness, bounce coefficient, COR

**Variable bounce**:
The random difference in vertical restitution from one delivery to the next at a venue. It lets a delivery that usually clears the bails keep low.
_Avoid_: Uneven bounce, bounce noise, jitter

**Pace retention**:
The fraction of a delivery's speed along the pitch that it keeps through the bounce. A fixed constant (0.887), not fitted to data. _Source: James, Carré and Haake (2004), Sports Engineering 7(1), 1–14._
_Avoid_: Friction, skid, pace off the pitch

**Seam deviation**:
The random sideways change of direction a delivery takes at the bounce, from the seam gripping the pitch. Large at Newlands.
_Avoid_: Seam movement (ambiguous with swing), kink, nip, cut

**Slope**:
The 2.5 m fall across the ground at Lord's ([source](https://en.wikipedia.org/wiki/Lord%27s_slope)), about 1.1° of tilt over the ground's 143 yd width ([MCC ground drawing, via cricketboundary.com](https://cricketboundary.com/grounds/lords/)). It moves a delivery sideways at the bounce.
_Avoid_: Cross-slope, gradient, 2.5° slope

**Bowling end**:
The end of the ground a delivery is bowled from. At Lord's, the Pavilion End sends the ball down the slope into a right-hander and the Nursery End sends it away.
_Avoid_: Side, direction

**Action**:
The batter's choice for a delivery: leave or play. The thing whose expected value the project estimates.
_Avoid_: Decision, shot, stroke

**Leave**:
The action of withdrawing the bat and letting the delivery pass. Scores nothing; costs a wicket only if the delivery hits the stumps.
_Avoid_: Shoulder arms, let go, no shot

**Play**:
The action of offering the bat at the delivery.
_Avoid_: Shot, defend, attack (the model does not distinguish them)

**Committed bat**:
The position the batter places the bat in, fixed at the moment of commitment and based on where they expect the delivery to arrive.
_Avoid_: Bat position, swing path

**Reaction time**:
The shortest interval before a delivery's arrival in which the batter can no longer change where the bat is going. A fixed constant (0.2 s), not fitted to data. _Source: McLeod (1987), Perception 16(1), 49–59._
_Avoid_: Response time, delay, latency

**Commit point**:
The moment one reaction time before a delivery arrives. The batter has seen the true trajectory up to it and assumes mean swing and no seam deviation after it.
_Avoid_: Decision point, trigger, release point

**Gap**:
The lateral distance between where the batter expected the delivery to arrive and where it actually arrives.
_Avoid_: Miss distance, deviation (reserved for seam deviation), error (reserved for error bound)

**Middled**:
A played delivery that meets the face of the bat. Scores runs.
_Avoid_: Hit, connected, timed

**Edged**:
A played delivery that meets the edge of the bat. A dismissal if it carries.
_Avoid_: Nicked, snicked, feathered

**Play-and-miss**:
A played delivery that passes the bat untouched. It can still hit the stumps.
_Avoid_: Beaten, missed

**Carry**:
An edged delivery reaching the slip cordon before it touches the ground.
_Avoid_: Reach, travel

**Catch conversion**:
The share of edges carrying to the slip cordon that are caught. Fitted per venue; it stands for edges that fly wide, fall between catchers or are dropped.
_Avoid_: Catch rate, catch probability, drop rate

**Slip cordon**:
The catchers standing behind the batter on the off side, including the wicketkeeper.
_Avoid_: Slips (excludes the keeper), cordon, behind

**Dismissal**:
A wicket falling in one of the two ways the model recognises: bowled, or caught in the slip cordon off an edge that carries. LBW, catches off middled deliveries, and run-outs are outside the model.
_Avoid_: Out, wicket (reserved for the count of batters dismissed)

**Common random numbers (CRN)**:
Evaluating leave and play on the same delivery with the same random draws, so that the noise they share cancels when their expected values are compared.
_Avoid_: Paired sampling, shared seed

**Release**:
The position and velocity of the ball at the moment it leaves the bowler's hand. The input that defines a delivery before any randomness.
_Avoid_: Launch, initial state, start

**Fourth-stump corridor**:
The channel just outside a right-hander's off stump, one imaginary stump wide, where a batter cannot tell whether a delivery must be played.
_Avoid_: Corridor of uncertainty, channel, off-stump line

**Leave rule**:
The fixed policy the simulated batter follows to choose an action: leave when the expected arrival is wider than a threshold outside off stump, otherwise play.
_Avoid_: Policy, strategy, shot selection

**Ball age**:
The number of overs bowled with the current ball, from 1 to 80. Swing weakens as it rises.
_Avoid_: Over number, overs remaining, innings over

**New-ball window**:
Overs 1 to 25 of an innings, used as the historical sample because pace bowlers bowl almost all of it.
_Avoid_: Powerplay, opening spell

**Run expectancy**:
The expected number of runs a batting side scores in the rest of its innings, given wickets lost and ball age.
_Avoid_: Value table, runs remaining, resources

**Wicket cost**:
The run expectancy lost when one more wicket falls at a given ball age. Written lambda.
_Avoid_: Wicket value, penalty, shadow price

**Expected value**:
For an action on a delivery: expected runs minus wicket cost times the probability of dismissal.
_Avoid_: EV score, utility, payoff

**Kernel**:
The closed-form evaluation of a single delivery's trajectory, with no numerical time-stepping.
_Avoid_: Solver, integrator, physics step

**Reference trajectory**:
The same delivery computed by RK4 numerical integration of the full equations of motion. It exists only to judge the kernel.
_Avoid_: Ground truth, exact solution

**Error bound**:
The largest measured distance between the kernel's trajectory and the reference trajectory, taken at the plane of the batter's stumps, over the envelope.
_Avoid_: Tolerance, accuracy

**Envelope**:
The stated ranges of delivery speed, swing coefficient, wind, release position, length and line within which the error bound is claimed. Outside it the kernel promises nothing.
_Avoid_: Valid range, domain, operating range

**Flight leg**:
A stretch of a delivery's flight with no contact with the pitch: release to bounce, or bounce to the batter's stumps.
_Avoid_: Segment, phase, half
