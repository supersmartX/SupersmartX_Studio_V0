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

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
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
            This is a receipt for your payment. No further action is required.<br>
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
        <tr><td style="padding:0 32px 24px;">
          <a href="https://dashboard.cashfree.com/app/orders" style="display:block;width:100%;padding:12px;background-color:#1e1e2e;color:#ffffff;text-align:center;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">View in Cashfree Dashboard</a>
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
  return `Payment Successful\n\nHi ${data.customerName || 'there'},\n\nYour ${planName} access is now active for the purchased term.\n\nAmount: ${price}\nOrder ID: ${data.orderId}\n${accessUntilStr ? `Access until: ${accessUntilStr}\n` : ''}\nAccess ends at the end of the purchased term. There is no automatic renewal.\n\nOpen SupersmartX Studio: ${APP_URL}/studio\n\nQuestions? Reply to this email or contact ${ADMIN_EMAIL}`;
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
 * could not be applied, or a termination Cashfree has not confirmed.
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
