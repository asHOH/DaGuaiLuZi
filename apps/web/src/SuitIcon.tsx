import { type Suit } from "@dglz/game-rules";

// Black suits: Skoll / Game-icons.net; red suits: Remix Icon.
// Attribution and licenses: /third-party-notices.txt.
const SUIT_PATHS: Record<Suit, string> = {
  S: "M458.915 307.705c0 62.63-54 91.32-91.34 91.34c-41.64 0-73.1-18.86-91.83-34.26c2.47 50.95 14.53 87.35 68.65 116h-176.79c54.12-28.65 66.18-65.05 68.65-116c-18.73 15.39-50.2 34.28-91.83 34.26c-37.29 0-91.34-28.71-91.34-91.34c0-114.47 80.64-83.32 202.91-276.49c122.28 193.17 202.92 162.03 202.92 276.49",
  H: "M2 8.5a5.5 5.5 0 0 1 10-3.163A5.5 5.5 0 0 1 22 8.5c0 7.5-10 12.985-10 12.985S2 16 2 8.5",
  C: "M477.443 295.143a104.45 104.45 0 0 1-202.26 36.67c-.08 68.73 4.33 114.46 69.55 149h-177.57c65.22-34.53 69.63-80.25 69.55-149a104.41 104.41 0 1 1-66.34-136.28a104.45 104.45 0 1 1 171.14 0a104.5 104.5 0 0 1 135.93 99.61",
  D: "m4.036 10.734l7.19-8.788a1 1 0 0 1 1.548 0l7.19 8.787a2 2 0 0 1 0 2.534l-7.19 8.787a1 1 0 0 1-1.548 0l-7.19-8.787a2 2 0 0 1 0-2.533",
};

// Centered square viewBoxes preserve silhouettes. Diamond area is 95% of heart.
// Black suits share a scale to preserve their original stem proportions.
const BLACK_SUIT_VIEW_BOX = "-24.440491 -24.440491 560.880983 560.880983";
const SUIT_VIEW_BOXES: Record<Suit, string> = {
  S: BLACK_SUIT_VIEW_BOX,
  H: "-1.885539 -1.645304 27.771077 27.771077",
  C: BLACK_SUIT_VIEW_BOX,
  D: "-0.246870 -0.246870 24.493740 24.493740",
};

export function SuitIcon({ suit }: { suit: Suit }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={SUIT_VIEW_BOXES[suit]}
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={SUIT_PATHS[suit]} />
    </svg>
  );
}
