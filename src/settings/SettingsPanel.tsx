import { useEffect, useState, useSyncExternalStore } from 'react';
import { signIn, signOut, useGoogleAuth } from '../google/auth';
import { createGoogleWeekly } from '../google/googleSeriesOps';
import { useSyncStatus } from '../google/syncEngine';
import { clearApiKey, setApiKey, useHasApiKey } from '../hermes/brain/keyStore';
import { appendLedger } from '../hermes/ledgerStore';
import { dateAtMinutes, dateKey, fmtClock, relTime } from '../lib/time';
import { useResetDemoData } from '../state/EventsContext';
import {
  deleteTemplate,
  getTemplates,
  nextOccurrenceOf,
  parseDateKey,
  subscribeTemplates,
  weekdayName,
} from '../state/recurrence';
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
  const [confirmingMigrate, setConfirmingMigrate] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const hasKey = useHasApiKey();
  // Write-only draft: the stored key is never rendered back into the DOM.
  const [keyDraft, setKeyDraft] = useState('');
  // Keeps "last synced …" honest while the panel sits open.
  const [, setSyncTick] = useState(0);

  // Local weekly templates still living on this device (ended ones stay put).
  const templates = useSyncExternalStore(subscribeTemplates, getTemplates);
  const todayKey = dateKey(new Date());
  const migratable = templates.filter((t) => !t.untilISO || t.untilISO >= todayKey);

  useEffect(() => {
    if (!open) {
      setConfirmingReset(false);
      setConfirmingMigrate(false);
      setKeyDraft('');
    }
  }, [open]);

  function saveKey() {
    const value = keyDraft.trim();
    if (!value) return;
    setApiKey(value);
    setKeyDraft('');
    showToast({ message: 'Hermes has a mind now.' });
  }

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

  /**
   * Convert each local weekly template into a real Google recurring event
   * (RRULE on the parent, first occurrence the next weekday), then retire
   * the template. One Ledger entry per series, each undoable on its own.
   * Per-date exceptions are a local notion and do not travel.
   */
  async function doMigrate() {
    setConfirmingMigrate(false);
    setMigrating(true);
    const total = migratable.length;
    let moved = 0;
    try {
      for (const template of migratable) {
        const kept = { ...template, exceptions: { ...template.exceptions } };
        const created = await createGoogleWeekly({
          title: template.title,
          categoryId: template.categoryId,
          day: nextOccurrenceOf(template.weekday),
          startMin: template.startMin,
          endMin: template.endMin,
          until: template.untilISO
            ? dateAtMinutes(parseDateKey(template.untilISO), template.startMin)
            : undefined,
        });
        deleteTemplate(template.id);
        moved += 1;
        appendLedger(
          'sync',
          `Moved “${template.title}” to Google Calendar — every ${weekdayName(template.weekday)} at ${fmtClock(template.startMin)}.`,
          {
            kind: 'g-remove-series',
            seriesId: created.googleSeriesId ?? created.id,
            title: template.title,
            restoreTemplate: kept,
          }
        );
      }
      showToast({
        message:
          moved === 1
            ? 'Your weekly rhythm now lives on Google Calendar.'
            : `${moved} weekly rhythms now live on Google Calendar.`,
      });
    } catch {
      // The store already raised its own toast for the one that failed.
      if (moved > 0) {
        showToast({ message: `Moved ${moved} of ${total} — the rest stayed on this device.` });
      }
    } finally {
      setMigrating(false);
    }
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
        {auth.status === 'signed-in' &&
          migratable.length > 0 &&
          (confirmingMigrate ? (
            <div className="settings-row">
              <span className="settings-value">
                Turn {migratable.length === 1 ? 'it' : 'them'} into real Google series?
              </span>
              <button className="btn small" onClick={() => setConfirmingMigrate(false)}>
                Keep here
              </button>
              <button className="btn small primary" onClick={() => void doMigrate()}>
                Move
              </button>
            </div>
          ) : (
            <p className="settings-note">
              {migratable.length === 1
                ? 'One weekly rhythm still lives on this device'
                : `${migratable.length} weekly rhythms still live on this device`}
              {' — '}
              <button
                className="settings-inline-link"
                onClick={() => setConfirmingMigrate(true)}
                disabled={migrating}
              >
                {migrating ? 'moving…' : 'move your weekly rhythm to Google Calendar'}
              </button>
              .
            </p>
          ))}
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
        <h3 className="scrolls-heading">Hermes’s mind</h3>
        {hasKey ? (
          <div className="settings-row">
            <span className="settings-value">Anthropic API key stored</span>
            <button
              className="btn small"
              onClick={() => {
                clearApiKey();
                showToast({ message: 'The key is forgotten.' });
              }}
            >
              Clear key
            </button>
          </div>
        ) : (
          <div className="settings-row">
            <input
              className="settings-key-input"
              type="password"
              autoComplete="off"
              placeholder="Anthropic API key (sk-ant-…)"
              aria-label="Anthropic API key"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveKey();
              }}
            />
            <button
              className="btn small primary"
              onClick={saveKey}
              disabled={keyDraft.trim() === ''}
            >
              Save
            </button>
          </div>
        )}
        <p className="settings-note">
          Stored only in this browser; your commands and event titles are sent to Anthropic when
          Hermes needs help interpreting. Get a key at{' '}
          <a
            className="settings-inline-link"
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
          >
            console.anthropic.com
          </a>
          .
        </p>
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
