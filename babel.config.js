module.exports = (api) => {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // "use gpu" functions -> TypeGPU's shader AST at build time
    plugins: ["unplugin-typegpu/babel"],
  };
};
