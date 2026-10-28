module.exports = function (api) {
  // the web build (the PC version) only: a library or two reads import.meta, which a classic script cannot
  const web = api.caller((c) => !!c && c.platform === 'web');
  return {
    presets: [web ? ['babel-preset-expo', { unstable_transformImportMeta: true }] : 'babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
