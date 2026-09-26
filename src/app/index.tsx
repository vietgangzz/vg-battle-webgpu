import { useLocalSearchParams } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import React, { Suspense, useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

// three.js and the generated shaders are large; load them after the first paint
const GameView = React.lazy(() => import("@/components/game-view").then((m) => ({ default: m.GameView })));

export default function Game() {
  // `?explore=1` opens straight into the valley (for testing builds where nothing can be tapped)
  const { explore, brawl } = useLocalSearchParams<{ explore?: string; brawl?: string }>();
  // the game is played lying down, whichever way the phone is turned; the film route keeps its own
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);
  return (
    <Suspense
      fallback={
        <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#D5F64B" />
        </View>
      }
    >
      <GameView autostart={explore === "1"} brawl={brawl === "1"} />
    </Suspense>
  );
}
