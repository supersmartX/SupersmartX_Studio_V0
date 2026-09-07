import { createClient, type Client } from '@libsql/client';

let client: Client | null = null;

export function getDb(): Client {
  if (client) return client;

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (tursoUrl) {
    client = createClient({
      url: tursoUrl,
      authToken: tursoToken || undefined,
    });
  } else {
    const { join } = require('path') as typeof import('path');
    const { existsSync, mkdirSync } = require('fs') as typeof import('fs');
    const dataDir = join(process.cwd(), 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    const dbPath = join(dataDir, 'supersmartx.db');
    client = createClient({ url: `file:${dbPath}` });
  }

  return client;
}

export function resetDb(): void {
  if (client) {
    client.close();
    client = null;
  }
}
