'use client';

import { useState } from 'react';
import { sendFeedback } from '@/services/discord.service';
import { Button } from '@/components/ui/Button';
import { DiscordIcon } from '@/components/icons';

interface DiscordFeedbackProps {
  onSuccess: (message: string) => void;
}

export function DiscordFeedback({ onSuccess }: DiscordFeedbackProps) {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    const text = input.trim();
    if (!text) {
      onSuccess('Please enter your Discord handle or feedback first.');
      return;
    }

    setIsSending(true);
    try {
      await sendFeedback(text);
      onSuccess('Successfully connected! Thank you!');
      setInput('');
    } catch {
      onSuccess('Could not send feedback. Please try again later.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="bg-accent/5 border border-accent/15 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-[#5865F2]/15 flex items-center justify-center shrink-0">
          <DiscordIcon className="w-4 h-4 text-[#5865F2]" />
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-text-primary">
            Connect on Discord
          </span>
          <span className="text-[10px] text-text-muted">
            Join our community or leave feedback.
          </span>
        </div>
      </div>

      <a
        href="https://discord.gg/supersmartx"
        target="_blank"
        rel="noopener noreferrer"
        className="w-full py-2 bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
      >
        <DiscordIcon className="w-4 h-4" />
        Join Discord Server
      </a>

      <div className="flex items-center gap-2">
        <hr className="flex-1 border-border-subtle" />
        <span className="text-[9px] font-medium text-text-muted uppercase tracking-wider">
          or leave feedback
        </span>
        <hr className="flex-1 border-border-subtle" />
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Your Discord handle or feedback..."
          className="flex-1 bg-canvas border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary placeholder-text-muted outline-none focus:border-accent transition-colors"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSend}
          disabled={isSending}
        >
          {isSending ? 'Sending...' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
