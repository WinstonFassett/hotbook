# Hotbook Demos QA Report

**Date**: 2026-07-13 17:19:11
**Target**: http://127.0.0.1:4816/demos/
**Total Issues**: 3

## Executive Summary

Total issues found: **3**

### By Severity
- **Critical**: 0
- **High**: 0
- **Medium**: 3
- **Low**: 0

### By Category
- **Functional**: 3

## Testing Scope

This QA pass focused on:
- Interactivity and gesture transitions on hierarchical charts
- Drag-to-reorder and value-handle drags
- Hierarchical diagram quality (treemap, icicle, sunburst, pack, budget-tree)
- Gantt chart drag-to-reorder and dependency propagation
- Nested-layered layout demo
- Demos page UX (tabs, controls, config)
- Flat charts (bar, bands, line, area, scatter, pie, radar, gauge, etc.)

## Issues

### Issue 1: budget-tree not found

**Severity**: Medium  
**Category**: Functional  
**URL**: `http://127.0.0.1:4816/demos/`

**Description**: Could not locate budget-tree chart on the demos page

**Screenshot**: `dogfood-output/screenshots/012_budget-tree_missing.png`

![Screenshot](dogfood-output/screenshots/012_budget-tree_missing.png)

---

### Issue 2: tree-chart not found

**Severity**: Medium  
**Category**: Functional  
**URL**: `http://127.0.0.1:4816/demos/`

**Description**: Could not locate tree-chart chart on the demos page

**Screenshot**: `dogfood-output/screenshots/013_tree-chart_missing.png`

![Screenshot](dogfood-output/screenshots/013_tree-chart_missing.png)

---

### Issue 3: Gantt chart not found

**Severity**: Medium  
**Category**: Functional  
**URL**: `http://127.0.0.1:4816/demos/`

**Description**: Could not locate Gantt chart on demos page

---

## Summary Table

| # | Severity | Category | Title |
|---|----------|----------|-------|
| 1 | Medium | Functional | budget-tree not found |
| 2 | Medium | Functional | tree-chart not found |
| 3 | Medium | Functional | Gantt chart not found |

## Testing Notes

- Total screenshots captured: 17
- All screenshots saved to: `dogfood-output/screenshots`
- Testing performed on local dev server
- Browser: Chromium (headless)

## Detailed Interaction Testing (2026-07-13 17:21:15)

**New issues found**: 0

