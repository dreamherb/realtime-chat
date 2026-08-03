require("dotenv").config({ path: `./.env.${process.env.NODE_ENV || "development"}` });

const { getKafka } = require("../infrastructure/kafka/kafka.client");
const {
  TOPICS,
  isKafkaEnabled,
  getKafkaGroupId,
} = require("../infrastructure/kafka/kafka.config");
const { notifyPushForMessage } = require("../chat/chat.push");

async function start() {
  if (!isKafkaEnabled()) {
    console.error("[worker] KAFKA_BROKERS 미설정. worker를 종료합니다.");
    process.exit(1);
  }

  const kafka = getKafka();
  const consumer = kafka.consumer({ groupId: getKafkaGroupId() });

  await consumer.connect();
  await consumer.subscribe({
    topic: TOPICS.CHAT_MESSAGE_CREATED,
    fromBeginning: false,
  });

  console.log(
    `[worker] listening topic=${TOPICS.CHAT_MESSAGE_CREATED} group=${getKafkaGroupId()}`,
  );

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      let event;
      try {
        event = JSON.parse(message.value.toString());
      } catch (error) {
        console.error("[worker] invalid json:", error.message);
        return;
      }

      const { roomId, senderId, message: chatMessage } = event;
      if (!roomId || !senderId || !chatMessage) return;

      // 이유: 메시지 전송 경로에서 푸시 HTTP를 분리해 채팅 latency/부하 보호
      await notifyPushForMessage(roomId, senderId, chatMessage);
    },
  });
}

start().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
