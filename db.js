// database.js
const mysql = require("mysql2")

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "baa123456789",
  database: "inmobiliaria",
})

db.connect((err) => {
  if (err) console.error("Error BD:", err)
  else console.log("✓ BD conectada correctamente")
})

module.exports = db
