module.exports = {
  expo: {
    name: "VGANG Battle",
    slug: "vg-battle-webgpu",
    scheme: "vgbattle",
    // follow the device: portrait, landscape, and the unfolded inner display
    orientation: "default",
    userInterfaceStyle: "dark",
    backgroundColor: "#000000",
    ios: {
      bundleIdentifier: "studio.vgang.battle",
      supportsTablet: true,
      requireFullScreen: true,
    },
    android: {
      package: "studio.vgang.battle",
    },
    plugins: ["expo-router", "react-native-webgpu", "expo-audio", "expo-font", "./plugins/with-scene-lifecycle"],
  },
};
