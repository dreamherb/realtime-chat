function getRedisUrl() {
  return process.env.REDIS_URL || null;
}

function isRedisEnabled() {
  return Boolean(getRedisUrl());
}

module.exports = {
  getRedisUrl,
  isRedisEnabled,
};
