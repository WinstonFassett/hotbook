Fixed treemap crash but found critical regression - sort is broken on hierarchical charts.

## Fixed

**Treemap crash** (commit cd175ce):
- Removed invalid `this._trackScene()` call - treemap doesn't have that method
- Treemap should now render without crashing

## Critical regression - investigating

**Sort toggle has no effect on hierarchical charts** (icicle, sunburst, treemap, pack when sort:value is clicked, nothing changes)

My merge replaced `buildHierarchy(root, this._sortByCell.value)` with manual hierarchy creation. The code reads `this._sortByCell.value` into a `sortBy` variable and applies h.sort() conditionally - this SHOULD work the same as buildHierarchy and SHOULD create a reactive dependency, but something's broken.

Checking now whether it's:
1. Reactive dependency not tracking properly
2. Demos page not properly wiring to chart sortBy setters
3. Something else in the merge

Working on it now.

**Pushed**: cd175ce (treemap fix only, sort issue remains)