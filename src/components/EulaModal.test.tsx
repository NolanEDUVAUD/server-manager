import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EulaModal } from './EulaModal';
import { EULA_VERSION } from '../legal/eula';

// Mock Tauri APIs
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    close: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('EulaModal', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should show modal when EULA not accepted', () => {
    localStorage.removeItem('eula.accepted.version');
    render(<EulaModal />);

    expect(screen.getAllByText(/Accord de licence|License Agreement/i).length).toBeGreaterThan(0);
  });

  it('should show EULA text in French by default', () => {
    localStorage.removeItem('eula.accepted.version');
    const { container } = render(<EulaModal />);

    const eulaText = container.querySelector('pre');
    expect(eulaText).toBeTruthy();
    expect(eulaText?.textContent).toContain('ACCORD DE LICENCE');
  });

  it('should not show modal when EULA already accepted for current version', () => {
    localStorage.setItem('eula.accepted.version', EULA_VERSION);
    const { container } = render(<EulaModal />);

    expect(container.querySelector('[role="status"]')).not.toBeInTheDocument();
  });

  it('should show modal when EULA version changes', () => {
    localStorage.setItem('eula.accepted.version', '0.0.1');
    render(<EulaModal />);

    expect(screen.getAllByText(/Accord de licence|License Agreement/i).length).toBeGreaterThan(0);
  });

  it('should accept EULA and store version', async () => {
    localStorage.removeItem('eula.accepted.version');
    const user = userEvent.setup();

    render(<EulaModal />);

    const acceptButton = screen.getByText('J\'accepte');
    await user.click(acceptButton);

    expect(localStorage.getItem('eula.accepted.version')).toBe(EULA_VERSION);
  });

  it('should hide modal after accepting', async () => {
    localStorage.removeItem('eula.accepted.version');
    const user = userEvent.setup();

    render(<EulaModal />);

    const acceptButton = screen.getByText('J\'accepte');
    await user.click(acceptButton);

    await waitFor(() => {
      expect(screen.queryByText(/Accord de licence|License Agreement/i)).not.toBeInTheDocument();
    });
  });

  it('should handle rendering without localStorage errors', () => {
    localStorage.removeItem('eula.accepted.version');
    render(<EulaModal />);
    // Modal should render successfully
    expect(screen.getAllByText(/Accord de licence|License Agreement/i).length).toBeGreaterThan(0);
  });

  it('should display both buttons', () => {
    localStorage.removeItem('eula.accepted.version');
    render(<EulaModal />);

    expect(screen.getByText('J\'accepte')).toBeInTheDocument();
    expect(screen.getByText('Quitter')).toBeInTheDocument();
  });
});
