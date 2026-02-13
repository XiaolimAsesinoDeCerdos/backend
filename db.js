// db.js
const mysql = require("mysql2");

const host = process.env.MYSQLHOST;
const port = Number(process.env.MYSQLPORT || 3306);
const user = process.env.MYSQLUSER;
const database = process.env.MYSQLDATABASE;

console.log("[DB] host:", host);
console.log("[DB] port:", port);
console.log("[DB] user:", user);
console.log("[DB] database:", database);

const db = mysql.createConnection({
    host,
    port,
    user,
    password: process.env.MYSQLPASSWORD,
    database,
});

db.connect((err) => {
    if (err) {
        console.error("Error BD (full):", err); // <- importante
    } else {
        console.log("✓ BD conectada correctamente");
    }
});

module.exports = db;
