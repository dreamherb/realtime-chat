module.exports = {
  testEnvironment: "node",
  setupFiles: ["<rootDir>/jest.setup.js"],
  testMatch: ["**/__tests__/unit/**/*.test.js"],
  // ponytail: mysql2 pool 소켓 때문에 worker가 안 죽음. 공유 앱 헬퍼로 pool.end 하면 제거 가능.
  forceExit: true,
};
