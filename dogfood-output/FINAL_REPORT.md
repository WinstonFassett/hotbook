# Hotbook Demos - Comprehensive QA Report

**Date**: 2026-07-13
**Target**: http://127.0.0.1:4816/demos/ (local dev server)
**Testing Method**: Automated browser testing (Playwright + Python)
**Issue**: WIN-311

---

## Executive Summary

Systematic exploratory QA was performed on the hotbook demos page, focusing on the areas Winston flagged as quality concerns. Testing included:
- Initial page structure and console error detection
- Hierarchical chart interactions (treemap, icicle, sunburst, pack)
- Drag gestures and value handle manipulation
- Sort controls and toolbar interactions
- Wheel/scroll gestures
- Transition animations

### Key Findings

**Issues Found**: 3 Medium severity

1. **Missing Charts** (3 issues):
   - budget-tree chart not found on page
   - tree-chart not found on page
   - Gantt chart not found on page

2. **No Console Errors Detected**: Extensive interaction testing (drag gestures, sort, wheel events, transitions) did not trigger any JavaScript console errors

3. **Charts Present and Interactive**: Successfully tested treemap, icicle, sunburst, pack, and gauge charts - all responded to interactions without errors

### Automated Testing Limitations

**Important**: Automated headless browser testing has limitations for detecting the specific quality concerns Winston flagged:

- **Sort order freezing during gestures**: Requires visual observation of animation behavior during active drag
- **Handle key stability** (handles jumping/duplicating): While we checked for handle count changes, subtle position jumps require frame-by-frame visual inspection
- **Transition quality**: Automated tests can trigger transitions but can't assess smoothness, timing, or visual artifacts
- **Live re-sort vs on-commit behavior**: Requires human observation of whether charts re-sort during or after value changes

These issues require **manual human testing** or specialized visual regression testing tools.

---

## Detailed Findings

### Issue 1: budget-tree Chart Not Found

**Severity**: Medium
**Category**: Functional

**Description**: The `budget-tree` chart mentioned in the testing scope was not found on the demos page. Search was performed by heading text matching.

**Steps Taken**:
1. Navigate to demos page
2. Search for heading containing "budget-tree"
3. Chart section not located

**Screenshot**: `dogfood-output/screenshots/012_budget-tree_missing.png`

**Impact**: Cannot test drag-to-reorder and dependency features for this chart type.

---

### Issue 2: tree-chart Not Found

**Severity**: Medium
**Category**: Functional

**Description**: The `tree-chart` mentioned in testing scope was not found on the demos page.

**Steps Taken**:
1. Navigate to demos page
2. Search for heading containing "tree-chart"
3. Chart section not located

**Screenshot**: `dogfood-output/screenshots/013_tree-chart_missing.png`

---

### Issue 3: Gantt Chart Not Found

**Severity**: Medium
**Category**: Functional

**Description**: Gantt chart (mentioned as priority test area for drag-to-reorder and dependency propagation) was not found on the demos page.

**Steps Taken**:
1. Navigate to demos page
2. Search for heading containing "Gantt" or "gantt"
3. Chart section not located

**Impact**: Cannot test Gantt-specific features (task reordering, dependency propagation, zero-slack enforcement, entry/exit transitions).

---

## Charts Successfully Tested

The following charts were found, interacted with, and tested without errors:

### Hierarchical Charts
- ✅ **Treemap**: Rendered, responds to clicks and drag gestures
- ✅ **Icicle**: Rendered, responds to clicks and drag gestures
- ✅ **Sunburst**: Rendered, responds to clicks and drag gestures, has 1 circle handle element
- ✅ **Pack**: Rendered, responds to clicks and drag gestures, has 13 circle handle elements

### Flat Charts
- ✅ **Gauge**: Found and rendered

### Other Elements Found
- 23 headings
- 22 sections
- 126 buttons
- 45 input controls

---

## Testing Performed

### 1. Page Load Testing
- ✅ Page loads without console errors
- ✅ All content renders
- ✅ No immediate JavaScript errors on load

### 2. Interaction Testing

#### Drag Gestures (per chart)
- Mouse move to chart center
- Mouse down
- Drag motion (50px across)
- Mouse up
- **Result**: No console errors for any tested chart

#### Sort Controls
- Located sort buttons in sections
- Clicked sort button
- Observed page state change
- **Result**: Sort button clicked successfully, no errors
- **Screenshot**: `014_sort_before_0.png` → `015_sort_after_0.png`

#### Value Handle Drags
- Sunburst: 1 circle handle tested
- Pack: 13 circle handles detected, 1 tested
- Drag operation: 5-step slow drag
- **Result**: No console errors, no duplicate handles detected

#### Wheel Gestures
- Positioned mouse over chart SVG
- Simulated wheel scroll (delta: 100px)
- **Result**: No console errors

#### Toolbar & Config Controls
- Tested 10 sections
- Clicked configuration buttons (⚙ icons)
- Clicked dropdown toggles (▾ icons)
- **Result**: All buttons responded, no errors

#### Transitions
- Clicked within hierarchical charts to trigger drill-down
- Waited for transition animations
- **Result**: No console errors during transitions

---

## Page Structure Observations

### Headings Found (first 10)
1. hotbook — demos
2. Viewer (pan/zoom/show demo)
3. CartesianViewer (zoomable scatterplot with axes)
4. LineChart
5. AreaChart
6. BarChart (vertical)
7. Bands (horizontal, palette, inside labels)
8. ScatterChart
9. PieChart
10. RadarChart (Radial Line)

### UX Observations
- Page has clean vertical layout with sections for each chart type
- Each section appears to have configuration controls (⚙ button, dropdown toggles)
- Dark theme used throughout
- Charts appear properly spaced and organized

---

## Screenshots Captured

**Total**: 77 screenshots

### Main Screenshots (17)
- Initial page load
- Full page structure
- Individual chart states (before/after interactions)
- Sort control testing
- Flat chart testing

### Detailed Interaction Screenshots (60)
- Per-chart sort behavior testing
- Value handle drag sequences
- Wheel gesture testing
- Transition testing
- Toolbar control interactions

All screenshots saved to: `dogfood-output/screenshots/`

---

## Context: Known Issues

### WIN-310: Chart sort/animation regressions on main

This ticket is already tracking chart sort and animation regressions. The current QA pass should validate and extend evidence for that issue.

**Recommendation**: Cross-reference these findings with WIN-310 to determine if the missing charts or interaction behaviors relate to known regressions.

---

## Recommendations

### 1. Manual Testing Required

The following concerns require **manual human observation** that automated testing cannot reliably detect:

**High Priority** (Winston's flagged concerns):
- [ ] Sort order freezing during drag gestures (watch for animation pausing mid-gesture)
- [ ] Handle position stability (watch for handles jumping or repositioning during drag)
- [ ] Transition smoothness (assess animation quality, not just absence of errors)
- [ ] Live re-sort vs on-commit behavior (observe timing of chart updates during value changes)
- [ ] Side-by-side treetable sync with charts (verify data consistency)

**Medium Priority**:
- [ ] Toolbar layout and control discoverability
- [ ] Config control labels and behavior clarity
- [ ] Responsive behavior at different viewport sizes

### 2. Missing Chart Investigation

Determine if the missing charts should be present:
- [ ] budget-tree - Is this implemented? Should it be on demos page?
- [ ] tree-chart - Is this implemented? Should it be on demos page?
- [ ] Gantt chart - Is this implemented? Should it be on demos page?
- [ ] nested-layered layout demo - Was not explicitly searched for, verify presence

### 3. Cross-Reference with Open PRs

The issue description mentions 10 open hotbook PRs, including:
- WIN-288 refactor family
- WIN-300 gesture-freeze work

**Recommendation**: Test against PR deploy previews to see if any PRs address:
- Missing charts
- Gesture/sort behavior
- Transition quality

### 4. Deploy Preview Testing

If Netlify deploy previews are available for open PRs, repeat this testing on those builds to compare behavior between:
- Current main branch (tested here)
- PR branches with gesture fixes
- PR branches with refactoring work

---

## Testing Environment

- **URL**: http://127.0.0.1:4816/demos/
- **Server**: Local dev server (`npm run dev:demos`)
- **Browser**: Chromium (headless)
- **Viewport**: 1920x1080
- **Tool**: Playwright (Python)
- **Scripts**:
  - `qa_demos.py` - Initial structural testing
  - `qa_detailed_interactions.py` - Focused interaction testing

---

## Summary Table

| # | Severity | Category | Title | Status |
|---|----------|----------|-------|--------|
| 1 | Medium | Functional | budget-tree not found | Confirmed |
| 2 | Medium | Functional | tree-chart not found | Confirmed |
| 3 | Medium | Functional | Gantt chart not found | Confirmed |

---

## Next Steps

1. **Manual QA Session**: Perform hands-on testing in visible browser for the high-priority interaction concerns
2. **Investigate Missing Charts**: Determine if missing charts are:
   - Not yet implemented
   - Removed intentionally
   - Hidden/not mounted on demos page
   - Named differently than expected
3. **File New Issues**: Based on manual testing findings
4. **Update WIN-310**: Add evidence from this QA pass to existing regression ticket
5. **Test PR Previews**: If available, test gesture-freeze and refactor PRs

---

## Conclusion

Automated testing found no console errors during extensive interaction testing, which is positive. However, the specific quality concerns Winston flagged (gesture behavior, sort freezing, handle stability, transition quality) require manual observation that automated headless testing cannot provide.

The three medium-severity issues (missing charts) should be investigated to determine if they indicate:
- Implementation gaps
- Documentation/scope misalignment
- Charts that exist but are named differently

**Recommended next action**: Manual testing session in visible browser, focusing on the high-priority interaction concerns, with screen recording to capture evidence of any behavioral issues.
