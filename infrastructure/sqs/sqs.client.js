const { SQSClient } = require("@aws-sdk/client-sqs");

function getSqsQueueUrl() {
  return (process.env.SQS_QUEUE_URL || "").trim();
}

function getSqsEndpoint() {
  return (process.env.SQS_ENDPOINT || "").trim() || undefined;
}

function isSqsEnabled() {
  return Boolean(getSqsQueueUrl());
}

let client = null;

function getSqsClient() {
  if (!isSqsEnabled()) return null;
  if (client) return client;

  const endpoint = getSqsEndpoint();
  const config = {
    region: process.env.AWS_REGION || "ap-northeast-2",
  };

  // 로컬 ElasticMQ 등 custom endpoint
  if (endpoint) {
    config.endpoint = endpoint;
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "x",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "x",
    };
  }

  client = new SQSClient(config);
  return client;
}

module.exports = {
  getSqsClient,
  getSqsQueueUrl,
  isSqsEnabled,
};
