interface GhostAction {
  label: string;
  primary?: boolean;
}

interface GhostCardProps {
  icon: string;
  title: string;
  meta: string;
  because: string;
  actions?: GhostAction[];
}

/**
 * A ghosted example dispatch: shows what a lane will hold before it holds
 * anything. Watermarked "example" in the museum-label style, never
 * interactive, never counted — hidden from assistive tech entirely.
 */
export function GhostCard({ icon, title, meta, because, actions = [] }: GhostCardProps) {
  return (
    <article className="dispatch-card ghost-card" aria-hidden="true">
      <span className="ghost-flag">Example</span>
      <div className="dispatch-card-head">
        <span className="dispatch-icon">{icon}</span>
        <span className="dispatch-title">{title}</span>
        <span className="dispatch-meta tnum">{meta}</span>
      </div>
      <div className="dispatch-because">{because}</div>
      {actions.length > 0 && (
        <div className="dispatch-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              className={`btn small${action.primary ? ' primary' : ''}`}
              disabled
              tabIndex={-1}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
