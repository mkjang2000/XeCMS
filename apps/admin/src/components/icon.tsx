import type { ReactElement } from "react";

export type IconName =
  | "arrowRight"
  | "collection"
  | "content"
  | "database"
  | "events"
  | "identity"
  | "logout"
  | "media"
  | "plus"
  | "schema"
  | "shield"
  | "sparkles"
  | "workspace";

export function Icon({
  name,
  size = 20,
  className,
}: {
  readonly name: IconName;
  readonly size?: number;
  readonly className?: string;
}): ReactElement {
  const common = {
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
    className,
  };

  switch (name) {
    case "content":
      return (
        <svg {...common}>
          <path d="M7 3.75h8.2L19 7.55v11.7a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 19.25v-14A1.5 1.5 0 0 1 7.5 3.75Z" />
          <path d="M15 3.9v4h3.8M9 12h6M9 15.5h6" />
        </svg>
      );
    case "schema":
      return (
        <svg {...common}>
          <rect x="3.75" y="4" width="6.5" height="6.5" rx="1.4" />
          <rect x="13.75" y="13.5" width="6.5" height="6.5" rx="1.4" />
          <path d="M10.25 7.25h4.25a2.5 2.5 0 0 1 2.5 2.5v3.75M7 10.5V17a2.5 2.5 0 0 0 2.5 2.5h4.25" />
        </svg>
      );
    case "workspace":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <path d="M17 14v6M14 17h6" />
        </svg>
      );
    case "collection":
      return (
        <svg {...common}>
          <rect x="5" y="4" width="14" height="16" rx="2" />
          <path d="M8.5 8h7M8.5 12h7M8.5 16H13" />
        </svg>
      );
    case "database":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
          <path d="M4.5 5.5v6c0 1.65 3.36 3 7.5 3s7.5-1.35 7.5-3v-6M4.5 11.5v6c0 1.65 3.36 3 7.5 3s7.5-1.35 7.5-3v-6" />
        </svg>
      );
    case "events":
      return (
        <svg {...common}>
          <path d="M5 5.5h9M5 12h14M5 18.5h9" />
          <circle cx="17.5" cy="5.5" r="1.7" />
          <circle cx="16.5" cy="18.5" r="1.7" />
          <path d="m14.8 7 2.7 3.2M17.3 13.7l-1 3.1" />
        </svg>
      );
    case "media":
      return (
        <svg {...common}>
          <rect x="3.5" y="4" width="17" height="16" rx="2" />
          <circle cx="9" cy="9" r="1.6" />
          <path d="m5.5 17 4.2-4.2 2.7 2.7 2.2-2.2 3.9 3.7" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3.5 19 6v5.4c0 4.5-2.9 7.65-7 9.1-4.1-1.45-7-4.6-7-9.1V6l7-2.5Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "identity":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.8 19c.35-3.65 2.1-5.5 5.2-5.5s4.85 1.85 5.2 5.5" />
          <circle cx="17.2" cy="9" r="2.2" />
          <path d="M15.3 14.3c3.05-.65 5.05.9 5.35 3.7" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...common}>
          <path d="m12 3 1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2L12 3ZM18.2 13.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9ZM6.3 14.2l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z" />
        </svg>
      );
    case "logout":
      return (
        <svg {...common}>
          <path d="M10 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H10M14.5 8l4 4-4 4M18.5 12H9" />
        </svg>
      );
    case "plus":
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "arrowRight":
      return <svg {...common}><path d="m9 5 7 7-7 7" /></svg>;
  }
}
