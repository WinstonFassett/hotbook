import type { Dataset } from '../schema/v11'
import type { PEdge } from '@hotbook/core'

const NOW = '2026-05-13T12:00:00.000Z'

let _idc = 0
function nid(): string { return `n${++_idc}` }

function row(name: string, measures: Record<string, number>, dims: Record<string, string>, parentId?: string | null, color?: string) {
  return { id: nid(), parentId: parentId ?? null, index: _idc, name, measures, dims, ...(color ? { color } : {}) }
}

/**
 * Dataset 5: Project Schedule (tasks with dependencies for Gantt)
 */
export function buildGanttDataset(): Dataset {
  _idc = 0
  // Tasks with start/end dates (day-offsets from 2026-01-01), duration, and slack
  // Slack = buffer days before successor starts (shows scheduling flexibility)
  const nodes = [
    row('Discovery',  { start: 0,  end: 7,  duration: 7,  slack: 0  }, { phase: 'research' }, null, '#e08888'),
    row('Design',     { start: 9,  end: 18, duration: 9,  slack: 0  }, { phase: 'planning' }, null, '#d4a86c'),
    row('Frontend',   { start: 20, end: 35, duration: 15, slack: 5  }, { phase: 'build' },    null, '#7ec87e'),
    row('Backend',    { start: 20, end: 38, duration: 18, slack: 2  }, { phase: 'build' },    null, '#6fb0d2'),
    row('QA',         { start: 40, end: 49, duration: 9,  slack: 0  }, { phase: 'verify' },   null, '#7aaae8'),
    row('Deploy',     { start: 51, end: 54, duration: 3,  slack: 0  }, { phase: 'launch' },   null, '#b090e0'),
  ]
  // Dependencies with lag (positive = required gap, negative = allowed overlap)
  const edges: PEdge[] = [
    { source: nodes[0]!.id, target: nodes[1]!.id, value: 0, lag: 2  },  // Discovery → Design (2 day gap)
    { source: nodes[1]!.id, target: nodes[2]!.id, value: 0, lag: 2  },  // Design → Frontend (2 day gap)
    { source: nodes[1]!.id, target: nodes[3]!.id, value: 0, lag: 2  },  // Design → Backend (2 day gap)
    { source: nodes[2]!.id, target: nodes[4]!.id, value: 0, lag: 5  },  // Frontend → QA (5 day gap, has slack)
    { source: nodes[3]!.id, target: nodes[4]!.id, value: 0, lag: 2  },  // Backend → QA (2 day gap)
    { source: nodes[4]!.id, target: nodes[5]!.id, value: 0, lag: 2  },  // QA → Deploy (2 day gap)
  ]
  return {
    id: 'ds-gantt',
    name: 'Project schedule (gantt)',
    createdAt: NOW,
    shape: 'graph',
    nodes,
    edges,
    measureDefs: [
      { key: 'start', label: 'Start (days from 2026-01-01)' },
      { key: 'end', label: 'End (days from 2026-01-01)' },
      { key: 'duration', label: 'Duration (days)' },
      { key: 'slack', label: 'Slack (buffer days)' },
    ],
    dimDefs: [
      { key: 'phase', label: 'Phase', values: ['research', 'planning', 'build', 'verify', 'launch'] },
    ],
  }
}
