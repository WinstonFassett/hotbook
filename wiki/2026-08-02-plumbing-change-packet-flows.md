# 2026-08-02 — Plumbing: change packets through the reactor

Diagrams of how value-change packets flow. The target architecture, not
the current broken one. Current breakage cited only as contrast.

---

## The machines

```mermaid
graph TB
    subgraph Reservoir["THE RESERVOIR (BiNode tree — cells)"]
        R["root ○"]
        A["○"]
        B["○"]
        L1["○"]
        L2["○"]
        L3["○"]
        L4["○"]
        R --> A & B
        A --> L1 & L2
        B --> L3 & L4
    end

    subgraph Kernel["THE KERNEL (cell-aware, target)"]
        K["DataNode tree<br/>(cells, not plain numbers)"]
        WV["writeValue → set one cell"]
        WR["writeReorder → swap child array"]
        BD["broadcastDraft → fan-out to views"]
    end

    Reservoir -->|"the only water source"| Kernel

    subgraph Views["VIEWS (DataView + Editor each)"]
        VA["VIEW A<br/>icicle"]
        VB["VIEW B<br/>treetable"]
        VC["VIEW C<br/>sunburst"]
    end

    Kernel --> VA & VB & VC

    VA --> ChartA["CHART<br/>renders from cells"]
    VB --> ChartB["CHART<br/>renders from cells"]
    VC --> ChartC["CHART<br/>renders from cells"]
```

**Key principle:** the Kernel stores cells. Charts derive from cells.
No rebuild step. No "collect all leaves and republish." A write is O(1).
A subscriber notification is "this cell changed" — bireactive tracks the
rest.

---

## Flow 1 — single value edit (the happy path)

User drags an icicle edge handle. One leaf changes.

```mermaid
sequenceDiagram
    participant U as USER
    participant C as CHART (icicle)
    participant E as EDITOR
    participant K as KERNEL
    participant VB as VIEW B (sunburst)
    participant VC as VIEW C (treetable)

    U->>C: pointer drag
    C->>E: onStart → draft
    E->>E: Idle → Drafting
    C->>C: write ChartNode.value cell (O(1))
    C->>C: live preview (reactive derive)

    E->>K: broadcastDraft(nodeId, value)
    K->>VB: draft event
    K->>VC: draft event
    VB->>VB: patch 1-2 cells in place
    VC->>VC: patch 1-2 cells in place
    VB->>VB: live preview (CSS transition)
    VC->>VC: live preview (CSS transition)

    U->>C: pointer up (commit)
    C->>E: commit
    E->>E: Drafting → Idle
    E->>K: writeValue(nodeId, value)
    K->>K: set ONE leaf cell
    K->>K: parent cells re-derive (automatic)
    Note over K: NO _publish. NO rebuild.<br/>bireactive propagates.
    K-->>VB: cell changed (dependency tracking)
    K-->>VC: cell changed (dependency tracking)
    VB->>VB: CSS transition settles
    VC->>VC: CSS transition settles
```

**Packet size:** one cell write. One broadcast. N views each patch 1-2
cells in place. Zero tree walks. Zero rebuilds.

> **What we're fixing:** today this flow collects ALL leaves, writes them
> all to the kernel, publishes to all subscribers, and each subscriber
> rebuilds the entire ChartNode tree from scratch. O(N) per edit.

---

## Flow 2 — two-sibling reapportion (edge handle drag)

User drags a boundary between two siblings. Both change, parent sum
preserved.

```mermaid
sequenceDiagram
    participant U as USER
    participant C as CHART
    participant E as EDITOR
    participant K as KERNEL
    participant VB as VIEW B

    U->>C: drag boundary handle
    C->>E: draft {nodeId, value, secondaryNodeId, secondaryValue}
    E->>E: Idle → Drafting
    C->>C: write 2 ChartNode cells (O(1))
    C->>C: live preview

    E->>K: broadcastDraft
    K->>VB: draft event
    VB->>VB: patch 2 cells in place

    U->>C: commit
    C->>E: commit
    E->>K: writeValues([nodeId, secondaryNodeId])
    K->>K: set 2 leaf cells
    K->>K: parent sum cell unchanged (a+b = b+a)
    Note over K: NO recomputeSums needed —<br/>parent is a derive from children
    K-->>VB: 2 cells changed
    VB->>VB: CSS transition settles
```

**Packet size:** two cell writes. Parent sum derives unchanged.

> **What we're fixing:** today `writeValues` writes ALL leaves, not just
> the changed pair. The original Jul 17 commit needed two-sibling atomic
> write but used a sledgehammer — write everything instead of just the
> pair.

---

## Flow 3 — reorder (drag to reorder, sort=index)

User drags a bar up to reorder. No values change — just child order.

```mermaid
sequenceDiagram
    participant U as USER
    participant C as CHART
    participant E as EDITOR
    participant K as KERNEL
    participant VB as VIEW B

    U->>C: drag bar body
    C->>C: provisional order cell (local)
    C->>C: siblings slide via CSS transform
    C->>E: draft {intent:"reorder", reorderOrder, parentId}
    E->>K: broadcastDraft
    K->>VB: draft event (frozen order applied)

    U->>C: commit
    C->>E: commit
    E->>K: writeReorder(parentId, orderedIds)
    K->>K: swap children array on parent DataNode
    K-->>VB: cell changed (children array)
    VB->>VB: re-derive child order from cell
    VB->>VB: CSS transitions animate the slide
```

**Packet size:** one array swap on one node.

---

## Flow 4 — cross-view draft preview

Two charts share a dataset. Chart A starts a drag. Chart B sees the
preview live, then both settle on commit.

```mermaid
sequenceDiagram
    participant A as CHART A (active)
    participant E as EDITOR A
    participant K as KERNEL
    participant EB as EDITOR B (passive)
    participant B as CHART B

    Note over A,B: PREVIEW PHASE (no data written)
    A->>E: draft
    E->>E: Idle → Drafting
    A->>A: write ChartNode cell (live preview)
    E->>K: broadcastDraft
    K->>EB: draft event
    EB->>B: applyDraft — patch 1-2 cells in place
    B->>B: live preview (CSS transition)

    Note over A,B: COMMIT PHASE
    A->>E: commit
    E->>E: Drafting → Idle
    E->>K: writeValue (ONE cell)
    K->>K: set cell, parents re-derive
    E->>K: broadcastCommit
    K->>EB: commit event
    EB->>B: clear draft overlay
    B->>B: CSS transition settles to committed value
    Note over K: NO _publish. NO rebuild.<br/>cell change propagates via bireactive.
```

> **What we're fixing:** today the commit path calls `leafValues(root)` →
> `kernel.writeValues(allLeaves)` → `_publish` → each view calls
> `buildWindow()` (full tree walk) → `buildTree()` (full tree walk, fresh
> cells). Preview is O(1) but commit is O(N). Target: commit is also O(1).

---

## Flow 5 — Cartesian chart (no kernel)

Bar/bands/radar/concentric arc/gantt. These never touch the kernel.

```mermaid
graph LR
    subgraph Reservoir["RESERVOIR (BiNode tree)"]
        LC["leaf cell"]
    end

    subgraph Chart["CHART (bar/bands/radar)"]
        NL["Num.lens"]
        DC["dataCell<br/>(flat array)"]
        RD["re-derive<br/>changed item only"]
        CSS["CSS transition<br/>animates settle"]
    end

    LC -->|"write from treetable"| NL
    NL --> DC
    DC --> RD
    RD --> CSS

    style Reservoir fill:#1a2a3a,color:#fff
    style Chart fill:#1a3a1a,color:#fff
```

**This is the model the kernel should follow.** One cell write →
bireactive tracks dependencies → only affected derives re-run → CSS
transitions animate. O(1) per edit. No tree walks, no rebuilds, no
publish fan-out.

---

## Flow 6 — treetable edit (target: unified)

In the target architecture, the treetable writes to the same cells the
chart reads from. No dual-write hack.

```mermaid
graph TB
    subgraph TT["TREETABLE"]
        ND["numberDrag set:<br/>BiNode.leaf.total.value = v"]
    end

    SC["THE SHARED CELL<br/>(BiNode leaf total)"]

    subgraph K["KERNEL"]
        KR["reads same cell"]
    end

    subgraph C["CHART"]
        CR["reads same cell<br/>via Num.lens"]
    end

    subgraph V["OTHER VIEWS"]
        VR["see change via<br/>bireactive tracking"]
    end

    ND -->|"one write"| SC
    SC --> KR
    SC --> CR
    KR --> VR
    CR -->|"one bar/slice/tile<br/>re-derives (O(1))"| R["render"]
    VR -->|"CSS transition"| R

    style SC fill:#2a2a4a,color:#fff,stroke:#4a9eff,stroke-width:3px
```

**One cell, one write, N readers.** No "primary column routes through
kernel, extra columns write BiNode directly." No dual-write. No
workaround. The cell IS the truth — everyone reads from it.

> **What we're fixing:** today the treetable writes to BOTH a ChartNode
> cell (for the kernel draft flow) AND a BiNode cell (for Cartesian
> charts). Two writes to two different trees for the same logical edit.

---

## The modalities (optionality)

### Edit intent variants

```mermaid
graph LR
    subgraph Packet["DRAFT PACKET"]
        direction TB
        P["{ nodeId, value, source, intent, ... }"]
    end

    subgraph VE["VALUE EDIT"]
        direction TB
        VE1["nodeId"]
        VE2["value"]
        VE3["intent: 'edit'"]
        VE4["one cell changes"]
    end

    subgraph RA["REAPPORTION"]
        direction TB
        RA1["nodeId + value"]
        RA2["secondaryNodeId"]
        RA3["secondaryValue"]
        RA4["two cells change"]
        RA5["parent preserved"]
    end

    subgraph RE["REORDER"]
        direction TB
        RE1["parentId"]
        RE2["reorderOrder[]"]
        RE3["intent: 'reorder'"]
        RE4["zero cells change"]
        RE5["array swaps"]
    end

    Packet --> VE & RA & RE
```

### Conservation mode variants (hierarchical only)

```mermaid
graph TB
    subgraph Conservation["CONSERVATION (chart-owned, not kernel)"]
        direction LR
        subgraph ADD["ADDITIVE"]
            A1["delta goes to<br/>edited node only"]
            A2["default"]
        end
        subgraph PN["PROP-NEIGHBOR"]
            P1["delta from<br/>ONE neighbor only"]
            P2["alt-drag"]
        end
        subgraph PS["PROP-SIBLINGS"]
            S1["delta spread across<br/>ALL siblings"]
            S2["config"]
        end
    end

    Note["The chart's gesture handler computes<br/>neighbor/sibling values and puts them<br/>in the draft packet. The kernel just<br/>stores what it gets."]
    Conservation --> Note
```

### Data shape variants

```mermaid
graph TB
    subgraph Shapes["DATA SHAPE"]
        direction LR
        subgraph HIER["HIERARCHICAL"]
            H1["icicle, sunburst"]
            H2["treemap, pack"]
            H3["treetable"]
            H4["tree of cells"]
            H5["drill, depth, conservation"]
        end
        subgraph FLAT["FLAT"]
            F1["bar, bands"]
            F2["radar, conc-arc"]
            F3["gantt, area, line"]
            F4["flat array of items"]
            F5["sort, orient, reorder"]
        end
        subgraph GRAPH["GRAPH"]
            G1["sankey"]
            G2["nodes + links"]
            G3["source/target flow"]
        end
    end

    Reservoir["ALL drink from<br/>the same Reservoir"]
    KernelWrap["Kernel wraps each<br/>shape in a Dataset"]
    Project["Charts project via<br/>DataView (query-keyed)"]

    Shapes --> Reservoir
    Reservoir --> KernelWrap
    KernelWrap --> Project
```

### Connection topology variants

```mermaid
graph TB
    subgraph VA["VARIANT A: hierarchical chart (target)"]
        direction LR
        RA1["Reservoir<br/>(BiNode)"] -->|"one cell"| KA1["Kernel<br/>(cells)"]
        KA1 -->|"one cell"| VIA1["View<br/>(derive)"]
        VIA1 -->|"one rect"| CA1["Chart<br/>(renders)"]
    end

    subgraph VB["VARIANT B: Cartesian chart (already correct)"]
        direction LR
        RB1["Reservoir<br/>(BiNode)"] -->|"one cell"| NB1["Num.lens"]
        NB1 -->|"one bar"| CB1["Chart<br/>(renders)"]
    end

    subgraph VC["VARIANT C: treetable editing (target)"]
        direction LR
        TC1["treetable<br/>writes cell"] --> SC1["SHARED CELL<br/>(BiNode leaf total)"]
        SC1 --> KC1["Kernel<br/>(reads cell)"]
        SC1 --> CC1["Chart<br/>(reads cell)"]
        KC1 --> VC1["Other views<br/>(derive)"]
    end

    subgraph VD["VARIANT D: cross-view (two charts, one dataset)"]
        direction LR
        RD1["Reservoir"] --> KD1["Kernel<br/>(cells)"]
        KD1 --> VDA["View A<br/>icicle"]
        KD1 --> VDB["View B<br/>sunburst"]
        VDA -.->|"draft broadcast"| VDB
    end
```

---

## What we're fixing (the broken pipe)

```mermaid
graph LR
    subgraph Current["CURRENT (broken)"]
        direction TB
        C1["commit"] --> C2["leafValues(root)<br/>walk ENTIRE tree"]
        C2 --> C3["kernel.writeValues<br/>write EVERY leaf<br/>recompute ALL sums"]
        C3 --> C4["_publish<br/>notify ALL subscribers"]
        C4 --> C5["each DataView × N<br/>buildWindow — walk tree<br/>buildTree — walk tree, fresh cells"]
        C5 --> C6["chart re-derives ALL<br/>every derive re-runs"]
    end

    subgraph Target["TARGET"]
        direction TB
        T1["commit"] --> T2["write ONE cell<br/>O(1)"]
        T2 --> T3["bireactive propagation<br/>only dependent derives re-run"]
        T3 --> T4["CSS transition animates<br/>same cell, new value"]
    end

    style Current fill:#3a1a1a,color:#fff
    style Target fill:#1a3a1a,color:#fff
```

The difference: **one cell write vs entire tree rebuild.** The Reservoir
already has cells. The Kernel should too. Then the Rebuilder, the
Snapshot Tank, and the Adapter all become unnecessary — there's one
reactive tree, everyone reads from the same cells, and bireactive tracks
the dependencies.
