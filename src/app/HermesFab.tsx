import { HERMES_ART, type HermesStyle } from '../hermes/art';
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
 * Card); a badge counts the unread scrolls waiting in his bag.
 */
export function HermesFab() {
  const theme = useTheme();
  const art = HERMES_ART[STYLE_FOR_THEME[theme]];
  const scrollCount = useScrolls().length;
  return (
    <button
      className="hermes-fab"
      title="Ask Hermes"
      aria-label={
        scrollCount > 0 ? `Ask Hermes (${scrollCount} scrolls waiting)` : 'Ask Hermes'
      }
      onClick={() => window.dispatchEvent(new CustomEvent('hermes:summon'))}
    >
      <img src={art.icon} alt="" />
      {scrollCount > 0 && (
        <span className="fab-badge tnum" aria-hidden="true">
          {scrollCount}
        </span>
      )}
    </button>
  );
}
