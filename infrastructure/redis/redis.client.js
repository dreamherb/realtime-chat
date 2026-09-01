const { createClient } = require("redis");

function getRedisUrl() {
  return process.env.REDIS_URL || null;
}

function isRedisTlsEnabled() {
  const url = getRedisUrl() || "";
  if (url.startsWith("rediss://")) return true;
  const flag = (process.env.REDIS_TLS || "").toLowerCase();
  return flag === "1" || flag === "true";
}

let clientPromise = null;
const clients = new Set();

async function getRedisClient() {
  if (!getRedisUrl()) return null;
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const options = { url: getRedisUrl() };
    if (isRedisTlsEnabled()) {
      options.socket = { tls: true };
    }
    const client = createClient(options);
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
