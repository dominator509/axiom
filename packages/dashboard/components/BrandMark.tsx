// FanThynks "Shared Roof" mark: a gold T whose crossbar is the FanLynks
// hexagon roof, with the ivory F underneath. Same geometry as the brand kit
// (fanthynks-mark-dark.svg); inlined so it renders without an extra request.
export default function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      <svg viewBox="20 17 140 158" focusable="false">
        <polygon
          points="32,57 90,27 148,57 148,77.27 99,51.92 99,160.34 90,165 81,160.34 81,51.92 32,77.27"
          fill="#cfa029"
        />
        <polygon
          points="32,82.27 50,72.95 50,92 76,78.55 76,98.82 50,112.27 50,144.31 32,135"
          fill="#f5f0e8"
        />
      </svg>
    </span>
  );
}

export function BrandWordmark() {
  return (
    <strong className="brand-wordmark">
      Fan<span>Thynks</span>
    </strong>
  );
}
