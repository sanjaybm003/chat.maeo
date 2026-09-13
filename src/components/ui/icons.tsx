import type { SVGProps } from "react";

/**
 * maeosan's own icon set. Drawn on a 20px grid with a 1.6 stroke so they sit
 * quietly next to Instrument Sans. Use sparingly: words first, icons second.
 */

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, strokeWidth = 1.6, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="5.25" />
    <path d="m13 13 3.5 3.5" />
  </Svg>
);

export const IconArrowUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 15.5v-11M5.5 9 10 4.5 14.5 9" />
  </Svg>
);

export const IconArrowDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 4.5v11M5.5 11l4.5 4.5 4.5-4.5" />
  </Svg>
);

export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.5 10h-11M9 5.5 4.5 10 9 14.5" />
  </Svg>
);

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 10h11M11 5.5l4.5 4.5-4.5 4.5" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 8 4 4 4-4" />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m8 6 4 4-4 4" />
  </Svg>
);

export const IconSelector = (p: IconProps) => (
  <Svg {...p}>
    <path d="m7 7.5 3-3 3 3M7 12.5l3 3 3-3" />
  </Svg>
);

export const IconPaperclip = (p: IconProps) => (
  <Svg {...p}>
    <path d="m14.75 9.25-4.9 4.9a3.1 3.1 0 0 1-4.38-4.38l5.4-5.4a2.05 2.05 0 0 1 2.9 2.9l-5.35 5.35a1.02 1.02 0 0 1-1.45-1.45l4.9-4.9" />
  </Svg>
);

export const IconSmile = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="6.75" />
    <path d="M7.25 11.5c.65.95 1.6 1.5 2.75 1.5s2.1-.55 2.75-1.5" />
    <circle cx="7.6" cy="8.1" r=".75" fill="currentColor" stroke="none" />
    <circle cx="12.4" cy="8.1" r=".75" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconReply = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 5.5 4 9.5l4 4" />
    <path d="M4.5 9.5H11a5 5 0 0 1 5 5v.5" />
  </Svg>
);

export const IconPencil = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12.5 4.5 3 3L8 15H5v-3l7.5-7.5Z" />
  </Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 6h11M8 6V4.5h4V6M6 6l.65 9.5h6.7L14 6" />
  </Svg>
);

export const IconMore = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="10" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="10" cy="10" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="15" cy="10" r="1.15" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Svg>
);

export const IconChecks = (p: IconProps) => (
  <Svg {...p}>
    <path d="m2.5 10.5 3.5 3.5 7-7.5M10 13.5l.5.5 7.5-8" />
  </Svg>
);

export const IconCompose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 4.5h-4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-4" />
    <path d="m14 3.5 2.5 2.5-6.5 6.5H7.5V10L14 3.5Z" />
  </Svg>
);

export const IconUsers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7.5" cy="7.25" r="2.75" />
    <path d="M2.75 16c.5-2.6 2.4-4 4.75-4s4.25 1.4 4.75 4" />
    <circle cx="13.9" cy="7.75" r="2.1" />
    <path d="M13.75 11.9c1.9 0 3.35 1.1 3.75 3.35" />
  </Svg>
);

export const IconUserPlus = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="7.25" r="3" />
    <path d="M2.75 16.25C3.25 13.5 5.35 12 8 12s4.75 1.5 5.25 4.25M15.5 5.5v5M13 8h5" />
  </Svg>
);

export const IconSliders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 6h7.75M15 6h1.5M3.5 14H5M8.75 14h7.75" />
    <circle cx="13.1" cy="6" r="1.85" />
    <circle cx="6.9" cy="14" r="1.85" />
  </Svg>
);

export const IconLogOut = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 4.5H5.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H8M11.5 6.5 15 10l-3.5 3.5M15 10H8" />
  </Svg>
);

export const IconMail = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4.75" width="14" height="10.5" rx="1.75" />
    <path d="m3.5 6 6.5 5 6.5-5" />
  </Svg>
);

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="7" y="7" width="9" height="9" rx="1.75" />
    <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
  </Svg>
);

export const IconLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 11.5a3 3 0 0 0 4.24 0l2.5-2.5A3 3 0 0 0 11 4.76l-.75.75M11.5 8.5a3 3 0 0 0-4.24 0l-2.5 2.5A3 3 0 0 0 9 15.24l.75-.75" />
  </Svg>
);

export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 8.5a4 4 0 0 1 8 0c0 3.5 1.5 5 1.5 5h-11S6 12 6 8.5ZM8.5 15.75a1.6 1.6 0 0 0 3 0" />
  </Svg>
);

export const IconBellOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 5.4A4 4 0 0 1 14 8.5c0 1.6.3 2.8.7 3.6M12.5 13.5h-8S6 12 6 8.5M8.5 15.75a1.6 1.6 0 0 0 3 0M3.5 3.5l13 13" />
  </Svg>
);

export const IconInfo = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="6.75" />
    <path d="M10 9.25v4.25" />
    <circle cx="10" cy="6.75" r=".8" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconFile = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5h5l4 4v8.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
    <path d="M11 3.5v4h4" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 4v8.5M6 9l4 4 4-4M4.5 16h11" />
  </Svg>
);

export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 10S5.25 5 10 5s7.5 5 7.5 5-2.75 5-7.5 5-7.5-5-7.5-5Z" />
    <circle cx="10" cy="10" r="2.25" />
  </Svg>
);

export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.2 5.2A7.9 7.9 0 0 1 10 5c4.75 0 7.5 5 7.5 5a13 13 0 0 1-1.9 2.5M12 14.6a6.8 6.8 0 0 1-2 .4c-4.75 0-7.5-5-7.5-5a13.4 13.4 0 0 1 2.9-3.4M3.5 3.5l13 13" />
  </Svg>
);

export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="3" />
    <path d="M10 2.75v1.5M10 15.75v1.5M2.75 10h1.5M15.75 10h1.5M4.9 4.9l1.05 1.05M14.05 14.05l1.05 1.05M4.9 15.1l1.05-1.05M14.05 5.95l1.05-1.05" />
  </Svg>
);

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.75 12.25A6.25 6.25 0 0 1 7.75 4.25a6.25 6.25 0 1 0 8 8Z" />
  </Svg>
);

export const IconMonitor = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="14" height="9.5" rx="1.5" />
    <path d="M7.5 16.5h5M10 13.5v3" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
    <path d="M7 9V6.75a3 3 0 0 1 6 0V9" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.5 8.5A5.75 5.75 0 0 0 4.9 6.5M4.5 11.5a5.75 5.75 0 0 0 10.6 2M4.5 3.5v3h3M15.5 16.5v-3h-3" />
  </Svg>
);

export const IconWarning = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3.5 17 16H3l7-12.5Z" />
    <path d="M10 8.5V12" />
    <circle cx="10" cy="14" r=".8" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconGoogle = ({ size = 18, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...props}>
    <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.56-5.17 3.56-8.8Z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.02c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.29 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.28a12 12 0 0 0 0 10.78l4.01-3.11Z" />
    <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77Z" />
  </svg>
);
