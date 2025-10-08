import { pool } from "./db.js";

const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(50) NOT NULL,
        apellido VARCHAR(50) NOT NULL,
        dni VARCHAR(10) NOT NULL UNIQUE,
        password VARCHAR(10) NOT NULL
      );
    `);
    console.log("✅ Tabla 'usuarios' creada o ya existente.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error creando tabla:", err);
    process.exit(1);
  }
};

initDB();
