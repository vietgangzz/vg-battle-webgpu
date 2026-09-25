import React, { Suspense } from "react";
import { ActivityIndicator, View } from "react-native";

// three.js and the generated shaders are large; load them after the first paint
const BattleView = React.lazy(() => import("@/components/battle-view").then((m) => ({ default: m.BattleView })));

export default function Battle() {
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
