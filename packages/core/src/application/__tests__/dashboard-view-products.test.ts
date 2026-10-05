import { describe, expect, it } from 'vitest';
import { NOW, dayString, snapshot } from '../../__tests__/fixtures.js';
import { dashboardViewSchema, type DashboardView } from '../../contracts/dashboard-view.js';
import type { AdoptionDay, ProductActiveUsers } from '../../domain/model/entities.js';
import type { AuditSnapshot } from '../../domain/model/snapshot.js';
import { buildDashboardView } from '../presenters/dashboard-view.js';

const view = (snap: AuditSnapshot): DashboardView =>
  buildDashboardView({
    now: NOW,
    title: 'Audit',
    source: 'demo',
    maskPii: true,
    snapshot: snap,
    report: null,
    history: [],
    insights: [],
  });

const day = (date: string, byProduct?: ProductActiveUsers[]): AdoptionDay => ({
  date,
  dailyActiveUsers: 20,
  weeklyActiveUsers: 30,
  monthlyActiveUsers: 35,
  assignedSeats: 50,
  monthlyAdoptionRate: 70,
  pendingInvites: 1,
  ...(byProduct ? { byProduct } : {}),
});

const p = (product: ProductActiveUsers['product'], wau: number): ProductActiveUsers => ({
  product,
  dau: Math.round(wau / 2),
  wau,
  mau: wau + 3,
});

describe('dashboard view active users by product (AN-2)', () => {
  const snap = snapshot({
    // Unordered on purpose: the presenter sorts by date.
    adoption: [
      day(dayString(1), [p('cowork', 6), p('chat', 25), p('claude_code', 6), p('science', 1)]),
      day(dayString(3)),
      day(dayString(2), [p('chat', 24), p('claude_code', 12)]),
    ],
  });

  it('lists the latest day by weekly active users, ties in catalog order, with labels', () => {
    const byProduct = view(snap).adoption?.byProduct ?? [];
    expect(byProduct.map((r) => r.product)).toEqual(['chat', 'claude_code', 'cowork', 'science']);
    expect(byProduct[0]).toEqual({ product: 'chat', label: 'Chat', dau: 13, wau: 25, mau: 28 });
    expect(byProduct.map((r) => r.label)).toContain('Claude Science');
  });

  it('charts the weekly trend only over days that carry a breakdown', () => {
    expect(view(snap).adoption?.productWeekly).toEqual([
      { date: dayString(2), wau: { chat: 24, claude_code: 12 } },
      { date: dayString(1), wau: { chat: 25, claude_code: 6, cowork: 6, science: 1 } },
    ]);
  });

  it('omits both fields when no day has per-product counts', () => {
    const adoption = view(
      snapshot({ adoption: [day(dayString(1)), day(dayString(2), [])] }),
    ).adoption;
    expect(adoption).not.toBeNull();
    expect(adoption).not.toHaveProperty('byProduct');
    expect(adoption).not.toHaveProperty('productWeekly');
  });

  it('accepts a dashboard.json written before the product breakdown existed', () => {
    const current = view(snap);
    if (!current.adoption) throw new Error('adoption expected');
    const legacyAdoption = { ...current.adoption };
    delete legacyAdoption.byProduct;
    delete legacyAdoption.productWeekly;
    const parsed = dashboardViewSchema.parse(
      JSON.parse(JSON.stringify({ ...current, adoption: legacyAdoption })),
    );
    expect(parsed.adoption?.byProduct).toBeUndefined();
    expect(dashboardViewSchema.parse(current)).toEqual(current);
  });
});
