/**
 * The game's icon set: one ink weight, rounded, on a 48-unit grid. The Little
 * Giant portrait is the approved brand outline and eye cut-outs (the same SVG
 * the film's 3D body was inflated from, battle/lib/mascot.py).
 */
import Svg, { Circle, G, Path, Rect } from "react-native-svg";

import { INK, IVORY, LIME } from "./theme";

export interface IconProps {
  size?: number;
  color?: string;
}

const stroke = (color: string, w = 3.2) => ({ stroke: color, strokeWidth: w, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" });

/** A katana, edge up, tip to the top right. */
export function BladeIcon({ size = 28, color = IVORY }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path d="M18.2 32.6 L37.4 11.4 Q40.6 7.9 41.4 7.2 Q40.9 10.3 38.9 12.9 L20.3 34.7 Z" fill={color} />
      <Path d="M13.6 29.6 L21.4 37.4" {...stroke(color, 3.6)} />
      <Path d="M8.6 42.4 L16.4 34.6" {...stroke(color, 4.6)} />
    </Svg>
  );
}

export function JumpIcon({ size = 24, color = IVORY }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path d="M13 25 L24 14 L35 25" {...stroke(color, 3.6)} />
      <Path d="M13 35 L24 24 L35 35" {...stroke(color, 3.6)} opacity={0.5} />
      <Path d="M12 42 H36" {...stroke(color, 2.4)} opacity={0.35} />
    </Svg>
  );
}

export function DashIcon({ size = 24, color = IVORY }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path d="M7 17 H21 M4 24 H23 M7 31 H21" {...stroke(color, 3)} opacity={0.55} />
      <Path d="M27 13 L38 24 L27 35" {...stroke(color, 3.8)} />
    </Svg>
  );
}

export function GuardIcon({ size = 22, color = IVORY }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path d="M24 6.5 L38.5 11.8 V23 C38.5 32 32.5 38.6 24 41.6 C15.5 38.6 9.5 32 9.5 23 V11.8 Z" {...stroke(color, 3.2)} />
      <Path d="M24 13 V35" {...stroke(color, 2.4)} opacity={0.5} />
    </Svg>
  );
}

/** The lime streak: a thrust that runs through everything in line. */
export function StreakIcon({ size = 24, color = IVORY }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path d="M8 38 L35 11" {...stroke(color, 3.8)} />
      <Path d="M24.5 11 H35 V21.5" {...stroke(color, 3.8)} />
      <Path d="M9 25 L15 31 M17 17 L20.5 20.5" {...stroke(color, 2.4)} opacity={0.5} />
      <Circle cx={39.5} cy={6.5} r={2.2} fill={color} />
    </Svg>
  );
}

/** Kiếm khí: a crescent of sword light flying out, with its wake. */
export function WaveIcon({ size = 24, color = IVORY }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path d="M27 8 C38 13 42 26 36 39 C34 29 29 19 17 12 C21 10 24 9 27 8 Z" fill={color} />
      <Path d="M8 30 H22 M5 22 H17 M10 38 H26" {...stroke(color, 2.6)} opacity={0.55} />
    </Svg>
  );
}

/** The bloom: the film's closing flower, for the ultimate. */
export function BloomIcon({ size = 30, color = IVORY }: IconProps) {
  const petal = "M24 7.5 C28.6 13.4 28.6 20.2 24 24 C19.4 20.2 19.4 13.4 24 7.5 Z";
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <G>
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <Path key={a} d={petal} fill={color} opacity={a % 120 === 0 ? 1 : 0.6} transform={`rotate(${a} 24 24)`} />
        ))}
      </G>
      <Circle cx={24} cy={24} r={3.4} fill={INK} />
      <Circle cx={24} cy={24} r={1.6} fill={color} />
    </Svg>
  );
}

export function PauseIcon({ size = 18, color = IVORY }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Rect x={12} y={9} width={8.5} height={30} rx={3} fill={color} />
      <Rect x={27.5} y={9} width={8.5} height={30} rx={3} fill={color} />
    </Svg>
  );
}

export function ChevronIcon({ size = 26, color = LIME }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path d="M16 10 L30 24 L16 38" {...stroke(color, 5)} />
    </Svg>
  );
}

// ---------------------------------------------------------------- the Little Giant (brand SVG)
const BODY =
  "M706 313.5L705 268L711 268.5Q717 269 729.5 272.5Q742 276 757 284Q772 292 784.5 304Q797 316 804.5 329Q812 342 816.5 360.5Q821 379 821 410Q821 441 823.5 455.5Q826 470 831.5 483Q837 496 848 512Q859 528 862.5 535.5Q866 543 867.5 549Q869 555 869 568Q869 581 865.5 591Q862 601 855 611Q848 621 841.5 627Q835 633 827.5 638Q820 643 800.5 651Q781 659 754 665.5Q727 672 691 676.5Q655 681 620 681.5Q585 682 562.5 679.5Q540 677 527 674Q514 671 506.5 668Q499 665 494 663.5Q489 662 478.5 656.5Q468 651 461.5 646.5Q455 642 446.5 634Q438 626 430 614.5Q422 603 416 587.5Q410 572 408 560Q406 548 406 531.5Q406 515 407 507.5Q408 500 413.5 480Q419 460 426.5 443.5Q434 427 443 412.5Q452 398 461.5 386Q471 374 482 362.5Q493 351 506.5 339.5Q520 328 534.5 318Q549 308 565.5 299Q582 290 594 285Q606 280 621.5 275.5Q637 271 639 271.5Q641 272 653 287.5Q665 303 682 328.5Q699 354 701.5 356.5Q704 359 705.5 359L707 359L706 313.5Z";
const EYES = [
  "M557.5 419.5L559 415.5L562 416Q565 416.5 614 448L663 479.5L662 486Q661 492.5 656.5 501Q652 509.5 649 512Q646 514.5 643.5 517.5Q641 520.5 635.5 523.5Q630 526.5 623 527.5Q616 528.5 606.5 525.5Q597 522.5 588.5 515Q580 507.5 573 496Q566 484.5 562.5 474.5Q559 464.5 557.5 456.5Q556 448.5 556 436Q556 423.5 557.5 419.5Z",
  "M755.5 455.5L783 433L785 434L787 435L787.5 437Q788 439 789 453.5Q790 468 788.5 476Q787 484 784.5 490.5Q782 497 776.5 504Q771 511 767 513Q763 515 757 515Q751 515 747.5 513.5Q744 512 743 510.5Q742 509 739 506.5Q736 504 733.5 499.5Q731 495 729.5 490.5Q728 486 728 482L728 478L755.5 455.5Z",
];

/** SORA (lime) or KAGE (ink with crimson eyes) as the flat brand mark. */
export function LittleGiant({ size = 40, body = LIME, eyes = INK, band }: { size?: number; body?: string; eyes?: string; band?: string }) {
  return (
    <Svg width={size} height={size} viewBox="396 258 484 434">
      <Path d={BODY} fill={body} />
      {band && <Rect x={400} y={380} width={480} height={26} fill={band} opacity={0.95} transform="rotate(4 640 393)" />}
      {EYES.map((d) => (
        <Path key={d.slice(0, 12)} d={d} fill={eyes} />
      ))}
    </Svg>
  );
}
