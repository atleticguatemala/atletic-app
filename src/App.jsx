import React, { useState, useEffect, useMemo } from "react";
import {
  Users,
  Wallet,
  AlertTriangle,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Check,
  CalendarClock,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  RefreshCw,
  Wrench,
  LogOut,
  ClipboardCheck,
  Lock,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { supabase } from "./lib/supabase.js";

/* ---------------------------------------------------------
   Atletic Guatemala — Control de pagos (Fase 1)
   Paleta de marca: azul #00B6F1 · carbón #404041
   Tipografía: Jost (encabezados) + Inter (cuerpo/datos)

   Los datos viven en Supabase (Postgres en la nube), no en el navegador.
   Las funciones que suman/restan saldo (registrar/anular pago, generar
   cobro, corregir saldo) llaman funciones de base de datos (ver
   supabase-schema.sql) que hacen la operación completa de un solo golpe,
   para que dos pestañas o dispositivos escribiendo al mismo tiempo nunca
   se pisen entre sí.
--------------------------------------------------------- */

// ---------- Traducción entre los nombres que usa la pantalla (camelCase)
// y los nombres de columnas en la base de datos (snake_case) ----------

function alumnoFromDb(r) {
  return {
    id: r.id,
    nombre: r.nombre,
    encargado: r.encargado,
    telefono: r.telefono,
    categoria: r.categoria,
    horario: r.horario,
    tarifaMensual: Number(r.tarifa_mensual) || 0,
    becado: !!r.becado,
    saldoPendiente: Number(r.saldo_pendiente) || 0,
    ultimoMesCobrado: r.ultimo_mes_cobrado,
    activo: r.activo,
    fechaAlta: r.fecha_alta,
  };
}
function alumnoToDb(a) {
  return {
    nombre: a.nombre,
    encargado: a.encargado,
    telefono: a.telefono,
    categoria: a.categoria,
    horario: a.horario,
    tarifa_mensual: Number(a.tarifaMensual) || 0,
    becado: !!a.becado,
    activo: a.activo,
  };
}

function pagoFromDb(r) {
  return { id: r.id, alumnoId: r.alumno_id, monto: Number(r.monto) || 0, metodo: r.metodo, fecha: r.fecha, nota: r.nota };
}

function gastoFromDb(r) {
  return { id: r.id, categoria: r.categoria, monto: Number(r.monto) || 0, fecha: r.fecha, nota: r.nota };
}

function cargoFromDb(r) {
  return { id: r.id, mes: r.mes, fecha: r.fecha, totalGenerado: Number(r.total_generado) || 0, cantidadAlumnos: r.cantidad_alumnos };
}

function ajusteFromDb(r) {
  return { id: r.id, alumnoId: r.alumno_id, saldoAnterior: Number(r.saldo_anterior) || 0, saldoNuevo: Number(r.saldo_nuevo) || 0, motivo: r.motivo, fecha: r.fecha };
}

function asistenciaFromDb(r) {
  return { id: r.id, alumnoId: r.alumno_id, fecha: r.fecha, presente: !!r.presente, nota: r.nota, entrenadorId: r.entrenador_id };
}

const CATEGORIAS = [
  "2010-2011",
  "2012-2013",
  "2014-2015",
  "2016-2017",
  "2018-2019",
  "2020-2021",
  "2022-2023",
  "Otra",
];

const HORARIOS = [
  "Sábado",
  "Martes",
  "Martes y sábado",
  "Martes y jueves",
  "Martes, jueves y sábado",
  "Lunes y miércoles",
  "Lunes, miércoles y sábado",
  "Lunes, martes y miércoles",
  "Otro",
];

const METODOS_PAGO = ["Efectivo", "Depósito BI", "Depósito OB", "Transferencia", "Otro"];

const CATEGORIAS_GASTO = ["Cancha", "Pago a entrenador", "Equipo y material", "Publicidad", "Otro"];

const IMPORT_ALUMNOS_2026 = [
  { nombre: "Sebastian Mar", categoria: "2010-2011", encargado: "Angel Mar", telefono: "55051538", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Mario Alberto Gomez Téllez", categoria: "2010-2011", encargado: "Luz Tellez", telefono: "50106690", horario: "Lunes, miércoles y sábado", tarifaMensual: 475 },
  { nombre: "Brandon Eduardo García", categoria: "2010-2011", encargado: "Damaris Molina", telefono: "38621773", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Gabriel Mercado", categoria: "2010-2011", encargado: "Reina Gonzalez", telefono: "42988287", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Andres Moreno", categoria: "2010-2011", encargado: "Oscar Moreno", telefono: "52023415", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Javier García", categoria: "2012-2013", encargado: "Javier García", telefono: "56308476", horario: "Martes y sábado", tarifaMensual: 475 },
  { nombre: "Julian Orriols", categoria: "2012-2013", encargado: "Estela Rivera", telefono: "55507910", horario: "Martes y sábado", tarifaMensual: 475 },
  { nombre: "Matias Orriols", categoria: "2012-2013", encargado: "Estela Rivera", telefono: "55507910", horario: "Martes y sábado", tarifaMensual: 475 },
  { nombre: "Martin Ortíz", categoria: "2012-2013", encargado: "Ana Lucia Montoya", telefono: "55553333", horario: "Martes y sábado", tarifaMensual: 475 },
  { nombre: "Mario Enrique Téllez", categoria: "2012-2013", encargado: "Luz Tellez", telefono: "50106690", horario: "Martes y sábado", tarifaMensual: 475 },
  { nombre: "Noah", categoria: "2012-2013", encargado: "Zahra Figueredo", telefono: "55326218", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Adrian Dominguez", categoria: "2012-2013", encargado: "Vivian", telefono: "5208 8147", horario: "Martes y sábado", tarifaMensual: 475 },
  { nombre: "Santiago Zelaya", categoria: "2012-2013", encargado: "Wendy Zelaya", telefono: "41135812", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Juan Felipe Leal", categoria: "2012-2013", encargado: "Luisa Gonzalez", telefono: "40024429", horario: "Martes y sábado", tarifaMensual: 475 },
  { nombre: "Nicolás López", categoria: "2012-2013", encargado: "Verónica López", telefono: "48820645", horario: "Martes y sábado", tarifaMensual: 475 },
  { nombre: "Luca Flores", categoria: "2012-2013", encargado: "Stefan Flores", telefono: "54107277", horario: "Martes y sábado", tarifaMensual: 475 },
  { nombre: "Martín Rodas", categoria: "2012-2013", encargado: "Susana Reyes", telefono: "58995534", horario: "Martes y sábado", tarifaMensual: 475 },
  { nombre: "Matias Betancurt", categoria: "2012-2013", encargado: "Oscar Bethancourt", telefono: "58771719", horario: "Martes y sábado", tarifaMensual: 475 },
  { nombre: "Matias Estrada", categoria: "2012-2013", encargado: "Mariela de Estrada", telefono: "42121720", horario: "Martes y sábado", tarifaMensual: 475 },
  { nombre: "Jose Ignacio Avendaño", categoria: "2012-2013", encargado: "Mishel de Avendaño", telefono: "56309372", horario: "Martes y sábado", tarifaMensual: 475 },
  { nombre: "Thiago Roman", categoria: "2012-2013", encargado: "Victor Roman", telefono: "58370153", horario: "Martes y sábado", tarifaMensual: 475 },
  { nombre: "Jose Alejandro Valdez", categoria: "2014-2015", encargado: "Beatriz Martinez", telefono: "52069262", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Gabriel Guerra", categoria: "2014-2015", encargado: "Raquel Asensio", telefono: "52029852", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Esteban Rojas", categoria: "2014-2015", encargado: "Jennifer Barrientos", telefono: "53176169", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Luca Feschet", categoria: "2014-2015", encargado: "Ana Barrios", telefono: "49743413", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Jose Haering", categoria: "2014-2015", encargado: "Daniel Haering", telefono: "30407006", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Nicolás Papescu", categoria: "2014-2015", encargado: "Mariana Lesca", telefono: "55552706", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Miguel López", categoria: "2014-2015", encargado: "Guadalupe Valle", telefono: "48284833", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Anthony Ramirez", categoria: "2014-2015", encargado: "Victor Ramirez", telefono: "37011323", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Diego Fernando Menchú", categoria: "2014-2015", encargado: "Francisco Menchú", telefono: "59911806", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Luis Mario Téllez", categoria: "2016-2017", encargado: "Luz Tellez", telefono: "50106690", horario: "Lunes, miércoles y sábado", tarifaMensual: 475 },
  { nombre: "Daniel Guerra", categoria: "2016-2017", encargado: "Raquel Asensio", telefono: "52029852", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Mateo Velasquez", categoria: "2016-2017", encargado: "Daniela Hercules", telefono: "59239301", horario: "Martes y jueves", tarifaMensual: 475 },
  { nombre: "Salvador Flores", categoria: "2016-2017", encargado: "Gabby Conzalez", telefono: "53000018", horario: "Martes y sábado", tarifaMensual: 475 },
  { nombre: "Ignacio Carrillo", categoria: "2016-2017", encargado: "Carol Rodriguez", telefono: "40473435", horario: "Martes", tarifaMensual: 375 },
  { nombre: "Santiago Lemus", categoria: "2016-2017", encargado: "Pamela López", telefono: "55720573", horario: "Martes y jueves", tarifaMensual: 0 },
  { nombre: "Javier López", categoria: "2016-2017", encargado: "Pedro López", telefono: "47242407", horario: "Martes y jueves", tarifaMensual: 475 },
  { nombre: "Jose Veras", categoria: "2016-2017", encargado: "Daniel Veras", telefono: "41739180", horario: "Martes y jueves", tarifaMensual: 475 },
  { nombre: "Juan Ignacio Reyes", categoria: "2016-2017", encargado: "Dulce Veras", telefono: "30111997", horario: "Martes y jueves", tarifaMensual: 475 },
  { nombre: "Andrés Carrillo", categoria: "2018-2019", encargado: "Gaby Lima", telefono: "52054807", horario: "Lunes y miércoles", tarifaMensual: 375 },
  { nombre: "Juan Diego Montufar", categoria: "2018-2019", encargado: "Claudia Conde", telefono: "59181475", horario: "Lunes y miércoles", tarifaMensual: 425 },
  { nombre: "Santiago Arenas", categoria: "2018-2019", encargado: "Andrea Galindo", telefono: "52045271", horario: "Lunes y miércoles", tarifaMensual: 425 },
  { nombre: "Sebas Ruiz", categoria: "2018-2019", encargado: "Gaby Aguilar", telefono: "52052887", horario: "Lunes y miércoles", tarifaMensual: 425 },
  { nombre: "Joaquin Urrea", categoria: "2018-2019", encargado: "Majo Urrea", telefono: "30008342", horario: "Lunes y miércoles", tarifaMensual: 375 },
  { nombre: "Julian Donis", categoria: "2018-2019", encargado: "Paula Alvarado", telefono: "30008342", horario: "Lunes y miércoles", tarifaMensual: 425 },
  { nombre: "Matias Gonzalez", categoria: "2018-2019", encargado: "Katia Diaz", telefono: "53187415", horario: "Lunes y miércoles", tarifaMensual: 425 },
  { nombre: "Pablo Urbina", categoria: "2018-2019", encargado: "María Andre Pelaez", telefono: "54859032", horario: "Lunes y miércoles", tarifaMensual: 375 },
  { nombre: "Javier Arriola", categoria: "2018-2019", encargado: "Marta Vargas", telefono: "58655756", horario: "Lunes y miércoles", tarifaMensual: 425 },
  { nombre: "Nicolas Javier", categoria: "2018-2019", encargado: "Analu Javier", telefono: "30121855", horario: "Lunes y miércoles", tarifaMensual: 375 },
  { nombre: "Ignacio Velasquez", categoria: "2018-2019", encargado: "Aleisa Quiroa", telefono: "54178613", horario: "Lunes, martes y miércoles", tarifaMensual: 475 },
  { nombre: "Joaquin Lou", categoria: "2018-2019", encargado: "Rita de Lou", telefono: "42209923", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Luis Rolando García", categoria: "2018-2019", encargado: "Luisa Medina", telefono: "52019533", horario: "Martes y jueves", tarifaMensual: 475 },
  { nombre: "Pablo Daniel", categoria: "2018-2019", encargado: "Ana Beatriz Caminade", telefono: "42191434", horario: "Martes, jueves y sábado", tarifaMensual: 575 },
  { nombre: "Agustín Rivera", categoria: "2022-2023", encargado: "Pamela Maldonado", telefono: "53118443", horario: "Sábado", tarifaMensual: 375 },
  { nombre: "Aitana de la Cerda Mendez", categoria: "2022-2023", encargado: "Luis Pedro de la Cerda", telefono: "59516339", horario: "Sábado", tarifaMensual: 375 },
];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function monthKeyOf(dateISO) {
  return dateISO.slice(0, 7); // YYYY-MM
}

function parseMonto(v) {
  if (typeof v !== "string") return Number(v) || 0;
  const cleaned = v.trim().replace(/,/g, ".");
  if (cleaned === "") return NaN;
  const n = parseFloat(cleaned);
  return n;
}

function formatQ(n) {
  const v = Number(n) || 0;
  return `Q ${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const label = d.toLocaleDateString("es-GT", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function saldoTone(saldo, tarifa) {
  if (saldo < 0) return { key: "credito", label: "A favor", color: "#0090C2", bg: "#E7F7FD" };
  if (saldo === 0) return { key: "aldia", label: "Al día", color: "#158F63", bg: "#E7F7F1" };
  if (saldo <= tarifa) return { key: "pendiente", label: "Pendiente", color: "#B4790A", bg: "#FCF1DD" };
  return { key: "atrasado", label: "Atrasado", color: "#C13F3B", bg: "#FBEAE9" };
}

// ---------- Punto de entrada: sesión, rol, y qué pantalla mostrar ----------
// No hay una sola "App" con todo dentro: primero se resuelve si hay una
// sesión iniciada y qué rol tiene esa persona, y según eso se muestra la
// pantalla de login, el panel completo (admin) o solo la de asistencia
// (entrenador). Cuál de las dos pantallas ve cada quien lo decide el rol
// guardado en la tabla `perfiles`, pero lo que de verdad protege los
// datos financieros son las políticas de la base de datos (RLS) — esto
// solo evita mostrarle al entrenador botones que igual no podría usar.
export default function App() {
  const [sesion, setSesion] = useState(undefined); // undefined = todavía no se sabe, null = sin sesión
  const [perfil, setPerfil] = useState(null);
  const [perfilError, setPerfilError] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nuevaSesion) => {
      setSesion(nuevaSesion || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!sesion) {
      setPerfil(null);
      return;
    }
    let cancelado = false;
    setPerfilError(false);
    supabase
      .from("perfiles")
      .select("*")
      .eq("id", sesion.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error || !data) {
          setPerfilError(true);
        } else {
          setPerfil({ id: data.id, nombre: data.nombre, rol: data.rol });
        }
      });
    return () => {
      cancelado = true;
    };
  }, [sesion]);

  function cerrarSesion() {
    supabase.auth.signOut();
  }

  if (sesion === undefined) {
    return <PantallaCentrada mensaje="Cargando…" />;
  }

  if (!sesion) {
    return <LoginScreen />;
  }

  if (perfilError) {
    return (
      <PantallaCentrada
        mensaje="Tu cuenta inició sesión pero no tiene un perfil asignado todavía. Pídele al administrador que te agregue en la tabla 'perfiles' (ver README)."
        error
        onLogout={cerrarSesion}
      />
    );
  }

  if (!perfil) {
    return <PantallaCentrada mensaje="Cargando tu perfil…" />;
  }

  if (perfil.rol === "entrenador") {
    return <PanelEntrenador perfil={perfil} onLogout={cerrarSesion} />;
  }

  if (perfil.rol === "asistente") {
    return <PanelAsistente perfil={perfil} onLogout={cerrarSesion} />;
  }

  return <PanelAdmin perfil={perfil} onLogout={cerrarSesion} />;
}

function PantallaCentrada({ mensaje, error, onLogout }) {
  return (
    <div className="app-root">
      <Styles />
      <div className="pantalla-centrada">
        {error ? <Lock size={22} /> : <Loader2 size={22} className="spin" />}
        <p>{mensaje}</p>
        {onLogout && (
          <button className="btn-secondary" onClick={onLogout}>
            Cerrar sesión
          </button>
        )}
      </div>
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!email.trim() || !password) {
      setError("Escribe tu correo y tu contraseña.");
      return;
    }
    setEnviando(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setEnviando(false);
    if (err) {
      setError("Correo o contraseña incorrectos.");
    }
  }

  return (
    <div className="app-root">
      <Styles />
      <div className="login-wrap">
        <div className="login-card">
          <LogoMark />
          <div className="brand-name" style={{ marginTop: 10 }}>
            Atletic Guatemala
          </div>
          <div className="brand-sub" style={{ marginBottom: 18 }}>
            Inicia sesión para continuar
          </div>
          {error && <div className="form-error">{error}</div>}
          <div
            className="form"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit(e);
            }}
          >
            <label>
              Correo
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
            <label>
              Contraseña
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button type="button" className="btn-primary full" onClick={handleSubmit} disabled={enviando}>
              {enviando ? "Entrando…" : "Entrar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Vista simplificada para entrenadores: SOLO asistencia. Nunca pide ni
// recibe tarifas ni saldos — la lista de alumnos viene de la función
// alumnos_para_asistencia(), que del lado de la base de datos ya excluye
// esas columnas (ver supabase-schema.sql), así que esta pantalla no
// podría mostrarlas aunque quisiera.
function PanelEntrenador({ perfil, onLogout }) {
  const [alumnos, setAlumnos] = useState([]);
  const [asistencias, setAsistencias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [marcandoIds, setMarcandoIds] = useState(() => new Set());

  async function cargar() {
    const [a, s] = await Promise.all([
      supabase.rpc("alumnos_para_asistencia"),
      supabase.from("asistencias").select("*").order("fecha", { ascending: false }),
    ]);
    setAlumnos(a.data || []);
    setAsistencias((s.data || []).map(asistenciaFromDb));
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await cargar();
      setLoading(false);
    })();
    const canal = supabase
      .channel("atletic-cambios-entrenador")
      .on("postgres_changes", { event: "*", schema: "public", table: "asistencias" }, () => cargar())
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function marcarAsistencia(alumnoId, fecha, presente) {
    if (marcandoIds.has(alumnoId)) return;
    setMarcandoIds((prev) => new Set(prev).add(alumnoId));
    try {
      await supabase.rpc("marcar_asistencia", { p_alumno_id: alumnoId, p_fecha: fecha, p_presente: presente });
      await cargar();
    } finally {
      setMarcandoIds((prev) => {
        const next = new Set(prev);
        next.delete(alumnoId);
        return next;
      });
    }
  }

  return (
    <div className="app-root">
      <Styles />
      <header className="topbar">
        <div className="brand">
          <LogoMark />
          <div>
            <div className="brand-name">Atletic Guatemala</div>
            <div className="brand-sub">Asistencia</div>
          </div>
        </div>
        <button className="reload-btn" onClick={onLogout} title="Cerrar sesión">
          <LogOut size={14} />
          {perfil?.nombre ? perfil.nombre : "Salir"}
        </button>
      </header>
      <main className="content">
        {loading ? (
          <div className="empty">Cargando información…</div>
        ) : (
          <AsistenciaView
            alumnosActivos={alumnos}
            asistencias={asistencias}
            onMarcar={marcarAsistencia}
            marcandoIds={marcandoIds}
          />
        )}
      </main>
    </div>
  );
}

// Vista del asistente: puede registrar pagos y marcar asistencia, pero no
// ve gastos, cobro mensual, ajustes de saldo, ni puede editar/eliminar
// alumnos ni el Resumen financiero completo — esas tablas y funciones
// están bloqueadas para el rol "asistente" a nivel de base de datos (ver
// supabase-schema.sql), así que aunque alguien manipulara la pantalla no
// podría sacar esos datos.
function PanelAsistente({ perfil, onLogout }) {
  const [alumnos, setAlumnos] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [asistencias, setAsistencias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("pago");
  const [toast, setToast] = useState(null);
  const [marcandoIds, setMarcandoIds] = useState(() => new Set());

  const enviandoRef = React.useRef(false);
  const [enviando, setEnviando] = useState(false);
  function iniciarEnvio() {
    if (enviandoRef.current) return false;
    enviandoRef.current = true;
    setEnviando(true);
    return true;
  }
  function terminarEnvio() {
    enviandoRef.current = false;
    setEnviando(false);
  }

  function showToast(msg, isError) {
    setToast({ msg, isError: !!isError });
    setTimeout(() => setToast(null), 2600);
  }

  const [pagoForm, setPagoForm] = useState({
    alumnoId: "",
    monto: "",
    metodo: "Efectivo",
    fecha: todayISO(),
    nota: "",
  });

  async function cargar() {
    const [a, p, s] = await Promise.all([
      supabase.rpc("alumnos_para_pagos"),
      supabase.from("pagos").select("*").order("created_at", { ascending: false }),
      supabase.from("asistencias").select("*").order("fecha", { ascending: false }),
    ]);
    setAlumnos(a.data || []);
    setPagos((p.data || []).map(pagoFromDb));
    setAsistencias((s.data || []).map(asistenciaFromDb));
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await cargar();
      setLoading(false);
    })();
    const canal = supabase
      .channel("atletic-cambios-asistente")
      .on("postgres_changes", { event: "*", schema: "public", table: "pagos" }, () => cargar())
      .on("postgres_changes", { event: "*", schema: "public", table: "asistencias" }, () => cargar())
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function alumnoNombre(id) {
    const a = alumnos.find((x) => x.id === id);
    return a ? a.nombre : "(alumno eliminado)";
  }

  async function registrarPago(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!iniciarEnvio()) return;
    try {
      const monto = parseMonto(pagoForm.monto);
      if (!pagoForm.alumnoId || isNaN(monto) || monto <= 0) {
        showToast("Selecciona un alumno e ingresa un monto válido.", true);
        return;
      }
      const { error } = await supabase.rpc("registrar_pago", {
        p_alumno_id: pagoForm.alumnoId,
        p_monto: monto,
        p_metodo: pagoForm.metodo,
        p_fecha: pagoForm.fecha,
        p_nota: pagoForm.nota || null,
      });
      if (!error) {
        await cargar();
        setPagoForm({ alumnoId: "", monto: "", metodo: "Efectivo", fecha: todayISO(), nota: "" });
        showToast("Pago registrado.");
      } else {
        showToast(
          "No se pudo guardar el pago (revisa tu conexión). No se perdió lo que escribiste — dale clic de nuevo.",
          true
        );
      }
    } finally {
      terminarEnvio();
    }
  }

  async function marcarAsistencia(alumnoId, fecha, presente) {
    if (marcandoIds.has(alumnoId)) return;
    setMarcandoIds((prev) => new Set(prev).add(alumnoId));
    try {
      await supabase.rpc("marcar_asistencia", { p_alumno_id: alumnoId, p_fecha: fecha, p_presente: presente });
      await cargar();
    } finally {
      setMarcandoIds((prev) => {
        const next = new Set(prev);
        next.delete(alumnoId);
        return next;
      });
    }
  }

  return (
    <div className="app-root">
      <Styles />
      <header className="topbar">
        <div className="brand">
          <LogoMark />
          <div>
            <div className="brand-name">Atletic Guatemala</div>
            <div className="brand-sub">Asistente</div>
          </div>
        </div>
        <button className="reload-btn" onClick={onLogout} title="Cerrar sesión">
          <LogOut size={14} />
          {perfil?.nombre ? perfil.nombre : "Salir"}
        </button>
      </header>

      <nav className="tabs">
        {[
          { key: "pago", label: "Registrar pago" },
          { key: "asistencia", label: "Asistencia" },
        ].map((t) => (
          <button
            key={t.key}
            className={"tab" + (tab === t.key ? " active" : "")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="content">
        {loading ? (
          <div className="empty">Cargando información…</div>
        ) : (
          <>
            {tab === "pago" && (
              <PagoView
                alumnosActivos={alumnos}
                pagoForm={pagoForm}
                setPagoForm={setPagoForm}
                onSubmit={registrarPago}
                pagosRecientes={pagos.slice(0, 10)}
                alumnoNombre={alumnoNombre}
                onAnular={() => showToast("No tienes permiso para anular pagos. Pídele a un administrador que lo haga.", true)}
                enviando={enviando}
              />
            )}

            {tab === "asistencia" && (
              <AsistenciaView
                alumnosActivos={alumnos}
                asistencias={asistencias}
                onMarcar={marcarAsistencia}
                marcandoIds={marcandoIds}
              />
            )}
          </>
        )}
      </main>

      {toast && (
        <div className={"toast" + (toast.isError ? " toast-error" : "")}>{toast.msg}</div>
      )}
    </div>
  );
}

// Vista completa: alumnos, pagos, gastos, cobros, ajustes y asistencia.
// Solo un usuario con rol "admin" llega aquí (la tabla `alumnos` y las
// demás están bloqueadas para cualquier otro rol a nivel de base de
// datos — ver supabase-schema.sql — así que aunque alguien manipulara la
// pantalla no podría sacar esos datos sin ser admin).
function PanelAdmin({ perfil, onLogout }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [alumnos, setAlumnos] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [cargos, setCargos] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [ajustes, setAjustes] = useState([]);
  const [asistencias, setAsistencias] = useState([]);
  const [tab, setTab] = useState("resumen");
  const [toast, setToast] = useState(null);

  // Evita que un doble clic (u otro disparo repetido) en un botón que
  // guarda datos cree dos registros en vez de uno. enviandoRef se revisa
  // de forma síncrona (un useState podría no haberse actualizado todavía
  // entre el primer y el segundo clic); enviando es solo para reflejarlo
  // en la pantalla (deshabilitar botones, mostrar "Guardando…").
  const enviandoRef = React.useRef(false);
  const [enviando, setEnviando] = useState(false);
  function iniciarEnvio() {
    if (enviandoRef.current) return false;
    enviandoRef.current = true;
    setEnviando(true);
    return true;
  }
  function terminarEnvio() {
    enviandoRef.current = false;
    setEnviando(false);
  }

  const [alumnoModal, setAlumnoModal] = useState(null); // null | {} (nuevo) | alumno (editar)
  const [ajusteModal, setAjusteModal] = useState(null); // alumno al que se le va a corregir el saldo
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmDeleteVarios, setConfirmDeleteVarios] = useState(null); // array de ids, o null
  // Mes que se va a cobrar en la pestaña "Cobro mensual". Empieza en el mes
  // de hoy, pero se puede adelantar a cualquier mes que quede del año — así
  // no hay que esperar a que llegue la fecha para generarlo.
  const [mesCobroSeleccionado, setMesCobroSeleccionado] = useState(monthKeyOf(todayISO()));
  const [pagoForm, setPagoForm] = useState({
    alumnoId: "",
    monto: "",
    metodo: "Efectivo",
    fecha: todayISO(),
    nota: "",
  });
  const [gastoForm, setGastoForm] = useState({
    categoria: CATEGORIAS_GASTO[0],
    monto: "",
    fecha: todayISO(),
    nota: "",
  });
  const [confirmDeleteGasto, setConfirmDeleteGasto] = useState(null);
  const [confirmDeletePago, setConfirmDeletePago] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [confirmCargo, setConfirmCargo] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);
  const [reloading, setReloading] = useState(false);

  async function cargarDatos({ silent } = {}) {
    const [a, p, c, g, j, s] = await Promise.all([
      supabase.from("alumnos").select("*").order("nombre"),
      supabase.from("pagos").select("*").order("created_at", { ascending: false }),
      supabase.from("cargos").select("*").order("created_at", { ascending: false }),
      supabase.from("gastos").select("*").order("created_at", { ascending: false }),
      supabase.from("ajustes").select("*").order("created_at", { ascending: false }),
      supabase.from("asistencias").select("*").order("fecha", { ascending: false }),
    ]);
    setAlumnos((a.data || []).map(alumnoFromDb));
    setPagos((p.data || []).map(pagoFromDb));
    setCargos((c.data || []).map(cargoFromDb));
    setGastos((g.data || []).map(gastoFromDb));
    setAjustes((j.data || []).map(ajusteFromDb));
    setAsistencias((s.data || []).map(asistenciaFromDb));

    const algunFallo = [a, p, c, g, j, s].some((r) => r.error);
    if (algunFallo) {
      showToast(
        "No se pudo cargar toda tu información (revisa tu conexión). Dale a \"Recargar\" para intentar de nuevo.",
        true
      );
    } else if (!silent) {
      showToast(`Datos actualizados: ${(a.data || []).length} alumnos, ${(p.data || []).length} pagos, ${(g.data || []).length} gastos.`);
    }
  }

  // Mientras la app está abierta, si alguien registra un pago (o un
  // entrenador marca asistencia) desde el celular u otro dispositivo,
  // esto refresca los datos aquí automáticamente — sin recargar la página.
  useEffect(() => {
    const canal = supabase
      .channel("atletic-cambios-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "alumnos" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "pagos" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "gastos" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "cargos" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "ajustes" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "asistencias" }, () => cargarDatos({ silent: true }))
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await cargarDatos({ silent: true });
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function recargarManual() {
    setReloading(true);
    try {
      await cargarDatos();
    } finally {
      setReloading(false);
    }
  }

  function showToast(msg, isError) {
    setToast({ msg, isError: !!isError });
    setTimeout(() => setToast(null), 2600);
  }

  const alumnosActivos = alumnos.filter((a) => a.activo !== false);
  const currentMonthKey = monthKeyOf(todayISO());

  const totalCobradoMes = useMemo(
    () =>
      pagos
        .filter((p) => monthKeyOf(p.fecha) === currentMonthKey)
        .reduce((s, p) => s + Number(p.monto || 0), 0),
    [pagos, currentMonthKey]
  );

  const totalGastosMes = useMemo(
    () =>
      gastos
        .filter((g) => monthKeyOf(g.fecha) === currentMonthKey)
        .reduce((s, g) => s + Number(g.monto || 0), 0),
    [gastos, currentMonthKey]
  );

  const utilidadMes = totalCobradoMes - totalGastosMes;

  const totalPorCobrar = useMemo(
    () => alumnosActivos.reduce((s, a) => s + Math.max(0, Number(a.saldoPendiente || 0)), 0),
    [alumnosActivos]
  );

  const pagosHoy = pagos.filter((p) => p.fecha === todayISO()).length;

  // Los becados nunca entran al cobro mensual: no se les suma tarifa.
  const becadosActivosCount = alumnosActivos.filter((a) => a.becado).length;
  const pendientesGenerar = alumnosActivos.filter(
    (a) => !a.becado && a.ultimoMesCobrado !== mesCobroSeleccionado
  );

  // Meses que se pueden elegir para generar el cobro: de hoy en adelante,
  // hasta diciembre del año actual (así se puede adelantar el cobro de
  // cualquier mes que falte, sin tener que esperar a que llegue la fecha).
  const mesesCobroDisponibles = useMemo(() => {
    const [anioActual, mesActual] = monthKeyOf(todayISO()).split("-").map(Number);
    const meses = [];
    for (let m = mesActual; m <= 12; m++) {
      meses.push(`${anioActual}-${String(m).padStart(2, "0")}`);
    }
    return meses;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendientesImportar = useMemo(
    () =>
      IMPORT_ALUMNOS_2026.filter(
        (x) => !alumnos.some((a) => a.nombre.trim().toLowerCase() === x.nombre.trim().toLowerCase())
      ),
    [alumnos]
  );

  async function importarListado2026() {
    if (pendientesImportar.length === 0) {
      setConfirmImport(false);
      return;
    }
    if (!iniciarEnvio()) return;
    try {
      const nuevos = pendientesImportar.map((x) => ({
        nombre: x.nombre,
        encargado: x.encargado,
        telefono: x.telefono,
        categoria: x.categoria,
        horario: x.horario,
        tarifa_mensual: x.tarifaMensual,
        becado: !!x.becado,
        activo: true,
      }));
      const { error } = await supabase.from("alumnos").insert(nuevos);
      setConfirmImport(false);
      if (!error) {
        await cargarDatos({ silent: true });
        showToast(`${nuevos.length} alumno(s) importado(s) del listado 2026.`);
      } else {
        showToast("No se pudo importar (revisa tu conexión). Nada se agregó — inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  function alumnoNombre(id) {
    const a = alumnos.find((x) => x.id === id);
    return a ? a.nombre : "(alumno eliminado)";
  }

  async function guardarAlumno(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      const payload = alumnoToDb(data);
      let error;
      if (data.id) {
        ({ error } = await supabase.from("alumnos").update(payload).eq("id", data.id));
      } else {
        ({ error } = await supabase.from("alumnos").insert(payload));
      }
      if (!error) {
        await cargarDatos({ silent: true });
        setAlumnoModal(null);
        showToast(esNuevo ? "Alumno agregado." : "Alumno actualizado.");
      } else {
        showToast("No se pudo guardar (revisa tu conexión). Vuelve a intentarlo, tus datos siguen en el formulario.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarAlumno(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("alumnos").delete().eq("id", id);
      setConfirmDelete(null);
      if (!error) {
        setAlumnos((prev) => prev.filter((a) => a.id !== id));
        showToast("Alumno eliminado.");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Sigue en tu lista — inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  // Borra varios alumnos de una vez (el checklist de la pestaña Alumnos).
  // Usa "in" para borrarlos todos en una sola llamada a la base de datos.
  async function eliminarAlumnos(ids) {
    if (!ids || ids.length === 0) return;
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("alumnos").delete().in("id", ids);
      setConfirmDeleteVarios(null);
      if (!error) {
        setAlumnos((prev) => prev.filter((a) => !ids.includes(a.id)));
        showToast(`${ids.length} alumno(s) eliminado(s).`);
      } else {
        showToast(
          "No se pudo eliminar (revisa tu conexión). Nadie se borró — inténtalo de nuevo.",
          true
        );
      }
    } finally {
      terminarEnvio();
    }
  }

  async function toggleActivo(id) {
    if (!iniciarEnvio()) return;
    try {
      const alumno = alumnos.find((a) => a.id === id);
      if (!alumno) return;
      const nuevoActivo = alumno.activo === false;
      const { error } = await supabase.from("alumnos").update({ activo: nuevoActivo }).eq("id", id);
      if (!error) {
        setAlumnos((prev) => prev.map((a) => (a.id === id ? { ...a, activo: nuevoActivo } : a)));
      } else {
        showToast("No se pudo guardar el cambio (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  async function registrarPago(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!iniciarEnvio()) return; // ya hay un guardado en curso: ignora el clic repetido
    try {
      const monto = parseMonto(pagoForm.monto);
      if (!pagoForm.alumnoId || isNaN(monto) || monto <= 0) {
        showToast("Selecciona un alumno e ingresa un monto válido.", true);
        return;
      }
      // registrar_pago crea el pago y descuenta el saldo en una sola
      // operación en la base de datos (ver supabase-schema.sql), así que
      // dos clics — o dos dispositivos — nunca pueden dejarlo a medias.
      const { error } = await supabase.rpc("registrar_pago", {
        p_alumno_id: pagoForm.alumnoId,
        p_monto: monto,
        p_metodo: pagoForm.metodo,
        p_fecha: pagoForm.fecha,
        p_nota: pagoForm.nota || null,
      });
      if (!error) {
        await cargarDatos({ silent: true });
        setPagoForm({ alumnoId: "", monto: "", metodo: "Efectivo", fecha: todayISO(), nota: "" });
        showToast("Pago registrado.");
      } else {
        showToast(
          "No se pudo guardar el pago (revisa tu conexión). No se perdió lo que escribiste — dale clic de nuevo.",
          true
        );
      }
    } finally {
      terminarEnvio();
    }
  }

  // Anula un pago: lo quita del historial y le devuelve el monto al saldo
  // pendiente del alumno, en una sola operación en la base de datos.
  async function anularPago(pago) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.rpc("anular_pago", { p_pago_id: pago.id });
      setConfirmDeletePago(null);
      if (!error) {
        await cargarDatos({ silent: true });
        showToast("Pago anulado. El saldo del alumno se actualizó.");
      } else {
        showToast("No se pudo anular el pago (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  // Corrige directamente el saldo pendiente de un alumno (para casos como
  // un pago duplicado que se anuló mal, o cualquier otro desajuste), dejando
  // registro de quién lo pidió, cuándo, el saldo anterior/nuevo y el motivo.
  async function aplicarAjusteSaldo(alumno, nuevoSaldo, motivo) {
    if (!iniciarEnvio()) return false;
    try {
      const { error } = await supabase.rpc("corregir_saldo_alumno", {
        p_alumno_id: alumno.id,
        p_saldo_nuevo: nuevoSaldo,
        p_motivo: motivo,
      });
      if (!error) {
        await cargarDatos({ silent: true });
        setAjusteModal(null);
        showToast(`Saldo de ${alumno.nombre} corregido.`);
      } else {
        showToast("No se pudo guardar la corrección (revisa tu conexión). Inténtalo de nuevo.", true);
      }
      return !error;
    } finally {
      terminarEnvio();
    }
  }

  // Marcar asistencia usa su propio candado por alumno (en vez del
  // candado global "enviando") para que pasar lista de 30 niños no
  // bloquee toda la pantalla mientras se guarda cada uno.
  const [marcandoIds, setMarcandoIds] = useState(() => new Set());
  async function marcarAsistencia(alumnoId, fecha, presente) {
    if (marcandoIds.has(alumnoId)) return;
    setMarcandoIds((prev) => new Set(prev).add(alumnoId));
    try {
      const { error } = await supabase.rpc("marcar_asistencia", {
        p_alumno_id: alumnoId,
        p_fecha: fecha,
        p_presente: presente,
      });
      if (!error) {
        await cargarDatos({ silent: true });
      } else {
        showToast("No se pudo guardar la asistencia (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      setMarcandoIds((prev) => {
        const next = new Set(prev);
        next.delete(alumnoId);
        return next;
      });
    }
  }

  async function registrarGasto(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!iniciarEnvio()) return;
    try {
      const monto = parseMonto(gastoForm.monto);
      if (isNaN(monto) || monto <= 0) {
        showToast("Ingresa un monto de gasto válido.", true);
        return;
      }
      const { error } = await supabase.from("gastos").insert({
        categoria: gastoForm.categoria,
        monto,
        fecha: gastoForm.fecha,
        nota: gastoForm.nota || null,
      });
      if (!error) {
        await cargarDatos({ silent: true });
        setGastoForm({ categoria: gastoForm.categoria, monto: "", fecha: todayISO(), nota: "" });
        showToast("Gasto registrado.");
      } else {
        showToast("No se pudo guardar el gasto (revisa tu conexión). Vuelve a intentarlo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarGasto(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("gastos").delete().eq("id", id);
      setConfirmDeleteGasto(null);
      if (!error) {
        setGastos((prev) => prev.filter((g) => g.id !== id));
        showToast("Gasto eliminado.");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Sigue en tu lista — inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  async function generarCobroMensual() {
    const afectados = pendientesGenerar;
    if (afectados.length === 0) {
      setConfirmCargo(false);
      return;
    }
    if (!iniciarEnvio()) return;
    try {
      // generar_cobro_mensual hace todo (sumar saldo a cada alumno + crear
      // el registro de historial) en una sola operación en la base de
      // datos, y además ya trae su propia protección contra duplicados
      // (ver supabase-schema.sql) — esto es justo lo que falló antes con
      // el incidente de "Por cobrar Q0" por varias pestañas abiertas.
      const { error } = await supabase.rpc("generar_cobro_mensual", {
        p_mes: mesCobroSeleccionado,
        p_alumno_ids: afectados.map((a) => a.id),
      });
      setConfirmCargo(false);
      if (!error) {
        await cargarDatos({ silent: true });
        showToast(`Cobro de ${monthLabel(mesCobroSeleccionado)} generado para ${afectados.length} alumno(s).`);
      } else {
        showToast(
          "No se pudo generar el cobro (revisa tu conexión). No se aplicó ningún cambio — inténtalo de nuevo.",
          true
        );
      }
    } finally {
      terminarEnvio();
    }
  }

  const alumnosFiltrados = alumnos
    .filter((a) => {
      const q = busqueda.trim().toLowerCase();
      if (!q) return true;
      return (
        a.nombre.toLowerCase().includes(q) ||
        (a.encargado || "").toLowerCase().includes(q) ||
        (a.categoria || "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => Number(b.saldoPendiente || 0) - Number(a.saldoPendiente || 0));

  const conDeuda = alumnosActivos
    .filter((a) => Number(a.saldoPendiente || 0) > 0)
    .sort((a, b) => Number(b.saldoPendiente || 0) - Number(a.saldoPendiente || 0))
    .slice(0, 8);

  // Lo que los entrenadores van marcando en "Asistencia" se refleja aquí
  // solo (por la suscripción en tiempo real de arriba), sin que el admin
  // tenga que hacer nada.
  const asistenciasHoy = asistencias.filter((x) => x.fecha === todayISO());
  const presentesHoy = asistenciasHoy.filter((x) => x.presente).length;

  // Datos para las gráficas del Resumen: cobrado vs. gastos de los
  // últimos 6 meses (incluyendo el actual), y % de asistencia de los
  // últimos 14 días con registros.
  const chartIngresos = useMemo(() => {
    const meses = [];
    const base = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      meses.push({ key, label: monthLabel(key).replace(/ de \d+$/, "").slice(0, 3) });
    }
    return meses.map(({ key, label }) => ({
      mes: label,
      Cobrado: Number(
        pagos.filter((p) => monthKeyOf(p.fecha) === key).reduce((s, p) => s + Number(p.monto || 0), 0).toFixed(2)
      ),
      Gastos: Number(
        gastos.filter((g) => monthKeyOf(g.fecha) === key).reduce((s, g) => s + Number(g.monto || 0), 0).toFixed(2)
      ),
    }));
  }, [pagos, gastos]);

  const chartAsistencia = useMemo(() => {
    const porFecha = new Map();
    asistencias.forEach((a) => {
      const actual = porFecha.get(a.fecha) || { total: 0, presentes: 0 };
      actual.total += 1;
      if (a.presente) actual.presentes += 1;
      porFecha.set(a.fecha, actual);
    });
    return [...porFecha.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-14)
      .map(([fecha, v]) => ({
        fecha: fecha.slice(5), // MM-DD
        Asistencia: Math.round((v.presentes / v.total) * 100),
      }));
  }, [asistencias]);

  return (
    <div className="app-root">
      <Styles />

      <header className="topbar">
        <div className="brand">
          <LogoMark />
          <div>
            <div className="brand-name">Atletic Guatemala</div>
            <div className="brand-sub">Control de pagos</div>
          </div>
        </div>
        {loading ? (
          <div className="sync-pill">
            <Loader2 size={14} className="spin" /> Cargando…
          </div>
        ) : (
          <div className="topbar-right">
            <button className="reload-btn" onClick={recargarManual} disabled={reloading} title="Recargar datos guardados">
              <RefreshCw size={14} className={reloading ? "spin" : ""} />
              Recargar
            </button>
            <div className="sync-pill ok">
              <Check size={14} /> Guardado
            </div>
            <button className="reload-btn" onClick={onLogout} title="Cerrar sesión">
              <LogOut size={14} />
              {perfil?.nombre ? perfil.nombre : "Salir"}
            </button>
          </div>
        )}
      </header>

      <nav className="tabs">
        {[
          { key: "resumen", label: "Resumen" },
          { key: "alumnos", label: "Alumnos" },
          { key: "pago", label: "Registrar pago" },
          { key: "gasto", label: "Gastos" },
          { key: "cobro", label: "Cobro mensual" },
          { key: "asistencia", label: "Asistencia" },
        ].map((t) => (
          <button
            key={t.key}
            className={"tab" + (tab === t.key ? " active" : "")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="content">
        {loading ? (
          <div className="empty">Cargando información…</div>
        ) : loadError ? (
          <div className="empty error">
            No se pudo cargar la información guardada. Intenta recargar.
          </div>
        ) : (
          <>
            {tab === "resumen" && (
              <ResumenView
                totalCobradoMes={totalCobradoMes}
                totalPorCobrar={totalPorCobrar}
                totalGastosMes={totalGastosMes}
                utilidadMes={utilidadMes}
                alumnosActivosCount={alumnosActivos.length}
                pagosHoy={pagosHoy}
                monthLabelStr={monthLabel(currentMonthKey)}
                conDeuda={conDeuda}
                onIrAlumnos={() => setTab("alumnos")}
                presentesHoy={presentesHoy}
                asistenciasHoyCount={asistenciasHoy.length}
                onIrAsistencia={() => setTab("asistencia")}
                chartIngresos={chartIngresos}
                chartAsistencia={chartAsistencia}
              />
            )}

            {tab === "alumnos" && (
              <AlumnosView
                alumnos={alumnosFiltrados}
                busqueda={busqueda}
                setBusqueda={setBusqueda}
                onNuevo={() => setAlumnoModal({})}
                onEditar={(a) => setAlumnoModal(a)}
                onEliminar={(a) => setConfirmDelete(a)}
                onEliminarVarios={(ids) => setConfirmDeleteVarios(ids)}
                onToggleActivo={toggleActivo}
                pendientesImportarCount={pendientesImportar.length}
                onImportar={() => setConfirmImport(true)}
                onCorregirSaldo={(a) => setAjusteModal(a)}
              />
            )}

            {tab === "pago" && (
              <PagoView
                alumnosActivos={alumnosActivos}
                pagoForm={pagoForm}
                setPagoForm={setPagoForm}
                onSubmit={registrarPago}
                pagosRecientes={pagos.slice(0, 10)}
                alumnoNombre={alumnoNombre}
                onAnular={(p) => setConfirmDeletePago(p)}
                enviando={enviando}
              />
            )}

            {tab === "gasto" && (
              <GastoView
                gastoForm={gastoForm}
                setGastoForm={setGastoForm}
                onSubmit={registrarGasto}
                gastosRecientes={gastos.slice(0, 10)}
                onEliminar={(g) => setConfirmDeleteGasto(g)}
                totalGastosMes={totalGastosMes}
                monthLabelStr={monthLabel(currentMonthKey)}
                enviando={enviando}
              />
            )}

            {tab === "cobro" && (
              <CobroView
                monthLabelStr={monthLabel(mesCobroSeleccionado)}
                mesesDisponibles={mesesCobroDisponibles}
                mesSeleccionado={mesCobroSeleccionado}
                onCambiarMes={setMesCobroSeleccionado}
                pendientesGenerar={pendientesGenerar}
                cargos={cargos}
                onGenerar={() => setConfirmCargo(true)}
              />
            )}

            {tab === "asistencia" && (
              <AsistenciaView
                alumnosActivos={alumnosActivos}
                asistencias={asistencias}
                onMarcar={marcarAsistencia}
                marcandoIds={marcandoIds}
              />
            )}
          </>
        )}
      </main>

      {alumnoModal !== null && (
        <AlumnoModal
          initial={alumnoModal}
          onSave={guardarAlumno}
          onCancel={() => setAlumnoModal(null)}
          enviando={enviando}
        />
      )}

      {ajusteModal && (
        <AjusteSaldoModal
          alumno={ajusteModal}
          onGuardar={aplicarAjusteSaldo}
          onCancel={() => setAjusteModal(null)}
          enviando={enviando}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`¿Eliminar a ${confirmDelete.nombre}?`}
          body="Se borrará su información y no podrá deshacerse. El historial de pagos ya registrados se conserva."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarAlumno(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
          disabled={enviando}
        />
      )}

      {confirmDeleteVarios && (
        <ConfirmDialog
          title={`¿Eliminar ${confirmDeleteVarios.length} alumno(s)?`}
          body="Se borrará su información y no podrá deshacerse. El historial de pagos ya registrados se conserva."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarAlumnos(confirmDeleteVarios)}
          onCancel={() => setConfirmDeleteVarios(null)}
          disabled={enviando}
        />
      )}

      {confirmDeleteGasto && (
        <ConfirmDialog
          title="¿Eliminar este gasto?"
          body={`${confirmDeleteGasto.categoria} · ${formatQ(confirmDeleteGasto.monto)} · ${confirmDeleteGasto.fecha}. No podrá deshacerse.`}
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarGasto(confirmDeleteGasto.id)}
          onCancel={() => setConfirmDeleteGasto(null)}
          disabled={enviando}
        />
      )}

      {confirmDeletePago && (
        <ConfirmDialog
          title="¿Anular este pago?"
          body={`${alumnoNombre(confirmDeletePago.alumnoId)} · ${formatQ(confirmDeletePago.monto)} · ${confirmDeletePago.fecha}. Se le devolverá el monto al saldo pendiente del alumno. No podrá deshacerse.`}
          confirmLabel="Anular pago"
          danger
          onConfirm={() => anularPago(confirmDeletePago)}
          onCancel={() => setConfirmDeletePago(null)}
          disabled={enviando}
        />
      )}

      {confirmCargo && (
        <ConfirmDialog
          title={`Generar cobro de ${monthLabel(mesCobroSeleccionado)}`}
          body={
            (pendientesGenerar.length === 0
              ? "Todos los alumnos activos que no están becados ya tienen el cobro de ese mes generado."
              : `Se sumará la tarifa mensual al saldo de ${pendientesGenerar.length} alumno(s) activo(s), por un total de ${formatQ(
                  pendientesGenerar.reduce((s, a) => s + Number(a.tarifaMensual || 0), 0)
                )}.`) +
            (becadosActivosCount > 0
              ? ` No se cobra a ${becadosActivosCount} alumno(s) becado(s).`
              : "")
          }
          confirmLabel={pendientesGenerar.length === 0 ? "Entendido" : "Generar cobro"}
          onConfirm={generarCobroMensual}
          onCancel={() => setConfirmCargo(false)}
          disabled={enviando}
        />
      )}

      {confirmImport && (
        <ConfirmDialog
          title="Importar listado 2026"
          body={
            pendientesImportar.length === 0
              ? "Ya se importaron todos los alumnos de este listado (o ya existen con el mismo nombre)."
              : `Se agregarán ${pendientesImportar.length} alumno(s) nuevo(s) con su categoría, horario y tarifa ya cargados, con saldo en Q0. Los que ya tienen el mismo nombre en tu lista no se duplican.`
          }
          confirmLabel={pendientesImportar.length === 0 ? "Entendido" : "Importar"}
          onConfirm={importarListado2026}
          onCancel={() => setConfirmImport(false)}
          disabled={enviando}
        />
      )}

      {toast && (
        <div className={"toast" + (toast.isError ? " toast-error" : "")}>{toast.msg}</div>
      )}
    </div>
  );
}

/* ---------------- Vistas ---------------- */

// Tooltip compartido por las gráficas del Resumen, con el mismo estilo
// (tarjeta blanca, borde suave) que el resto de la app en vez del tooltip
// genérico de la librería.
function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #E4E8EA", borderRadius: 8, padding: "8px 11px", boxShadow: "0 6px 16px rgba(38,40,44,0.10)", fontSize: 12.5 }}>
      <div style={{ color: "#404041", fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", alignItems: "center", gap: 6, color: "#6C6F72" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, display: "inline-block" }} />
          <span>{p.name}:</span>
          <span style={{ color: "#404041", fontWeight: 500 }}>{formatter ? formatter(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

function ResumenView({
  totalCobradoMes,
  totalPorCobrar,
  totalGastosMes,
  utilidadMes,
  alumnosActivosCount,
  pagosHoy,
  monthLabelStr,
  conDeuda,
  onIrAlumnos,
  presentesHoy,
  asistenciasHoyCount,
  onIrAsistencia,
  chartIngresos,
  chartAsistencia,
}) {
  const utilidadPositiva = utilidadMes >= 0;
  const hayAsistencia = chartAsistencia && chartAsistencia.length > 0;
  return (
    <div className="stack">
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#E7F7FD", color: "#0090C2" }}>
            <Wallet size={18} />
          </div>
          <div>
            <div className="kpi-label">Cobrado en {monthLabelStr}</div>
            <div className="kpi-value">{formatQ(totalCobradoMes)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#FBEAE9", color: "#C13F3B" }}>
            <ArrowDownRight size={18} />
          </div>
          <div>
            <div className="kpi-label">Gastos en {monthLabelStr}</div>
            <div className="kpi-value">{formatQ(totalGastosMes)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div
            className="kpi-icon"
            style={
              utilidadPositiva
                ? { background: "#E7F7F1", color: "#158F63" }
                : { background: "#FBEAE9", color: "#C13F3B" }
            }
          >
            <ArrowUpRight size={18} />
          </div>
          <div>
            <div className="kpi-label">Utilidad de {monthLabelStr}</div>
            <div className="kpi-value" style={{ color: utilidadPositiva ? "#158F63" : "#C13F3B" }}>
              {formatQ(utilidadMes)}
            </div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#FCF1DD", color: "#B4790A" }}>
            <AlertTriangle size={18} />
          </div>
          <div>
            <div className="kpi-label">Por cobrar (total)</div>
            <div className="kpi-value">{formatQ(totalPorCobrar)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#E7F7F1", color: "#158F63" }}>
            <Users size={18} />
          </div>
          <div>
            <div className="kpi-label">Alumnos activos</div>
            <div className="kpi-value">{alumnosActivosCount}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#EFEFF0", color: "#404041" }}>
            <CalendarClock size={18} />
          </div>
          <div>
            <div className="kpi-label">Pagos registrados hoy</div>
            <div className="kpi-value">{pagosHoy}</div>
          </div>
        </div>
        <div className="kpi-card kpi-clickable" onClick={onIrAsistencia}>
          <div className="kpi-icon" style={{ background: "#E7F7FD", color: "#0090C2" }}>
            <ClipboardCheck size={18} />
          </div>
          <div>
            <div className="kpi-label">Asistencia de hoy</div>
            <div className="kpi-value">
              {asistenciasHoyCount === 0 ? "Sin marcar" : `${presentesHoy}/${asistenciasHoyCount}`}
            </div>
          </div>
        </div>
      </div>

      <div className="stack two-col">
        <div className="panel">
          <h2>Cobrado vs. gastos (últimos 6 meses)</h2>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={chartIngresos} margin={{ top: 4, right: 4, left: -12, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="#F0F2F3" />
                <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#8A8D90" }} axisLine={{ stroke: "#E4E8EA" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#8A8D90" }} axisLine={false} tickLine={false} width={54} tickFormatter={(v) => `Q${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
                <Tooltip content={<ChartTooltip formatter={(v) => formatQ(v)} />} cursor={{ fill: "#F4F6F7" }} />
                <Legend wrapperStyle={{ fontSize: 12.5, color: "#6C6F72" }} iconType="circle" iconSize={8} />
                <Bar dataKey="Cobrado" fill="#0090C2" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="Gastos" fill="#C13F3B" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <h2>Asistencia (últimos días con registro)</h2>
          {!hayAsistencia ? (
            <div className="empty small">Todavía no hay asistencia marcada para graficar.</div>
          ) : (
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={chartAsistencia} margin={{ top: 4, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#F0F2F3" />
                  <XAxis dataKey="fecha" tick={{ fontSize: 12, fill: "#8A8D90" }} axisLine={{ stroke: "#E4E8EA" }} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#8A8D90" }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<ChartTooltip formatter={(v) => `${v}%`} />} cursor={{ stroke: "#E4E8EA" }} />
                  <Line type="monotone" dataKey="Asistencia" stroke="#00B6F1" strokeWidth={2} dot={{ r: 3, fill: "#00B6F1", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Mayor deuda pendiente</h2>
          <button className="link-btn" onClick={onIrAlumnos}>
            Ver todos los alumnos
          </button>
        </div>
        {conDeuda.length === 0 ? (
          <div className="empty small">No hay alumnos con saldo pendiente. Todo al día.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Alumno</th>
                <th>Categoría</th>
                <th>Encargado</th>
                <th className="num">Debe</th>
              </tr>
            </thead>
            <tbody>
              {conDeuda.map((a) => (
                <tr key={a.id}>
                  <td>{a.nombre}</td>
                  <td>{a.categoria}</td>
                  <td>{a.encargado || "—"}</td>
                  <td className="num debt">{formatQ(a.saldoPendiente)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AlumnosView({
  alumnos,
  busqueda,
  setBusqueda,
  onNuevo,
  onEditar,
  onEliminar,
  onEliminarVarios,
  onToggleActivo,
  pendientesImportarCount,
  onImportar,
  onCorregirSaldo,
}) {
  const [seleccionados, setSeleccionados] = useState(() => new Set());

  // Si la lista visible cambia (por búsqueda, o porque se borró alguien),
  // se quita de la selección a cualquiera que ya no esté en pantalla.
  useEffect(() => {
    setSeleccionados((prev) => {
      const idsVisibles = new Set(alumnos.map((a) => a.id));
      const next = new Set([...prev].filter((id) => idsVisibles.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alumnos]);

  function toggleUno(id) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTodos() {
    setSeleccionados((prev) =>
      prev.size === alumnos.length ? new Set() : new Set(alumnos.map((a) => a.id))
    );
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            placeholder="Buscar por nombre, encargado o categoría…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <div className="toolbar-actions">
          {seleccionados.size > 0 && (
            <button
              className="btn-danger"
              onClick={() => onEliminarVarios(Array.from(seleccionados))}
            >
              <Trash2 size={16} /> Eliminar seleccionados ({seleccionados.size})
            </button>
          )}
          {pendientesImportarCount > 0 && (
            <button className="btn-secondary" onClick={onImportar}>
              Importar listado 2026 ({pendientesImportarCount})
            </button>
          )}
          <button className="btn-primary" onClick={onNuevo}>
            <Plus size={16} /> Agregar alumno
          </button>
        </div>
      </div>

      {alumnos.length === 0 ? (
        <div className="empty">
          No hay alumnos todavía. Agrega el primero con el botón de arriba.
        </div>
      ) : (
        <div className="panel">
          <table className="table">
            <thead>
              <tr>
                <th className="th-check">
                  <input
                    type="checkbox"
                    checked={alumnos.length > 0 && seleccionados.size === alumnos.length}
                    ref={(el) => {
                      if (el) el.indeterminate = seleccionados.size > 0 && seleccionados.size < alumnos.length;
                    }}
                    onChange={toggleTodos}
                    aria-label="Seleccionar todos"
                  />
                </th>
                <th>Alumno</th>
                <th>Categoría</th>
                <th>Horario</th>
                <th>Encargado</th>
                <th className="num">Tarifa</th>
                <th className="num">Saldo</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {alumnos.map((a) => {
                const tone = saldoTone(Number(a.saldoPendiente || 0), Number(a.tarifaMensual || 0));
                return (
                  <tr key={a.id} className={a.activo === false ? "row-inactive" : ""}>
                    <td className="th-check">
                      <input
                        type="checkbox"
                        checked={seleccionados.has(a.id)}
                        onChange={() => toggleUno(a.id)}
                        aria-label={`Seleccionar a ${a.nombre}`}
                      />
                    </td>
                    <td>
                      <div className="cell-title">
                        {a.nombre}
                        {a.becado && <span className="badge-becado">Becado</span>}
                      </div>
                      <div className="cell-sub">{a.telefono || ""}</div>
                    </td>
                    <td>{a.categoria}</td>
                    <td>{a.horario}</td>
                    <td>{a.encargado || "—"}</td>
                    <td className="num">{a.becado ? "—" : formatQ(a.tarifaMensual)}</td>
                    <td className="num">
                      {a.becado ? (
                        <span className="badge" style={{ color: "#0090C2", background: "#E7F7FD" }}>
                          Sin cobro
                        </span>
                      ) : (
                        <span className="badge" style={{ color: tone.color, background: tone.bg }}>
                          {formatQ(Math.abs(a.saldoPendiente || 0))}
                          {a.saldoPendiente < 0 ? " a favor" : ""}
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className={"pill-toggle" + (a.activo === false ? "" : " on")}
                        onClick={() => onToggleActivo(a.id)}
                      >
                        {a.activo === false ? "Inactivo" : "Activo"}
                      </button>
                    </td>
                    <td className="actions">
                      <button className="icon-btn" onClick={() => onEditar(a)} aria-label="Editar">
                        <Pencil size={15} />
                      </button>
                      {!a.becado && (
                        <button
                          className="icon-btn"
                          onClick={() => onCorregirSaldo(a)}
                          aria-label="Corregir saldo"
                          title="Corregir saldo"
                        >
                          <Wrench size={15} />
                        </button>
                      )}
                      <button className="icon-btn danger" onClick={() => onEliminar(a)} aria-label="Eliminar">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BuscadorAlumno({ alumnos, seleccionado, onSeleccionar }) {
  const [query, setQuery] = useState("");
  const [abierto, setAbierto] = useState(false);
  const wrapRef = React.useRef(null);

  useEffect(() => {
    function handleClickFuera(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setAbierto(false);
      }
    }
    document.addEventListener("mousedown", handleClickFuera);
    return () => document.removeEventListener("mousedown", handleClickFuera);
  }, []);

  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? alumnos.filter(
          (a) =>
            a.nombre.toLowerCase().includes(q) || (a.encargado || "").toLowerCase().includes(q)
        )
      : alumnos;
    return base.slice(0, 30);
  }, [alumnos, query]);

  if (seleccionado && !abierto) {
    return (
      <div className="buscador-chip">
        <div>
          <div className="cell-title">{seleccionado.nombre}</div>
          <div className="cell-sub">
            {seleccionado.categoria} · saldo {formatQ(seleccionado.saldoPendiente)}
          </div>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Cambiar alumno"
          onClick={() => {
            setQuery("");
            setAbierto(true);
          }}
        >
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="buscador-wrap" ref={wrapRef}>
      <div className="search-box buscador-input">
        <Search size={16} />
        <input
          type="text"
          placeholder="Escribe el nombre del alumno…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setAbierto(true)}
          autoFocus={!!seleccionado}
        />
      </div>
      {abierto && (
        <div className="buscador-lista">
          {resultados.length === 0 ? (
            <div className="buscador-vacio">No se encontró ningún alumno con ese nombre.</div>
          ) : (
            resultados.map((a) => (
              <button
                type="button"
                key={a.id}
                className="buscador-item"
                onClick={() => {
                  onSeleccionar(a.id);
                  setQuery("");
                  setAbierto(false);
                }}
              >
                <span className="cell-title">{a.nombre}</span>
                <span className="cell-sub">
                  {a.categoria} · saldo {formatQ(a.saldoPendiente)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PagoView({ alumnosActivos, pagoForm, setPagoForm, onSubmit, pagosRecientes, alumnoNombre, onAnular, enviando }) {
  const alumnoSeleccionado = alumnosActivos.find((a) => a.id === pagoForm.alumnoId) || null;
  const [meses, setMeses] = useState(1);

  const tarifaSeleccionado = Number(alumnoSeleccionado?.tarifaMensual || 0);
  const sugerido = tarifaSeleccionado * Math.max(1, Number(meses) || 1);

  function aplicarSugerido() {
    const n = Math.max(1, Number(meses) || 1);
    setPagoForm({
      ...pagoForm,
      monto: String(tarifaSeleccionado * n),
      nota: pagoForm.nota || (n > 1 ? `Pago adelantado de ${n} meses` : ""),
    });
  }

  return (
    <div className="stack two-col">
      <div className="panel">
        <h2>Registrar pago</h2>
        {alumnosActivos.length === 0 ? (
          <div className="empty small">Agrega alumnos activos antes de registrar un pago.</div>
        ) : (
          <div
            className="form"
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit(e);
            }}
          >
            <label>
              Alumno
              <BuscadorAlumno
                alumnos={alumnosActivos}
                seleccionado={alumnoSeleccionado}
                onSeleccionar={(id) => setPagoForm({ ...pagoForm, alumnoId: id })}
              />
            </label>

            {alumnoSeleccionado && tarifaSeleccionado > 0 && (
              <div className="meses-calc">
                <label className="meses-calc-label">
                  ¿Cuántos meses cubre este pago?
                  <div className="meses-calc-row">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={meses}
                      onChange={(e) => setMeses(e.target.value)}
                      className="meses-calc-input"
                    />
                    <button type="button" className="btn-secondary" onClick={aplicarSugerido}>
                      Usar {formatQ(sugerido)} como monto
                    </button>
                  </div>
                </label>
                <p className="muted meses-calc-hint">
                  Tarifa mensual de {alumnoSeleccionado.nombre}: {formatQ(tarifaSeleccionado)}. Si
                  paga meses adelantados, el saldo quedará "a favor" y se irá descontando solo
                  cada vez que generes el cobro de esos meses.
                </p>
              </div>
            )}

            <div className="form-row">
              <label>
                Monto
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={pagoForm.monto}
                  onChange={(e) => setPagoForm({ ...pagoForm, monto: e.target.value })}
                />
              </label>
              <label>
                Fecha
                <input
                  type="date"
                  value={pagoForm.fecha}
                  onChange={(e) => setPagoForm({ ...pagoForm, fecha: e.target.value })}
                />
              </label>
            </div>

            <label>
              Método de pago
              <select
                value={pagoForm.metodo}
                onChange={(e) => setPagoForm({ ...pagoForm, metodo: e.target.value })}
              >
                {METODOS_PAGO.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Nota (opcional)
              <input
                type="text"
                placeholder="No. de transacción, observación…"
                value={pagoForm.nota}
                onChange={(e) => setPagoForm({ ...pagoForm, nota: e.target.value })}
              />
            </label>

            <button type="button" className="btn-primary full" onClick={onSubmit} disabled={enviando}>
              {enviando ? "Guardando…" : "Registrar pago"}
            </button>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Últimos pagos</h2>
        {pagosRecientes.length === 0 ? (
          <div className="empty small">Aún no hay pagos registrados.</div>
        ) : (
          <ul className="pago-list">
            {pagosRecientes.map((p) => (
              <li key={p.id}>
                <div className="pago-row">
                  <span className="cell-title">{alumnoNombre(p.alumnoId)}</span>
                  <span className="num pago-monto">{formatQ(p.monto)}</span>
                </div>
                <div className="cell-sub gasto-sub">
                  <span>
                    {p.fecha} · {p.metodo}
                    {p.nota ? ` · ${p.nota}` : ""}
                  </span>
                  <button className="icon-btn danger" onClick={() => onAnular(p)} aria-label="Anular pago" disabled={enviando}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function GastoView({
  gastoForm,
  setGastoForm,
  onSubmit,
  gastosRecientes,
  onEliminar,
  totalGastosMes,
  monthLabelStr,
  enviando,
}) {
  return (
    <div className="stack two-col">
      <div className="panel">
        <h2>Registrar gasto</h2>
        <div
          className="form"
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit(e);
          }}
        >
          <label>
            Categoría
            <select
              value={gastoForm.categoria}
              onChange={(e) => setGastoForm({ ...gastoForm, categoria: e.target.value })}
            >
              {CATEGORIAS_GASTO.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <div className="form-row">
            <label>
              Monto
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={gastoForm.monto}
                onChange={(e) => setGastoForm({ ...gastoForm, monto: e.target.value })}
              />
            </label>
            <label>
              Fecha
              <input
                type="date"
                value={gastoForm.fecha}
                onChange={(e) => setGastoForm({ ...gastoForm, fecha: e.target.value })}
              />
            </label>
          </div>

          <label>
            Nota (opcional)
            <input
              type="text"
              placeholder="Cancha Discovery, sueldo profe Carlos…"
              value={gastoForm.nota}
              onChange={(e) => setGastoForm({ ...gastoForm, nota: e.target.value })}
            />
          </label>

          <button type="button" className="btn-primary full" onClick={onSubmit} disabled={enviando}>
            {enviando ? "Guardando…" : "Registrar gasto"}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Últimos gastos</h2>
          <span className="muted">Total {monthLabelStr}: {formatQ(totalGastosMes)}</span>
        </div>
        {gastosRecientes.length === 0 ? (
          <div className="empty small">Aún no hay gastos registrados.</div>
        ) : (
          <ul className="pago-list">
            {gastosRecientes.map((g) => (
              <li key={g.id}>
                <div className="pago-row">
                  <span className="cell-title">{g.categoria}</span>
                  <span className="num" style={{ color: "#C13F3B", fontWeight: 600 }}>
                    -{formatQ(g.monto)}
                  </span>
                </div>
                <div className="cell-sub gasto-sub">
                  <span>
                    {g.fecha}
                    {g.nota ? ` · ${g.nota}` : ""}
                  </span>
                  <button className="icon-btn danger" onClick={() => onEliminar(g)} aria-label="Eliminar gasto">
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CobroView({
  monthLabelStr,
  mesesDisponibles,
  mesSeleccionado,
  onCambiarMes,
  pendientesGenerar,
  cargos,
  onGenerar,
}) {
  const total = pendientesGenerar.reduce((s, a) => s + Number(a.tarifaMensual || 0), 0);
  const hoyKey = monthKeyOf(todayISO());
  return (
    <div className="stack">
      <div className="panel highlight">
        <div className="cobro-head">
          <div>
            <h2>Cobro de {monthLabelStr}</h2>
            <p className="muted">
              Suma la tarifa mensual al saldo de cada alumno activo que aún no tenga el cobro de
              ese mes generado. Los alumnos agregados a mitad de mes no se duplican. Puedes
              adelantar el cobro de un mes futuro sin esperar a que llegue la fecha.
            </p>
            {mesesDisponibles && mesesDisponibles.length > 1 && (
              <label className="cobro-mes-selector">
                Mes a cobrar
                <select value={mesSeleccionado} onChange={(e) => onCambiarMes(e.target.value)}>
                  {mesesDisponibles.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                      {m === hoyKey ? " (mes actual)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <button
            className="btn-primary"
            onClick={onGenerar}
            disabled={pendientesGenerar.length === 0}
          >
            {pendientesGenerar.length === 0 ? "Ya generado" : `Generar cobro (${pendientesGenerar.length})`}
          </button>
        </div>
        {pendientesGenerar.length > 0 && (
          <div className="cobro-preview">
            {pendientesGenerar.length} alumno(s) pendientes · total a sumar: {formatQ(total)}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Historial de cobros generados</h2>
        {cargos.length === 0 ? (
          <div className="empty small">Todavía no se ha generado ningún cobro mensual.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Fecha de generación</th>
                <th className="num">Alumnos</th>
                <th className="num">Total generado</th>
              </tr>
            </thead>
            <tbody>
              {cargos.map((c) => (
                <tr key={c.id}>
                  <td>{monthLabel(c.mes)}</td>
                  <td>{c.fecha}</td>
                  <td className="num">{c.cantidadAlumnos}</td>
                  <td className="num">{formatQ(c.totalGenerado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Pasar lista. La usan tanto el admin como los entrenadores — a los
// entrenadores se les pasa una lista de alumnos SIN tarifa ni saldo
// (viene de la función alumnos_para_asistencia(), que nunca expone esas
// columnas), así que este componente ni siquiera tiene esos datos
// disponibles para mostrar por accidente.
function AsistenciaView({ alumnosActivos, asistencias, onMarcar, marcandoIds }) {
  const [fecha, setFecha] = useState(todayISO());
  const [busqueda, setBusqueda] = useState("");

  const asistenciasDelDia = useMemo(() => {
    const mapa = new Map();
    asistencias.filter((a) => a.fecha === fecha).forEach((a) => mapa.set(a.alumnoId, a));
    return mapa;
  }, [asistencias, fecha]);

  const alumnosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const base = q
      ? alumnosActivos.filter(
          (a) => a.nombre.toLowerCase().includes(q) || (a.categoria || "").toLowerCase().includes(q)
        )
      : alumnosActivos;
    return [...base].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [alumnosActivos, busqueda]);

  const totalPresentes = alumnosFiltrados.filter((a) => asistenciasDelDia.get(a.id)?.presente).length;
  const totalMarcados = alumnosFiltrados.filter((a) => asistenciasDelDia.has(a.id)).length;

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head">
          <h2>Asistencia</h2>
          <span className="muted">
            {totalMarcados === 0 ? "Nadie marcado todavía" : `${totalPresentes} presente(s) de ${totalMarcados} marcado(s)`}
          </span>
        </div>
        <div className="toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              placeholder="Buscar por nombre o categoría…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <label className="asistencia-fecha">
            Fecha
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </label>
        </div>
      </div>

      {alumnosFiltrados.length === 0 ? (
        <div className="empty">No hay alumnos activos que coincidan con la búsqueda.</div>
      ) : (
        <div className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Alumno</th>
                <th>Categoría</th>
                <th>Horario</th>
                <th className="num">Asistencia</th>
              </tr>
            </thead>
            <tbody>
              {alumnosFiltrados.map((a) => {
                const marca = asistenciasDelDia.get(a.id);
                const marcando = marcandoIds.has(a.id);
                return (
                  <tr key={a.id}>
                    <td className="cell-title">{a.nombre}</td>
                    <td>{a.categoria}</td>
                    <td>{a.horario}</td>
                    <td className="num">
                      <div className="asistencia-botones">
                        <button
                          type="button"
                          className={"pill-toggle" + (marca?.presente ? " on" : "")}
                          disabled={marcando}
                          onClick={() => onMarcar(a.id, fecha, true)}
                        >
                          Presente
                        </button>
                        <button
                          type="button"
                          className={"pill-toggle pill-ausente" + (marca && !marca.presente ? " on" : "")}
                          disabled={marcando}
                          onClick={() => onMarcar(a.id, fecha, false)}
                        >
                          Ausente
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- Componentes ---------------- */

function AlumnoModal({ initial, onSave, onCancel, enviando }) {
  const [form, setForm] = useState({
    id: initial.id || null,
    nombre: initial.nombre || "",
    encargado: initial.encargado || "",
    telefono: initial.telefono || "",
    categoria: initial.categoria || CATEGORIAS[0],
    horario: initial.horario || HORARIOS[0],
    tarifaMensual: initial.tarifaMensual != null ? String(initial.tarifaMensual) : "",
    becado: !!initial.becado,
  });
  const [error, setError] = useState(null);

  function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const problemas = [];
    if (!form.nombre.trim()) problemas.push("Escribe el nombre del alumno.");
    const tarifaNum = parseMonto(form.tarifaMensual);
    if (form.tarifaMensual === "" || isNaN(tarifaNum) || tarifaNum < 0) {
      problemas.push("Ingresa una tarifa mensual válida (por ejemplo 425 o 425.00).");
    }
    if (problemas.length > 0) {
      setError(problemas.join(" "));
      return;
    }
    setError(null);
    onSave({ ...form, tarifaMensual: tarifaNum });
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{form.id ? "Editar alumno" : "Agregar alumno"}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div
          className="form"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit(e);
          }}
        >
          <label>
            Nombre completo
            <input
              type="text"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              autoFocus
            />
          </label>
          <div className="form-row">
            <label>
              Encargado
              <input
                type="text"
                value={form.encargado}
                onChange={(e) => setForm({ ...form, encargado: e.target.value })}
              />
            </label>
            <label>
              Teléfono
              <input
                type="text"
                value={form.telefono}
                onChange={(e) => setForm({ ...form, telefono: e.target.value })}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Categoría
              <select
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
              >
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Horario
              <select
                value={form.horario}
                onChange={(e) => setForm({ ...form, horario: e.target.value })}
              >
                {HORARIOS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Tarifa mensual
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={form.tarifaMensual}
              onChange={(e) => setForm({ ...form, tarifaMensual: e.target.value })}
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={form.becado}
              onChange={(e) => setForm({ ...form, becado: e.target.checked })}
            />
            <span>
              Becado (no se le cobra mensualidad)
              {form.becado && (
                <span className="checkbox-hint">
                  {" "}
                  — no se le sumará ningún cobro mientras esté marcado, aunque tenga tarifa
                  registrada.
                </span>
              )}
            </span>
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={enviando}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" onClick={handleSubmit} disabled={enviando}>
              {enviando ? "Guardando…" : form.id ? "Guardar cambios" : "Agregar alumno"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Corrige el saldo pendiente de un alumno a mano, con un motivo obligatorio,
// para casos donde el saldo quedó mal (p. ej. un pago duplicado por un
// doble clic que al anularse no dejó todo exactamente como estaba antes).
// Queda guardado en el historial de ajustes (saldo anterior, saldo nuevo,
// motivo y fecha), a diferencia de pedirme a mí que edite el dato por chat.
function AjusteSaldoModal({ alumno, onGuardar, onCancel, enviando }) {
  const [nuevoSaldo, setNuevoSaldo] = useState(String(alumno.saldoPendiente ?? 0));
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(null);

  const saldoActual = Number(alumno.saldoPendiente || 0);
  const saldoNum = parseMonto(nuevoSaldo);
  const diferencia = isNaN(saldoNum) ? null : Number((saldoNum - saldoActual).toFixed(2));

  function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (isNaN(saldoNum)) {
      setError("Ingresa un saldo válido (puede ser 0, o negativo si el alumno queda a favor).");
      return;
    }
    if (!motivo.trim()) {
      setError("Escribe brevemente el motivo de la corrección (queda guardado en el historial).");
      return;
    }
    setError(null);
    onGuardar(alumno, saldoNum, motivo.trim());
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Corregir saldo de {alumno.nombre}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>
          Usa esto para corregir un saldo que quedó mal por un error (pago duplicado, anulación
          incompleta, etc.), no para registrar un pago o un cobro nuevo. Queda un registro de por
          qué se hizo el cambio.
        </p>
        {error && <div className="form-error">{error}</div>}
        <div
          className="form"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit(e);
          }}
        >
          <label>
            Saldo actual
            <input type="text" value={formatQ(saldoActual)} disabled />
          </label>
          <label>
            Saldo correcto
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={nuevoSaldo}
              onChange={(e) => setNuevoSaldo(e.target.value)}
              autoFocus
            />
          </label>
          {diferencia !== null && diferencia !== 0 && (
            <p className="muted" style={{ marginTop: -4 }}>
              Esto {diferencia > 0 ? "aumenta" : "reduce"} el saldo en {formatQ(Math.abs(diferencia))}.
            </p>
          )}
          <label>
            Motivo de la corrección
            <input
              type="text"
              placeholder="Ej: pago duplicado por doble clic, se anuló mal"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={enviando}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" onClick={handleSubmit} disabled={enviando}>
              {enviando ? "Guardando…" : "Guardar corrección"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel, disabled }) {
  return (
    <div className="modal-overlay" onClick={disabled ? undefined : onCancel}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="muted">{body}</p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel} disabled={disabled}>
            Cancelar
          </button>
          <button className={danger ? "btn-danger" : "btn-primary"} onClick={onConfirm} disabled={disabled}>
            {disabled ? "Guardando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function LogoMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="17" cy="17" r="16" stroke="#00B6F1" strokeWidth="2" fill="#F5FBFE" />
      <path
        d="M17 8 L21 12.5 L19.3 18 L14.7 18 L13 12.5 Z"
        fill="#00B6F1"
      />
      <path d="M17 3.2V8M17 26v4.8M3.2 17H8M26 17h4.8" stroke="#00B6F1" strokeWidth="1.4" />
    </svg>
  );
}

function Styles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Jost:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');

      .app-root {
        --blue: #00B6F1;
        --blue-dark: #0090C2;
        --charcoal: #404041;
        --ink: #26282C;
        --bg: #F4F6F7;
        --card: #FFFFFF;
        --border: #E4E8EA;
        font-family: 'Inter', system-ui, sans-serif;
        color: var(--ink);
        background: var(--bg);
        min-height: 100%;
        border-radius: 12px;
        overflow: hidden;
      }
      .app-root h1, .app-root h2, .app-root h3, .app-root .brand-name, .app-root .tab, .app-root button {
        font-family: 'Jost', 'Inter', sans-serif;
      }

      .topbar {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 20px; background: var(--card); border-bottom: 1px solid var(--border);
      }
      .brand { display: flex; align-items: center; gap: 10px; }
      .brand-name { font-weight: 600; font-size: 17px; color: var(--charcoal); line-height: 1.1; }
      .brand-sub { font-size: 12px; color: #8A8D90; font-family: 'Inter'; margin-top: 2px; }
      .sync-pill { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #8A8D90; }
      .sync-pill.ok { color: #158F63; }
      .topbar-right { display: flex; align-items: center; gap: 10px; }
      .reload-btn {
        display: flex; align-items: center; gap: 6px; font-size: 12px; color: #6C6F72;
        background: #F0F2F3; border: none; padding: 6px 11px; border-radius: 999px; cursor: pointer; font-family: 'Inter';
      }
      .reload-btn:hover { background: #E4E8EA; }
      .reload-btn:disabled { opacity: 0.6; cursor: default; }
      .spin { animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }

      .tabs { display: flex; gap: 4px; padding: 10px 16px 0; background: var(--card); overflow-x: auto; }
      .tab {
        border: none; background: transparent; padding: 10px 16px; font-size: 14px; font-weight: 500;
        color: #8A8D90; cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap;
      }
      .tab.active { color: var(--blue-dark); border-bottom-color: var(--blue); }

      .content { padding: 20px; }
      .stack { display: flex; flex-direction: column; gap: 18px; }
      .two-col { flex-direction: row; align-items: flex-start; flex-wrap: wrap; }
      .two-col > .panel { flex: 1 1 320px; }

      .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
      .kpi-card {
        background: var(--card); border: 1px solid var(--border); border-radius: 12px;
        padding: 14px 16px; display: flex; align-items: center; gap: 12px;
      }
      .kpi-icon { width: 36px; height: 36px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .kpi-label { font-size: 12px; color: #8A8D90; margin-bottom: 2px; }
      .kpi-value { font-size: 19px; font-weight: 700; color: var(--charcoal); font-family: 'Jost'; }

      .panel { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
      .panel.highlight { border-color: #BEE9FA; background: #F7FCFE; }
      .panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .panel h2 { font-size: 15px; font-weight: 600; color: var(--charcoal); margin: 0 0 10px; }
      .link-btn { background: none; border: none; color: var(--blue-dark); font-size: 13px; cursor: pointer; font-weight: 500; }
      .muted { color: #8A8D90; font-size: 13px; line-height: 1.5; margin: 4px 0 0; }

      .cobro-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .cobro-preview { margin-top: 12px; font-size: 13px; color: var(--blue-dark); background: #E7F7FD; padding: 8px 12px; border-radius: 8px; display: inline-block; }
      .cobro-mes-selector { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; font-size: 12px; color: #8A8D90; max-width: 240px; }
      .cobro-mes-selector select { font-size: 14px; color: var(--ink); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: #fff; }

      .table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .table th { text-align: left; font-weight: 500; color: #8A8D90; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 12px; }
      .table td { padding: 10px; border-bottom: 1px solid #F0F2F3; vertical-align: middle; }
      .table tr:last-child td { border-bottom: none; }
      .table .num { text-align: right; }
      .table .debt { color: #C13F3B; font-weight: 600; }
      .table .th-check { width: 34px; padding-right: 0; }
      .table .th-check input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }
      .row-inactive { opacity: 0.5; }
      .cell-title { font-weight: 500; color: var(--charcoal); }
      .badge-becado { display: inline-block; margin-left: 7px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.2px; color: #B4790A; background: #FCF1DD; padding: 1.5px 7px; border-radius: 999px; vertical-align: middle; }
      .cell-sub { font-size: 12px; color: #8A8D90; margin-top: 1px; }

      .badge { padding: 3px 10px; border-radius: 999px; font-weight: 600; font-size: 12.5px; }
      .pill-toggle { border: 1px solid var(--border); background: #F7F7F8; color: #8A8D90; font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
      .pill-toggle.on { background: #E7F7F1; color: #158F63; border-color: #CBEEDF; }
      .pill-ausente.on { background: #FBEAE9; color: #C13F3B; border-color: #F3CFCD; }
      .kpi-clickable { cursor: pointer; }
      .kpi-clickable:hover { border-color: #BEE9FA; }
      .asistencia-fecha { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #6C6F72; font-weight: 500; }
      .asistencia-fecha input { font-family: 'Inter'; font-size: 13.5px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); }
      .asistencia-botones { display: flex; gap: 6px; justify-content: flex-end; }

      .actions { display: flex; gap: 4px; }
      .icon-btn { border: none; background: transparent; color: #8A8D90; cursor: pointer; padding: 6px; border-radius: 7px; display: flex; }
      .icon-btn:hover { background: #F0F2F3; color: var(--charcoal); }
      .icon-btn.danger:hover { background: #FBEAE9; color: #C13F3B; }

      .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: space-between; }
      .toolbar-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .search-box { display: flex; align-items: center; gap: 8px; background: var(--card); border: 1px solid var(--border); border-radius: 9px; padding: 8px 12px; flex: 1 1 260px; color: #8A8D90; }
      .search-box input { border: none; outline: none; flex: 1; font-size: 13px; font-family: 'Inter'; background: transparent; }

      .buscador-wrap { position: relative; }
      .buscador-input { border: 1px solid var(--border); }
      .buscador-input input { font-size: 14px; }
      .buscador-lista {
        position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: #fff;
        border: 1px solid var(--border); border-radius: 9px; max-height: 240px; overflow-y: auto;
        box-shadow: 0 8px 20px rgba(38,40,44,0.12); z-index: 20;
      }
      .buscador-item {
        display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%;
        text-align: left; padding: 9px 12px; border: none; background: transparent; cursor: pointer;
        border-bottom: 1px solid #F0F2F3; font-family: 'Inter';
      }
      .buscador-item:last-child { border-bottom: none; }
      .buscador-item:hover { background: #F7FCFE; }
      .buscador-vacio { padding: 14px 12px; font-size: 12.5px; color: #8A8D90; text-align: center; }
      .buscador-chip {
        display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--border);
        border-radius: 9px; padding: 9px 11px; background: #F7FCFE;
      }

      .meses-calc { background: #F7FCFE; border: 1px dashed #BEE9FA; border-radius: 9px; padding: 10px 12px; }
      .meses-calc-label { font-size: 12.5px; color: #6C6F72; font-weight: 500; display: flex; flex-direction: column; gap: 6px; }
      .meses-calc-row { display: flex; gap: 8px; align-items: center; }
      .meses-calc-input { width: 60px; font-family: 'Inter'; font-size: 14px; padding: 9px 8px; border-radius: 8px; border: 1px solid var(--border); text-align: center; }
      .meses-calc-hint { margin-top: 8px; margin-bottom: 0; }

      .btn-primary, .btn-secondary, .btn-danger {
        border: none; border-radius: 9px; padding: 10px 16px; font-size: 13.5px; font-weight: 600;
        cursor: pointer; display: inline-flex; align-items: center; gap: 6px; justify-content: center;
      }
      .btn-primary { background: var(--blue); color: #fff; }
      .btn-primary:hover { background: var(--blue-dark); }
      .btn-primary:disabled { background: #CBD3D6; cursor: not-allowed; }
      .btn-primary.full { width: 100%; margin-top: 4px; }
      .btn-secondary { background: #F0F2F3; color: var(--charcoal); }
      .btn-secondary:hover { background: #E4E8EA; }
      .btn-danger { background: #C13F3B; color: #fff; }
      .btn-danger:hover { background: #A3312D; }

      .form-error { background: #FBEAE9; color: #C13F3B; font-size: 12.5px; padding: 9px 12px; border-radius: 8px; margin-bottom: 12px; }
      .checkbox-field { flex-direction: row !important; align-items: flex-start; gap: 9px !important; font-size: 13px !important; color: var(--ink) !important; font-weight: 400 !important; cursor: pointer; }
      .checkbox-field input[type="checkbox"] { width: 16px; height: 16px; margin-top: 2px; accent-color: var(--blue); flex-shrink: 0; }
      .checkbox-hint { color: #8A8D90; }
      .form { display: flex; flex-direction: column; gap: 12px; }
      .form-row { display: flex; gap: 12px; }
      .form-row > label { flex: 1; }
      .form label { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: #6C6F72; font-family: 'Inter'; font-weight: 500; }
      .form input, .form select {
        font-family: 'Inter'; font-size: 14px; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--border);
        color: var(--ink); background: #fff; outline: none;
      }
      .form input:focus, .form select:focus { border-color: var(--blue); box-shadow: 0 0 0 3px #E7F7FD; }

      .pago-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .pago-list li { padding-bottom: 10px; border-bottom: 1px solid #F0F2F3; }
      .pago-list li:last-child { border-bottom: none; padding-bottom: 0; }
      .pago-row { display: flex; justify-content: space-between; }
      .pago-monto { color: #158F63; font-weight: 600; }
      .gasto-sub { display: flex; justify-content: space-between; align-items: center; }

      .empty { text-align: center; padding: 32px 16px; color: #8A8D90; font-size: 13.5px; background: var(--card); border: 1px dashed var(--border); border-radius: 12px; }
      .empty.small { padding: 18px; }
      .empty.error { color: #C13F3B; border-color: #F3CFCD; background: #FBEAE9; }

      .modal-overlay {
        position: fixed; inset: 0; background: rgba(38,40,44,0.45); display: flex; align-items: center; justify-content: center;
        padding: 16px; z-index: 50;
      }
      .modal { background: #fff; border-radius: 14px; padding: 20px; width: 100%; max-width: 440px; max-height: 90vh; overflow-y: auto; }
      .modal.small { max-width: 380px; }
      .modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
      .modal h3 { margin: 0; font-size: 16px; color: var(--charcoal); }
      .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }

      .toast {
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        background: var(--charcoal); color: #fff; padding: 10px 18px; border-radius: 999px;
        font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,0.18); z-index: 60;
      }
      .toast-error { background: #C13F3B; }

      .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
      .login-card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 28px 26px; width: 100%; max-width: 360px; display: flex; flex-direction: column; align-items: center; text-align: center; }
      .login-card .form { width: 100%; text-align: left; margin-top: 4px; }
      .pantalla-centrada { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 30px; text-align: center; color: #6C6F72; font-size: 14px; max-width: 420px; margin: 0 auto; }

      @media (max-width: 640px) {
        .two-col { flex-direction: column; }
        .form-row { flex-direction: column; }
        .content { padding: 14px; }
      }
    `}</style>
  );
}
