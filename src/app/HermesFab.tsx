import { HERMES_ART, type HermesStyle } from '../hermes/art';
import { useSuggestions } from '../hermes/suggestStore';
import { useScrolls } from '../scrolls/scrollsStore';
import { useTheme, type ThemeName } from '../theme/theme';

const STYLE_FOR_THEME: Record<ThemeName, HermesStyle> = {
  vase: 'vase',
  fresco: 'fresco',
  amphora: 'amphora',
  nyx: 'vase', // black-figure ground suits the vase artwork
};

/**
 * The fixed Hermes medallion. Clicking it emits 'hermes:summon' (the Hermes
 * Card); a badge counts the dispatches waiting in his bag — unread scrolls
 * plus fresh suggestions.
 */
export function HermesFab() {
  const theme = useTheme();
  const art = HERMES_ART[STYLE_FOR_THEME[theme]];
  const dispatchCount = useScrolls().length + useSuggestions().length;
  return (
    <button
      className="hermes-fab"
      title="Ask Hermes"
      aria-label={
        dispatchCount > 0 ? `Ask Hermes (${dispatchCount} dispatches waiting)` : 'Ask Hermes'
      }
      onClick={() => window.dispatchEvent(new CustomEvent('hermes:summon'))}
    >
      <img src={art.icon} alt="" />
      {dispatchCount > 0 && (
        <span className="fab-badge tnum" aria-hidden="true">
          {dispatchCount}
        </span>
      )}
    </button>
  );
}
