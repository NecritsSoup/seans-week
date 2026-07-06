import { HERMES_ART, type HermesStyle } from '../hermes/art';
import { useTheme, type ThemeName } from '../theme/theme';

const STYLE_FOR_THEME: Record<ThemeName, HermesStyle> = {
  vase: 'vase',
  fresco: 'fresco',
  amphora: 'amphora',
  nyx: 'vase', // black-figure ground suits the vase artwork
};

/**
 * The fixed Hermes medallion. Clicking it emits 'hermes:summon' — Phase 2
 * wires this to the Hermes palette/card.
 */
export function HermesFab() {
  const theme = useTheme();
  const art = HERMES_ART[STYLE_FOR_THEME[theme]];
  return (
    <button
      className="hermes-fab"
      title="Ask Hermes"
      aria-label="Ask Hermes"
      onClick={() => window.dispatchEvent(new CustomEvent('hermes:summon'))}
    >
      <img src={art.icon} alt="" />
    </button>
  );
}
