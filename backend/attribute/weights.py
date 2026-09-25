"""The attribution weights: hand-set, version-stamped, printed on every card, never fitted.

Three ground-truth cases cannot support fitting six weights (`RESEARCH/SYNTHESIS.md`
section 9 Q4), and a weight fitted to make a fixture pass is not evidence
(PHASE-06). `drift` carries the largest share because it is the only term
grounded in transport physics; the rest are Cerulean's, kept at their relative
ordering. These are the console's weights (`frontDemo/src/sim/scoring.ts`), and
`tests/test_attribution.py` fails if the two ever differ.
"""

from __future__ import annotations

from typing import Literal

TermKey = Literal["drift", "proximity", "parity", "temporality", "behaviour", "prior"]

WEIGHTS: dict[str, float] = {
    "drift": 0.3,
    "proximity": 0.2,
    "parity": 0.15,
    "temporality": 0.15,
    "behaviour": 0.12,
    "prior": 0.08,
}

WEIGHTS_VERSION = "w1-handset"

#: Proximity decay constant, km. Cerulean's value.
PROXIMITY_LAMBDA_KM = 4.0

#: Field agreement above which a track point counts as inside the origin field.
GATE_THRESHOLD = 0.06

#: `integral` saturates once a track has sat inside the field this long.
DWELL_SATURATION_H = 6.0

#: A wind gate multiplier below this refuses the ranking outright (C9, C3).
WIND_GATE_REFUSE = 0.15

#: Top-two margin below which the weighting cannot tell the two apart (C3).
SEPARABILITY_FLOOR = 0.015
