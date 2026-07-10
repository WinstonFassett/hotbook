import type { Dataset } from '../schema/v11'

const NOW = '2026-05-13T12:00:00.000Z'

let _idc = 0
function nid(): string { return `n${++_idc}` }

function row(name: string, measures: Record<string, number>, dims: Record<string, string>, parentId?: string) {
  return { id: nid(), parentId: parentId ?? null, index: _idc, name, measures, dims }
}

/**
 * Dataset 2 — Team Allocation (2-level hierarchy)
 *   Shape: tree (3 quarter roots Q2/Q3/Q4 → team leaves). 16 nodes total.
 *   Measures: budget (k), headcount. Dims: team, role.
 *   Teams per quarter: Design, Frontend, Backend, Infra (+ PM in Q4).
 *   Use: exercises hier charts natively (no groupBy needed), scatter (budget vs headcount),
 *        multi-measure selector, cross-quarter comparison via flat charts on leaves.
 */
export function buildTeamDataset(): Dataset {
  _idc = 0
  const q2id = nid(); const q3id = nid(); const q4id = nid()
  const q2 = { id: q2id, parentId: null, index: 1, name: 'Q2', measures: {}, dims: {}, color: '#7ec87e' }
  const q3 = { id: q3id, parentId: null, index: 2, name: 'Q3', measures: {}, dims: {}, color: '#7aaae8' }
  const q4 = { id: q4id, parentId: null, index: 3, name: 'Q4', measures: {}, dims: {}, color: '#b090e0' }
  const nodes = [
    q2, q3, q4,
    row('Design',   { budget: 20, headcount: 2 }, { team: 'Design',   role: 'product' }, q2id),
    row('Frontend', { budget: 35, headcount: 3 }, { team: 'Frontend', role: 'eng' },     q2id),
    row('Backend',  { budget: 30, headcount: 3 }, { team: 'Backend',  role: 'eng' },     q2id),
    row('Infra',    { budget: 15, headcount: 1 }, { team: 'Infra',    role: 'eng' },     q2id),
    row('Design',   { budget: 25, headcount: 2 }, { team: 'Design',   role: 'product' }, q3id),
    row('Frontend', { budget: 40, headcount: 4 }, { team: 'Frontend', role: 'eng' },     q3id),
    row('Backend',  { budget: 25, headcount: 3 }, { team: 'Backend',  role: 'eng' },     q3id),
    row('Infra',    { budget: 10, headcount: 1 }, { team: 'Infra',    role: 'eng' },     q3id),
    row('Design',   { budget: 30, headcount: 2 }, { team: 'Design',   role: 'product' }, q4id),
    row('Frontend', { budget: 45, headcount: 4 }, { team: 'Frontend', role: 'eng' },     q4id),
    row('Backend',  { budget: 35, headcount: 3 }, { team: 'Backend',  role: 'eng' },     q4id),
    row('Infra',    { budget: 20, headcount: 2 }, { team: 'Infra',    role: 'eng' },     q4id),
    row('PM',       { budget: 18, headcount: 1 }, { team: 'PM',       role: 'product' }, q4id),
  ]
  return {
    id: 'ds-team',
    name: 'Team allocation (demo)',
    createdAt: NOW,
    shape: 'tree' as const,
    nodes,
    measureDefs: [
      { key: 'budget', label: 'Budget', unit: 'k' },
      { key: 'headcount', label: 'Headcount' },
    ],
    dimDefs: [
      { key: 'team', label: 'Team', values: ['Design', 'Frontend', 'Backend', 'Infra', 'PM'] },
      { key: 'role', label: 'Role', values: ['product', 'eng'] },
    ],
  }
}
