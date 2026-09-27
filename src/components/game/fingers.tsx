/**
 * Fingertips drawn over the screen for the showcase demo, the way a screen
 * recording shows touches: a soft disc under each thumb, pressing in when it
 * taps. Positions are in the window's points; everything runs on the UI thread.
 */
import { memo, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

export interface FingerApi {
  place(i: number, x: number, y: number): void;
  show(i: number, on: boolean): void;
  press(i: number): void;
}

const R = 23;
type Finger = { x: SharedValue<number>; y: SharedValue<number>; on: SharedValue<number>; press: SharedValue<number> };

const Tip = memo(function Tip({ f }: { f: Finger }) {
  const style = useAnimatedStyle(() => ({
    opacity: f.on.value,
    transform: [{ translateX: f.x.value - R }, { translateY: f.y.value - R }, { scale: 1 - 0.18 * f.press.value }],
  }));
  const ring = useAnimatedStyle(() => ({ opacity: f.press.value, transform: [{ scale: 1 + 0.9 * (1 - f.press.value) }] }));
  return (
    <Animated.View style={[styles.tip, style]}>
      <Animated.View style={[styles.ring, ring]} />
    </Animated.View>
  );
});

export const Fingers = memo(function Fingers({ api }: { api: { current: FingerApi | null } }) {
  const a = { x: useSharedValue(0), y: useSharedValue(0), on: useSharedValue(0), press: useSharedValue(0) };
  const b = { x: useSharedValue(0), y: useSharedValue(0), on: useSharedValue(0), press: useSharedValue(0) };
  const c = { x: useSharedValue(0), y: useSharedValue(0), on: useSharedValue(0), press: useSharedValue(0) };
  const all = [a, b, c];
  useEffect(() => {
    api.current = {
      place(i, x, y) {
        all[i].x.set(x);
        all[i].y.set(y);
      },
      show(i, on) {
        all[i].on.set(withTiming(on ? 1 : 0, { duration: on ? 90 : 220 }));
      },
      press(i) {
        all[i].press.set(withSequence(withTiming(1, { duration: 70 }), withTiming(0, { duration: 260 })));
      },
    };
    return () => {
      api.current = null;
    };
    // the shared values live as long as the component
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}>
      {all.map((f, i) => (
        <Tip key={i} f={f} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  tip: {
    position: "absolute",
    left: 0,
    top: 0,
    width: R * 2,
    height: R * 2,
    borderRadius: R,
    backgroundColor: "rgba(255,255,255,0.30)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.8)",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  ring: { ...StyleSheet.absoluteFill, borderRadius: R, borderWidth: 3, borderColor: "rgba(255,255,255,0.95)" },
});
