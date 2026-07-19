// Tiny inline SVG glyphs, token-colored via currentColor — no brand marks.

interface GlyphProps {
  /** Rendered square, in px. */
  size?: number;
}

/** A small camera: the universal "this event has a meeting link" mark. */
export function CameraGlyph({ size = 10 }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1.5 5A1.5 1.5 0 0 1 3 3.5h6A1.5 1.5 0 0 1 10.5 5v6A1.5 1.5 0 0 1 9 12.5H3A1.5 1.5 0 0 1 1.5 11V5Zm10 1.9 2.1-1.6a.55.55 0 0 1 .9.44v4.52a.55.55 0 0 1-.9.44l-2.1-1.6V6.9Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Two offset squares: copy-to-clipboard. */
export function CopyGlyph({ size = 12 }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5.5 5.5V3A1.5 1.5 0 0 1 7 1.5h6A1.5 1.5 0 0 1 14.5 3v6A1.5 1.5 0 0 1 13 10.5h-2.5m-8-5H9A1.5 1.5 0 0 1 10.5 7v6A1.5 1.5 0 0 1 9 14.5H3A1.5 1.5 0 0 1 1.5 13V7A1.5 1.5 0 0 1 3 5.5h-.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
