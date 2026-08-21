import { NextRequest, NextResponse } from 'next/server';
import { findUserByEmail } from '@/auth';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';
import { Resend } from 'resend';

const DATA_DIR = join(process.cwd(), 'data');
const TOKENS_FILE = join(DATA_DIR, 'reset-tokens.json');
const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

interface ResetToken {
  tokenHash: string;
  email: string;
  expiresAt: string;
}

function getTokens(): ResetToken[] {
  try {
    if (!existsSync(TOKENS_FILE)) return [];
    return JSON.parse(readFileSync(TOKENS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveTokens(tokens: ResetToken[]) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }

    const user = findUserByEmail(email);
    if (!user) {
      // Don't reveal whether user exists
      return NextResponse.json({ ok: true });
    }

    // Generate token
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    // Save token
    const tokens = getTokens().filter((t) => t.email !== email);
    tokens.push({
      tokenHash,
      email,
      expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString(),
    });
    saveTokens(tokens);

    // Send email
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'SupersmartX Studio <noreply@supersmartx.com>';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://studio.supersmartx.com';
    const resetUrl = `${appUrl}/auth/reset-password?token=${rawToken}`;

    if (!apiKey) {
      console.error('RESEND_API_KEY is not set — cannot send password reset email');
      return NextResponse.json({ success: true, message: 'If an account exists, a reset email was sent.' }, { status: 200 });
    }

    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: 'Reset your password — SupersmartX Studio',
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="margin:0;padding:0;background-color:#09090B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#09090B;padding:40px 20px;">
            <tr><td align="center">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#111113;border-radius:16px;border:1px solid rgba(255,255,255,0.06);overflow:hidden;">
                <tr><td style="padding:32px;text-align:center;">
                  <h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ffffff;">Reset your password</h1>
                  <p style="margin:0 0 24px;font-size:14px;color:rgba(255,255,255,0.4);">Click the button below to set a new password. This link expires in 1 hour.</p>
                  <a href="${resetUrl}" style="display:inline-block;padding:14px 32px;background-color:#7C3AED;color:#ffffff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;">Reset Password</a>
                  <p style="margin:24px 0 0;font-size:12px;color:rgba(255,255,255,0.25);">If you didn&apos;t request this, you can safely ignore this email.</p>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </body>
        </html>
      `,
      text: `Reset your password\n\nClick this link to set a new password (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
