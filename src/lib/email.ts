import { Resend } from 'resend';

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (resend) return resend;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  resend = new Resend(apiKey);
  return resend;
}

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'SupersmartX Studio <noreply@supersmartx.com>';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'support@supersmartx.com';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.supersmartx.com';

interface PaymentEmailData {
  orderId: string;
  plan: string;
  amount: number;
  currency: string;
  customerName: string;
  customerEmail: string;
  billingPeriod: 'monthly' | 'yearly';
  /**
   * The expiry actually stored on the account when the receipt is built
   * (ISO-8601). Rendered verbatim; never recomputed from the send time, which
   * would disagree with the entitlement on a renewal or a retried send.
   */
  accessUntil?: string | null;
  nextChargeAt?: string | null;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function sanitizeAttr(str: string): string {
  return str.replace(/[<>"'&]/g, '').trim().slice(0, 200);
}

function getPlanFeatures(plan: string): string[] {
  switch (plan) {
    case 'pro_monthly':
    case 'pro_yearly':
    case 'creator_monthly':
    case 'creator_yearly':
      return ['Unlimited recording duration and sessions', 'Unlimited teleprompter', 'Unlimited exports by count & downloads; each file is limited to 2 GiB (about 28 min at current 1080p settings)', 'All supported platform formats', '1080p with no watermark', 'Voice-activated teleprompter', 'Cloud video library'];
    default:
      return [];
  }
}

const ZERO_DECIMAL_CURRENCIES = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

function minorUnitScale(currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 1;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 1000;
  return 100;
}

function formatCurrency(amount: number, currency: string): string {
  const major = amount / minorUnitScale(currency);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2)}`;
  }
}

function getPlanDisplayName(plan: string): string {
  switch (plan) {
    case 'creator_monthly': return 'Creator (1 month)';
    case 'creator_yearly': return 'Creator (1 year)';
    case 'pro_monthly': return 'Creator (1 month)';
    case 'pro_yearly': return 'Creator (1 year)';
    case 'free': return 'Free';
    default: return plan;
  }
}

/**
 * Renders a stored expiry as the receipt's "Access until" date.
 *
 * UTC on purpose: the expiry is a UTC instant, so formatting it in the
 * server's local zone could print the previous day for an account that expires
 * just after midnight UTC. Returns null for a missing/invalid value so the
 * receipt omits the row instead of inventing a date.
 */
export function formatAccessUntil(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function buildUserConfirmationHtml(data: PaymentEmailData): string {
  const price = formatCurrency(data.amount, data.currency);
  const planName = getPlanDisplayName(data.plan);
  const safeName = sanitizeHtml(data.customerName || 'there');
  const safeOrderId = sanitizeHtml(data.orderId);
  const accessUntilStr = formatAccessUntil(data.accessUntil);
  const nextChargeAtStr = formatAccessUntil(data.nextChargeAt);

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#12121a;border-radius:16px;border:1px solid #1e1e2e;overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:32px 32px 24px;border-bottom:1px solid #1e1e2e;">
          <h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">SupersmartX Studio</h1>
          <p style="margin:8px 0 0;font-size:14px;color:#a1a1aa;">Payment Confirmation</p>
        </td></tr>

        <!-- Success Icon -->
        <tr><td style="padding:32px 32px 0;text-align:center;">
          <div style="width:56px;height:56px;border-radius:50%;background-color:#22c55e20;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;">
            <span style="font-size:28px;">&#10003;</span>
          </div>
          <h2 style="margin:0;font-size:18px;font-weight:600;color:#ffffff;">Payment Successful</h2>
          <p style="margin:8px 0 0;font-size:14px;color:#a1a1aa;">Thank you, ${safeName}!</p>
        </td></tr>

        <!-- Receipt -->
        <tr><td style="padding:24px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a1a26;border-radius:12px;border:1px solid #1e1e2e;">
            <tr><td style="padding:20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:4px 0;font-size:13px;color:#71717a;">Plan</td>
                  <td style="padding:4px 0;font-size:13px;color:#ffffff;text-align:right;font-weight:600;">${sanitizeHtml(planName)}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:13px;color:#71717a;">Amount</td>
                  <td style="padding:4px 0;font-size:13px;color:#22c55e;text-align:right;font-weight:700;">${sanitizeHtml(price)}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:13px;color:#71717a;">Access term</td>
                  <td style="padding:4px 0;font-size:13px;color:#ffffff;text-align:right;">${data.billingPeriod === 'monthly' ? '1 month' : '1 year'}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:13px;color:#71717a;">Order ID</td>
                  <td style="padding:4px 0;font-size:12px;color:#a1a1aa;text-align:right;font-family:monospace;">${safeOrderId}</td>
                </tr>
                ${accessUntilStr ? `<tr>
                  <td style="padding:4px 0;font-size:13px;color:#71717a;">Access until</td>
                  <td style="padding:4px 0;font-size:13px;color:#ffffff;text-align:right;">${sanitizeHtml(accessUntilStr)}</td>
                </tr>` : ''}
                ${nextChargeAtStr ? `<tr>
                  <td style="padding:4px 0;font-size:13px;color:#71717a;">Next billing date</td>
                  <td style="padding:4px 0;font-size:13px;color:#ffffff;text-align:right;">${sanitizeHtml(nextChargeAtStr)}</td>
                </tr>` : ''}
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- Plan Features -->
        <tr><td style="padding:0 32px 24px;">
          <p style="margin:0 0 12px;font-size:13px;color:#a1a1aa;font-weight:600;">Your ${sanitizeHtml(planName)} plan includes:</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${getPlanFeatures(data.plan).map(f =>
              `<tr><td style="padding:4px 0;font-size:13px;color:#a1a1aa;">&#10003; ${f}</td></tr>`
            ).join('')}
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="padding:0 32px 32px;">
          <a href="${APP_URL}/studio" style="display:block;width:100%;padding:14px;background-color:#7C3AED;color:#ffffff;text-align:center;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;">Open SupersmartX Studio</a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 32px;border-top:1px solid #1e1e2e;">
          <p style="margin:0;font-size:11px;color:#52525b;text-align:center;">
            This is your SupersmartX Studio payment confirmation. Paddle sends your official invoice separately.<br>
            Questions? Reply to this email or contact <a href="mailto:${sanitizeAttr(ADMIN_EMAIL)}" style="color:#7C3AED;">${sanitizeHtml(ADMIN_EMAIL)}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildAdminNotificationHtml(data: PaymentEmailData): string {
  const price = formatCurrency(data.amount, data.currency);
  const planName = getPlanDisplayName(data.plan);
  const safeName = sanitizeHtml(data.customerName || 'N/A');
  const safeEmail = sanitizeHtml(data.customerEmail);
  const safeOrderId = sanitizeHtml(data.orderId);

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#12121a;border-radius:16px;border:1px solid #1e1e2e;overflow:hidden;">
        <tr><td style="padding:24px 32px;border-bottom:1px solid #1e1e2e;">
          <h1 style="margin:0;font-size:16px;font-weight:700;color:#22c55e;">New Payment Received</h1>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#71717a;">Customer</td>
              <td style="padding:6px 0;font-size:13px;color:#ffffff;text-align:right;">${safeName} (${safeEmail})</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#71717a;">Plan</td>
              <td style="padding:6px 0;font-size:13px;color:#ffffff;text-align:right;font-weight:600;">${sanitizeHtml(planName)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#71717a;">Amount</td>
              <td style="padding:6px 0;font-size:14px;color:#22c55e;text-align:right;font-weight:700;">${sanitizeHtml(price)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#71717a;">Order ID</td>
              <td style="padding:6px 0;font-size:12px;color:#a1a1aa;text-align:right;font-family:monospace;">${safeOrderId}</td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildUserConfirmationText(data: PaymentEmailData): string {
  const price = formatCurrency(data.amount, data.currency);
  const planName = getPlanDisplayName(data.plan);
  const accessUntilStr = formatAccessUntil(data.accessUntil);
  const nextChargeAtStr = formatAccessUntil(data.nextChargeAt);
  return `Payment Successful\n\nHi ${data.customerName || 'there'},\n\nYour ${planName} subscription payment is confirmed and your access is active.\n\nAmount: ${price}\nOrder ID: ${data.orderId}\n${accessUntilStr ? `Access until: ${accessUntilStr}\n` : ''}${nextChargeAtStr ? `Next billing date: ${nextChargeAtStr}\n` : ''}\nPaddle will email your official invoice separately. Manage your subscription from your Studio account.\n\nOpen SupersmartX Studio: ${APP_URL}/studio\n\nQuestions? Reply to this email or contact ${ADMIN_EMAIL}`;
}

function buildAdminNotificationText(data: PaymentEmailData): string {
  const price = formatCurrency(data.amount, data.currency);
  const planName = getPlanDisplayName(data.plan);
  return `New Payment Received\n\nCustomer: ${data.customerName || 'N/A'} (${data.customerEmail})\nPlan: ${planName}\nAmount: ${price}\nOrder ID: ${data.orderId}`;
}

export async function sendPaymentConfirmationEmail(data: PaymentEmailData): Promise<boolean> {
  try {
    const client = getResend();
    if (!client) {
      console.warn('Resend API key not configured, skipping confirmation email');
      return false;
    }

    const planName = getPlanDisplayName(data.plan);

    await client.emails.send({
      from: FROM_EMAIL,
      to: data.customerEmail,
      subject: `Payment confirmed — ${planName} | SupersmartX Studio`,
      html: buildUserConfirmationHtml(data),
      text: buildUserConfirmationText(data),
    });

    return true;
  } catch (error) {
    console.error('Failed to send confirmation email:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

/**
 * Operator alert for a billing condition that needs a human: a paid order that
 * could not be applied, or a termination Paddle has not confirmed.
 *
 * Deliberately separate from `sendAdminNotification`, which is payment-shaped
 * (it formats an amount and a plan and is only sent on a new payment). Returns
 * false rather than throwing: the caller dedupes through `order_notifications`
 * and releases the claim on failure so a later pass can retry.
 */
export async function sendBillingOpsAlert(data: {
  subject: string;
  lines: string[];
}): Promise<boolean> {
  try {
    const client = getResend();
    if (!client) {
      console.warn('Resend API key not configured, skipping billing ops alert');
      return false;
    }
    const text = `${data.lines.join('\n')}\n\nSupersmartX Studio billing operations`;
    const html = `<div style="font-family:system-ui,sans-serif;line-height:1.5">
      <h2 style="margin:0 0 12px">${sanitizeHtml(data.subject)}</h2>
      ${data.lines.map((line) => `<p style="margin:0 0 8px">${sanitizeHtml(line)}</p>`).join('')}
      <p style="margin-top:16px;color:#666">SupersmartX Studio billing operations</p>
    </div>`;

    await client.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `[Billing] ${data.subject}`,
      html,
      text,
    });
    return true;
  } catch (error) {
    console.error('Failed to send billing ops alert:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

export async function sendAdminNotification(data: PaymentEmailData): Promise<boolean> {
  try {
    const client = getResend();
    if (!client) {
      console.warn('Resend API key not configured, skipping admin notification');
      return false;
    }

    const price = formatCurrency(data.amount, data.currency);
    const planName = getPlanDisplayName(data.plan);

    await client.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `💰 New payment: ${price} — ${planName} | SupersmartX Studio`,
      html: buildAdminNotificationHtml(data),
      text: buildAdminNotificationText(data),
    });

    return true;
  } catch (error) {
    console.error('Failed to send admin notification:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

export type BillingLifecycleKind =
  | 'payment_failed'
  | 'cancel_scheduled'
  | 'refund_issued'
  | 'dispute_filed';

export interface BillingLifecycleEmailData {
  kind: BillingLifecycleKind;
  customerEmail: string;
  customerName?: string | null;
  plan?: string | null;
  amount?: number | null;
  currency?: string | null;
  reference?: string | null;
  accessUntil?: string | null;
  nextChargeAt?: string | null;
}

const LIFECYCLE_COPY: Record<BillingLifecycleKind, {
  subject: string;
  heading: string;
  intro: string;
  action: string;
}> = {
  payment_failed: {
    subject: 'Action needed: your subscription payment did not go through',
    heading: 'Your payment needs attention',
    intro: 'We could not collect the latest payment for your SupersmartX Studio subscription. Your access is unchanged while Paddle retries the charge.',
    action: 'Update your payment method from the billing page to avoid losing access:',
  },
  cancel_scheduled: {
    subject: 'Your SupersmartX Studio subscription is canceled',
    heading: 'Your subscription is canceled',
    intro: 'Your recurring subscription will not renew. You keep access until the end of the period you already paid for, and you will not be charged again.',
    action: 'You can resubscribe at any time from your Studio account:',
  },
  refund_issued: {
    subject: 'Your SupersmartX Studio refund was issued',
    heading: 'Your refund was issued',
    intro: 'Paddle approved a refund for your SupersmartX Studio payment. Refunds usually appear on your statement within 5–10 business days.',
    action: 'Your billing history is available here:',
  },
  dispute_filed: {
    subject: 'A payment dispute was opened for your SupersmartX Studio subscription',
    heading: 'A payment dispute was opened',
    intro: 'A chargeback was opened for your SupersmartX Studio payment. Access may be suspended while the card issuer reviews the dispute.',
    action: 'If this was not you, or you need help, contact support:',
  },
};

function buildLifecycleHtml(data: BillingLifecycleEmailData): string {
  const copy = LIFECYCLE_COPY[data.kind];
  const safeName = sanitizeHtml(data.customerName || 'there');
  const amount = data.amount !== null && data.amount !== undefined && data.currency
    ? formatCurrency(data.amount, data.currency)
    : null;
  const reference = data.reference ? sanitizeHtml(data.reference) : null;
  const accessUntil = formatAccessUntil(data.accessUntil);
  const nextChargeAt = formatAccessUntil(data.nextChargeAt);
  const link = data.kind === 'dispute_filed'
    ? `mailto:${sanitizeAttr(ADMIN_EMAIL)}`
    : `${APP_URL}/billing`;

  const rows = [
    data.plan ? `<tr><td style="padding:4px 0;font-size:13px;color:#71717a;">Plan</td><td style="padding:4px 0;font-size:13px;color:#ffffff;text-align:right;">${sanitizeHtml(getPlanDisplayName(data.plan))}</td></tr>` : '',
    amount ? `<tr><td style="padding:4px 0;font-size:13px;color:#71717a;">Amount</td><td style="padding:4px 0;font-size:13px;color:#ffffff;text-align:right;font-weight:600;">${sanitizeHtml(amount)}</td></tr>` : '',
    accessUntil ? `<tr><td style="padding:4px 0;font-size:13px;color:#71717a;">Access until</td><td style="padding:4px 0;font-size:13px;color:#ffffff;text-align:right;">${sanitizeHtml(accessUntil)}</td></tr>` : '',
    nextChargeAt ? `<tr><td style="padding:4px 0;font-size:13px;color:#71717a;">Next billing date</td><td style="padding:4px 0;font-size:13px;color:#ffffff;text-align:right;">${sanitizeHtml(nextChargeAt)}</td></tr>` : '',
    reference ? `<tr><td style="padding:4px 0;font-size:13px;color:#71717a;">Reference</td><td style="padding:4px 0;font-size:12px;color:#a1a1aa;text-align:right;font-family:monospace;">${reference}</td></tr>` : '',
  ].join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#12121a;border-radius:16px;border:1px solid #1e1e2e;overflow:hidden;">
        <tr><td style="padding:32px 32px 24px;border-bottom:1px solid #1e1e2e;">
          <h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">SupersmartX Studio</h1>
          <p style="margin:8px 0 0;font-size:14px;color:#a1a1aa;">Billing update</p>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#ffffff;">${sanitizeHtml(copy.heading)}</h2>
          <p style="margin:0 0 16px;font-size:14px;color:#a1a1aa;">Hi ${safeName},</p>
          <p style="margin:0 0 16px;font-size:14px;color:#a1a1aa;">${sanitizeHtml(copy.intro)}</p>
          ${rows ? `<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a1a26;border-radius:12px;border:1px solid #1e1e2e;margin-bottom:16px;"><tr><td style="padding:16px 20px;"><table width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table>` : ''}
          <p style="margin:0 0 8px;font-size:14px;color:#a1a1aa;">${sanitizeHtml(copy.action)}</p>
          <a href="${sanitizeAttr(link)}" style="display:block;width:100%;padding:14px;background-color:#7C3AED;color:#ffffff;text-align:center;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;">${data.kind === 'dispute_filed' ? 'Contact support' : data.kind === 'payment_failed' ? 'Update payment method' : 'Open billing history'}</a>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #1e1e2e;">
          <p style="margin:0;font-size:11px;color:#52525b;text-align:center;">
            Paddle processes your payment and sends the official invoice. Questions? Contact <a href="mailto:${sanitizeAttr(ADMIN_EMAIL)}" style="color:#7C3AED;">${sanitizeHtml(ADMIN_EMAIL)}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildLifecycleText(data: BillingLifecycleEmailData): string {
  const copy = LIFECYCLE_COPY[data.kind];
  const amount = data.amount !== null && data.amount !== undefined && data.currency
    ? formatCurrency(data.amount, data.currency)
    : null;
  const accessUntil = formatAccessUntil(data.accessUntil);
  const nextChargeAt = formatAccessUntil(data.nextChargeAt);
  const link = data.kind === 'dispute_filed' ? ADMIN_EMAIL : `${APP_URL}/billing`;
  return [
    copy.heading,
    '',
    `Hi ${data.customerName || 'there'},`,
    '',
    copy.intro,
    data.plan ? `Plan: ${getPlanDisplayName(data.plan)}` : '',
    amount ? `Amount: ${amount}` : '',
    accessUntil ? `Access until: ${accessUntil}` : '',
    nextChargeAt ? `Next billing date: ${nextChargeAt}` : '',
    data.reference ? `Reference: ${data.reference}` : '',
    '',
    copy.action,
    link,
    '',
    `Questions? Contact ${ADMIN_EMAIL}`,
  ].filter((line) => line !== '').join('\n');
}

/**
 * Customer-facing lifecycle notice. Deliberately separate from the payment
 * confirmation: these are sent for events Paddle does not reliably email
 * (failed retries, cancellations, refunds, disputes), and the customer needs a
 * plain-language explanation plus a route back to billing.
 *
 * Returns false rather than throwing. The worker dedupes with
 * `order_notifications` and releases the claim on failure so a later retry can
 * resend.
 */
export async function sendBillingLifecycleEmail(data: BillingLifecycleEmailData): Promise<boolean> {
  try {
    const client = getResend();
    if (!client) {
      console.warn('Resend API key not configured, skipping billing lifecycle email');
      return false;
    }
    const copy = LIFECYCLE_COPY[data.kind];
    const result = await client.emails.send({
      from: FROM_EMAIL,
      to: data.customerEmail,
      subject: `${copy.subject} | SupersmartX Studio`,
      html: buildLifecycleHtml(data),
      text: buildLifecycleText(data),
    });
    if (result && (result as { error?: unknown }).error) {
      console.error('Failed to send billing lifecycle email:', (result as { error?: unknown }).error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Failed to send billing lifecycle email:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}
