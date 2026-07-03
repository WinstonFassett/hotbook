import type { ExampleMeta } from './types';

// Auto-discover all example files using Vite's glob import
const modules = import.meta.glob<{ default: ExampleMeta }>('./*.example.tsx', { eager: true });

export const ALL_EXAMPLES: ExampleMeta[] = Object.values(modules).map((m) => m.default);

// Filter by maturity
export const getExamples = (maturity?: string[]): ExampleMeta[] => {
  if (!maturity || maturity.length === 0) {
    return ALL_EXAMPLES.filter((ex) => ex.maturity === 'released');
  }
  return ALL_EXAMPLES.filter((ex) => maturity.includes(ex.maturity));
};

// Get example by slug
export const getExample = (slug: string): ExampleMeta | undefined => {
  return ALL_EXAMPLES.find((ex) => ex.slug === slug);
};
