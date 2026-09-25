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
      // the film runs edge to edge: no status bar at launch; the screen hides it after
      // (react-native-screens owns it, which needs view-controller-based appearance)
      infoPlist: {
        UIStatusBarHidden: true,
        UIViewControllerBasedStatusBarAppearance: true,
      },
    },
    android: {
      package: "studio.vgang.battle",
    },
    plugins: ["expo-router", "react-native-webgpu", "expo-audio", "expo-font", "./plugins/with-scene-lifecycle"],
  },
};
