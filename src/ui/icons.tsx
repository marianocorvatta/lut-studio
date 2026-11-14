/** Íconos de trazo fino (SVG, color del texto). */
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

/** Panel lateral (a la derecha). `open`: el panel se ve relleno suave. */
export function SidebarIcon({ open }: { open: boolean }) {
  return (
    <svg {...base}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M10 3.4v9.2" />
      {open && <rect x="10.6" y="3.6" width="2.8" height="8.8" rx="0.8" fill="currentColor" stroke="none" opacity="0.35" />}
    </svg>
  )
}

/** Ampliar: esquinas hacia afuera. */
export function ExpandIcon() {
  return (
    <svg {...base}>
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </svg>
  )
}

/** Reducir: esquinas hacia adentro. */
export function CollapseIcon() {
  return (
    <svg {...base}>
      <path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" />
    </svg>
  )
}
