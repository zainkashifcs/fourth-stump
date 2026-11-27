# The batter commits one reaction time before arrival

ADR-007 left open when the batter commits the bat and what they assume about the rest of the delivery. The batter tracks the true trajectory until a fixed visuomotor reaction time `t_react` (about 0.2 s) before the ball arrives. At that commit point they fix the bat, expecting the venue's mean swing and no seam deviation for whatever flight remains. Movement after the commit point is what creates the gap, which is what "late" movement means in cricket.

## Considered options

- **Commit at release** (expect mean swing and no seam deviation for the whole delivery): rejected. A batter who watches a delivery swing 30 cm and still plays the mean line is not believable.
- **Commit at the bounce** (see the true path to the bounce, expect no seam deviation after it): rejected. Swing variation could then never beat the bat, so `sigma_swing` would drop out of the calibration and the swing at Lord's would barely affect the result.

## Consequences

- Length matters. A full delivery still has swing to come after the commit point; a short one bounces early enough for the batter to see part of the seam deviation and adjust.
- For a good-length delivery the commit point falls close to the bounce, so the "Test Your Eye" game, which hides the path after the bounce, remains a fair picture of the model.
- If the bounce happens before the commit point, the batter has seen the seam deviation and only the remaining swing variation contributes to the gap.
- `t_react` is a fixed constant from published measurements and is never calibrated. The likely source is McLeod (1987), "Visual reaction time and high-speed ball games", with Land and McLeod (2000) on batters' eye movements as supporting context. Both are recalled, not checked; the citation joins the open list in ADR-006.
- The batter is assumed not to infer this delivery's swing coefficient from the curve they have already seen. That understates a good batter and is a deliberate simplification.
- Finding the commit point inverts the kernel's time-distance relation, which costs one `log` per delivery.
