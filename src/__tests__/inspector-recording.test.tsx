import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InspectorPanel } from '@/components/layout/InspectorPanel';
import { DEFAULT_SETTINGS } from '@/constants';

const props = () => ({
  settings: DEFAULT_SETTINGS, onSettingsChange: vi.fn(),
  focusViewEnabled: false, onFocusViewToggle: vi.fn(),
  mirrorCamera: false, onMirrorCameraToggle: vi.fn(),
  countdownEnabled: true, onCountdownToggle: vi.fn(), onUpgradeClick: vi.fn(),
  script: 'Keep reading this script.', onScriptChange: vi.fn(), onClearScript: vi.fn(),
  wordCount: 4, progress: 10, onLoadInspiration: vi.fn(), onClose: vi.fn(),
});

describe('recording inspector', () => {
  it('keeps live controls available when preparation becomes recording', () => {
    const p = props();
    const { rerender } = render(<InspectorPanel {...p} inspectorContext="preparing" />);
    rerender(<InspectorPanel {...p} inspectorContext="recording" />);
    expect(screen.getByRole('complementary', { name: 'Inspector panel' })).toHaveAttribute('aria-hidden', 'false');
    fireEvent.change(screen.getByRole('slider', { name: /Scroll Speed/ }), { target: { value: '1.5' } });
    expect(p.onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ scrollSpeedMultiplier: 1.5 }));
    fireEvent.click(screen.getByRole('button', { name: 'Script' }));
    expect(screen.getByRole('textbox', { name: 'Script Editor' })).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Camera & Preview' }));
    expect(screen.getByRole('switch', { name: 'Countdown' })).toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Mirror Camera' }));
    expect(p.onMirrorCameraToggle).toHaveBeenCalledOnce();
    rerender(<InspectorPanel {...p} inspectorContext="preparing" />);
    expect(screen.getByRole('textbox', { name: 'Script Editor' })).not.toHaveAttribute('readonly');
  });

  it('allows closing the recording drawer and preserves review behavior', () => {
    const p = props();
    const { rerender } = render(<InspectorPanel {...p} inspectorContext="recording" isDrawer />);
    expect(screen.getByRole('dialog', { name: 'Inspector panel' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledOnce();
    rerender(<InspectorPanel {...p} inspectorContext="review" isDrawer />);
    expect(screen.queryByRole('dialog', { name: 'Inspector panel' })).not.toBeInTheDocument();
  });
});
