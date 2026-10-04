import { getDisclaimer, redFlagEngine } from '@ruralcare/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App (Phase 1 placeholder)', () => {
  it('shows the disclaimer in English, Tamil and Hindi', () => {
    render(<App />);
    expect(screen.getByText(getDisclaimer('en'))).toBeInTheDocument();
    expect(screen.getByText(getDisclaimer('ta'))).toBeInTheDocument();
    expect(screen.getByText(getDisclaimer('hi'))).toBeInTheDocument();
  });

  it('runs the shared red-flag engine in the browser environment', () => {
    expect(redFlagEngine.evaluate({ symptoms: ['chest_pain'] }).level).toBe('EMERGENCY');
  });
});
