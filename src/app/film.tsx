import React, { Suspense } from "react";
import { ActivityIndicator, View } from "react-native";

// the showcase film, played through (the game's source material)
const BattleView = React.lazy(() => import("@/components/battle-view").then((m) => ({ default: m.BattleView })));

export default function Film() {
  return (
    <Suspense
      fallback={
        <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#D5F64B" />
        </View>
      }
    >
      <BattleView />
    </Suspense>
  );
}
