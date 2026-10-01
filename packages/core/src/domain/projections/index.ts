import { credentialUsageProjection } from './credential-usage.js';
import type { Projection } from './projection.js';

export type { Projection } from './projection.js';
export { credentialUsageProjection } from './credential-usage.js';

/** Registered projections, applied after every collection in this order. */
export const BUILTIN_PROJECTIONS: readonly Projection[] = [credentialUsageProjection];
