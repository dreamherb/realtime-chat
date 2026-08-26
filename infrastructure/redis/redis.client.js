const { createClient } = require("redis");
const { isRedisEnabled, getRedisClientOptions } = require("./redis.config");

let clientPromise = null;
const clients = new Set();

async function getRedisClient() {
  if (!isRedisEnabled()) return null;
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const client = createClient(getRedisClientOptions());
    clients.add(client);
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
  clients.add(duplicate);
  duplicate.on("error", (error) => {
    console.error("[redis] duplicate error:", error.message);
  });
  await duplicate.connect();
  return duplicate;
}

async function closeRedis() {
  clientPromise = null;
  const pending = [...clients];
  clients.clear();
  await Promise.all(
    pending.map((client) => client.close().catch(() => client.destroy())),
  );
}

module.exports = {
  getRedisClient,
  createRedisDuplicate,
  closeRedis,
};
