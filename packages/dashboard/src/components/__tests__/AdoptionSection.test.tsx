import type { DashboardAdoption } from '@claude-audit/core/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { productTrend, productTrendRows, sparklinePoints } from '../../lib/adoption-view';
import { AdoptionSection } from '../sections';

const adoption = (over: Partial<DashboardAdoption> = {}): DashboardAdoption => ({
  daily: [
    { date: '2026-09-28', dau: 20, wau: 30, mau: 35 },
    { date: '2026-09-29', dau: 22, wau: 31, mau: 35 },
  ],
  assignedSeats: 45,
  monthlyAdoptionRate: 77.8,
  pendingInvites: 3,
  byProduct: [
    { product: 'chat', label: 'Chat', dau: 18, wau: 26, mau: 30 },
    { product: 'claude_code', label: 'Claude Code', dau: 11, wau: 16, mau: 19 },
    { product: 'science', label: 'Claude Science', dau: 1, wau: 1, mau: 2 },
  ],
  productWeekly: [
    { date: '2026-09-28', wau: { chat: 25, claude_code: 15 } },
    { date: '2026-09-29', wau: { chat: 26, claude_code: 16, science: 1 } },
  ],
  ...over,
});

describe('Active users by product (AN-2)', () => {
  it('lists each product with daily, weekly and monthly active users and a named sparkline', () => {
    render(<AdoptionSection adoption={adoption()} />);
    expect(screen.getByRole('heading', { level: 3, name: 'By product' })).toBeInTheDocument();
    const chat = screen.getByRole('rowheader', { name: 'Chat' }).closest('tr');
    if (!chat) throw new Error('row expected');
    expect(
      within(chat)
        .getAllByRole('cell')
        .slice(0, 3)
        .map((c) => c.textContent),
    ).toEqual(['18', '26', '30']);
    expect(
      screen.getByRole('img', {
        name: 'Chat weekly active users: 25 on 2026-09-28, 26 on 2026-09-29',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Claude Science weekly active users: 1 on 2026-09-29' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Claude Science weekly')).toBeInTheDocument();
  });

  it('shows only the organization-wide chart for a dashboard.json without the breakdown', () => {
    const legacy = adoption();
    delete legacy.byProduct;
    delete legacy.productWeekly;
    render(<AdoptionSection adoption={legacy} />);
    expect(screen.getByText('Active users')).toBeInTheDocument();
    expect(screen.queryByText('By product')).not.toBeInTheDocument();
  });

  it('derives trends, table rows and sparkline points on a shared scale', () => {
    const { productWeekly, byProduct = [] } = adoption();
    expect(productTrend(productWeekly, 'science')).toEqual([{ date: '2026-09-29', value: 1 }]);
    expect(productTrendRows(productWeekly, byProduct, String)).toEqual([
      ['2026-09-28', '25', '15', '—'],
      ['2026-09-29', '26', '16', '1'],
    ]);
    const trend = productTrend(productWeekly, 'chat');
    expect(sparklinePoints(trend, { width: 100, height: 20, max: 50 })).toBe('0.0,10.0 100.0,9.6');
    expect(sparklinePoints([], { width: 100, height: 20, max: 50 })).toBe('');
  });
});
