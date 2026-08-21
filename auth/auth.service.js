const { pool } = require("../infrastructure/database");

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
    console.error("ERROR IN CREATE USER : ", error.stack);
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
    console.error("ERROR IN FIND USER BY EMAIL : ", error.stack);
    throw error;
  }
}

async function findUserById(userId) {
  const sql = "SELECT * FROM users WHERE id = ?";
  const params = [userId];

  try {
    const [rows] = await pool.query(sql, params);
    return rows[0] || null;
  } catch (error) {
    console.error("ERROR IN FIND USER BY ID : ", error.stack);
    throw error;
  }
}

async function resolveSessionUser(req) {
  if (req.user?.id) {
    const user = await findUserById(req.user.id);
    if (user) {
      return user;
    }
  }

  if (req.user?.email) {
    return findUserByEmail(req.user.email);
  }

  return null;
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  resolveSessionUser,
};
