import type { Rule } from '../define-rule.js';
import { accessControlRules } from './access-control.js';
import { credentialRules } from './credentials.js';
import { governanceRules } from './governance.js';
import { operationalRules } from './operational.js';
import { usageRules } from './usage.js';

/** Rules implemented in code. Data-driven rules (CF / AM) are built in `../catalog.ts`. */
export const BUILTIN_RULES: readonly Rule[] = [
  ...accessControlRules,
  ...credentialRules,
  ...usageRules,
  ...governanceRules,
  ...operationalRules,
];
