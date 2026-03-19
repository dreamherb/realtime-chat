const { pool } = require("./database.client");

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
  checkDbConnection,
};

