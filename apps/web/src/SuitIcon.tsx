import { ClubIcon } from "@phosphor-icons/react/dist/csr/Club";
import { DiamondIcon } from "@phosphor-icons/react/dist/csr/Diamond";
import { HeartIcon } from "@phosphor-icons/react/dist/csr/Heart";
import { SpadeIcon } from "@phosphor-icons/react/dist/csr/Spade";
import { type Suit } from "@dglz/game-rules";

const SUIT_ICONS = { S: SpadeIcon, H: HeartIcon, C: ClubIcon, D: DiamondIcon };

export function SuitIcon({ suit }: { suit: Suit }) {
  const Icon = SUIT_ICONS[suit];
  return <Icon weight="fill" size="1em" aria-hidden="true" focusable="false" />;
}
