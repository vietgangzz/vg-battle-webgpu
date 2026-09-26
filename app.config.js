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
      // the personal team signs device builds
      appleTeamId: "SL53MJAWWY",
      bundleIdentifier: "studio.vgang.battle",
      supportsTablet: true,
      requireFullScreen: true,
      // edge to edge: no status bar, at launch or after (the app-wide setting,
      // which React Native's StatusBar drives)
      infoPlist: {
        UIStatusBarHidden: true,
        UIViewControllerBasedStatusBarAppearance: false,
      },
    },
    android: {
      package: "studio.vgang.battle",
    },
    plugins: ["expo-router", "react-native-webgpu", "expo-audio", "expo-font", "./plugins/with-scene-lifecycle"],
  },
};
