import { useTheme, type ThemeName } from '../theme/theme';
import { HERMES_ART, type HermesStyle } from './art';
import type { BriefKind } from './briefs';

const STYLE_FOR_THEME: Record<ThemeName, HermesStyle> = {
  vase: 'vase',
  fresco: 'fresco',
  amphora: 'amphora',
  nyx: 'vase',
};

interface BriefCardProps {
  kind: BriefKind;
  text: string;
  onDismiss: () => void;
}

/** A soft, dismissible one-liner from Hermes, anchored near his medallion. */
export function BriefCard({ kind, text, onDismiss }: BriefCardProps) {
  const theme = useTheme();
  const art = HERMES_ART[STYLE_FOR_THEME[theme]];
  const pose = kind === 'morning' ? 'greeting' : 'resting';

  return (
    <aside className="brief-card" role="status" aria-label="A word from Hermes">
      <img className="brief-pose" src={art.poses[pose]} alt="" />
      <div className="brief-body">
        <div className="epigraph brief-kind">
          {kind === 'morning' ? 'Morning brief' : 'Evening review'}
        </div>
        <p className="brief-text">{text}</p>
      </div>
      <button className="brief-dismiss" onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </aside>
  );
}
