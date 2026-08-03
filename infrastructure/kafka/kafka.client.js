const { Kafka, logLevel } = require("kafkajs");
const {
  getKafkaBrokers,
  getKafkaClientId,
  isKafkaEnabled,
} = require("./kafka.config");

let kafka = null;

function getKafka() {
  if (!isKafkaEnabled()) return null;
  if (kafka) return kafka;

  kafka = new Kafka({
    clientId: getKafkaClientId(),
    brokers: getKafkaBrokers(),
    // 채팅 hot path를 막지 않도록 재시도는 짧게
    retry: {
      retries: 2,
      initialRetryTime: 100,
      maxRetryTime: 500,
    },
    logLevel: logLevel.ERROR,
  });
  return kafka;
}

module.exports = {
  getKafka,
};
