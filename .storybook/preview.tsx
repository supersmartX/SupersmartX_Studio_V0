import type { Preview } from '@storybook/nextjs-vite';

// Design tokens (@theme) + Tailwind v4 utilities for every story canvas.
// Without this, component classes like bg-accent render unstyled in Storybook.
import '../src/app/globals.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
