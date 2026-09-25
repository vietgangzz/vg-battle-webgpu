import { useFonts } from "expo-font";
import { useEffect } from "react";
import { Image, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from "react-native-reanimated";

/** Same timing as encode.sh: card fades in 0.6 s, the URL follows at 0.7 s, out to black from 2.0 s. */
export const END_CARD_SECONDS = 2.5;

const LOCKUP = require("../../assets/brand/lockup.png");
const CHARCOAL = "#121619";
const LIME = "#D5F64B";

/**
 * The vgang lockup + site URL. Laid out on the film's 16:9 frame, which is
 * centred and fit inside whatever the screen is (unfolded, folded, rotated).
 */
export function EndCard() {
  const [fontsLoaded] = useFonts({ ManropeSemiBold: require("../../assets/fonts/Manrope-SemiBold.ttf") });
  const { width, height } = useWindowDimensions();
  const frameW = Math.min(width, (height * 16) / 9);
  const k = frameW / 1920;

  const card = useSharedValue(0);
  const url = useSharedValue(0);
  useEffect(() => {
    const ease = Easing.inOut(Easing.quad);
    card.value = withSequence(
      withTiming(1, { duration: 600, easing: ease }),
      withDelay(1400, withTiming(0, { duration: 500, easing: ease })),
    );
    url.value = withDelay(700, withTiming(1, { duration: 500, easing: ease }));
  }, [card, url]);

  const cardStyle = useAnimatedStyle(() => ({ opacity: card.value }));
  const urlStyle = useAnimatedStyle(() => ({ opacity: url.value }));

  return (
    <View style={[styles.black, { pointerEvents: "none" }]}>
      <Animated.View style={[styles.card, cardStyle]}>
        {/* the 1920x1080 card, scaled: 760x169 lockup at (580, 450), URL top at y=688 */}
        <View style={{ width: frameW, height: frameW * (9 / 16) }}>
          <Image source={LOCKUP} style={{ position: "absolute", left: 580 * k, top: 450 * k, width: 760 * k, height: 169 * k }} />
          {fontsLoaded && (
            <Animated.View style={[{ position: "absolute", left: 0, right: 0, top: 688 * k }, urlStyle]}>
              <Text style={[styles.url, { fontSize: 46 * k, lineHeight: 56 * k }]}>vgang.studio</Text>
            </Animated.View>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  black: { ...StyleSheet.absoluteFill, backgroundColor: "#000" },
  card: { ...StyleSheet.absoluteFill, backgroundColor: CHARCOAL, alignItems: "center", justifyContent: "center" },
  url: { color: LIME, fontFamily: "ManropeSemiBold", textAlign: "center", includeFontPadding: false },
});
