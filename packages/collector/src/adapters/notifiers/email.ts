import type { AlertMessage, Notifier } from '@claude-audit/core';
import { createTransport } from 'nodemailer';
import { escapeHtml, toHtml } from '../renderers/html.js';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string | undefined;
  pass?: string | undefined;
  from: string;
  to: string[];
}

export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

const htmlBody = (alert: AlertMessage): string =>
  alert.document
    ? toHtml(alert.document)
    : `<ul>${alert.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` +
      (alert.link ? `<p><a href="${escapeHtml(alert.link)}">Open the audit dashboard</a></p>` : '');

export const smtpTransport = (smtp: SmtpSettings): MailTransport =>
  createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.pass ?? '' } } : {}),
  });

/** SMTP e-mail with a text and an HTML part (full report when the alert carries a document). */
export const emailNotifier = (
  smtp: SmtpSettings,
  transport: MailTransport = smtpTransport(smtp),
): Notifier => ({
  id: 'email',
  send: async (alert) => {
    await transport.sendMail({
      from: smtp.from,
      to: smtp.to,
      subject: alert.title,
      text: [...alert.lines, ...(alert.link ? ['', alert.link] : [])].join('\n'),
      html: htmlBody(alert),
    });
  },
});
