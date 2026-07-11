import type { GanttTask } from "@hotbook/bireactive";

// Convert day-offset format from hotbook/gantt-tasks.json to Date objects.
// Base date: 2026-01-01
const BASE = new Date(2026, 0, 1); // Jan 1, 2026

function dayOffset(days: number): Date {
  return new Date(BASE.getTime() + days * 86400 * 1000);
}

export function ganttTasks(): GanttTask[] {
  return [
    {
      id: "g1",
      label: "Discovery",
      start: dayOffset(0),
      end: dayOffset(7),
      color: "#e08888",
    },
    {
      id: "g2",
      label: "Design",
      start: dayOffset(5),
      end: dayOffset(14),
      color: "#d4a86c",
      deps: [{ from: "g1", lag: 2 }],
    },
    {
      id: "g3",
      label: "Build core",
      start: dayOffset(12),
      end: dayOffset(28),
      color: "#7ec87e",
      deps: [{ from: "g2", lag: -2 }],
    },
    {
      id: "g4",
      label: "QA",
      start: dayOffset(25),
      end: dayOffset(34),
      color: "#7aaae8",
      deps: [{ from: "g3", lag: 0 }],
    },
    {
      id: "g5",
      label: "Launch",
      start: dayOffset(33),
      end: dayOffset(36),
      color: "#b090e0",
      deps: [
        { from: "g3", lag: 3 },
        { from: "g4" }, // lag defaults to 0
      ],
    },
  ];
}
