const { getRedisClient } = require("./redis.client");

function connKey(userId) {
  return `presence:conn:${userId}`;
}

const ONLINE_SET = "presence:online";

/**
 * 멀티탭 대비 connection refcount.
 * 첫 연결에서만 online set에 추가, 마지막 끊김에서만 제거.
 */
async function markOnline(userId) {
  const redis = await getRedisClient();
  if (!redis) return false;

  const key = connKey(userId);
  const count = await redis.incr(key);
  await redis.expire(key, 60 * 60 * 24);
  if (count === 1) {
    await redis.sAdd(ONLINE_SET, String(userId));
  }
  return true;
}

async function markOffline(userId) {
  const redis = await getRedisClient();
  if (!redis) return false;

  const key = connKey(userId);
  const count = await redis.decr(key);
  if (count <= 0) {
    await redis.del(key);
    await redis.sRem(ONLINE_SET, String(userId));
  }
  return true;
}

async function listOfflineUserIds(userIds) {
  const redis = await getRedisClient();
  if (!redis || !userIds.length) return userIds;

  const pipeline = redis.multi();
  for (const userId of userIds) {
    pipeline.sIsMember(ONLINE_SET, String(userId));
  }
  const results = await pipeline.exec();

  return userIds.filter((_, index) => !results[index]);
}

module.exports = {
  markOnline,
  markOffline,
  listOfflineUserIds,
};
