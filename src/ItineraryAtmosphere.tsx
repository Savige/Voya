/** Night wash (blue → indigo) + visible static stars for Itinerary Destinations. */
export function ItineraryAtmosphere() {
  const stars = [
    [6, 8],
    [14, 22],
    [22, 11],
    [30, 36],
    [38, 14],
    [46, 28],
    [54, 9],
    [62, 32],
    [70, 16],
    [78, 40],
    [86, 12],
    [94, 26],
    [10, 48],
    [18, 62],
    [26, 52],
    [34, 70],
    [42, 58],
    [50, 78],
    [58, 54],
    [66, 68],
    [74, 48],
    [82, 72],
    [90, 56],
    [8, 84],
    [28, 88],
    [48, 44],
    [68, 86],
    [88, 80],
    [16, 34],
    [56, 20],
    [76, 6],
    [40, 24],
  ] as const

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.5rem]"
      aria-hidden
    >
      {/* Deep navy → indigo wash (the purple/blue night sky) */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_0%,#1e3a5f_0%,transparent_55%),radial-gradient(ellipse_at_88%_18%,#312e81_0%,transparent_48%),linear-gradient(165deg,#020617_0%,#0f172a_42%,#020617_100%)]" />
      {stars.map(([x, y], i) => {
        const large = i % 5 === 0
        return (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: large ? 3 : 2,
              height: large ? 3 : 2,
              background: '#fff',
              opacity: large ? 1 : 0.9,
              boxShadow: large
                ? '0 0 8px 2px rgba(255,255,255,0.9), 0 0 14px rgba(186,230,253,0.7)'
                : '0 0 5px 1px rgba(255,255,255,0.75)',
            }}
          />
        )
      })}
    </div>
  )
}
