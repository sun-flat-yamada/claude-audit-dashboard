import { resolve } from 'node:path';
import type { AlertMessage } from '@claude-audit/core';
import {
  Registry,
  addDays,
  appendSent,
  dispatchAlert,
  documentAlert,
  formatScore,
  planComplianceAlert,
  pruneLastSent,
  sanitizeAlertTitle,
} from '@claude-audit/core';
import { defaultFixtureDir } from '../adapters/fixture/fixture-source.js';
import { archiveSnapshots } from '../adapters/storage/archive.js';
import type { Container } from './container.js';
import { ackAlert } from './alerts.js';
import { writeDetail } from './detail.js';
import { writeMonthlyView } from './monthly-report.js';
import { writeDemoSample } from './demo.js';
import { writeFixtureTenant } from './fixture.js';
import { sanitizeDirectory } from './sanitize.js';
import { check, collect, generateReport, writeDashboard } from './workflows.js';

export interface Command {
  readonly name: string;
  readonly usage: string;
  readonly description: string;
  run(container: Container, args: readonly string[]): Promise<void>;
}

const option = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const collectCommand: Command = {
  name: 'collect',
  usage: 'collect [--capture-raw <dir>]',
  description: 'Collect every dataset into a new snapshot (opt-in raw capture)',
  async run(c) {
    const snapshot = await collect(c);
    const entries = Object.entries(snapshot.coverage);
    c.logger.info(
      `Snapshot ${snapshot.id}: ${entries.filter(([, m]) => m.status === 'ok').length}/${entries.length} datasets collected`,
    );
    for (const [name, meta] of entries.filter(([, m]) => m.status !== 'ok')) {
      c.logger.warn(`${name} ${meta.status}: ${meta.reason ?? 'no reason'}`);
    }
  },
};

const checkCommand: Command = {
  name: 'check',
  usage: 'check',
  description: 'Evaluate the latest snapshot and store the compliance report',
  async run(c) {
    const { report } = await check(c);
    const s = report.summary;
    c.logger.info(
      `Compliance score ${formatScore(s)} — ${s.failed} failed, ${s.warnings} warnings, ${s.skipped} skipped, ${s.errors} errors`,
    );
  },
};

const dashboardCommand: Command = {
  name: 'dashboard',
  usage: 'dashboard',
  description: 'Write data/dashboard.json for the dashboard UI',
  async run(c) {
    const view = await writeDashboard(c);
    c.logger.info(
      `Dashboard data written (${view.compliance.results.length} rule results, source ${view.source})`,
    );
  },
};

const detailCommand: Command = {
  name: 'detail',
  usage: 'detail',
  description: 'Write data/detail/*.json (members, API keys, activity, org / groups)',
  async run(c) {
    const files = await writeDetail(c);
    c.logger.info(
      `Detail data written (${Object.keys(files).length} files, maskPii ${String(c.config.dashboard.maskPii)})`,
    );
  },
};

const pipelineCommand: Command = {
  name: 'pipeline',
  usage: 'pipeline',
  description: 'collect, check, dashboard and detail in one run',
  async run(c, args) {
    for (const step of [collectCommand, checkCommand, dashboardCommand, detailCommand])
      await step.run(c, args);
  },
};

/** Appends the send to `state.json` history (the alert history view reads it). */
async function recordSend(
  c: Container,
  alert: AlertMessage,
  channels: readonly string[],
  now: Date,
): Promise<void> {
  if (channels.length === 0) return;
  const state = await c.state.load();
  const record = {
    key: alert.key,
    sentAt: now.toISOString(),
    severity: alert.severity,
    channels: [...channels],
    title: sanitizeAlertTitle(alert.title),
  };
  await c.state.save({
    ...state,
    notifications: {
      ...state.notifications,
      history: appendSent(state.notifications.history, record),
    },
  });
}

async function deliver(
  c: Container,
  alert: AlertMessage,
  now: Date = c.clock.now(),
): Promise<void> {
  const { delivered, failed } = await dispatchAlert(alert, c.notifiers, c.logger);
  c.logger.info(`Sent "${alert.title}" via ${delivered.join(', ') || 'no channel'}`);
  await recordSend(c, alert, delivered, now);
  if (failed.length) throw new Error(`Notification failed for: ${failed.join(', ')}`);
}

const reportCommand: Command = {
  name: 'report',
  usage: 'report <compliance|weekly|monthly> [--month YYYY-MM] [--notify]',
  description: 'Generate a report in every format and optionally send it',
  async run(c, args) {
    const [id] = args;
    if (!id || id.startsWith('--')) throw new Error(`Usage: ${this.usage}`);
    const { document, paths } = await generateReport(c, id, option(args, '--month'));
    const published = Object.keys(await writeMonthlyView(c, document));
    c.logger.info(`${document.title}\n  ${[...paths, ...published].join('\n  ')}`);
    if (args.includes('--notify')) await deliver(c, documentAlert(document, c.env.dashboardUrl));
  },
};

const notifyCommand: Command = {
  name: 'notify',
  usage: 'notify [--collect-status <success|failure|cancelled>]',
  description: 'Send the alert digest for the latest compliance report',
  async run(c, args) {
    const status = option(args, '--collect-status');
    const now = c.clock.now();
    if (status && status !== 'success') {
      await deliver(
        c,
        {
          key: `collection:${status}`,
          title: `Claude audit collection ${status}`,
          severity: 'high',
          lines: ['Check the collect-audit workflow run.'],
          link: c.env.dashboardUrl,
        },
        now,
      );
    }
    const report = await c.reports.latest();
    if (!report) throw new Error('No compliance report found: run `check` first');
    const { cooldownMinutes } = c.config.notifications;
    const { lastSent } = (await c.state.load()).notifications;
    const policy = { ...c.config.notifications, link: c.env.dashboardUrl };
    const alert = planComplianceAlert(report, policy, lastSent, now);
    if (!alert) return c.logger.info('Nothing new to notify');
    await deliver(c, alert, now);
    // Reload: `deliver` has appended the send record to the history.
    const state = await c.state.load();
    await c.state.save({
      ...state,
      notifications: {
        ...state.notifications,
        lastSent: {
          ...pruneLastSent(lastSent, now, cooldownMinutes),
          [alert.key]: now.toISOString(),
        },
      },
    });
  },
};

const ALERT_USAGE = 'alerts ack <alert-id> [--by <label>]';

const alertsCommand: Command = {
  name: 'alerts',
  usage: ALERT_USAGE,
  description: 'Acknowledge a sent alert (recorded in alerts/ack.json on the data/audit branch)',
  async run(c, args) {
    const [action, id] = args;
    const by = option(args, '--by');
    if (action !== 'ack' || !id || id.startsWith('--')) throw new Error(`Usage: ${ALERT_USAGE}`);
    if (args.includes('--by') && (!by || by.startsWith('--')))
      throw new Error('--by requires a label');
    const { outcome } = await ackAlert(c, id, by);
    if (outcome === 'unknown-alert')
      throw new Error(`Unknown alert ${id}: it is not in the alert history`);
    c.logger.info(
      outcome === 'acknowledged'
        ? `Alert ${id} acknowledged`
        : `Alert ${id} was already acknowledged`,
    );
  },
};

const archiveCommand: Command = {
  name: 'archive',
  usage: 'archive [--days N]',
  description: 'Compress snapshots older than the retention period',
  async run(c, args) {
    const days = Number(option(args, '--days') ?? c.config.retention.snapshotDays);
    if (!Number.isInteger(days) || days < 1) throw new Error('--days must be a positive integer');
    const archived = await archiveSnapshots(c.store, addDays(c.clock.now(), -days));
    c.logger.info(`Archived ${archived.length} snapshot(s) older than ${days} days`);
  },
};

const demoCommand: Command = {
  name: 'demo',
  usage: 'demo [--out data/sample]',
  description: 'Run everything on the synthetic tenant and refresh the public sample data',
  async run(c, args) {
    const out = resolve(c.env.baseDir, option(args, '--out') ?? 'data/sample');
    const files = await writeDemoSample(out, { logger: c.logger, cwd: c.env.baseDir, env: {} });
    c.logger.info(`Sample data written to ${out}: ${Object.keys(files).join(', ')}`);
  },
};

const sanitizeCommand: Command = {
  name: 'sanitize',
  usage: 'sanitize <captured-dir> <out-dir>',
  description: 'Turn raw captures (--capture-raw) into shareable synthetic fixtures',
  async run(c, args) {
    const [from, to] = args;
    if (!from || !to || from.startsWith('--') || to.startsWith('--')) {
      throw new Error(`Usage: ${this.usage}`);
    }
    const r = await sanitizeDirectory(resolve(c.env.baseDir, from), resolve(c.env.baseDir, to));
    c.logger.info(
      `Sanitized ${r.files} file(s) into ${to}: ${r.emails} e-mails, ${r.ids} IDs, ${r.names} names, ${r.ips} IPs mapped. Review the output before committing.`,
    );
  },
};

const fixtureCommand: Command = {
  name: 'fixture',
  usage: 'fixture [--out <dir>] [--fixtures <dir>]',
  description: 'Run collect, check and dashboard on the fixture tenant (no key needed)',
  async run(c, args) {
    // Default: the gitignored data/fixture/, read by DASHBOARD_DATA_SOURCE=fixtures.
    const out = option(args, '--out') ?? 'data/fixture';
    const fixtureDir = resolve(
      c.env.baseDir,
      option(args, '--fixtures') ?? defaultFixtureDir(c.env.baseDir),
    );
    const files = await writeFixtureTenant(resolve(c.env.baseDir, out), {
      fixtureDir,
      cwd: c.env.baseDir,
      logger: c.logger,
    });
    c.logger.info(`Fixture tenant output written to ${out}: ${Object.keys(files).join(', ')}`);
  },
};

export const COMMANDS = new Registry<Command>((cmd) => cmd.name, 'command').addAll([
  collectCommand,
  checkCommand,
  dashboardCommand,
  detailCommand,
  pipelineCommand,
  reportCommand,
  notifyCommand,
  archiveCommand,
  alertsCommand,
  demoCommand,
  sanitizeCommand,
  fixtureCommand,
]);

export const usage = (): string =>
  [
    'Usage: claude-audit <command>',
    '',
    ...COMMANDS.list().map((cmd) => `  ${cmd.usage.padEnd(58)} ${cmd.description}`),
  ].join('\n');
