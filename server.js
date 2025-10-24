import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { pool } from "./db.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(
  session({
    secret: "clave-secreta",
    resave: false,
    saveUninitialized: false,
  })
);

// ================== LOGIN Y REGISTRO ==================

app.get("/", (req, res) => res.redirect("/login"));
app.get("/login", (req, res) => res.render("login"));
app.get("/registro", (req, res) => res.render("registro"));

// Registro de nuevo usuario
app.post("/registro", async (req, res) => {
  const { nombre, apellido, dni } = req.body;
  const password = dni.slice(-3);

  try {
    await pool.query(
      "INSERT INTO usuarios (nombre, apellido, dni, password) VALUES ($1, $2, $3, $4)",
      [nombre, apellido, dni, password]
    );
    res.render("login", { mensaje: `Usuario creado. Clave: ${password}` });
  } catch (err) {
    console.error("Error al registrar usuario:", err);
    res.render("registro", { error: "Error al crear usuario" });
  }
});

// Login de usuario
app.post("/login", async (req, res) => {
  const { dni, password, nro_escuela, nro_mesa } = req.body;

  try {
    const result = await pool.query("SELECT * FROM usuarios WHERE dni=$1", [dni]);
    if (result.rows.length === 0) return res.render("login", { error: "DNI no encontrado" });

    const usuario = result.rows[0];
    if (usuario.password !== password)
      return res.render("login", { error: "Contraseña incorrecta" });

    req.session.usuario = usuario;
    req.session.nro_escuela = nro_escuela;
    req.session.nro_mesa = nro_mesa;

    // Verificar padrón
    const padron = await pool.query(
      "SELECT cantidad_votantes FROM padrones WHERE nro_escuela=$1 AND nro_mesa=$2",
      [nro_escuela, nro_mesa]
    );
    if (padron.rows.length === 0)
      return res.render("login", { error: "No existe padrón para esa escuela/mesa" });

    // Crear participación si no existe
    const existe = await pool.query(
      "SELECT id FROM participaciones WHERE nro_escuela=$1 AND nro_mesa=$2",
      [nro_escuela, nro_mesa]
    );
    if (existe.rows.length === 0) {
      await pool.query(
        "INSERT INTO participaciones (nro_escuela, nro_mesa, total_votaron, cerrado) VALUES ($1, $2, 0, false)",
        [nro_escuela, nro_mesa]
      );
    }

    // Crear sesión del usuario
    const sesion = await pool.query(
      `INSERT INTO sesiones_usuario (usuario_id, nro_escuela, nro_mesa)
       VALUES ($1, $2, $3) RETURNING id`,
      [usuario.id, nro_escuela, nro_mesa]
    );
    req.session.sesion_id = sesion.rows[0].id;

    res.redirect("/dashboard");
  } catch (err) {
    console.error("Error en login:", err);
    res.render("login", { error: "Error al iniciar sesión" });
  }
});

// ================== DASHBOARD ==================

app.get("/dashboard", async (req, res) => {
  if (!req.session.usuario) return res.redirect("/login");
  const { nro_escuela, nro_mesa } = req.session;

  try {
    const padron = await pool.query(
      "SELECT cantidad_votantes FROM padrones WHERE nro_escuela=$1 AND nro_mesa=$2",
      [nro_escuela, nro_mesa]
    );
    const mesa = await pool.query(
      "SELECT * FROM participaciones WHERE nro_escuela=$1 AND nro_mesa=$2",
      [nro_escuela, nro_mesa]
    );

    const cantidad_votantes = padron.rows[0]?.cantidad_votantes || 0;
    const total_votaron = mesa.rows[0]?.total_votaron || 0;
    const cerrado = mesa.rows[0]?.cerrado || false;
    const porcentaje = cantidad_votantes
      ? ((total_votaron / cantidad_votantes) * 100).toFixed(2)
      : 0;

    res.render("dashboard", { nro_escuela, nro_mesa, porcentaje, cerrado });
  } catch (err) {
    console.error("Error al cargar dashboard:", err);
    res.render("dashboard", { nro_escuela, nro_mesa, porcentaje: 0, cerrado: false });
  }
});

// ================== REGISTRAR VOTOS ==================

app.post("/registrar", async (req, res) => {
  if (!req.session.usuario)
    return res.status(401).json({ error: "Sesión expirada" });

  const { nro_escuela, nro_mesa, sesion_id } = req.session;
  const { cantidad_votos } = req.body;

  try {
    // Registrar detalle
    await pool.query(
      "INSERT INTO registros (sesion_id, cantidad_votos) VALUES ($1, $2)",
      [sesion_id, cantidad_votos]
    );

    // Actualizar total acumulado
    await pool.query(
      `UPDATE participaciones 
       SET total_votaron = total_votaron + $1, fecha_actualizacion=NOW()
       WHERE nro_escuela=$2 AND nro_mesa=$3 AND cerrado=false`,
      [cantidad_votos, nro_escuela, nro_mesa]
    );

    // Calcular porcentaje actualizado
    const padron = await pool.query(
      "SELECT cantidad_votantes FROM padrones WHERE nro_escuela=$1 AND nro_mesa=$2",
      [nro_escuela, nro_mesa]
    );
    const total = padron.rows[0]?.cantidad_votantes || 1;

    const participacion = await pool.query(
      "SELECT total_votaron FROM participaciones WHERE nro_escuela=$1 AND nro_mesa=$2",
      [nro_escuela, nro_mesa]
    );
    const total_votaron = participacion.rows[0]?.total_votaron || 0;

    const porcentaje = ((total_votaron / total) * 100).toFixed(2);
    res.json({ success: true, porcentaje });
  } catch (err) {
    console.error("Error al registrar votos:", err);
    res.json({ error: "Error al registrar votos" });
  }
});

// ================== CERRAR MESA ==================

app.post("/cerrar", async (req, res) => {
  if (!req.session.usuario)
    return res.status(401).json({ error: "Sesión expirada" });

  const { nro_escuela, nro_mesa } = req.session;

  try {
    await pool.query(
      "UPDATE participaciones SET cerrado=true, fecha_actualizacion=NOW() WHERE nro_escuela=$1 AND nro_mesa=$2",
      [nro_escuela, nro_mesa]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Error al cerrar mesa:", err);
    res.json({ error: "Error al cerrar mesa" });
  }
});

// ================== LOGOUT ==================

app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.send("Error al cerrar sesión.");
    res.clearCookie("connect.sid");
    res.redirect("/login");
  });
});

// ================== SERVIDOR ==================

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
