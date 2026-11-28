import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InspectorPanel } from '@/components/layout/InspectorPanel';
import { DEFAULT_SETTINGS } from '@/constants';

const props = () => ({
  settings: DEFAULT_SETTINGS, onSettingsChange: vi.fn(),
  focusViewEnabled: false, onFocusViewToggle: vi.fn(),
  mirrorCamera: false, onMirrorCameraToggle: vi.fn(),
  countdownEnabled: true, onCountdownToggle: vi.fn(), onUpgradeClick: vi.fn(),
  script: 'Keep reading this script.', onScriptChange: vi.fn(),
  onClearScript: vi.fn(), wordCount: 4, progress: 10, onLoadInspiration: vi.fn(),
});

describe('screen-share teleprompter interlock (inspector)', () => {
  it('locks the script editor while screen sharing so the prompter cannot be activated', () => {
    render(<InspectorPanel {...props()} screenShareActive inspectorContext="preparing" />);
    expect(screen.getByRole('textbox', { name: 'Script Editor' })).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    expect(screen.getByText('Screen sharing is active — the teleprompter is hidden until sharing stops.')).toBeInTheDocument();
  });

  it('restores script editing once screen sharing stops', () => {
    const p = props();
    const { rerender } = render(<InspectorPanel {...p} screenShareActive inspectorContext="preparing" />);
    rerender(<InspectorPanel {...p} inspectorContext="preparing" />);
    expect(screen.getByRole('textbox', { name: 'Script Editor' })).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
    expect(screen.queryByText('Screen sharing is active — the teleprompter is hidden until sharing stops.')).not.toBeInTheDocument();
  });

  it('locks the script editor while screen sharing even during capture', () => {
    render(<InspectorPanel {...props()} screenShareActive inspectorContext="recording" />);
    fireEvent.click(screen.getByRole('button', { name: 'Script' }));
    expect(screen.getByRole('textbox', { name: 'Script Editor' })).toHaveAttribute('readonly');
  });
});
