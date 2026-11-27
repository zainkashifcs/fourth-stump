# Impulsive bounce map with the real Lord's slope

The bounce is modelled as an instantaneous map from incoming to outgoing velocity. The ball reflects about the pitch's surface normal; the velocity component into the pitch is multiplied by the vertical restitution `e_z`; the component along the pitch is multiplied by a pace-retention constant; and the outgoing direction is then turned sideways by a seam deviation angle drawn from a zero-mean normal distribution with spread `sigma_seam`. We chose this over a friction-and-spin model because each venue's character then sits in one nameable number, and because spin state was already excluded in ADR-004.

The surface normal is vertical at Perth and Newlands. At Lord's it is tilted by the real slope: a 2.5 m fall across the ground ([Lord's slope, Wikipedia](https://en.wikipedia.org/wiki/Lord%27s_slope)), which is about 1.0° over a ground roughly 135–140 m wide. The original brief said 2.5°, which confused the fall in metres with an angle and would have exaggerated the effect about 2.5 times.

## Considered options

- **Friction and spin** (the ball slides or grips depending on its spin): rejected. Closer to the real mechanics, but it reintroduces spin, which commentary data cannot calibrate.
- **A tuned 2.5° "effective" tilt**: rejected. The number has no source.

## Consequences

- Venue character at the bounce: high `e_z` at Perth, high `sigma_seam` at Newlands, the tilt at Lord's.
- The tilt's sign depends on the bowling end. From the Pavilion End the ball moves down the slope into a right-hander; from the Nursery End it moves away ([The Athletic, 10 July 2025](https://www.nytimes.com/athletic/6482874/2025/07/10/lords-cricket-ground-slope-england-india/)).
- Pace retention is a fixed constant from published measurements and is never calibrated, because commentary data cannot separate it from `e_z`.
- The kernel and the reference trajectory use the same bounce map with the same random draw. The bounce adds no error of its own; it only carries forward the first flight leg's error in where the ball lands.
- Size of the slope effect, measured with the engine: 4.3 cm of sideways movement at the stumps for a good-length delivery (3.2 cm for a fuller one, 5.7 cm for a shorter one). The estimate made before the engine existed was 2–3 cm.

## Verified constants (2026-11-27)

These replace the estimates in the text above.

- **Lord's tilt: 1.09° (0.0191 rad).** The 2.5 m fall is taken across the ground's 143 yd (130.8 m) width, from MCC's dimensioned ground drawing (172 × 143 yd) as reported by [cricketboundary.com](https://cricketboundary.com/grounds/lords/). The slope runs diagonally, so the component across the pitch may be smaller; 1.09° is an upper estimate.
- **Pace retention: 0.887.** The midpoint of the 87.1%–90.2% of impact speed retained at 36 m/s across the pitches monitored by James, Carré and Haake (2004), "The playing performance of county cricket pitches", Sports Engineering 7(1), 1–14, [doi:10.1007/BF02843969](https://doi.org/10.1007/BF02843969). They measured total speed on English county pitches, not the along-pitch component on Test pitches; at impact angles near 10° the two differ by under 1%.
- **Vertical restitution range: 0.46–0.65.** The same paper reports rebound angle as 52%–73% of impact angle; multiplied by pace retention this bounds `e_z` and is the range the calibrator searches.
- **Reaction time `t_react`: 0.2 s** (used by ADR-008). McLeod (1987), "Visual reaction time and high-speed ball games", Perception 16(1), 49–59, [doi:10.1068/p160049](https://doi.org/10.1068/p160049), reports about 200 ms. Land and McLeod (2000), "From eye movements to actions: how batsmen hit the ball", Nature Neuroscience 3, 1340–1345, is supporting context and was not re-read.

The figures from both papers were read from abstract and index pages, not the full texts.
