module.exports = {
  ...require("./jest.config"),
  testMatch: ["**/__tests__/integration/**/*.test.js"],
  maxWorkers: 1,
};
