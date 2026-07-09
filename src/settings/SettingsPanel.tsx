import { useEffect, useState } from 'react';
import { signIn, signOut, useGoogleAuth } from '../google/auth';
import { useSyncStatus } from '../google/syncEngine';
import { appendLedger } from '../hermes/ledgerStore';
import { relTime } from '../lib/time';
import { useResetDemoData } from '../state/EventsContext';
import { setTheme, THEMES, useTheme, type ThemeName } from '../theme/theme';
import { Panel, useToast } from '../ui';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const THEME_LABELS: Record<ThemeName, string> = {
  vase: 'Vase',
  fresco: 'Fresco',
  amphora: 'Amphora',
  nyx: 'Nyx',
};

/** Settings: the Google account, the theme, the demo data, the Ledger. */
export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const auth = useGoogleAuth();
  const sync = useSyncStatus();
  const theme = useTheme();
  const resetDemo = useResetDemoData();
  const { showToast } = useToast();
  const [confirmingReset, setConfirmingReset] = useState(false);
  // Keeps "last synced …" honest while the panel sits open.
  const [, setSyncTick] = useState(0);

  useEffect(() => {
    if (!open) setConfirmingReset(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setSyncTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, [open]);

  async function doReset() {
    setConfirmingReset(false);
    await resetDemo();
    appendLedger('sync', 'Local demo events were cleared and a fresh week laid down.');
    showToast({ message: 'The demo week is fresh again.' });
  }

  const accountLabel =
    auth.status === 'signed-in'
      ? (auth.email ?? 'Signed in')
      : auth.status === 'connecting'
        ? 'Connecting…'
        : auth.status === 'expired'
          ? 'Session expired'
          : 'Not signed in';

  return (
    <Panel open={open} onClose={onClose} title="Settings" width={340}>
      <section className="settings-section">
        <h3 className="scrolls-heading">Google account</h3>
        <div className="settings-row">
          <span className="settings-value">{accountLabel}</span>
          {auth.status === 'signed-in' ? (
            <button className="btn small" onClick={signOut}>
              Sign out
            </button>
          ) : (
            <button
              className="btn small primary"
              onClick={() => void signIn()}
              disabled={auth.status === 'connecting'}
            >
              {auth.status === 'expired' ? 'Reconnect' : 'Sign in with Google'}
            </button>
          )}
        </div>
        {auth.status === 'signed-in' && sync.lastSyncedAt !== null && (
          <p className="settings-note">Last synced {relTime(sync.lastSyncedAt)}.</p>
        )}
        <p className="settings-note">
          Signed in, events flow to and from Google Calendar and Hermes carries scrolls from
          Gmail. Signed out, everything stays on this device.
        </p>
      </section>

      <hr className="gold-rule" />

      <section className="settings-section">
        <h3 className="scrolls-heading">Theme</h3>
        <div className="theme-swatches" role="group" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t}
              className={`theme-swatch theme-swatch-${t}${theme === t ? ' active' : ''}`}
              title={THEME_LABELS[t]}
              aria-label={`${THEME_LABELS[t]} theme`}
              aria-pressed={theme === t}
              onClick={() => setTheme(t)}
            >
              <span className="theme-swatch-name">{THEME_LABELS[t]}</span>
            </button>
          ))}
        </div>
      </section>

      <hr className="gold-rule" />

      <section className="settings-section">
        <h3 className="scrolls-heading">Data</h3>
        {confirmingReset ? (
          <div className="settings-row">
            <span className="settings-value">Clear local events and reseed?</span>
            <button className="btn small" onClick={() => setConfirmingReset(false)}>
              Keep
            </button>
            <button className="btn small danger" onClick={() => void doReset()}>
              Reset
            </button>
          </div>
        ) : (
          <div className="settings-row">
            <span className="settings-value">Local demo events</span>
            <button className="btn small" onClick={() => setConfirmingReset(true)}>
              Reset demo data
            </button>
          </div>
        )}
        <p className="settings-note">
          Only events kept on this device are touched — Google Calendar is never cleared.
        </p>
      </section>

      <hr className="gold-rule" />

      <button
        className="hermes-link"
        onClick={() => {
          onClose();
          window.dispatchEvent(new CustomEvent('hermes:ledger'));
        }}
      >
        Open the Ledger <kbd>L</kbd>
      </button>
    </Panel>
  );
}
