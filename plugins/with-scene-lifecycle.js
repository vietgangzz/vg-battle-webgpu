/**
 * Adopt the UIScene life cycle, which apps built with the iOS 27 SDK must use
 * (UIKit refuses to launch them otherwise). The SDK 57 AppDelegate template
 * still creates its window at launch; this hands that job to Expo's
 * `ExpoAppSceneDelegate` (expo/ios/AppDelegates), which builds the window from
 * the connecting scene, starts React Native in it and forwards URL and life
 * cycle events to the app delegate. Drop this once the template adopts scenes.
 */
const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const WINDOW_AT_LAUNCH = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "EXExpoAppSceneDelegate",
          },
        ],
      },
    };
    return c;
  });
  return withAppDelegate(config, (c) => {
    let src = c.modResults.contents;
    if (!src.includes("ExpoReactNativeFactoryProvider")) {
      src = src.replace(
        "class AppDelegate: ExpoAppDelegate {",
        "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {",
      );
      if (!src.includes(WINDOW_AT_LAUNCH)) {
        throw new Error("with-scene-lifecycle: AppDelegate template changed; update the plugin");
      }
      src = src.replace(
        WINDOW_AT_LAUNCH,
        "    // the window is created by ExpoAppSceneDelegate when the scene connects",
      );
    }
    c.modResults.contents = src;
    return c;
  });
};
