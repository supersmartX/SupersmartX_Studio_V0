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
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://studio.supersmartx.com';

interface PaymentEmailData {
  orderId: string;
  plan: string;
  amount: number;
  currency: string;
  customerName: string;
  customerEmail: string;
  billingPeriod: 'monthly' | 'yearly';
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
      return ['Everything in Creator', '4K export quality', 'Batch export (multiple platforms)', 'Priority support'];
    case 'creator_monthly':
    case 'creator_yearly':
      return ['Unlimited video downloads', 'Unlimited recording length', '1080p export quality', 'All platform presets', 'Crop & reframe for each platform'];
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
    case 'creator_monthly': return 'Creator Monthly';
    case 'creator_yearly': return 'Creator Yearly';
    case 'pro_monthly': return 'Pro Monthly';
    case 'pro_yearly': return 'Pro Yearly';
    case 'free': return 'Free';
    default: return plan;
  }
}

function buildUserConfirmationHtml(data: PaymentEmailData): string {
  const price = formatCurrency(data.amount, data.currency);
  const planName = getPlanDisplayName(data.plan);
  const safeName = sanitizeHtml(data.customerName || 'there');
  const safeOrderId = sanitizeHtml(data.orderId);
  const renewalDate = new Date();
  if (data.billingPeriod === 'monthly') {
    renewalDate.setMonth(renewalDate.getMonth() + 1);
  } else {
    renewalDate.setFullYear(renewalDate.getFullYear() + 1);
  }
  const renewalStr = renewalDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

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
                  <td style="padding:4px 0;font-size:13px;color:#71717a;">Billing</td>
                  <td style="padding:4px 0;font-size:13px;color:#ffffff;text-align:right;">${data.billingPeriod === 'monthly' ? 'Monthly' : 'Annually'}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:13px;color:#71717a;">Order ID</td>
                  <td style="padding:4px 0;font-size:12px;color:#a1a1aa;text-align:right;font-family:monospace;">${safeOrderId}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:13px;color:#71717a;">Next billing</td>
                  <td style="padding:4px 0;font-size:13px;color:#ffffff;text-align:right;">${sanitizeHtml(renewalStr)}</td>
                </tr>
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
  return `Payment Successful\n\nHi ${data.customerName || 'there'},\n\nYour ${planName} subscription is now active.\n\nAmount: ${price}\nOrder ID: ${data.orderId}\n\nOpen SupersmartX Studio: ${APP_URL}/studio\n\nQuestions? Reply to this email or contact ${ADMIN_EMAIL}`;
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

    console.log(`Confirmation email sent to ${data.customerEmail} for order ${data.orderId}`);
    return true;
  } catch (error) {
    console.error('Failed to send confirmation email:', error);
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

    console.log(`Admin notification sent for order ${data.orderId}`);
    return true;
  } catch (error) {
    console.error('Failed to send admin notification:', error);
    return false;
  }
}
