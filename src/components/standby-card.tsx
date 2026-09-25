import { useFonts } from "expo-font";
import { useEffect } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const LOCKUP = require("../../assets/brand/lockup.png");
const LIME = "#D5F64B";

/**
 * Over the folded-screen intro: the vgang lockup and an invitation to open the
 * phone, with a lime glint running down the hinge line. Fades away the moment
 * the phone starts to open.
 */
export function StandbyCard({ visible }: { visible: boolean }) {
  const [fontsLoaded] = useFonts({ ManropeSemiBold: require("../../assets/fonts/Manrope-SemiBold.ttf") });
  const shown = useSharedValue(0);
  const glint = useSharedValue(0);

  useEffect(() => {
    shown.value = withTiming(visible ? 1 : 0, { duration: visible ? 900 : 220, easing: Easing.out(Easing.quad) });
  }, [visible, shown]);

  useEffect(() => {
    // a slow pulse down the hinge: "open here"
    glint.value = withRepeat(
      withSequence(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), withDelay(900, withTiming(0, { duration: 0 }))),
      -1,
    );
  }, [glint]);

  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));
  const hinge = useAnimatedStyle(() => ({
    top: `${glint.value * 100 - 20}%`,
    opacity: Math.sin(glint.value * Math.PI) * 0.9,
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, fade, { pointerEvents: "none" }]}>
      <View style={styles.hingeTrack}>
        <Animated.View style={[styles.hingeGlint, hinge]} />
      </View>
      <View style={styles.bottom}>
        <Image source={LOCKUP} style={styles.lockup} resizeMode="contain" />
        {fontsLoaded && <Text style={styles.cta}>UNFOLD TO FIGHT</Text>}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hingeTrack: { position: "absolute", top: 0, bottom: 0, left: "50%", width: 2, marginLeft: -1, overflow: "hidden" },
  hingeGlint: { position: "absolute", left: 0, right: 0, height: "20%", backgroundColor: LIME, borderRadius: 1 },
  bottom: { position: "absolute", left: 0, right: 0, bottom: "7%", alignItems: "center", gap: 14 },
  lockup: { width: "46%", height: 40, opacity: 0.92 },
  cta: { color: LIME, fontFamily: "ManropeSemiBold", fontSize: 12, letterSpacing: 3.5 },
});
