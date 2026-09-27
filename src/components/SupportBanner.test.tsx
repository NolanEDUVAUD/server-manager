import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { SupportBanner } from './SupportBanner';
import { useStore } from '../stores/useStore';

const setOnboardingDone = (done: boolean) =>
  useStore.setState((s) => ({ settings: { ...s.settings, general: { ...s.settings.general, onboarding_done: done } } }));

// Mock the i18n hook
vi.mock('../i18n', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'supportBanner.title': 'Support this project',
        'supportBanner.description': 'Help keep this app free',
        'supportBanner.support': 'Support',
        'supportBanner.later': 'Later',
        'supportBanner.neverAgain': 'Never show again',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock the navigate hook
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

describe('SupportBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should not show on first launch (before onboarding)', () => {
    setOnboardingDone(false);
    render(
      <BrowserRouter>
        <SupportBanner />
      </BrowserRouter>
    );
    expect(screen.queryByText(/Support this project/i)).not.toBeInTheDocument();
  });

  it('should show after onboarding delay when dismissed is false', async () => {
    setOnboardingDone(true);
    localStorage.removeItem('supportBanner.dismissed');

    render(
      <BrowserRouter>
        <SupportBanner />
      </BrowserRouter>
    );

    // Wait for the 2 second delay
    await waitFor(() => {
      expect(screen.queryByText(/Support this project/i)).toBeInTheDocument();
    }, { timeout: 3500 });
  });

  it('should not show if permanently dismissed', () => {
    setOnboardingDone(true);
    localStorage.setItem('supportBanner.dismissed', 'true');

    render(
      <BrowserRouter>
        <SupportBanner />
      </BrowserRouter>
    );

    // Banner should not appear at all
    expect(screen.queryByText(/Support this project/i)).not.toBeInTheDocument();
  });

  it('should render support and later buttons when visible', async () => {
    setOnboardingDone(true);
    localStorage.removeItem('supportBanner.dismissed');

    render(
      <BrowserRouter>
        <SupportBanner />
      </BrowserRouter>
    );

    // Wait for banner to appear
    await waitFor(() => {
      expect(screen.getByText(/Support this project/i)).toBeInTheDocument();
    }, { timeout: 3500 });

    // Check for buttons - use more specific selectors
    expect(screen.getByRole('button', { name: /Support/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Later/i })).toBeInTheDocument();
  });

  it('« Ne plus afficher » est mémorisé', async () => {
    setOnboardingDone(true);
    const user = userEvent.setup();
    render(
      <BrowserRouter>
        <SupportBanner />
      </BrowserRouter>
    );
    await waitFor(() => expect(screen.getByText(/Support this project/i)).toBeInTheDocument(), { timeout: 3500 });
    await user.click(screen.getByRole('button', { name: /Never show again/i }));
    expect(localStorage.getItem('supportBanner.dismissed')).toBe('true');
    expect(screen.queryByText(/Support this project/i)).not.toBeInTheDocument();
  });
});
