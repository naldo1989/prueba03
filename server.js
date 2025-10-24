import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === CONFIGURACIÓN BASE ===
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

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// === RUTAS DE INTERFAZ (EJS) ===
app.get("/", (req, res) => res.render("login", { error: null, success: null }));
app.get("/login", (req, res) => res.render("login", { error: null, success: null }));
app.get("/dashboard", (req, res) => res.render("dashboard", { error: null, success: null }));
app.get("/crearPadron", (req, res) => res.render("crearPadron", { error: null, success: null }));
app.get("/mesa", (req, res) => res.render("mesa", { error: null, success: null }));
app.get("/registro", (req, res) => res.render("registro", { error: null, success: null }));

// === LOGIN DE USUARIO ===
app.post("/login", async (req, res) => {
  const { dni, password, nro_escuela, nro_mesa } = req.body;

  try {
    const userResult = await pool.query(
      "SELECT * FROM usuarios WHERE dni = $1 AND password = $2",
      [dni, password]
    );

    if (userResult.rows.length === 0) {
      return res.render("login", { error: "Credenciales inválidas", success: null });
    }

    const user = userResult.rows[0];
    req.session.userId = user.id;

    // Verificar si existe el padrón para esa escuela y mesa
    const padronResult = await pool.query(
      "SELECT * FROM padrones WHERE nro_escuela = $1 AND nro_mesa = $2",
      [nro_escuela, nro_mesa]
    );

    // Si no existe, se crea automáticamente
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

    // Registrar sesión del usuario
    const sesionResult = await pool.query(
      `INSERT INTO sesiones_usuario (usuario_id, nro_escuela, nro_mesa)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [user.id, nro_escuela, nro_mesa]
    );

    req.session.sesionId = sesionResult.rows[0].id;
    req.session.escuela = nro_escuela;
    req.session.mesa = nro_mesa;

    res.render("dashboard", {
      user,
      escuela: nro_escuela,
      mesa: nro_mesa,
      padron,
      error: null,
      success: "Login exitoso.",
    });
  } catch (err) {
    console.error("Error en login:", err);
    res.render("login", { error: "Error interno del servidor", success: null });
  }
});

// === REGISTRAR CANTIDAD DE VOTOS ===
app.post("/registrar-votos", async (req, res) => {
  const { total_votaron } = req.body;
  const sesionId = req.session.sesionId;

  if (!sesionId) {
    return res.render("login", { error: "Sesión no válida o expirada", success: null });
  }

  try {
    const sesion = await pool.query(
      "SELECT nro_escuela, nro_mesa FROM sesiones_usuario WHERE id = $1",
      [sesionId]
    );

    if (sesion.rows.length === 0)
      return res.render("dashboard", { error: "Sesión no encontrada", success: null });

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

    // Obtener datos del padrón para calcular porcentaje
    const padron = await pool.query(
      "SELECT cantidad_votantes FROM padrones WHERE nro_escuela = $1 AND nro_mesa = $2",
      [nro_escuela, nro_mesa]
    );

    let porcentaje = 0;
    if (padron.rows.length > 0 && padron.rows[0].cantidad_votantes > 0) {
      porcentaje = ((total_votaron / padron.rows[0].cantidad_votantes) * 100).toFixed(2);
    }

    res.render("dashboard", {
      error: null,
      success: `Votos registrados correctamente. Participación: ${porcentaje}%`,
      escuela: nro_escuela,
      mesa: nro_mesa,
    });
  } catch (err) {
    console.error("Error registrando votos:", err);
    res.render("dashboard", { error: "Error al registrar votos", success: null });
  }
});

// === CERRAR MESA ===
app.post("/cerrar-mesa", async (req, res) => {
  const sesionId = req.session.sesionId;

  if (!sesionId) {
    return res.render("login", { error: "Sesión expirada", success: null });
  }

  try {
    const sesion = await pool.query(
      "SELECT nro_escuela, nro_mesa FROM sesiones_usuario WHERE id = $1",
      [sesionId]
    );

    if (sesion.rows.length === 0)
      return res.render("dashboard", { error: "Sesión no encontrada", success: null });

    const { nro_escuela, nro_mesa } = sesion.rows[0];

    await pool.query(
      "UPDATE participaciones SET cerrado = true WHERE nro_escuela = $1 AND nro_mesa = $2",
      [nro_escuela, nro_mesa]
    );

    res.render("dashboard", {
      error: null,
      success: "Mesa cerrada correctamente.",
      escuela: nro_escuela,
      mesa: nro_mesa,
    });
  } catch (err) {
    console.error("Error cerrando mesa:", err);
    res.render("dashboard", { error: "Error al cerrar mesa", success: null });
  }
});

// === LOGOUT ===
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.render("login", { error: null, success: "Sesión finalizada correctamente" });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor corriendo en puerto ${PORT}`));
