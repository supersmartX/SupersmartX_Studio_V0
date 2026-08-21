import { NextRequest, NextResponse } from 'next/server';
import { findUserByEmail, createUser } from '@/auth';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import bcrypt from 'bcrypt';

const DATA_DIR = join(process.cwd(), 'data');
const TOKENS_FILE = join(DATA_DIR, 'reset-tokens.json');
const USERS_FILE = join(DATA_DIR, 'users.json');

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
  writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

interface StoredUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

function getUsers(): StoredUser[] {
  try {
    if (!existsSync(USERS_FILE)) return [];
    return JSON.parse(readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveUsers(users: StoredUser[]) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json();

    if (!token || !password) {
      return NextResponse.json({ error: 'Token and password are required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // Hash the incoming token and find matching record
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const tokens = getTokens();
    const record = tokens.find((t) => t.tokenHash === tokenHash);

    if (!record) {
      return NextResponse.json({ error: 'Invalid reset token' }, { status: 400 });
    }

    // Check expiry
    if (new Date(record.expiresAt) < new Date()) {
      const remaining = tokens.filter((t) => t.tokenHash !== tokenHash);
      saveTokens(remaining);
      return NextResponse.json({ error: 'Reset link has expired' }, { status: 400 });
    }

    // Update password
    const users = getUsers();
    const userIndex = users.findIndex((u) => u.email === record.email);
    if (userIndex === -1) {
      return NextResponse.json({ error: 'User not found' }, { status: 400 });
    }

    users[userIndex].passwordHash = await bcrypt.hash(password, 12);
    saveUsers(users);

    // Remove used token
    saveTokens(tokens.filter((t) => t.tokenHash !== tokenHash));

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
