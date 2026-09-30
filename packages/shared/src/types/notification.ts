/**
 * Notification and alerting types
 */

/** Supported notification channels */
export type NotificationChannel = 'slack' | 'discord' | 'email';

/** Notification priority levels */
export type NotificationPriority = 'urgent' | 'high' | 'normal' | 'low';

/** A notification to be sent */
export interface Notification {
  id: string;
  channel: NotificationChannel;
  priority: NotificationPriority;
  title: string;
  body: string;
  fields: NotificationField[];
  timestamp: string;
  source: 'compliance-check' | 'usage-alert' | 'weekly-report' | 'system';
  metadata: Record<string, unknown>;
}

/** Key-value field in a notification */
export interface NotificationField {
  name: string;
  value: string;
  inline?: boolean;
}

/** Notification channel configuration */
export interface ChannelConfig {
  channel: NotificationChannel;
  enabled: boolean;
  config: SlackConfig | DiscordConfig | EmailConfig;
}

/** Slack webhook configuration */
export interface SlackConfig {
  webhook_url: string;
  channel?: string;
  username?: string;
  icon_emoji?: string;
}

/** Discord webhook configuration */
export interface DiscordConfig {
  webhook_url: string;
  username?: string;
  avatar_url?: string;
}

/** Email (SMTP) configuration */
export interface EmailConfig {
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
  from: string;
  to: string[];
  cc?: string[];
}

/** Alert rule definition */
export interface AlertRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  condition: AlertCondition;
  channels: NotificationChannel[];
  priority: NotificationPriority;
  cooldown_minutes: number;
  last_triggered_at: string | null;
}

/** Condition for triggering an alert */
export interface AlertCondition {
  type: 'threshold' | 'anomaly' | 'compliance_failure' | 'pattern';
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'ne';
  value: number | string;
  window_minutes?: number;
}
