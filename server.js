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

    // Guardar sesión
    req.session.usuario = {
      id: usuario.id,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      dni: usuario.dni,
    };
    req.session.nro_escuela = nro_escuela;
    req.session.nro_mesa = nro_mesa;

    // Guardar sesión en la DB  
    try {
  await pool.query(
    "INSERT INTO sesiones_usuario (usuario_id, nro_escuela, nro_mesa, fecha_inicio) VALUES ($1, $2, $3, NOW())",
    [usuario.id, nro_escuela, nro_mesa]
  );
  console.log(" Sesión guardada en la base de datos");
} catch (error) {
  console.error("Error al guardar sesión:", error);
}

    


    //  Redirige al dashboard
    res.redirect("/dashboard");

  } catch (err) {
    console.error("Error en login:", err);
    res.render("login", { error: "Error en login" });
  }
});


/////Dashboard **************/

app.get("/dashboard", (req, res) => {
  if (!req.session.usuario) {
    return res.redirect("/login");
  }

  const { nombre, apellido } = req.session.usuario;
  const { nro_escuela, nro_mesa } = req.session;

  // Renderizamos una vista EJS con un formulario para registrar votos
  res.render("dashboard", {
    usuario: `${nombre} ${apellido}`,
    nro_escuela,
    nro_mesa
  });
});


// Registrar nuevo voto
app.post('/registrar', async (req, res) => {
  if (!req.session.usuario) {
    return res.status(401).json({ success: false, message: "Sesión no válida" });
  }

  const { nro_orden, cantidad_votos } = req.body;
  const usuario_id = req.session.usuario.id;

  try {
    const sesion = await pool.query(
      'SELECT id FROM sesiones_usuario WHERE usuario_id = $1 ORDER BY fecha_inicio DESC LIMIT 1',
      [usuario_id]
    );

    if (sesion.rows.length === 0) {
      return res.json({ success: false, message: "No hay sesión activa para este usuario." });
    }

    const sesion_id = sesion.rows[0].id;

    await pool.query(
      'INSERT INTO registros (sesion_id, nro_orden, cantidad_votos, fecha_registro) VALUES ($1, $2, $3, NOW())',
      [sesion_id, nro_orden, cantidad_votos]
    );

    res.json({ success: true, message: "✅ Registro exitoso" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error al registrar el voto." });
  }
});

// Obtener los últimos registros del usuario
app.get('/ultimos-registros', async (req, res) => {
  if (!req.session.usuario) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const usuario_id = req.session.usuario.id;

    const result = await pool.query(
      `SELECT r.nro_orden, r.cantidad_votos, r.fecha_registro
       FROM registros r
       JOIN sesiones_usuario s ON r.sesion_id = s.id
       WHERE s.usuario_id = $1
       ORDER BY r.fecha_registro DESC
       LIMIT 5`,
      [usuario_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener historial:', err);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// Total acumulado de esa escuela y mesa
app.get("/total", async (req, res) => {
  if (!req.session.usuario) return res.json({ total: 0 });

  const { nro_escuela, nro_mesa } = req.session;

  try {
    const result = await pool.query(
      `SELECT COALESCE(SUM(r.cantidad_votos), 0) AS total
       FROM registros r
       JOIN sesiones_usuario s ON r.sesion_id = s.id
       WHERE s.nro_escuela = $1 AND s.nro_mesa = $2`,
      [nro_escuela, nro_mesa]
    );
    res.json({ total: result.rows[0].total });
  } catch (error) {
    console.error("Error al calcular total:", error);
    res.json({ total: 0 });
  }
});

// Últimos 5 registros de esa escuela y mesa
app.get("/ultimos", async (req, res) => {
  if (!req.session.usuario) return res.json([]);

  const { nro_escuela, nro_mesa } = req.session;

  try {
    const result = await pool.query(
      `SELECT r.nro_orden, r.cantidad_votos, r.fecha_registro
       FROM registros r
       JOIN sesiones_usuario s ON r.sesion_id = s.id
       WHERE s.nro_escuela = $1 AND s.nro_mesa = $2
       ORDER BY r.fecha_registro DESC
       LIMIT 5`,
      [nro_escuela, nro_mesa]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener registros:", error);
    res.json([]);
  }
});



// ----------- LOGOUT -----------
app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error al cerrar sesión:", err);
      return res.send("Error al cerrar sesión.");
    }
    res.clearCookie("connect.sid"); // Limpia la cookie de sesión
    res.redirect("/login");
  });
});


const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
