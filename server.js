import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import cors from "cors";
import { pool } from "./db.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
  session({
    secret: "clave_secreta_segura",
    resave: false,
    saveUninitialized: true,
  })
);

// === LOGIN DE USUARIO ===
app.post("/login", async (req, res) => {
  const { dni, password, nro_escuela, nro_mesa } = req.body;

  try {
    const userResult = await pool.query(
      "SELECT * FROM usuarios WHERE dni = $1 AND password = $2",
      [dni, password]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const user = userResult.rows[0];
    req.session.userId = user.id;

    // Verificar si existe el padrón para esa escuela y mesa
    const padronResult = await pool.query(
      "SELECT * FROM padrones WHERE nro_escuela = $1 AND nro_mesa = $2",
      [nro_escuela, nro_mesa]
    );

    // Si no existe, se crea automáticamente con cantidad_votantes = 0
    let padron;
    if (padronResult.rows.length === 0) {
      const newPadron = await pool.query(
        "INSERT INTO padrones (nro_escuela, nro_mesa, cantidad_votantes) VALUES ($1, $2, $3) RETURNING *",
        [nro_escuela, nro_mesa, 0]
      );
      padron = newPadron.rows[0];
    } else {
      padron = padronResult.rows[0];
    }

    // Crear o registrar sesión del usuario
    const sesionResult = await pool.query(
      `INSERT INTO sesiones_usuario (usuario_id, nro_escuela, nro_mesa)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [user.id, nro_escuela, nro_mesa]
    );

    req.session.sesionId = sesionResult.rows[0].id;

    res.json({
      message: "Login exitoso",
      user: { nombre: user.nombre, apellido: user.apellido },
      escuela: nro_escuela,
      mesa: nro_mesa,
      padron,
    });
  } catch (err) {
    console.error("Error en login:", err);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// === CARGAR CANTIDAD DE VOTOS ===
app.post("/registrar-votos", async (req, res) => {
  const { total_votaron } = req.body;
  const sesionId = req.session.sesionId;

  if (!sesionId) {
    return res.status(403).json({ message: "Sesión no válida" });
  }

  try {
    // Obtener datos de la sesión
    const sesion = await pool.query(
      "SELECT nro_escuela, nro_mesa FROM sesiones_usuario WHERE id = $1",
      [sesionId]
    );

    if (sesion.rows.length === 0)
      return res.status(404).json({ message: "Sesión no encontrada" });

    const { nro_escuela, nro_mesa } = sesion.rows[0];

    // Buscar o crear participación
    const participacion = await pool.query(
      "SELECT * FROM participaciones WHERE nro_escuela = $1 AND nro_mesa = $2",
      [nro_escuela, nro_mesa]
    );

    if (participacion.rows.length === 0) {
      await pool.query(
        "INSERT INTO participaciones (nro_escuela, nro_mesa, total_votaron) VALUES ($1, $2, $3)",
        [nro_escuela, nro_mesa, total_votaron]
      );
    } else {
      await pool.query(
        "UPDATE participaciones SET total_votaron = $1, fecha_actualizacion = CURRENT_TIMESTAMP WHERE nro_escuela = $2 AND nro_mesa = $3",
        [total_votaron, nro_escuela, nro_mesa]
      );
    }

    res.json({ message: "Votos registrados correctamente" });
  } catch (err) {
    console.error("Error registrando votos:", err);
    res.status(500).json({ message: "Error al registrar votos" });
  }
});

// === CERRAR MESA ===
app.post("/cerrar-mesa", async (req, res) => {
  const sesionId = req.session.sesionId;

  if (!sesionId)
    return res.status(403).json({ message: "Sesión no válida o expirada" });

  try {
    const sesion = await pool.query(
      "SELECT nro_escuela, nro_mesa FROM sesiones_usuario WHERE id = $1",
      [sesionId]
    );

    if (sesion.rows.length === 0)
      return res.status(404).json({ message: "Sesión no encontrada" });

    const { nro_escuela, nro_mesa } = sesion.rows[0];

    await pool.query(
      "UPDATE participaciones SET cerrado = true WHERE nro_escuela = $1 AND nro_mesa = $2",
      [nro_escuela, nro_mesa]
    );

    res.json({ message: "Mesa cerrada correctamente" });
  } catch (err) {
    console.error("Error cerrando mesa:", err);
    res.status(500).json({ message: "Error al cerrar mesa" });
  }
});

// === LOGOUT ===
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "Sesión finalizada" });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor corriendo en puerto ${PORT}`));
