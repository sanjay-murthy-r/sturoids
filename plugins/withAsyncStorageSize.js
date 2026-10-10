// Raises the room Android gives AsyncStorage's database (6 MB by default) to 50 MB. The store saves one row per
// collection, each read back up to about 2 MB, and the whole database is capped too: this lifts that cap well clear of
// a long-used app, while each row stays small enough to read.
const { withGradleProperties } = require('expo/config-plugins');

const KEY = 'AsyncStorage_db_size_in_MB';

module.exports = function withAsyncStorageSize(config, { sizeInMB = 50 } = {}) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter((item) => !(item.type === 'property' && item.key === KEY));
    cfg.modResults.push({ type: 'property', key: KEY, value: String(sizeInMB) });
    return cfg;
  });
};
