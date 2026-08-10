// 현재 미사용: 푸시 이벤트는 SQS(infrastructure/sqs)로 전환됨. 재전환 시 이 모듈 사용.
const TOPICS = {
  CHAT_MESSAGE_CREATED: "chat.message.created",
};

function getKafkaBrokers() {
  const raw = process.env.KAFKA_BROKERS || "";
  return raw
    .split(",")
    .map((broker) => broker.trim())
    .filter(Boolean);
}

function isKafkaEnabled() {
  return getKafkaBrokers().length > 0;
}

function getKafkaClientId() {
  return process.env.KAFKA_CLIENT_ID || "realtime-chat";
}

function getKafkaGroupId() {
  return process.env.KAFKA_GROUP_ID || "realtime-chat-push";
}

module.exports = {
  TOPICS,
  getKafkaBrokers,
  isKafkaEnabled,
  getKafkaClientId,
  getKafkaGroupId,
};
