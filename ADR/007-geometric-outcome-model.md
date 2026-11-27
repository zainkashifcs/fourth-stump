# Geometric outcome model with a committed bat and common random numbers

The engine has to turn a trajectory into runs or a wicket for each action. We use a geometric outcome model: the batter commits the bat to where they expect the delivery to arrive, and the outcome follows from the gap between that expected position and where the ball actually arrives. An empirical model fitted straight from data was the alternative, but it would reduce the engine to drawing pictures and undercut the headline claim in ADR-001.

LEAVE and PLAY are evaluated on the same simulated delivery with the same random draws. This is common random numbers (CRN): the noise shared by both actions cancels in the difference of their expected values, so the comparison needs far fewer deliveries than two independent batches would.

## The rules

- **LEAVE**: no runs. A wicket only if the trajectory intersects the stumps.
- **PLAY**: the lateral gap, measured against the bat's regulation width of 108 mm plus the ball's radius, gives one of three results.
  - **Middled**: the ball meets the face of the bat. Runs are scored.
  - **Edged**: the ball meets the edge. A wicket if the edge carries to the slip cordon, which depends on the delivery's height and speed after the bounce. This is where Perth's steep bounce matters: the same edge falls short at Lord's and carries at Perth.
  - **Play-and-miss**: the ball passes the bat. It then continues, and is a wicket if it intersects the stumps.

## Considered options

- **Empirical outcome model** (probability of each outcome given line, length, venue and action, fitted from data): rejected, as above.
- **Stumps only** (simulate whether a left ball hits the stumps, fixed probabilities for PLAY): rejected. It ignores the edge, which is the main way a batter is dismissed in the corridor.

## Consequences

- Only two dismissals exist in the model: bowled, and caught in the cordon off an edge.
- Deliberately out of scope: LBW, catches off middled shots, and run-outs. Calibration targets must exclude these dismissals from the historical data or the fit will be biased.
- Only the lateral gap decides middled, edged or play-and-miss. Height affects the stumps check and the carry, not the contact band.
- Each delivery needs a second, cheaper trajectory evaluation for the batter's expected arrival point.
- The exact boundary between middled and edged within the contact band is a model constant, set in the prototype.

## Settled after this decision

- **When the batter commits, and what they assume afterwards**: see ADR-008.
- **Runs for a middled delivery**: the empirical historical mean of runs scored off played deliveries in the fourth-stump corridor. This needs data that labels both the line and the batter's action, so it depends on the data source decision.
