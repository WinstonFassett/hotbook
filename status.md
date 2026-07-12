## Status Update

**Fixed**: Treemap crash - removed invalid `_trackScene()` call (cd175ce, pushed)

**Still broken**: Sort not working on hierarchical charts

**Investigation findings**:
- Chart classes have sortBy getter/setter defined correctly (icicle.ts:75-77, sunburst.ts:55-56, treemap.ts:64-65)
- Demos page calls `(el as any).sortBy = config.sort` to set values (main.ts:118)
- My layout derive reads `this._sortByCell.value` which SHOULD create reactive dependency
- Code logic matches buildHierarchy exactly - when sortBy==='value', apply descending sort; otherwise no sort

**Possible causes**:
1. Bireactive reactivity issue with cell in derive?
2. Something subtle about hierarchy() call order?
3. Need to verify demos page is actually calling the setter

**Next**: Need to run dev server and add console.log to see if:
- sortBy setter is being called
- layout derive is re-running when sortBy changes
- h.sort() is being applied when expected

Will continue debugging with live testing.