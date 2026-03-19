const mysql = require("mysql2/promise");
const { databaseConfig } = require("./database.config");

const pool = mysql.createPool(databaseConfig);

module.exports = {
  pool,
};

