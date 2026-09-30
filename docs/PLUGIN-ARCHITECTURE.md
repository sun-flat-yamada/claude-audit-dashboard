# Plugin Architecture — Alert & Compliance Rule Extensibility

> **Goal:** Allow users to add custom alert triggers, compliance rules, and notification channels without modifying core code.

---

## Design Principles

1. **Registry Pattern** — All plugins are registered via a central registry. Core code iterates the registry; it never hardcodes implementations.
2. **Interface-First** — Every plugin type has a strict TypeScript interface. Plugins must implement it.
3. **Zero Core Modification** — Adding a new alert trigger or compliance rule requires NO changes to core orchestration code.
4. **Convention over Configuration** — Plugins are auto-discovered from conventional file paths.
5. **Isolated Side Effects** — Each plugin manages its own resources (API clients, connections).

---

## Plugin Types

### 1. Compliance Rule Plugin

```typescript
// packages/shared/src/types/plugin.ts

export interface ComplianceRulePlugin {
  /** Unique rule ID (e.g., 'AC-001', 'CUSTOM-001') */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Rule description */
  readonly description: string;
  /** Category for grouping */
  readonly category: ComplianceCategory;
  /** Default severity */
  readonly severity: Severity;
  /** Configurable parameters with defaults */
  readonly defaultParams: Record<string, unknown>;

  /**
   * Execute the compliance check against the current snapshot.
   * @param snapshot - Current audit data snapshot
   * @param params - Merged default + user-overridden parameters
   * @returns One or more check results
   */
  check(
    snapshot: AuditSnapshot,
    params: Record<string, unknown>,
  ): Promise<ComplianceCheckResult[]>;
}
```

### 2. Alert Trigger Plugin

```typescript
export interface AlertTriggerPlugin {
  /** Unique trigger ID */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Description of what this trigger detects */
  readonly description: string;
  /** Default priority */
  readonly defaultPriority: NotificationPriority;
  /** Channels this trigger should notify (default) */
  readonly defaultChannels: NotificationChannel[];
  /** Cooldown in minutes to avoid alert storms */
  readonly cooldownMinutes: number;

  /**
   * Evaluate the trigger condition.
   * @param context - Current and historical data for evaluation
   * @returns Alert notifications to send, or empty array if no alert
   */
  evaluate(
    context: AlertContext,
  ): Promise<Notification[]>;
}

export interface AlertContext {
  currentSnapshot: AuditSnapshot;
  previousSnapshot: AuditSnapshot | null;
  complianceReport: ComplianceReport;
  collectorState: CollectorState;
  config: Record<string, unknown>;
}
```

### 3. Notification Channel Plugin

```typescript
export interface NotificationChannelPlugin {
  /** Channel identifier (e.g., 'slack', 'discord', 'email', 'teams') */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;

  /**
   * Initialize the channel (validate config, establish connections).
   * Called once during startup.
   */
  initialize(config: Record<string, unknown>): Promise<void>;

  /**
   * Send a notification through this channel.
   */
  send(notification: Notification): Promise<void>;

  /**
   * Cleanup resources on shutdown.
   */
  destroy(): Promise<void>;
}
```

---

## Plugin Registry

```typescript
// packages/collector/src/plugins/registry.ts

export class PluginRegistry {
  private complianceRules = new Map<string, ComplianceRulePlugin>();
  private alertTriggers = new Map<string, AlertTriggerPlugin>();
  private notificationChannels = new Map<string, NotificationChannelPlugin>();

  /** Register a compliance rule plugin */
  registerRule(plugin: ComplianceRulePlugin): void {
    if (this.complianceRules.has(plugin.id)) {
      throw new Error(`Duplicate rule ID: ${plugin.id}`);
    }
    this.complianceRules.set(plugin.id, plugin);
  }

  /** Register an alert trigger plugin */
  registerTrigger(plugin: AlertTriggerPlugin): void {
    if (this.alertTriggers.has(plugin.id)) {
      throw new Error(`Duplicate trigger ID: ${plugin.id}`);
    }
    this.alertTriggers.set(plugin.id, plugin);
  }

  /** Register a notification channel plugin */
  registerChannel(plugin: NotificationChannelPlugin): void {
    if (this.notificationChannels.has(plugin.id)) {
      throw new Error(`Duplicate channel ID: ${plugin.id}`);
    }
    this.notificationChannels.set(plugin.id, plugin);
  }

  /** Get all registered rules */
  getRules(): ComplianceRulePlugin[] {
    return [...this.complianceRules.values()];
  }

  /** Get enabled rules based on config */
  getEnabledRules(enabledIds: string[]): ComplianceRulePlugin[] {
    return enabledIds
      .map((id) => this.complianceRules.get(id))
      .filter((r): r is ComplianceRulePlugin => r !== undefined);
  }

  /** Get all registered triggers */
  getTriggers(): AlertTriggerPlugin[] {
    return [...this.alertTriggers.values()];
  }

  /** Get all registered channels */
  getChannels(): NotificationChannelPlugin[] {
    return [...this.notificationChannels.values()];
  }
}

// Singleton instance
export const registry = new PluginRegistry();
```

---

## Auto-Discovery

Plugins are loaded from conventional directories:

```
packages/collector/src/
├── plugins/
│   ├── registry.ts                 # Central registry
│   ├── loader.ts                   # Auto-discovery & loading
│   └── index.ts                    # Re-exports
├── rules/                          # Built-in compliance rules
│   ├── ac-001-inactive-members.ts
│   ├── ac-002-excessive-admins.ts
│   ├── ac-003-primary-owner.ts
│   ├── ak-001-unused-api-keys.ts
│   ├── ak-002-unscoped-api-keys.ts
│   ├── ak-003-api-key-age.ts
│   ├── ua-001-usage-spike.ts
│   ├── ua-002-cost-budget.ts
│   ├── dg-001-empty-workspaces.ts
│   ├── op-001-collection-freshness.ts
│   └── index.ts                    # Registers all built-in rules
├── triggers/                       # Built-in alert triggers
│   ├── compliance-failure.ts
│   ├── usage-spike.ts
│   ├── budget-exceeded.ts
│   ├── collection-failure.ts
│   └── index.ts                    # Registers all built-in triggers
├── channels/                       # Built-in notification channels
│   ├── slack.ts
│   ├── discord.ts
│   ├── email.ts
│   └── index.ts                    # Registers all built-in channels
└── custom/                         # User custom plugins (gitignored)
    └── README.md                   # Instructions for adding custom plugins
```

### Loader Pattern

```typescript
// packages/collector/src/plugins/loader.ts

import { registry } from './registry.js';

// 1. Load built-in plugins
import '../rules/index.js';       // Registers all built-in rules
import '../triggers/index.js';    // Registers all built-in triggers
import '../channels/index.js';    // Registers all built-in channels

// 2. Load custom plugins from config
export async function loadCustomPlugins(configPath: string): Promise<void> {
  // Read custom-rules.json
  // Dynamically import and register custom plugins
}

// 3. Export loaded registry
export { registry };
```

---

## Adding a New Plugin (User Guide)

### Adding a Custom Compliance Rule

```typescript
// packages/collector/src/custom/my-custom-rule.ts

import type { ComplianceRulePlugin } from '@claude-audit/shared';
import { registry } from '../plugins/registry.js';

const myRule: ComplianceRulePlugin = {
  id: 'CUSTOM-001',
  name: 'Maximum Members',
  description: 'Warn if organization exceeds member limit',
  category: 'access-control',
  severity: 'medium',
  defaultParams: { maxMembers: 100 },

  async check(snapshot, params) {
    const max = params.maxMembers as number;
    const count = snapshot.members.length;
    return [{
      rule_id: 'CUSTOM-001',
      rule_name: 'Maximum Members',
      status: count > max ? 'fail' : 'pass',
      severity: 'medium',
      category: 'access-control',
      message: `Organization has ${count} members (limit: ${max})`,
      details: { count, max },
      evidence: [],
      remediation: count > max ? 'Review and remove unused accounts' : null,
      checked_at: new Date().toISOString(),
    }];
  },
};

// Self-registering
registry.registerRule(myRule);
```

### Adding a Custom Alert Trigger

```typescript
// packages/collector/src/custom/my-alert-trigger.ts

import type { AlertTriggerPlugin } from '@claude-audit/shared';
import { registry } from '../plugins/registry.js';

const myTrigger: AlertTriggerPlugin = {
  id: 'CUSTOM-ALERT-001',
  name: 'New Admin Added',
  description: 'Alert when a new admin role is assigned',
  defaultPriority: 'high',
  defaultChannels: ['slack', 'email'],
  cooldownMinutes: 0, // No cooldown — always alert

  async evaluate(context) {
    const adminEvents = context.currentSnapshot.activities.filter(
      (a) => a.type === 'member.role_changed' &&
             a.details?.new_role === 'admin'
    );

    return adminEvents.map((event) => ({
      id: `alert-${event.id}`,
      channel: 'slack', // Will be dispatched to all defaultChannels
      priority: 'high',
      title: '🔔 New Admin Role Assigned',
      body: `${event.actor.name} promoted ${event.target?.name} to admin`,
      fields: [],
      timestamp: event.timestamp,
      source: 'compliance-check',
      metadata: { event_id: event.id },
    }));
  },
};

registry.registerTrigger(myTrigger);
```

---

## Complexity Guarantee

The plugin system ensures:

| Concern | Complexity |
|---------|------------|
| Adding a new rule | **O(1)** — one file, self-registering |
| Adding a new trigger | **O(1)** — one file, self-registering |
| Adding a new channel | **O(1)** — one file, self-registering |
| Core orchestration changes | **O(0)** — never needed |
| Type safety | Compile-time — TypeScript interfaces |
| Testing | Unit-testable in isolation |

No `switch` statements, no `if/else` chains, no modification of existing files.
The Registry Pattern + self-registration ensures **additive-only extensibility**.
