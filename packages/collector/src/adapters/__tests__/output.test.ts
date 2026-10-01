import type { AlertMessage, ReportDocument } from '@claude-audit/core';
import { describe, expect, it, vi } from 'vitest';
import { consoleNotifier, discordNotifier, slackNotifier } from '../notifiers/channels.js';
import { emailNotifier } from '../notifiers/email.js';
import { csvRenderer } from '../renderers/csv.js';
import { BUILTIN_RENDERERS } from '../renderers/index.js';
import { htmlRenderer } from '../renderers/html.js';
import { MAX_TABLE_ROWS, markdownRenderer } from '../renderers/markdown.js';

const document: ReportDocument = {
  id: 'weekly-2026-09-30',
  kind: 'weekly',
  title: 'Weekly <digest>',
  generatedAt: '2026-09-30T00:00:00Z',
  period: null,
  sections: [
    { type: 'kpis', title: 'Summary', items: [{ label: 'Score', value: '90/100' }] },
    {
      type: 'table',
      title: 'Raw cost records',
      columns: ['Key', 'Amount'],
      rows: [
        ['a|b', 1.5],
        ['with, "comma"', null],
      ],
    },
    { type: 'list', title: 'Insights', items: ['Use <caching>'] },
    { type: 'text', title: 'Notes', body: 'Provisional.' },
  ],
};

describe('renderers', () => {
  it('render markdown with escaped cells and cut long tables', () => {
    const [md] = markdownRenderer.render(document);
    expect(md?.content).toContain('| a\\|b | 1.5 |');
    const long: ReportDocument = {
      ...document,
      sections: [
        {
          type: 'table',
          title: 'T',
          columns: ['n'],
          rows: Array.from({ length: MAX_TABLE_ROWS + 5 }, (_, i) => [i]),
        },
      ],
    };
    expect(markdownRenderer.render(long)[0]?.content).toContain(
      '_5 more row(s) in the CSV / JSON export._',
    );
  });

  it('render CSV per table with RFC 4180 quoting', () => {
    const files = csvRenderer.render(document);
    expect(files.map((f) => f.suffix)).toEqual(['.raw-cost-records.csv']);
    expect(files[0]?.content).toBe('Key,Amount\r\na|b,1.5\r\n"with, ""comma""",\r\n');
  });

  it('escape HTML and register every format', () => {
    const [html] = htmlRenderer.render(document);
    expect(html?.content).toContain('<h1>Weekly &lt;digest&gt;</h1>');
    expect(html?.content).toContain('<li>Use &lt;caching&gt;</li>');
    expect(BUILTIN_RENDERERS.map((r) => r.id)).toEqual(['markdown', 'html', 'csv', 'json']);
  });
});

const alert: AlertMessage = {
  key: 'k',
  title: 'Claude audit: 1 finding',
  severity: 'critical',
  lines: ['[CRITICAL] AC-003 …'],
  link: 'https://example.com/dash',
};

describe('notifiers', () => {
  it('post Block Kit to Slack and embeds to Discord', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('ok', { status: 200 }),
    ) as unknown as typeof fetch;
    await slackNotifier('https://hooks.slack.test/T0/B0/mock', fetchImpl).send(alert);
    await discordNotifier('https://discord.test/api/webhooks/0/mock', fetchImpl).send(alert);
    const bodies = vi.mocked(fetchImpl).mock.calls.map((c) => JSON.parse(String(c[1]?.body)));
    expect(bodies[0].blocks[0]).toEqual({
      type: 'header',
      text: { type: 'plain_text', text: 'Claude audit: 1 finding' },
    });
    expect(bodies[0].blocks[2].elements[0].text).toContain('https://example.com/dash');
    expect(bodies[1].embeds[0]).toMatchObject({ color: 0xdc2626, url: 'https://example.com/dash' });
  });

  it('never leak the webhook URL in errors', async () => {
    const fetchImpl = (async () =>
      new Response('nope', { status: 404 })) as unknown as typeof fetch;
    const failure = await slackNotifier('https://hooks.slack.test/T0/B0/secret-token', fetchImpl)
      .send(alert)
      .catch((e: Error) => e);
    expect((failure as Error).message).toBe('Slack webhook responded 404');
    expect((failure as Error).message).not.toContain('secret-token');
  });

  it('send e-mail with text and HTML parts and log to the console', async () => {
    const sendMail = vi.fn(async () => ({}));
    const smtp = {
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      from: 'audit@example.com',
      to: ['security@example.com'],
    };
    await emailNotifier(smtp, { sendMail }).send({ ...alert, document });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: alert.title,
        to: ['security@example.com'],
        html: expect.stringContaining('Weekly &lt;digest&gt;'),
      }),
    );
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await consoleNotifier(logger).send(alert);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('[critical] Claude audit'));
  });
});
