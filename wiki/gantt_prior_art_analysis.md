# Gantt Chart Prior Art Analysis

Research conducted: June 30, 2026

## Executive Summary

Modern project planning tools (MS Project, Asana, Monday.com, Jira) share common patterns for Gantt chart interactions:
- **Real-time constraint solving** during drag operations
- **Multiple dependency types** with lag/lead support
- **Auto-shifting dependent tasks** when predecessors change
- **Visual conflict indicators** (red lines/badges)
- **Flexible vs. strict enforcement modes**

## 1. Constraint Types (Task Dependencies)

All major tools support **four fundamental dependency types**:

### Finish-to-Start (FS) - Most Common
- Successor begins only after predecessor ends
- Default in MS Project, Asana (only type), Monday.com
- Classic waterfall dependency

### Start-to-Start (SS)
- Tasks can begin simultaneously
- Allows parallel work with guardrails
- Supported by MS Project, Monday.com

### Finish-to-Finish (FF)
- Tasks must complete together
- Less common but supported by MS Project

### Start-to-Finish (SF)
- Rare; successor's finish depends on predecessor's start
- Only in advanced tools like MS Project

**Key Finding:** Asana only supports FS dependencies, suggesting this covers 80%+ of use cases.

## 2. Lag and Lead (Slack)

### Lag
- **Definition:** Waiting period between tasks
- **Use cases:** Drying time, legal review, procurement wait
- **Implementation:** Positive number in dependency (e.g., +3 days)
- **Monday.com:** Enter positive number in Dependency Column
- **Effect:** Creates gap between predecessor end and successor start

### Lead
- **Definition:** Overlap allowing early start
- **Use cases:** Tasks that can begin before predecessor finishes
- **Implementation:** Negative number in dependency (e.g., -2 days)
- **Monday.com:** Enter negative number in Dependency Column
- **Effect:** Successor can start before predecessor completes

### Slack (Float)
- **Definition:** Free time in schedule without delaying project
- **Visual:** Often shown as black lines on critical path charts
- **Critical path:** Tasks with zero slack (shown in red)

## 3. Drag Behavior and Auto-Shifting

### Microsoft Project
- **Direct drag:** Tasks can be dragged to new dates; schedule recalculates instantly
- **Automatic constraints:** Dragging sets Start No Earlier Than (SNET) or Finish No Later Than (FNLT) constraints
- **Constraint precedence:** Inflexible constraints can override dependencies
- **Example:** Task with SNET=July 1 won't move earlier even if predecessor finishes June 28

### Asana Timeline
- **Real-time shifting:** Dragging one task auto-shifts all downstream dependents
- **Buffer modes:** Three options when predecessor changes:
  1. Maintain buffer between tasks
  2. Consume the buffer
  3. Ignore the buffer
- **Visual feedback:** Dependencies show as gray lines; conflicts turn red
- **One-way:** Only finish-to-start, forward propagation

### Monday.com
- **Dependency modes:**
  - **Flexible mode:** Prevents overlap; adjusts dates only when conflict occurs
  - **Strict mode:** (implied) Always maintains relationships
- **Visual propagation:** Can see all items move when dragging
- **Lag/Lead support:** Built into dependency column

### Jira Timeline/Roadmap
- **Drag to link:** Drag from schedule bar dots to create dependencies
- **Auto-order:** System determines "blocks" vs "is blocked by" from schedule order
- **Conflict detection:** Red badges/lines when dates conflict
- **Warning system:** Dependencies turn red when lead-in work puts successor at risk

## 4. Bidirectional Constraint Solving

**Key Gap in Current Research:** None of the tools explicitly document bidirectional pushing (dragging backward pushes predecessors back).

**Observed behavior:**
- **Forward propagation:** Well-documented (drag predecessor → shift successors)
- **Backward propagation:** Not mentioned; likely constraint violations trigger warnings but don't auto-push predecessors
- **Conflict resolution:** Manual; system warns but doesn't auto-solve bidirectional conflicts

**Hypothesis:** Professional tools warn about conflicts but leave resolution to user, avoiding unexpected changes to other tasks.

## 5. Visual Indicators and Conflict Detection

All tools use consistent visual language:
- **Gray/Black lines:** Normal dependencies
- **Red lines:** Conflicts (successor scheduled before predecessor completes)
- **Red badges/dots:** Task-level conflict indicators
- **Critical path:** Red bars for zero-slack tasks

## 6. Implementation Patterns

### Common Architecture
1. **Dependency graph:** DAG (directed acyclic graph) of task relationships
2. **Topological sort:** Process tasks in dependency order (Kahn's algorithm)
3. **Forward propagation:** When task changes, push successors via BFS/DFS
4. **Constraint checking:** Detect conflicts; warn user
5. **Visual feedback:** Update immediately during drag

### Drag Gesture Pattern
```
onDragStart:
  - Snapshot all task positions
  - Enter gesture mode (suppress transitions)

onDragMove:
  - Calculate new position
  - Apply constraints (lag/lead)
  - Forward-propagate to dependents
  - Detect conflicts → visual feedback (red)
  - Preview changes (no commit)

onDragEnd:
  - Commit all changes
  - Exit gesture mode
  - Apply transitions

onEscape:
  - Restore snapshot
  - Cancel all changes
```

### Constraint Solver Approach
```
For each task T in topological order:
  For each dependency D where T depends on predecessor P:
    minStart = P.end + D.lag
    if T.start < minStart:
      if strict mode:
        T.start = minStart
        T.end = T.start + T.duration
      else:
        mark conflict; don't auto-fix
```

## 7. Recommendations for Bireactive Implementation

### Phase 1: Core Constraint System
1. **Support FS dependencies with lag** (covers 90% of cases)
2. **Forward propagation during drag** (auto-shift successors)
3. **Conflict detection and visual feedback** (red connectors)
4. **Flexible vs. strict enforcement modes**

### Phase 2: Advanced Features
5. **SS, FF dependency types** (parallel workflows)
6. **Critical path highlighting** (zero-slack visualization)
7. **Undo/redo for constraint changes**

### Phase 3: Sophisticated UX
8. **Smart space conservation** on drag reversal
9. **Bidirectional pushing** (experimental; not in prior art)
10. **Tree/hierarchy with parent constraint aggregation**

### Bireactive Advantages
- **Reactive constraint graph:** Dependencies as derived cells
- **Real-time solving:** Constraint propagation via cell reactivity
- **Gesture integration:** Works with existing dragController pattern
- **Visual updates:** Connector positions auto-update via pathD derives

## 8. Key Decisions Needed

1. **Dependency types:** Start with FS + lag, or full FS/SS/FF/SF?
2. **Enforcement mode:** Strict (auto-fix) vs. flexible (warn only)?
3. **Bidirectional push:** Implement (novel) or omit (like others)?
4. **Conflict resolution:** Auto-solve vs. manual user intervention?
5. **Critical path:** Show in initial version or defer?

## Sources

### Microsoft Project
- [Link tasks in a project | Microsoft Support](https://support.microsoft.com/en-us/office/link-tasks-in-a-project-31b918ce-4b71-475c-9d6b-0ee501b4be57)
- [Work with the Gantt Chart view | Microsoft Support](https://support.microsoft.com/en-us/office/work-with-the-gantt-chart-view-0e84efa4-78ce-4cd1-baed-5159a55f78b4)
- [Ms Project Gantt Chart - Project Management Formula](https://projectmanagementformula.com/ms-project-gantt-chart/)

### Asana Timeline
- [Managing tasks and dependencies with timeline | Asana Help Center](https://help.asana.com/s/article/managing-tasks-and-dependencies-with-timeline?language=en_US)
- [How to use task dependencies | Asana Help Center](https://help.asana.com/hc/en-us/articles/14078761989531-Task-dependencies)
- [How to auto-shift dates for dependent tasks | Asana Help Center](https://help.asana.com/s/article/auto-shifting-dates-for-dependent-tasks?language=en_US)
- [What is a Gantt Chart? Guide to Project Timelines [2026] • Asana](https://asana.com/resources/gantt-chart-basics)

### Monday.com
- [The Gantt Chart View and Widget – Support](https://support.monday.com/hc/en-us/articles/360015643840-The-Gantt-Chart-View-and-Widget)
- [Dependencies on monday.com – Support](https://support.monday.com/hc/en-us/articles/360007402599-Dependencies-on-monday-com)
- [A guide to Gantt chart with dependencies](https://monday.com/blog/project-management/gantt-charts-with-dependencies/)

### Jira Timeline
- [Jira Work Roadmap with Drag & Drop | Atlassian Community](https://community.atlassian.com/forums/App-Central-articles/Jira-Work-Roadmap-with-Drag-amp-Drop-Plan-Without-Losing-Control/ba-p/3191065)
- [Create or remove dependencies on your timeline | Jira Cloud Support](https://support.atlassian.com/jira-software-cloud/docs/create-or-remove-dependencies-on-your-timeline/)
- [Scheduling dependencies | Advanced Roadmaps for Jira](https://confluence.atlassian.com/jiraportfolioserver/scheduling-dependencies-968677365.html)

### General Gantt Theory
- [Lead, Lag, and Constraints in Gantt Charts](https://www.paymoapp.com/blog/lead-lag-and-constraints/)
- [Gantt Chart Dependencies: The Complete Guide (2025 Update)](https://teamhood.com/project-management-resources/gantt-chart-dependencies/)
- [Understanding Gantt Charts: Essential Terms Explained](https://apmic.org/blogs/understanding-gantt-charts-essential-terms-explained)
