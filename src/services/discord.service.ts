const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

export async function sendFeedback(text: string): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) {
    console.warn('Discord webhook not configured');
    return;
  }

  try {
    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `**SupersmartX Studio Feedback**\n${text}`,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to send feedback');
    }
  } catch (err) {
    console.error('Discord feedback error:', err);
    throw err;
  }
}
