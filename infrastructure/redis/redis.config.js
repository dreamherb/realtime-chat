function getRedisUrl() {
  return process.env.REDIS_URL || null;
}

function isRedisEnabled() {
  return Boolean(getRedisUrl());
}

function isRedisTlsEnabled() {
  const url = getRedisUrl() || "";
  if (url.startsWith("rediss://")) return true;
  const flag = (process.env.REDIS_TLS || "").toLowerCase();
  return flag === "1" || flag === "true";
}

function getRedisClientOptions() {
  const options = { url: getRedisUrl() };
  if (isRedisTlsEnabled()) {
    options.socket = { tls: true };
  }
  return options;
}

module.exports = {
  getRedisUrl,
  isRedisEnabled,
  isRedisTlsEnabled,
  getRedisClientOptions,
};
