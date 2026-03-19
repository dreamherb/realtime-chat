const { pool } = require("../db");

/**
 * 회원 생성
 */
async function createUser({ nickname, encryptedEmail, passwordHash }) {
  const sql =
    "INSERT INTO users (nickname, email, password, status, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())";
  const params = [nickname, encryptedEmail, passwordHash, "INACTIVE"];

  try {
    const [result] = await pool.query(sql, params);
    return result;
  } catch (error) {
    console.error("ERROR IN CREATE USER : ", error);
    throw error;
  }
}

/**
 * 이메일 기준 사용자 조회
 * NOTE: 로그인 로직 구현 시 쿼리문 작성
 */
async function findUserByEmail(encryptedEmail) {
  const sql = "SELECT * FROM users WHERE email = ?";
  const params = [encryptedEmail];

  try {
    const [rows] = await pool.query(sql, params);
    return rows[0] || null;
  } catch (error) {
    console.error("ERROR IN FIND USER BY EMAIL : ", error);
    throw error;
  }
}

module.exports = {
  createUser,
  findUserByEmail,
};
