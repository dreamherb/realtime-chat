const mysql = require("mysql2/promise");

const dbConfig = {
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT, 10),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

const pool = mysql.createPool(dbConfig);

async function checkDbConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log("[DB] MySQL connection established.");
    return true;
  } catch (error) {
    console.error("[DB] MySQL connection failed:", error.message);
    return false;
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

module.exports = {
  pool,
  checkDbConnection,
};
