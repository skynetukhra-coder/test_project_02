const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "1234",
    database: process.env.DB_NAME || "canteen",
    timezone: "+05:30",
    waitForConnections: true,
    connectionLimit: 10
});

// Set session timezone to IST (+05:30) for every new database connection in the pool
pool.on("connection", (connection) => {
    connection.query("SET time_zone = '+05:30'", (err) => {
        if (err) {
            console.error("Error setting session timezone:", err.message);
        }
    });
});

module.exports = pool;