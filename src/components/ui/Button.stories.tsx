import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { fn } from 'storybook/test';

import { Button } from './Button';

const VARIANTS = [
  'primary',
  'secondary',
  'ghost',
  'destructive',
  'danger-ghost',
] as const;
const SIZES = ['sm', 'md', 'lg'] as const;

const meta = {
  title: 'Design System/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Interactive primitive of the SupersmartX design system. Variant and size classes resolve against the Tailwind v4 `@theme` tokens declared in `src/app/globals.css`.',
      },
    },
  },
  args: {
    children: 'Continue',
    onClick: fn(),
  },
  argTypes: {
    variant: { control: 'select', options: [...VARIANTS] },
    size: { control: 'select', options: [...SIZES] },
    className: { control: false },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Brand accent — the default call-to-action treatment. */
export const Primary: Story = {
  args: { variant: 'primary', children: 'Continue' },
};

/** Elevated neutral surface — secondary emphasis next to Primary. */
export const Secondary: Story = {
  args: { variant: 'secondary', children: 'Save draft' },
};

/** No chrome at all — for low-priority or inline actions. */
export const Ghost: Story = {
  args: { variant: 'ghost', children: 'Cancel' },
};

/** Destructive intent with a soft fill — for delete confirmations. */
export const Destructive: Story = {
  args: { variant: 'destructive', children: 'Delete project' },
};

/** Destructive intent without a fill — for discard/skip actions. */
export const DangerGhost: Story = {
  args: { variant: 'danger-ghost', children: 'Discard' },
};

/** Compact density (h-10) for toolbars and dense layouts. */
export const Small: Story = {
  args: { size: 'sm', children: 'Small' },
};

/** Comfortable density (h-12) for primary flows. */
export const Large: Story = {
  args: { size: 'lg', children: 'Large' },
};

/** Unavailable state — opacity + pointer-events handled in the component. */
export const Disabled: Story = {
  args: { disabled: true, children: 'Unavailable' },
};

/** Every variant × size combination in one grid — token audit view. */
export const AllVariants: Story = {
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story:
          'Renders all 5 variants across all 3 sizes for a single-glance design-token audit.',
      },
    },
  },
  render: () => (
    <div className="grid gap-6">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex items-center gap-4">
          <span className="text-text-muted w-36 shrink-0 text-xs">
            {variant}
          </span>
          {SIZES.map((size) => (
            <Button key={size} variant={variant} size={size}>
              Button
            </Button>
          ))}
        </div>
      ))}
    </div>
  ),
};
