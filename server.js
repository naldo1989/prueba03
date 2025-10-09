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

// Configuración
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

// ----------- RUTAS -------------

// Página principal -> redirige al login
app.get("/", (req, res) => res.redirect("/login"));

// Formulario de login
app.get("/login", (req, res) => res.render("login"));

// Formulario de registro
app.get("/registro", (req, res) => res.render("registro"));

// Crear usuario
app.post("/registro", async (req, res) => {
  const { nombre, apellido, dni } = req.body;
  const password = dni.slice(-3);

  try {
    await pool.query(
      "INSERT INTO usuarios (nombre, apellido, dni, password) VALUES ($1, $2, $3, $4)",
      [nombre, apellido, dni, password]
    );
    res.render("login", { mensaje: `Usuario creado. Clave por defecto: ${password}` });
  } catch (err) {
    console.error("Error al registrar usuario:", err);
    res.render("registro", { error: "Error al crear usuario" });
  }
});

// Login *************************************************************************
app.post("/login", async (req, res) => {
  const { dni, password, nro_escuela, nro_mesa } = req.body;

  try {
    const result = await pool.query("SELECT * FROM usuarios WHERE dni = $1", [dni]);
    if (result.rows.length === 0)
      return res.render("login", { error: "DNI no encontrado" });

    const usuario = result.rows[0];
    if (usuario.password !== password)
      return res.render("login", { error: "Contraseña incorrecta" });

    // Guardar datos en la sesión y DB
    await pool.query(
      "INSERT INTO sesiones_usuario (usuario_id, nro_escuela, nro_mesa) VALUES ($1, $2, $3)",
      [usuario.id, nro_escuela, nro_mesa]
    );

    req.session.usuario = {
      id: usuario.id,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      dni: usuario.dni,
    };
    req.session.nro_escuela = nro_escuela;
    req.session.nro_mesa = nro_mesa;

    //  Redirigir al dashboard después del login exitoso
    res.redirect("/dashboard");

  } catch (err) {
    console.error("Error en login:", err);
    res.render("login", { error: "Error en login" });
  }
});

/////Dashboard ************

// Registrar nuevo voto
app.post('/registrar', async (req, res) => {
  if (!req.session.usuario) {
    return res.redirect('/');
  }

  const { nro_orden, cantidad_votos } = req.body;
  const usuario_id = req.session.usuario.id;

  try {
    // obtener la última sesión activa del usuario
    const sesion = await pool.query(
      'SELECT id FROM sesiones_usuario WHERE usuario_id = $1 ORDER BY fecha_inicio DESC LIMIT 1',
      [usuario_id]
    );

    if (sesion.rows.length === 0) {
      return res.send('No hay sesión activa para este usuario.');
    }

    const sesion_id = sesion.rows[0].id;

    await pool.query(
      'INSERT INTO registros (sesion_id, nro_orden, cantidad_votos) VALUES ($1, $2, $3)',
      [sesion_id, nro_orden, cantidad_votos]
    );

    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res.send('Error al registrar el voto.');
  }
});


const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
