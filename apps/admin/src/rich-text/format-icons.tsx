import type { ReactElement } from "react";

export type FormatIconName =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "link"
  | "unlink"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  | "alignLeft"
  | "alignCenter"
  | "alignRight"
  | "image"
  | "table"
  | "rule"
  | "undo"
  | "redo"
  | "chevronDown";

/**
 * Toolbar glyphs drawn to match the app's navigation icons: 24×24 box, 1.8
 * stroke, round caps. Letterform marks (B/I/U/S) are filled paths instead so
 * they read as type samples rather than outlines.
 */
export function FormatIcon({ name, size = 18 }: {
  readonly name: FormatIconName;
  readonly size?: number;
}): ReactElement {
  const stroke = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
  };
  const text = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
    focusable: false,
  };

  switch (name) {
    case "bold":
      return (
        <svg {...text}>
          <text x="12" y="17.5" textAnchor="middle" fontSize="15" fontWeight="800" fill="currentColor" fontFamily="Georgia, serif">B</text>
        </svg>
      );
    case "italic":
      return (
        <svg {...text}>
          <text x="12" y="17.5" textAnchor="middle" fontSize="15" fontStyle="italic" fill="currentColor" fontFamily="Georgia, serif">I</text>
        </svg>
      );
    case "underline":
      return (
        <svg {...text}>
          <text x="12" y="16" textAnchor="middle" fontSize="14" fill="currentColor" fontFamily="Georgia, serif">U</text>
          <rect x="6" y="18" width="12" height="1.7" rx="0.85" fill="currentColor" />
        </svg>
      );
    case "strike":
      return (
        <svg {...text}>
          <text x="12" y="17" textAnchor="middle" fontSize="14" fill="currentColor" fontFamily="Georgia, serif">S</text>
          <rect x="5" y="11.3" width="14" height="1.7" rx="0.85" fill="currentColor" />
        </svg>
      );
    case "code":
      return (
        <svg {...stroke}>
          <path d="m9 8-4 4 4 4" />
          <path d="m15 8 4 4-4 4" />
        </svg>
      );
    case "link":
      return (
        <svg {...stroke}>
          <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.54 3.54 0 0 0-5-5l-1.2 1.2" />
          <path d="M13.5 10.5a3.5 3.5 0 0 0-5 0L6 13a3.54 3.54 0 0 0 5 5l1.2-1.2" />
        </svg>
      );
    case "unlink":
      return (
        <svg {...stroke}>
          <path d="M11 13.5a3.5 3.5 0 0 0 4.5.4l2.5-2.5a3.54 3.54 0 0 0-5-5L12 7.5" />
          <path d="M13 10.5a3.5 3.5 0 0 0-4.5-.4L6 12.6a3.54 3.54 0 0 0 5 5" />
          <path d="m4 4 16 16" />
        </svg>
      );
    case "bulletList":
      return (
        <svg {...stroke}>
          <circle cx="5" cy="7" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="5" cy="17" r="1.2" fill="currentColor" stroke="none" />
          <path d="M9.5 7h9.5M9.5 12h9.5M9.5 17h9.5" />
        </svg>
      );
    case "orderedList":
      return (
        <svg {...stroke}>
          <path d="M10 7h9M10 12h9M10 17h9" />
          <text x="3" y="9" fontSize="7" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">1</text>
          <text x="3" y="14" fontSize="7" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">2</text>
          <text x="3" y="19" fontSize="7" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">3</text>
        </svg>
      );
    case "blockquote":
      return (
        <svg {...stroke}>
          <path d="M5 5v14" strokeWidth="2.4" />
          <path d="M10 8.5h9M10 13h9M10 17h5.5" />
        </svg>
      );
    case "alignLeft":
      return (
        <svg {...stroke}>
          <path d="M4 6h16M4 10.5h10M4 15h16M4 19.5h10" />
        </svg>
      );
    case "alignCenter":
      return (
        <svg {...stroke}>
          <path d="M4 6h16M7 10.5h10M4 15h16M7 19.5h10" />
        </svg>
      );
    case "alignRight":
      return (
        <svg {...stroke}>
          <path d="M4 6h16M10 10.5h10M4 15h16M10 19.5h10" />
        </svg>
      );
    case "image":
      return (
        <svg {...stroke}>
          <rect x="3.5" y="5" width="17" height="14" rx="2" />
          <circle cx="8.75" cy="10" r="1.5" />
          <path d="m4.5 16.5 4.2-4.2a1.5 1.5 0 0 1 2.1 0l3 3a1.5 1.5 0 0 0 2.1 0l1.4-1.4a1.5 1.5 0 0 1 2.1 0l1.1 1.1" />
        </svg>
      );
    case "table":
      return (
        <svg {...stroke}>
          <rect x="3.5" y="5" width="17" height="14" rx="2" />
          <path d="M3.5 9.7h17M3.5 14.3h17M9.8 5v14" />
        </svg>
      );
    case "rule":
      return (
        <svg {...stroke}>
          <path d="M4 12h16" strokeWidth="2.2" />
          <path d="M6.5 7h11M6.5 17h11" opacity="0.45" />
        </svg>
      );
    case "undo":
      return (
        <svg {...stroke}>
          <path d="M4 9h9a5 5 0 0 1 0 10h-2" />
          <path d="m7.5 5.5-3.5 3.5 3.5 3.5" />
        </svg>
      );
    case "redo":
      return (
        <svg {...stroke}>
          <path d="M20 9h-9a5 5 0 0 0 0 10h2" />
          <path d="m16.5 5.5 3.5 3.5-3.5 3.5" />
        </svg>
      );
    case "chevronDown":
      return (
        <svg {...stroke}>
          <path d="m7 10 5 5 5-5" />
        </svg>
      );
  }
}
