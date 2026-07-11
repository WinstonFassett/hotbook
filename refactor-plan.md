# WIN-247 Refactor Plan

## Goal
Refactor packages/layout from demo+lib hybrid to clean lib, extract spike 5 demo to apps/demos

## Dependencies (spike5 uses):
- layered-tight.ts
- diagram-settings.ts (direction)
- measure.ts
- render.ts (FONT_PX, renderEdgeStyled, renderHull, renderNode)
- selection.ts
- data.ts (containmentForest, descendantsOf, flatGraph, leafIds, rowsById, sharedEdges, sharedRows, items, TreeNode)
- controls.ts (mountControls) - demo only
- sidebar.ts (mountSidebar) - demo only

## Can delete (spike 1-4 only):
- cola-factories.ts
- hull.ts
- layout-node.ts
- project.ts
- spike1-prop-sugiyama.ts
- spike2-cola-adapt.ts
- spike3-force-adapt.ts
- spike4-dagre-wrap.ts

## Steps

1. Create apps/demos/src/layout/ directory
2. Move spike5 demo files to apps/demos/src/layout/:
   - main.ts (demo entry, uses spike5 + controls + sidebar)
   - index.html
   - theme.css
3. Delete scripts/ directory in packages/layout
4. Delete spike 1-4 and unused utilities from packages/layout/src/lib/
5. Update packages/layout/src/index.ts to export only spike5 + required utilities
6. Update packages/layout/package.json to remove demo script, keep only lib
7. Update apps/demos to include layout demo
8. Update apps/docs/src/pages/index.astro:
   - Remove layout link from demos list
   - Add layout demo to chart demos (or just remove the separate link)
9. Verify builds
10. Test deployed version

## Unresolved
- Should controls/sidebar be in the demo or exported from lib?
- Should data.ts fixtures be in demo or lib?
