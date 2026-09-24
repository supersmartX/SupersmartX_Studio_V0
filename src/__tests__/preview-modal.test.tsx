import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';

afterEach(() => {
  document.body.style.overflow = '';
});

describe('preview Modal behavior', () => {
  function renderPreview() {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="Recording preview" maxWidth="max-w-3xl" ariaLabel="Recording preview">
        <video data-testid="preview-video" src="blob:preview" controls />
      </Modal>,
    );
    return onClose;
  }

  it('renders centered with backdrop, title, and accessible close', () => {
    renderPreview();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Close')).toBeInTheDocument();
    expect(screen.getByTestId('preview-video')).toBeInTheDocument();
  });

  it('Escape closes the modal', async () => {
    const onClose = renderPreview();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('backdrop click closes, video click does not', async () => {
    const onClose = renderPreview();
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.firstElementChild as HTMLElement;
    fireEvent.click(backdrop);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    const onClose2 = vi.fn();
    render(
      <Modal isOpen onClose={onClose2} title="x" ariaLabel="x">
        <video data-testid="preview-video-2" src="blob:preview" controls />
      </Modal>,
    );
    fireEvent.click(screen.getByTestId('preview-video-2'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(onClose2).not.toHaveBeenCalled();
  });

  it('locks background scroll while open', () => {
    renderPreview();
    expect(document.body.style.overflow).toBe('hidden');
  });
});

describe('useDismissOnOutsideClick (safe popover dismissal)', () => {
  function MenuHarness() {
    const [open, setOpen] = useState(true);
    const ref = useRef<HTMLDivElement | null>(null);
    useDismissOnOutsideClick(ref, open, () => setOpen(false));
    return (
      <div>
        <button data-testid="outside">outside</button>
        {open && (
          <div ref={ref} data-testid="menu" role="menu">
            <button data-testid="inside">action</button>
          </div>
        )}
      </div>
    );
  }

  it('closes on outside mousedown', () => {
    render(<MenuHarness />);
    expect(screen.getByTestId('menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByTestId('menu')).not.toBeInTheDocument();
  });

  it('stays open on inside click, closes on Escape', () => {
    render(<MenuHarness />);
    fireEvent.mouseDown(screen.getByTestId('inside'));
    expect(screen.getByTestId('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('menu')).not.toBeInTheDocument();
  });
});
