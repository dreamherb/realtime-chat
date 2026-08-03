const { getKafka } = require("./kafka.client");
const { TOPICS, isKafkaEnabled } = require("./kafka.config");

let producer = null;
let connecting = null;
let connectFailedAt = 0;
const RECONNECT_COOLDOWN_MS = 5000;
const CONNECT_WAIT_MS = 300;

async function getProducer({ waitMs = CONNECT_WAIT_MS } = {}) {
  if (!isKafkaEnabled()) return null;
  if (producer) return producer;

  if (
    connectFailedAt &&
    Date.now() - connectFailedAt < RECONNECT_COOLDOWN_MS
  ) {
    return null;
  }

  if (!connecting) {
    connecting = (async () => {
      const kafka = getKafka();
      if (!kafka) return null;
      const next = kafka.producer();
      await next.connect();
      producer = next;
      connectFailedAt = 0;
      if (process.env.NODE_ENV === "development") {
        console.log("[kafka] producer connected");
      }
      return producer;
    })()
      .catch((error) => {
        console.error("[kafka] producer connect failed:", error.message);
        connectFailedAt = Date.now();
        return null;
      })
      .finally(() => {
        connecting = null;
      });
  }

  if (!waitMs) return connecting;

  return Promise.race([
    connecting,
    new Promise((resolve) => setTimeout(() => resolve(null), waitMs)),
  ]);
}

/**
 * 채팅 메시지 생성 이벤트 발행.
 * 실패해도 채팅 전송 자체는 이미 성공한 상태이므로 throw 하지 않음.
 */
async function publishChatMessageCreated({ roomId, senderId, message }) {
  const activeProducer = await getProducer();
  if (!activeProducer) return { ok: false, reason: "KAFKA_UNAVAILABLE" };

  try {
    await activeProducer.send({
      topic: TOPICS.CHAT_MESSAGE_CREATED,
      messages: [
        {
          key: String(roomId),
          value: JSON.stringify({
            roomId: Number(roomId),
            senderId: Number(senderId),
            message,
            emittedAt: Date.now(),
          }),
        },
      ],
    });
    return { ok: true };
  } catch (error) {
    console.error("[kafka] publishChatMessageCreated error:", error.message);
    return { ok: false, reason: "PUBLISH_FAILED" };
  }
}

module.exports = {
  publishChatMessageCreated,
  getProducer,
};
