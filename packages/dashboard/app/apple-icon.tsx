import { ImageResponse } from 'next/og';

// Apple touch icon (180x180): the FanThynks Shared Roof mark on the brand
// petrol tile with a soft teal glow, retaining the gold roof from the brand kit.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(circle at 50% 0%, rgba(103,189,178,0.22), #0c1a20 70%)',
        }}
      >
        <svg width="112" height="126" viewBox="20 17 140 158">
          <polygon
            points="32,57 90,27 148,57 148,77.27 99,51.92 99,160.34 90,165 81,160.34 81,51.92 32,77.27"
            fill="#cfa029"
          />
          <polygon
            points="32,82.27 50,72.95 50,92 76,78.55 76,98.82 50,112.27 50,144.31 32,135"
            fill="#f5f0e8"
          />
        </svg>
      </div>
    ),
    size,
  );
}
