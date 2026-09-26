/**
 * The action buttons' glyphs: bold, filled shapes painted with a gradient from
 * the skill's colour to near white, on a 64-unit grid. Each takes the colour
 * of its element (see ELEMENT in controls.tsx).
 */
import { useId } from "react";
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from "react-native-svg";

export interface GlyphProps {
  size: number;
  color: string;
  /** darker ink for a lit (solid) button face */
  ink?: string;
}

/** a gradient from the colour to a near-white highlight, top-right to bottom-left */
function Paint({ id, color, ink }: { id: string; color: string; ink?: string }) {
  return (
    <LinearGradient id={id} x1="1" y1="0" x2="0" y2="1">
      <Stop offset="0" stopColor={ink ?? "#FFFFFF"} stopOpacity={ink ? 1 : 0.98} />
      <Stop offset="0.55" stopColor={ink ?? color} stopOpacity={1} />
      <Stop offset="1" stopColor={ink ?? color} stopOpacity={0.85} />
    </LinearGradient>
  );
}

const useGid = () => `g${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

/** SLASH: a katana cutting up-right through the crescent of its own swing. */
export function SlashGlyph({ size, color, ink }: GlyphProps) {
  const id = useGid();
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <Paint id={id} color={color} ink={ink} />
      </Defs>
      <Path d="M8 46 C14 22 32 8 56 8 C38 14 24 26 16 48 Z" fill={ink ?? color} opacity={0.38} />
      <Path d="M19 44 L49 13 Q54 8 57 7 Q56 11 51 16 L22 47 Z" fill={`url(#${id})`} />
      <Path d="M13 39 L25 51" stroke={ink ?? "#FFFFFF"} strokeWidth={4.2} strokeLinecap="round" />
      <Path d="M7 57 L17 47" stroke={ink ?? color} strokeWidth={5.2} strokeLinecap="round" />
    </Svg>
  );
}

/** STREAK: a spear of light piercing ahead, speed lines streaming off it. */
export function StreakGlyph({ size, color, ink }: GlyphProps) {
  const id = useGid();
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <Paint id={id} color={color} ink={ink} />
      </Defs>
      <Path d="M8 50 L40 26 L44 31 L12 55 Z" fill={`url(#${id})`} />
      <Path d="M36 14 L58 8 L52 30 L45 23 L41 19 Z" fill={`url(#${id})`} />
      <Path d="M6 36 L22 24 M14 46 L26 37 M24 54 L34 46" stroke={ink ?? color} strokeWidth={3} strokeLinecap="round" opacity={0.6} />
    </Svg>
  );
}

/** KIẾM KHÍ: a crescent of sword light, sparks trailing. */
export function CrescentGlyph({ size, color, ink }: GlyphProps) {
  const id = useGid();
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <Paint id={id} color={color} ink={ink} />
      </Defs>
      <Path d="M30 6 C48 10 58 26 54 44 C51 56 40 60 32 58 C44 52 48 38 44 26 C40 16 32 10 30 6 Z" fill={`url(#${id})`} />
      <Path d="M10 22 H26 M6 32 H24 M12 42 H28" stroke={ink ?? color} strokeWidth={3.2} strokeLinecap="round" opacity={0.55} />
      <Circle cx={22} cy={12} r={2.2} fill={ink ?? "#FFFFFF"} />
      <Circle cx={16} cy={52} r={1.8} fill={ink ?? "#FFFFFF"} opacity={0.8} />
    </Svg>
  );
}

/** ULTIMATE (Liên Hoa): a lotus opening on the water, a star at its heart. */
export function LotusGlyph({ size, color, ink }: GlyphProps) {
  const id = useGid();
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <Paint id={id} color={color} ink={ink} />
      </Defs>
      <G>
        <Path d="M32 8 C40 18 41 32 32 42 C23 32 24 18 32 8 Z" fill={`url(#${id})`} />
        <Path d="M32 42 C24 38 15 30 13 18 C23 20 30 28 32 42 Z" fill={`url(#${id})`} opacity={0.88} />
        <Path d="M32 42 C40 38 49 30 51 18 C41 20 34 28 32 42 Z" fill={`url(#${id})`} opacity={0.88} />
        <Path d="M32 44 C22 44 11 40 5 31 C16 29 26 34 32 44 Z" fill={ink ?? color} opacity={0.62} />
        <Path d="M32 44 C42 44 53 40 59 31 C48 29 38 34 32 44 Z" fill={ink ?? color} opacity={0.62} />
      </G>
      <Path d="M12 52 C22 49 42 49 52 52" stroke={ink ?? color} strokeWidth={3} strokeLinecap="round" opacity={0.55} />
      <Path d="M32 20 L34 26 L40 27 L35 30 L37 36 L32 32 L27 36 L29 30 L24 27 L30 26 Z" fill={ink ? "#FFFFFF" : "#FFFFFF"} opacity={0.95} />
    </Svg>
  );
}

/** DASH: a gust curling forward. */
export function GustGlyph({ size, color, ink }: GlyphProps) {
  const id = useGid();
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <Paint id={id} color={color} ink={ink} />
      </Defs>
      <Path d="M6 26 H40 C48 26 52 20 50 15 C48 10 41 10 39 15" stroke={`url(#${id})`} strokeWidth={5.5} strokeLinecap="round" fill="none" />
      <Path d="M10 38 H48 C56 38 60 44 57 50 C54 55 47 54 46 49" stroke={`url(#${id})`} strokeWidth={5.5} strokeLinecap="round" fill="none" />
      <Path d="M6 50 H30" stroke={ink ?? color} strokeWidth={4} strokeLinecap="round" opacity={0.55} />
    </Svg>
  );
}

/** JUMP: twin chevrons springing up off a line of ground. */
export function RiseGlyph({ size, color, ink }: GlyphProps) {
  const id = useGid();
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <Paint id={id} color={color} ink={ink} />
      </Defs>
      <Path d="M14 30 L32 12 L50 30 L42 30 L32 20 L22 30 Z" fill={`url(#${id})`} />
      <Path d="M14 44 L32 26 L50 44 L42 44 L32 34 L22 44 Z" fill={`url(#${id})`} opacity={0.6} />
      <Path d="M12 54 H52" stroke={ink ?? color} strokeWidth={4} strokeLinecap="round" opacity={0.5} />
    </Svg>
  );
}

/** GUARD: a shield with a lotus pressed into it. */
export function ShieldGlyph({ size, color, ink }: GlyphProps) {
  const id = useGid();
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <Paint id={id} color={color} ink={ink} />
      </Defs>
      <Path d="M32 6 L54 14 V30 C54 44 45 54 32 59 C19 54 10 44 10 30 V14 Z" fill={`url(#${id})`} />
      <Path d="M32 18 C37 24 37 32 32 38 C27 32 27 24 32 18 Z M32 38 C27 36 22 32 21 26 C27 27 30 31 32 38 Z M32 38 C37 36 42 32 43 26 C37 27 34 31 32 38 Z" fill={ink ? "#FFFFFF" : "#0B1624"} opacity={0.55} />
    </Svg>
  );
}

/** SPRINT: two chevrons driving forward, flame-like streaks behind. */
export function SprintGlyph({ size, color, ink }: GlyphProps) {
  const id = useGid();
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <Paint id={id} color={color} ink={ink} />
      </Defs>
      <Path d="M22 14 L40 32 L22 50 L14 50 L32 32 L14 14 Z" fill={`url(#${id})`} />
      <Path d="M38 14 L56 32 L38 50 L30 50 L48 32 L30 14 Z" fill={`url(#${id})`} />
      <Path d="M4 24 H12 M2 32 H11 M4 40 H12" stroke={ink ?? color} strokeWidth={3} strokeLinecap="round" opacity={0.55} />
    </Svg>
  );
}
