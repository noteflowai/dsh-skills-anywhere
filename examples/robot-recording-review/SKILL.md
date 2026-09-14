---
name: robot-recording-review
description: Review JSON/JSONL robotics motion traces and compute position, velocity, coordinate-frame, clock, trajectory-error, and missing-sample facts.
license: MIT
---

# Review recorded robot motion

Build the review around the supplied recording contract. Read its frame mapping,
units, clock origin, sample identifiers, and source digest before computing
physical quantities.

- Convert positions and velocities into the same world convention. Translation
  belongs to positions; apply axis signs and unit scale to both. Compute speed
  after conversion, rather than interpreting a component as a magnitude.
- Subtract a clock's origin before scaling to elapsed seconds. Avoid converting
  frame numbers directly to time when measured timestamps are provided.
- Index observations by their explicit identifiers. Preserve omissions; array
  order, row count and last row do not establish chronology or completeness.
- When comparing with constant-acceleration motion, evaluate the reference
  equation separately at each available timestamp. Use the Euclidean vector
  error, then aggregate only the observations actually present.
- Locate a trajectory peak from world height, applying the contract's tie rule.
  A final frame can follow the peak by a substantial interval.
- Keep original attribution in the result. A matching digest shows which
  recording was used; it does not establish that the recording is physically
  accurate or that its author is authenticated.

For a service implementation, keep the numerical transformation separate from
stdin/stdout handling. Exercise the completed program on the supplied example,
including its actual JSON-lines input. Report missing evidence explicitly and
keep diagnostic text out of machine-readable output.
