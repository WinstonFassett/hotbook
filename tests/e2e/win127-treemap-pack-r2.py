"""
WIN-127 acceptance: treemap + pack two-lane split.

After the fix, a cross-tile (remote) value edit must be IMMEDIATE (write-through,
no 250-350ms settle-lag), while a sort-by-value reorder must STILL animate.

    uv run --with playwright python tests/e2e/win127-treemap-pack-r2.py
"""
import sys
from r2_harness import R2Harness

with R2Harness() as h:
    for tag in ("v-br-treemap", "v-br-pack"):
        h.check_value_immediate(tag)          # R2: remote value edit snaps
        h.check_structural_animates(tag)      # R1: sort reorder still tweens
    h.report_and_exit()
