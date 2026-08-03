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
