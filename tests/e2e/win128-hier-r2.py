"""
WIN-128 acceptance: sunburst + icicle + tree two-lane split.

After the fix, a cross-tile (remote) value edit must be IMMEDIATE (write-through),
while a structural change (sort reorder) must STILL animate. Same shape as the
WIN-127 treemap/pack fixture.

    uv run --with playwright python tests/e2e/win128-hier-r2.py
"""
from r2_harness import R2Harness

with R2Harness() as h:
    # sunburst + icicle: value edits reshape arc/partition geometry, so the R2
    # value-immediate assertion applies directly.
    for tag in ("v-br-sunburst", "v-br-icicle"):
        h.check_value_immediate(tag)          # R2: remote value edit snaps
        h.check_structural_animates(tag)      # R1: sort reorder still tweens

    # tree: node POSITIONS come from d3 tree() layout (depth + sibling index) and
    # node rects are FIXED size — geometry is value-INDEPENDENT, so there is no
    # value-lag to observe (a value edit moves nothing). The two-lane change still
    # applies correctly: sort/orientation/collapse tween, value snaps (a no-op
    # geometrically, but avoids a spurious zero-distance tween). We can only assert
    # the structural lane here; value-immediate is not observable for tree.
    # (The harness also can't drive tree's tab: it lives in the right dock and its
    #  tab activates on pointerdown/up, not click — a harness limitation, not a
    #  chart bug. tree was verified directly, see the WIN-128 PR notes.)
    h.check_structural_animates("v-br-tree")  # R1: sort reorder still tweens
    h.report_and_exit()
