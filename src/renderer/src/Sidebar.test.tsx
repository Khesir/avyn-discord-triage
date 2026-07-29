// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from './Sidebar';

describe('Sidebar', () => {
  it('shows a Triage item and a Settings item, each with an icon and a label', () => {
    render(<Sidebar activeSection="triage" onSectionChange={vi.fn()} />);

    const triageButton = screen.getByRole('button', { name: /triage/i });
    const settingsButton = screen.getByRole('button', { name: /settings/i });

    expect(triageButton).toBeInTheDocument();
    expect(settingsButton).toBeInTheDocument();
    // Icon: a decorative glyph alongside the text label, not just bare text.
    expect(triageButton.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(settingsButton.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('clicking the Settings item invokes the section-change callback with "settings"', () => {
    const onSectionChange = vi.fn();
    render(<Sidebar activeSection="triage" onSectionChange={onSectionChange} />);

    fireEvent.click(screen.getByRole('button', { name: /settings/i }));

    expect(onSectionChange).toHaveBeenCalledWith('settings');
  });

  it('clicking the Triage item invokes the section-change callback with "triage"', () => {
    const onSectionChange = vi.fn();
    render(<Sidebar activeSection="settings" onSectionChange={onSectionChange} />);

    fireEvent.click(screen.getByRole('button', { name: /triage/i }));

    expect(onSectionChange).toHaveBeenCalledWith('triage');
  });

  it('neither nav item is disabled, regardless of the active section', () => {
    render(<Sidebar activeSection="settings" onSectionChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /triage/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /settings/i })).not.toBeDisabled();
  });

  it('marks the active section for assistive tech via aria-current', () => {
    render(<Sidebar activeSection="settings" onSectionChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /settings/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /triage/i })).not.toHaveAttribute('aria-current');
  });
});
