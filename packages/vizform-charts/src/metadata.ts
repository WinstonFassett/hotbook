/**
 * Chart maturity levels:
 * - experimental: Work in progress, API may change
 * - candidate: Stable API, needs user validation
 * - released: Production-ready
 */
export type ChartMaturity = 'experimental' | 'candidate' | 'released';

export interface ChartMetadata {
  name: string;
  maturity: ChartMaturity;
  description?: string;
}

export const CHART_METADATA: Record<string, ChartMetadata> = {
  'bar-chart': {
    name: 'Bar Chart',
    maturity: 'released',
    description: 'Vertical or horizontal bar chart with drag interaction'
  },
  'line-chart': {
    name: 'Line Chart',
    maturity: 'released',
    description: 'Line chart with area fill and drag interaction'
  },
  'area-chart': {
    name: 'Area Chart',
    maturity: 'released',
    description: 'Area chart with gradient fill'
  },
  'pie-chart': {
    name: 'Pie Chart',
    maturity: 'released',
    description: 'Pie or donut chart with slice drag'
  },
  'treemap': {
    name: 'Treemap',
    maturity: 'candidate',
    description: 'Hierarchical treemap with zoom navigation'
  },
  'treetable': {
    name: 'Tree Table',
    maturity: 'candidate',
    description: 'Hierarchical tree table with expand/collapse'
  },
  'icicle': {
    name: 'Icicle',
    maturity: 'candidate',
    description: 'Vertical hierarchical icicle chart'
  },
  'sunburst': {
    name: 'Sunburst',
    maturity: 'candidate',
    description: 'Radial hierarchical sunburst chart'
  },
  'pack': {
    name: 'Pack',
    maturity: 'candidate',
    description: 'Circle packing layout'
  },
  'scatter-chart': {
    name: 'Scatter Chart',
    maturity: 'candidate',
    description: 'XY scatter plot'
  },
  'radar-chart': {
    name: 'Radar Chart',
    maturity: 'experimental',
    description: 'Radar/spider chart'
  },
  'concentric-arc': {
    name: 'Concentric Arc',
    maturity: 'experimental',
    description: 'Concentric arc diagram'
  },
  'gauge': {
    name: 'Gauge',
    maturity: 'experimental',
    description: 'Single-value gauge'
  },
  'gauge-segmented': {
    name: 'Segmented Gauge',
    maturity: 'experimental',
    description: 'Multi-segment gauge'
  },
  'sankey': {
    name: 'Sankey',
    maturity: 'experimental',
    description: 'Sankey flow diagram'
  },
  'sankey-flow': {
    name: 'Sankey Flow',
    maturity: 'experimental',
    description: 'Animated sankey flow'
  },
  'tree-chart': {
    name: 'Tree Chart',
    maturity: 'experimental',
    description: 'Hierarchical tree diagram'
  },
  'gantt': {
    name: 'Gantt Chart',
    maturity: 'experimental',
    description: 'Gantt timeline chart'
  },
};

export function getChartMaturity(chartName: string): ChartMaturity {
  return CHART_METADATA[chartName]?.maturity || 'experimental';
}
