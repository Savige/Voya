type Props = {
  className?: string
  title?: string
}

/** Map + pin mark for Waypoint. */
export function BrandLogo({ className = 'h-8 w-8', title = 'Waypoint' }: Props) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id="wp-sky" x1="8" y1="6" x2="56" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="#38bdf8" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <path
        fill="url(#wp-sky)"
        d="M10 14c0-2.2 1.8-4 4-4h36c2.2 0 4 1.8 4 4v30c0 2.2-1.8 4-4 4H14c-2.2 0-4-1.8-4-4V14z"
      />
      <path fill="#e0f2fe" opacity=".35" d="M14 12h16l-4 36H14c-2.2 0-4-1.8-4-4V16c0-2.2 1.8-4 4-4z" />
      <path fill="#fff" opacity=".2" d="M30 12h20c2.2 0 4 1.8 4 4v26c0 2.2-1.8 4-4 4H26l4-34z" />
      <path
        fill="none"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="3 4"
        d="M18 40c6-8 10-6 16-12s8-4 14-8"
      />
      <path
        fill="#0f172a"
        d="M32 8.5c-5.4 0-9.8 4.3-9.8 9.7 0 7.2 9.8 18.3 9.8 18.3s9.8-11.1 9.8-18.3c0-5.4-4.4-9.7-9.8-9.7z"
      />
      <circle cx="32" cy="18" r="3.6" fill="#38bdf8" />
    </svg>
  )
}
