import { pool } from "./db.js";

const initDB = async () => {
  try {
      await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(50) NOT NULL,
        apellido VARCHAR(50) NOT NULL
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
    try {
      await pool.query(`
      CREATE TABLE IF NOT EXISTS sesiones_usuario (
       id SERIAL PRIMARY KEY,
       usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
       nro_escuela VARCHAR(10) NOT NULL,
       nro_mesa VARCHAR(10) NOT NULL,
       fecha_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
    `);
    console.log("✅ Tabla 'sesiones_usuarios' creada o ya existente.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error creando tabla:", err);
    process.exit(1);
  }
};
 try {
      await pool.query(`
CREATE TABLE IF NOT EXISTS registros (
    id SERIAL PRIMARY KEY,
    sesion_id INTEGER NOT NULL REFERENCES sesiones_usuario(id) ON DELETE CASCADE,
    nro_orden VARCHAR(100) NOT NULL,
    cantidad_votos INTEGER NOT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

    `);
    console.log("✅ Tabla 'registros' creada o ya existente.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error creando tabla:", err);
    process.exit(1);
  }
};

initDB();
