import type { ReactNode } from 'react';

export type Maturity = 'experimental' | 'candidate' | 'released';

export interface ExampleMeta {
  slug: string;
  title: string;
  description: string;
  maturity: Maturity;
  render: () => ReactNode;
  source?: string;
}
