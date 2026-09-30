import { z } from 'zod';

const envSchema = z.object({
  ANTHROPIC_ADMIN_API_KEY: z.string().min(1),
  ANTHROPIC_COMPLIANCE_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_ORGANIZATION_ID: z.string().min(1).optional(),
  DATA_DIR: z.string().min(1).default('data'),
});

export interface CollectorConfig {
  adminApiKey: string;
  /** Activities are skipped when no Compliance Access Key is configured. */
  complianceApiKey: string | undefined;
  organizationId: string | undefined;
  dataDir: string;
}

/** Load configuration from environment variables only (no secrets in files). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration: ${problems.join('; ')}`);
  }
  return {
    adminApiKey: parsed.data.ANTHROPIC_ADMIN_API_KEY,
    complianceApiKey: parsed.data.ANTHROPIC_COMPLIANCE_API_KEY,
    organizationId: parsed.data.ANTHROPIC_ORGANIZATION_ID,
    dataDir: parsed.data.DATA_DIR,
  };
}
