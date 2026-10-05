import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, LanguageSwitch } from '../i18n/I18nProvider';
import { AuthProvider } from '../lib/auth';
import { ConnectivityProvider } from '../lib/connectivity';
import { ModelProvider } from '../model/ModelProvider';
import { SyncProvider } from '../triage/SyncProvider';
import TriageWizard from './TriageWizard';

function renderWizard() {
  return render(
    <I18nProvider>
      <ConnectivityProvider>
        <AuthProvider>
          <ModelProvider>
            <SyncProvider>
              <MemoryRouter initialEntries={['/triage']}>
                <LanguageSwitch />
                <TriageWizard />
              </MemoryRouter>
            </SyncProvider>
          </ModelProvider>
        </AuthProvider>
      </ConnectivityProvider>
    </I18nProvider>,
  );
}

const next = () => fireEvent.click(screen.getByTestId('wizard-next'));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('ruralcare.locale', 'en');
  localStorage.setItem('ruralcare.tokens', JSON.stringify({ accessToken: 'a', refreshToken: 'r' }));
  localStorage.setItem(
    'ruralcare.user',
    JSON.stringify({
      id: 'u1',
      name: 'P',
      phone: '9',
      role: 'patient',
      villageIds: [],
      preferredLanguage: 'en',
    }),
  );
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
});

describe('TriageWizard', () => {
  it('asks "Are you pregnant?" only for females aged 12–50', async () => {
    renderWizard();
    expect(screen.getByTestId('wizard-step-area')).toBeInTheDocument();
    next();
    // symptoms are required
    next();
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one symptom');
    fireEvent.click(screen.getByTestId('symptom-chest_pain'));
    next();
    fireEvent.click(screen.getByTestId('wizard-skip')); // duration
    fireEvent.click(screen.getByTestId('wizard-skip')); // severity
    expect(screen.getByTestId('wizard-step-person')).toBeInTheDocument();

    // age is required
    fireEvent.click(screen.getByTestId('sex-female'));
    next();
    expect(screen.getByRole('alert')).toHaveTextContent('Age is required');

    fireEvent.change(screen.getByTestId('age-years'), { target: { value: '25' } });
    expect(screen.getByTestId('pregnancy-question')).toBeInTheDocument();
    // "Not sure" is not a confirmed pregnancy, so bleeding advice is shown right there
    expect(screen.queryByTestId('pregnancy-unsure-advice')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pregnant-unsure'));
    expect(screen.getByTestId('pregnancy-unsure-advice')).toHaveTextContent('call 108');
    fireEvent.click(screen.getByTestId('pregnant-no'));
    expect(screen.queryByTestId('pregnancy-unsure-advice')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sex-male'));
    expect(screen.queryByTestId('pregnancy-question')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sex-female'));
    fireEvent.change(screen.getByTestId('age-years'), { target: { value: '60' } });
    expect(screen.queryByTestId('pregnancy-question')).not.toBeInTheDocument();
  });

  it('switches language on every screen, and search works across languages', async () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'தமிழ்' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('பிரச்சனை எங்கே?');
    next();
    fireEvent.change(screen.getByTestId('symptom-search'), { target: { value: 'खांसी' } });
    expect(screen.getByTestId('symptom-cough')).toHaveTextContent('இருமல்');
  });
});
