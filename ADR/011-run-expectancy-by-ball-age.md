# Run expectancy is indexed by wickets lost and ball age, not overs remaining

The brief specified `V(wickets_lost, overs_remaining)` over a 90-over day. "Overs remaining" is a limited-overs idea: with nothing after the close of play, the cost of a wicket shrinks to zero near stumps, the opposite of real Test cricket. We index by ball age instead: `V(wickets_lost, ball_age)`, a 10 × 80 table of expected runs for the rest of the innings, ending when the side is all out. The wicket cost is `lambda(w, a) = V(w, a) − V(w+1, a)`.

## Consequences

- Wicket and run rates per ball are estimated from Cricsheet by wickets lost and ball age.
- Ball age cycles: a new ball is assumed every 80 overs, because Cricsheet does not record when it is taken. The table is therefore the fixed point of a cyclic recursion, not a single backward pass.
- Ball age is the same axis as the visualisation's slider.
- Declarations, the follow-on and the match situation are ignored, which overstates run expectancy for strong positions. Stated in the README.
