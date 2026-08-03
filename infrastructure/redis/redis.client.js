const { createClient } = require("redis");
const { getRedisUrl, isRedisEnabled } = require("./redis.config");

let clientPromise = null;

async function getRedisClient() {
  if (!isRedisEnabled()) return null;
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const client = createClient({ url: getRedisUrl() });
    client.on("error", (error) => {
      console.error("[redis] client error:", error.message);
    });
    await client.connect();
    if (process.env.NODE_ENV === "development") {
      console.log("[redis] connected");
    }
    return client;
  })().catch((error) => {
    console.error("[redis] connect failed:", error.message);
    clientPromise = null;
    return null;
  });

  return clientPromise;
}

async function createRedisDuplicate() {
  const client = await getRedisClient();
  if (!client) return null;
  const duplicate = client.duplicate();
  duplicate.on("error", (error) => {
    console.error("[redis] duplicate error:", error.message);
  });
  await duplicate.connect();
  return duplicate;
}

module.exports = {
  getRedisClient,
  createRedisDuplicate,
};
