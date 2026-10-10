import { resolve } from 'node:path';
import { z } from 'zod';

/** GitHub Actions passes unset secrets as empty strings: treat blank as absent. */
const optional = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().optional(),
);

const envSchema = z.object({
  ANTHROPIC_ENTERPRISE_API_KEY: optional,
  ANTHROPIC_COMPLIANCE_API_KEY: optional,
  ANTHROPIC_ANALYTICS_API_KEY: optional,
  ANTHROPIC_ADMIN_API_KEY: optional,
  ANTHROPIC_CONSOLE_ADMIN_API_KEY: optional,
  ANTHROPIC_BASE_URL: optional,
  CAPTURE_RAW_DIR: optional,
  CI: optional,
  DATA_DIR: optional,
  CONFIG_DIR: optional,
  INIT_CWD: optional,
  DASHBOARD_URL: optional,
  SLACK_WEBHOOK_URL: optional,
  DISCORD_WEBHOOK_URL: optional,
  SMTP_HOST: optional,
  SMTP_PORT: optional,
  SMTP_SECURE: optional,
  SMTP_USER: optional,
  SMTP_PASS: optional,
  ALERT_EMAIL_FROM: optional,
  ALERT_EMAIL_TO: optional,
});

type Env = z.output<typeof envSchema>;

export interface SmtpEnvironment {
  host: string;
  port: number;
  secure: boolean;
  user: string | undefined;
  pass: string | undefined;
  from: string;
  to: string[];
}

export interface KeyFamilyDefinition {
  readonly id: string;
  readonly envVar: string;
  readonly fallbackToEnterprise?: boolean;
}

export const KEY_FAMILIES: KeyFamilyDefinition[] = [
  { id: 'compliance', envVar: 'ANTHROPIC_COMPLIANCE_API_KEY', fallbackToEnterprise: true },
  { id: 'analytics', envVar: 'ANTHROPIC_ANALYTICS_API_KEY', fallbackToEnterprise: true },
  { id: 'admin', envVar: 'ANTHROPIC_ADMIN_API_KEY', fallbackToEnterprise: true },
  { id: 'console', envVar: 'ANTHROPIC_CONSOLE_ADMIN_API_KEY', fallbackToEnterprise: false },
];

export function registerKeyFamily(family: KeyFamilyDefinition): void {
  const existing = KEY_FAMILIES.findIndex((f) => f.id === family.id);
  if (existing >= 0) {
    KEY_FAMILIES[existing] = family;
  } else {
    KEY_FAMILIES.push(family);
  }
}

export interface Environment {
  /** Key per API family; each falls back to ANTHROPIC_ENTERPRISE_API_KEY unless configured otherwise. */
  keys: {
    compliance?: string | undefined;
    analytics?: string | undefined;
    admin?: string | undefined;
    /**
     * Claude Console organization Admin API key (optional sources, B4). Never falls back to the
     * Enterprise key and is not `ANTHROPIC_ADMIN_API_KEY` (the Enterprise admin override).
     */
    console?: string | undefined;
    [familyId: string]: string | undefined;
  };
  baseUrl: string | undefined;
  /** Opt-in raw response capture directory (`CAPTURE_RAW_DIR`; the CLI flag wins). */
  captureRawDir: string | undefined;
  /** The `CI` variable; raw capture refuses to run when it is true. */
  ci: string | undefined;
  /** Directory relative paths resolve against (pnpm's INIT_CWD, else the process cwd). */
  baseDir: string;
  dataDir: string;
  configDir: string;
  dashboardUrl: string | undefined;
  slackWebhookUrl: string | undefined;
  discordWebhookUrl: string | undefined;
  smtp: SmtpEnvironment | null;
}

function smtpFrom(env: Env): SmtpEnvironment | null {
  if (!env.SMTP_HOST || !env.ALERT_EMAIL_TO) return null;
  const port = Number(env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid SMTP_PORT: ${env.SMTP_PORT}`);
  return {
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.ALERT_EMAIL_FROM ?? env.SMTP_USER ?? 'claude-audit@localhost',
    to: env.ALERT_EMAIL_TO.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/**
 * Reads configuration from environment variables only (secrets never live in files).
 * Relative directories resolve against the directory pnpm was started from (`INIT_CWD`),
 * so `pnpm collect` at the repository root writes to `<root>/data`.
 */
const sanitizeSecret = (val: string | undefined): string | undefined =>
  val && val.trim() !== '' ? val.trim() : undefined;

export function readEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Environment {
  const env = envSchema.parse(source);
  const base = env.INIT_CWD ?? cwd;
  const shared = env.ANTHROPIC_ENTERPRISE_API_KEY;
  const keys: Record<string, string | undefined> = {};
  for (const family of KEY_FAMILIES) {
    const fromSchema = (env as Record<string, string | undefined>)[family.envVar];
    const raw = fromSchema !== undefined ? fromSchema : sanitizeSecret(source[family.envVar]);
    keys[family.id] = raw ?? (family.fallbackToEnterprise ? shared : undefined);
  }
  return {
    keys: {
      compliance: keys.compliance,
      analytics: keys.analytics,
      admin: keys.admin,
      console: keys.console,
      ...keys,
    },
    baseUrl: env.ANTHROPIC_BASE_URL,
    captureRawDir: env.CAPTURE_RAW_DIR,
    ci: env.CI,
    baseDir: base,
    dataDir: resolve(base, env.DATA_DIR ?? 'data'),
    configDir: resolve(base, env.CONFIG_DIR ?? 'config'),
    dashboardUrl: env.DASHBOARD_URL,
    slackWebhookUrl: env.SLACK_WEBHOOK_URL,
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL,
    smtp: smtpFrom(env),
  };
}
