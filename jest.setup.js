process.env.NODE_ENV = "test";
process.env.ENC_KEY_HEX ||= "aa".repeat(32);
process.env.JWT_ACCESS_SECRET ||= "test-jwt-secret";
process.env.MYSQL_HOST ||= "127.0.0.1";
process.env.MYSQL_PORT ||= "3306";
process.env.MYSQL_USER ||= "root";
process.env.MYSQL_PASSWORD ||= "";
process.env.MYSQL_DATABASE ||= "realtime_chat";
// ponytail: 세션 캐시 없이 MySQL만으로 통합 테스트. Redis 붙이면 여기 지우면 됨.
delete process.env.REDIS_URL;
