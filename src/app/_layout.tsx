import { Slot } from "expo-router";
import { StatusBar, View } from "react-native";

export { ErrorBoundary } from "expo-router";

/**
 * Edge to edge, no navigation stack: on iOS 27 a UINavigationController lays a
 * full-screen floating-bar host over its content that swallows every touch,
 * which a touch-driven game cannot have. One screen at a time is all we need.
 */
export default function Layout() {
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar hidden />
      <Slot />
    </View>
  );
}
