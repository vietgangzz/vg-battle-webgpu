module.exports = {
  expo: {
    name: "VGANG Battle",
    slug: "vg-battle-webgpu",
    scheme: "vgbattle",
    // follow the device: portrait, landscape, and the unfolded inner display
    orientation: "default",
    userInterfaceStyle: "dark",
    icon: "./assets/images/icon.png",
    version: "1.0.0",
    backgroundColor: "#000000",
    ios: {
      // the team signs device builds and the TestFlight uploads (scripts/testflight.sh)
      appleTeamId: "SL53MJAWWY",
      // only the standard HTTPS the OS provides: no export compliance paperwork per build
      config: { usesNonExemptEncryption: false },
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
