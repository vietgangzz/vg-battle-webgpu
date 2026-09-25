const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// the film's geometry + tracks ship as one binary asset
config.resolver.assetExts.push("bin");

// Bare `three` (and the addons that import it) must resolve to the WebGPU build;
// `three/tsl` and `three/addons/*` resolve through the package exports as-is.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "three") {
    moduleName = "three/webgpu";
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
