import { HERMES_ART, type HermesStyle } from '../hermes/art';
import { useTheme, type ThemeName } from '../theme/theme';

const STYLE_FOR_THEME: Record<ThemeName, HermesStyle> = {
  vase: 'vase',
  fresco: 'fresco',
  amphora: 'amphora',
  nyx: 'vase', // black-figure ground suits the vase artwork
};

/**
 * The Hermes medallion. Clicking it emits 'hermes:summon' (the Hermes
 * Card). It stays clean — the waiting-dispatch badge lives on the wax
 * seal above it (see DispatchesFab).
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
