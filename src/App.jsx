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
  FileDown,
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

// Un alumno tiene un solo "estado" visible (activo / prueba / becado /
// congelado / retirado), pero por debajo la base de datos sigue guiándose
// por las dos banderas de siempre (`activo` y `becado`), porque de ellas
// dependen `alumnos_para_asistencia()`, `alumnos_para_pagos()`, el cobro
// mensual y los filtros de la pantalla. Esta función es la ÚNICA que decide
// cómo se traduce el estado a esas dos banderas, para que nunca queden
// desincronizadas sin importar desde dónde se guarde un alumno.
//   - becado    -> becado: true,  activo: true   (no se le cobra, pero sigue activo)
//   - retirado  -> becado: false, activo: false  (fuera de listas y cobro)
//   - congelado -> becado: false, activo: false  (pausado: igual que retirado
//                  para asistencia/cobro, pero reversible y visible aparte)
//   - prueba / activo -> becado: false, activo: true
function flagsDeEstado(estado) {
  if (estado === "becado") return { becado: true, activo: true };
  if (estado === "retirado") return { becado: false, activo: false };
  if (estado === "congelado") return { becado: false, activo: false };
  return { becado: false, activo: true }; // "prueba" y "activo"
}

// Para alumnos guardados antes de que existiera la columna `estado` (o si
// por lo que sea todavía no corriste la migración en Supabase), calcula un
// estado de respaldo a partir de becado/activo — mismo criterio que usa el
// backfill del SQL — para que la pantalla nunca muestre un estado en blanco.
function estadoDeRespaldo(becado, activo) {
  if (becado) return "becado";
  if (activo) return "activo";
  return "retirado";
}

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
    estado: r.estado || estadoDeRespaldo(!!r.becado, r.activo),
    saldoPendiente: Number(r.saldo_pendiente) || 0,
    ultimoMesCobrado: r.ultimo_mes_cobrado,
    activo: r.activo,
    fechaAlta: r.fecha_alta,
  };
}
function alumnoToDb(a) {
  const estado = a.estado || estadoDeRespaldo(!!a.becado, a.activo !== false);
  const { becado, activo } = flagsDeEstado(estado);
  return {
    nombre: a.nombre,
    encargado: a.encargado,
    telefono: a.telefono,
    categoria: a.categoria,
    horario: a.horario,
    tarifa_mensual: Number(a.tarifaMensual) || 0,
    estado,
    becado,
    activo,
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
  return {
    id: r.id,
    alumnoId: r.alumno_id,
    fecha: r.fecha,
    presente: !!r.presente,
    nota: r.nota,
    motivoAusencia: r.motivo_ausencia,
    entrenadorId: r.entrenador_id,
  };
}

function historialTarifaFromDb(r) {
  return {
    id: r.id,
    alumnoId: r.alumno_id,
    tarifaAnterior: Number(r.tarifa_anterior) || 0,
    tarifaNueva: Number(r.tarifa_nueva) || 0,
    fecha: r.fecha,
  };
}

const ESTADOS_ALUMNO = [
  { value: "activo", label: "Activo" },
  { value: "prueba", label: "En prueba" },
  { value: "becado", label: "Becado" },
  { value: "congelado", label: "Congelado" },
  { value: "retirado", label: "Retirado" },
];

// Colores del badge de estado en la lista de alumnos. Reutiliza la misma
// paleta (color + fondo suave) que ya usan los badges de saldo y el de
// "Becado" junto al nombre, para que se vea consistente con el resto.
function estadoInfo(estado) {
  switch (estado) {
    case "prueba":
      return { label: "En prueba", color: "#0090C2", bg: "#E7F7FD" };
    case "becado":
      return { label: "Becado", color: "#B4790A", bg: "#FCF1DD" };
    case "congelado":
      return { label: "Congelado", color: "#C1673B", bg: "#FBEEE5" };
    case "retirado":
      return { label: "Retirado", color: "#8A8D90", bg: "#F0F2F3" };
    case "activo":
    default:
      return { label: "Activo", color: "#158F63", bg: "#E7F7F1" };
  }
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

// Motivos de ausencia: opciones fijas que pidió el dueño, en este orden
// exacto ("Otro" se agregó como comodín para casos que no encajen en las
// otras cuatro).
const MOTIVOS_AUSENCIA = ["No confirmó", "Enfermo", "Estudios", "Lesión", "Otro"];

// Etiqueta para agrupar en Asistencia a los alumnos sin categoría asignada
// (o con una categoría que ya no está en la lista de CATEGORIAS).
const CATEGORIA_SIN_ASIGNAR = "Sin categoría";
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

// Prepara un valor para una fila de CSV: si tiene comas, comillas o saltos
// de línea, lo envuelve en comillas (duplicando las comillas internas),
// que es la regla que entiende Excel al abrir un .csv.
function csvEscape(v) {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
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
          <LogoMark size={72} />
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
  const [toast, setToast] = useState(null);

  function showToast(msg, isError) {
    setToast({ msg, isError: !!isError });
    setTimeout(() => setToast(null), 2600);
  }

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

  async function marcarAsistencia(alumnoId, fecha, presente, motivoAusencia) {
    if (marcandoIds.has(alumnoId)) return;
    setMarcandoIds((prev) => new Set(prev).add(alumnoId));
    try {
      const { error } = await supabase.rpc("marcar_asistencia", {
        p_alumno_id: alumnoId,
        p_fecha: fecha,
        p_presente: presente,
        p_motivo_ausencia: presente ? null : motivoAusencia || null,
      });
      if (!error) {
        await cargar();
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

  // Quita una marca ya puesta (vuelve al estado "sin marcar"). Las
  // políticas de la base de datos ya limitan esto a las marcas propias
  // (ver "entrenador borra propias" en supabase-schema.sql).
  async function desmarcarAsistencia(alumnoId, fecha, asistenciaId) {
    if (marcandoIds.has(alumnoId)) return;
    setMarcandoIds((prev) => new Set(prev).add(alumnoId));
    try {
      const { error } = await supabase.from("asistencias").delete().eq("id", asistenciaId);
      if (!error) {
        await cargar();
      } else {
        showToast("No se pudo quitar la marca (revisa tu conexión). Inténtalo de nuevo.", true);
      }
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
            onDesmarcar={desmarcarAsistencia}
            marcandoIds={marcandoIds}
          />
        )}
      </main>
      {toast && (
        <div className={"toast" + (toast.isError ? " toast-error" : "")}>{toast.msg}</div>
      )}
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
  const [editarPagoModal, setEditarPagoModal] = useState(null); // pago que se está editando, o null
  const [busqueda, setBusqueda] = useState("");
  const [confirmCargo, setConfirmCargo] = useState(false);
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
        const alumnoAnterior = alumnos.find((a) => a.id === data.id);
        ({ error } = await supabase.from("alumnos").update(payload).eq("id", data.id));
        // Si la tarifa cambió, deja constancia en el historial (solo de
        // referencia — si esto fallara por algún motivo no se revierte el
        // guardado del alumno, que ya se hizo bien arriba).
        if (!error && alumnoAnterior && Number(alumnoAnterior.tarifaMensual || 0) !== Number(data.tarifaMensual || 0)) {
          await supabase.from("historial_tarifas").insert({
            alumno_id: data.id,
            tarifa_anterior: Number(alumnoAnterior.tarifaMensual || 0),
            tarifa_nueva: Number(data.tarifaMensual || 0),
          });
        }
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

  // Edita un pago ya registrado (monto, método, fecha o nota). editar_pago
  // ajusta el saldo del alumno por la DIFERENCIA entre el monto nuevo y el
  // anterior, no lo sobrescribe — otra operación "todo o nada" en la base
  // de datos, igual que registrar/anular pago.
  async function guardarEdicionPago(pago, datos) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.rpc("editar_pago", {
        p_pago_id: pago.id,
        p_monto: datos.monto,
        p_metodo: datos.metodo,
        p_fecha: datos.fecha,
        p_nota: datos.nota || null,
      });
      if (!error) {
        await cargarDatos({ silent: true });
        setEditarPagoModal(null);
        showToast("Pago actualizado. El saldo del alumno se ajustó por la diferencia.");
      } else {
        showToast("No se pudo guardar el cambio (revisa tu conexión). Inténtalo de nuevo.", true);
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

  // Exporta a un .csv (se abre directo en Excel) los pagos y gastos del
  // mes en curso más los totales, todo armado en el navegador — no hace
  // falta ninguna llamada al servidor ni librería nueva.
  function exportarResumenMes() {
    const mesKey = currentMonthKey;
    const pagosMes = pagos
      .filter((p) => monthKeyOf(p.fecha) === mesKey)
      .sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    const gastosMes = gastos
      .filter((g) => monthKeyOf(g.fecha) === mesKey)
      .sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    const totalCobrado = pagosMes.reduce((s, p) => s + Number(p.monto || 0), 0);
    const totalGastado = gastosMes.reduce((s, g) => s + Number(g.monto || 0), 0);

    const filas = [];
    filas.push([`Resumen de ${monthLabel(mesKey)}`]);
    filas.push([]);
    filas.push(["Pagos"]);
    filas.push(["Alumno", "Monto", "Método", "Fecha", "Nota"]);
    pagosMes.forEach((p) => {
      filas.push([alumnoNombre(p.alumnoId), Number(p.monto || 0).toFixed(2), p.metodo || "", p.fecha, p.nota || ""]);
    });
    filas.push([]);
    filas.push(["Gastos"]);
    filas.push(["Categoría", "Monto", "Fecha", "Nota"]);
    gastosMes.forEach((g) => {
      filas.push([g.categoria || "", Number(g.monto || 0).toFixed(2), g.fecha, g.nota || ""]);
    });
    filas.push([]);
    filas.push(["Totales"]);
    filas.push(["Total cobrado", totalCobrado.toFixed(2)]);
    filas.push(["Total gastado", totalGastado.toFixed(2)]);
    filas.push(["Margen", (totalCobrado - totalGastado).toFixed(2)]);

    const csv = filas.map((fila) => fila.map(csvEscape).join(",")).join("\r\n");
    // El "﻿" (BOM) al inicio es lo que hace que Excel reconozca los
    // acentos y la "ñ" correctamente al abrir el archivo directo.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `resumen-atletic-${mesKey}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Resumen exportado.");
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

  // Alumnos activos no becados a los que todavía no se les generó el
  // cobro del mes en curso — mismo criterio que "pendientesGenerar" en
  // Cobro mensual, pero fijo al mes de hoy (sin importar qué mes tenga
  // seleccionado ahí), para avisar en el Resumen.
  const pendientesMesActual = useMemo(
    () =>
      alumnosActivos
        .filter((a) => !a.becado && a.ultimoMesCobrado !== currentMonthKey)
        .sort((a, b) => Number(b.saldoPendiente || 0) - Number(a.saldoPendiente || 0)),
    [alumnosActivos, currentMonthKey]
  );

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
          { key: "margen", label: "Margen" },
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
                pendientesMesActual={pendientesMesActual}
                onExportarMes={exportarResumenMes}
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
                onEditar={(p) => setEditarPagoModal(p)}
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

            {tab === "margen" && (
              <MargenView alumnosActivos={alumnosActivos} totalGastosMes={totalGastosMes} monthLabelStr={monthLabel(currentMonthKey)} />
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

      {editarPagoModal && (
        <EditarPagoModal
          pago={editarPagoModal}
          alumnoNombre={alumnoNombre}
          onGuardar={guardarEdicionPago}
          onCancel={() => setEditarPagoModal(null)}
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
  pendientesMesActual,
  onExportarMes,
}) {
  const utilidadPositiva = utilidadMes >= 0;
  const hayAsistencia = chartAsistencia && chartAsistencia.length > 0;
  return (
    <div className="stack">
      <div className="toolbar" style={{ justifyContent: "flex-end" }}>
        <button className="btn-secondary" onClick={onExportarMes}>
          <FileDown size={15} /> Exportar resumen del mes
        </button>
      </div>

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
          <div className="table-scroll">
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
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Mensualidad pendiente de este mes</h2>
        {pendientesMesActual.length === 0 ? (
          <div className="empty small">
            Todos los alumnos activos (no becados) ya tienen el cobro de este mes generado.
          </div>
        ) : (
          <>
            <p className="muted" style={{ marginBottom: 10 }}>
              {pendientesMesActual.length} alumno(s) con la mensualidad de este mes sin generar
              todavía. Puedes generarla desde la pestaña "Cobro mensual".
            </p>
            <ul className="pago-list">
              {pendientesMesActual.slice(0, 10).map((a) => (
                <li key={a.id}>
                  <div className="pago-row">
                    <span className="cell-title">{a.nombre}</span>
                    <span className="num">{formatQ(a.saldoPendiente)}</span>
                  </div>
                </li>
              ))}
            </ul>
            {pendientesMesActual.length > 10 && (
              <p className="muted" style={{ marginTop: 8 }}>
                +{pendientesMesActual.length - 10} más.
              </p>
            )}
          </>
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
          <div className="table-scroll">
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
                      <span
                        className="badge"
                        style={{ color: estadoInfo(a.estado).color, background: estadoInfo(a.estado).bg }}
                      >
                        {estadoInfo(a.estado).label}
                      </span>
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

function PagoView({ alumnosActivos, pagoForm, setPagoForm, onSubmit, pagosRecientes, alumnoNombre, onAnular, onEditar, enviando }) {
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
                  <span className="actions">
                    {onEditar && (
                      <button className="icon-btn" onClick={() => onEditar(p)} aria-label="Editar pago" disabled={enviando}>
                        <Pencil size={13} />
                      </button>
                    )}
                    <button className="icon-btn danger" onClick={() => onAnular(p)} aria-label="Anular pago" disabled={enviando}>
                      <Trash2 size={13} />
                    </button>
                  </span>
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
          <div className="table-scroll">
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
          </div>
        )}
      </div>
    </div>
  );
}

// Junta a los alumnos activos por un campo (categoría u horario) y calcula
// cantidad, cuántos son becados (no se les cobra), ingreso mensual
// potencial (suma de tarifa de los NO becados) y tarifa promedio.
function agruparAlumnosPor(alumnosActivos, campo) {
  const mapa = new Map();
  alumnosActivos.forEach((a) => {
    const key = a[campo] || "Sin especificar";
    const actual = mapa.get(key) || { cantidad: 0, becados: 0, ingresoPotencial: 0, tarifaCount: 0 };
    actual.cantidad += 1;
    if (a.becado) {
      actual.becados += 1;
    } else {
      actual.ingresoPotencial += Number(a.tarifaMensual || 0);
      actual.tarifaCount += 1;
    }
    mapa.set(key, actual);
  });
  return [...mapa.entries()]
    .map(([key, v]) => ({
      key,
      cantidad: v.cantidad,
      becados: v.becados,
      ingresoPotencial: Number(v.ingresoPotencial.toFixed(2)),
      tarifaPromedio: v.tarifaCount > 0 ? Number((v.ingresoPotencial / v.tarifaCount).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.ingresoPotencial - a.ingresoPotencial);
}

function TablaMargen({ titulo, filas }) {
  return (
    <div className="panel">
      <h2>{titulo}</h2>
      {filas.length === 0 ? (
        <div className="empty small">No hay alumnos activos para agrupar.</div>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{titulo === "Por categoría" ? "Categoría" : "Horario"}</th>
                <th className="num">Alumnos</th>
                <th className="num">Becados</th>
                <th className="num">Tarifa promedio</th>
                <th className="num">Ingreso potencial</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.key}>
                  <td>{f.key}</td>
                  <td className="num">{f.cantidad}</td>
                  <td className="num">{f.becados || "—"}</td>
                  <td className="num">{formatQ(f.tarifaPromedio)}</td>
                  <td className="num">{formatQ(f.ingresoPotencial)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Reporte de margen por categoría y horario. El "ingreso potencial" es la
// suma de tarifas de alumnos activos no becados (lo que se cobraría en un
// mes si todos pagan su tarifa completa) — no es lo realmente cobrado, que
// ya se ve en el Resumen. Los gastos NO están divididos por categoría ni
// horario (esa información no existe todavía en "gastos"), así que se
// muestran como un total aparte y se dice explícitamente que no se reparten,
// en vez de inventar un reparto que no sería real.
function MargenView({ alumnosActivos, totalGastosMes, monthLabelStr }) {
  const porCategoria = useMemo(() => agruparAlumnosPor(alumnosActivos, "categoria"), [alumnosActivos]);
  const porHorario = useMemo(() => agruparAlumnosPor(alumnosActivos, "horario"), [alumnosActivos]);
  const ingresoPotencialTotal = useMemo(
    () => alumnosActivos.filter((a) => !a.becado).reduce((s, a) => s + Number(a.tarifaMensual || 0), 0),
    [alumnosActivos]
  );

  return (
    <div className="stack">
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#E7F7F1", color: "#158F63" }}>
            <ArrowUpRight size={18} />
          </div>
          <div>
            <div className="kpi-label">Ingreso potencial mensual</div>
            <div className="kpi-value">{formatQ(ingresoPotencialTotal)}</div>
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
      </div>

      <p className="muted">
        El ingreso potencial es la suma de tarifas de alumnos activos no becados agrupados abajo —
        lo que se cobraría en un mes completo, no necesariamente lo que ya se cobró. Los gastos no
        están divididos por categoría ni horario (esa información no se registra todavía al cargar
        un gasto), por eso se muestran como un total aparte y no repartidos.
      </p>

      <div className="stack two-col">
        <div className="panel">
          <h2>Ingreso potencial por categoría</h2>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={porCategoria.map((f) => ({ nombre: f.key, Ingreso: f.ingresoPotencial }))} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#F0F2F3" />
                <XAxis dataKey="nombre" tick={{ fontSize: 11, fill: "#8A8D90" }} axisLine={{ stroke: "#E4E8EA" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#8A8D90" }} axisLine={false} tickLine={false} width={54} tickFormatter={(v) => `Q${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
                <Tooltip content={<ChartTooltip formatter={(v) => formatQ(v)} />} cursor={{ fill: "#F4F6F7" }} />
                <Bar dataKey="Ingreso" fill="#0090C2" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel">
          <h2>Ingreso potencial por horario</h2>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={porHorario.map((f) => ({ nombre: f.key, Ingreso: f.ingresoPotencial }))} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#F0F2F3" />
                <XAxis dataKey="nombre" tick={{ fontSize: 10, fill: "#8A8D90" }} axisLine={{ stroke: "#E4E8EA" }} tickLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11, fill: "#8A8D90" }} axisLine={false} tickLine={false} width={54} tickFormatter={(v) => `Q${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
                <Tooltip content={<ChartTooltip formatter={(v) => formatQ(v)} />} cursor={{ fill: "#F4F6F7" }} />
                <Bar dataKey="Ingreso" fill="#00B6F1" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="stack two-col">
        <TablaMargen titulo="Por categoría" filas={porCategoria} />
        <TablaMargen titulo="Por horario" filas={porHorario} />
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
          <div className="table-scroll">
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
    estado: initial.estado || estadoDeRespaldo(!!initial.becado, initial.activo !== false),
  });
  const [error, setError] = useState(null);

  // Historial de cambios de tarifa: solo aplica si se está editando a un
  // alumno que ya existe (uno nuevo todavía no tiene historial). Es
  // secundario/de referencia, así que arranca cerrado y no bloquea nada
  // si la consulta falla o tarda.
  const [historial, setHistorial] = useState([]);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  useEffect(() => {
    if (!initial.id) return;
    let cancelado = false;
    setCargandoHistorial(true);
    supabase
      .from("historial_tarifas")
      .select("*")
      .eq("alumno_id", initial.id)
      .order("fecha", { ascending: false })
      .then(({ data }) => {
        if (cancelado) return;
        setHistorial((data || []).map(historialTarifaFromDb));
        setCargandoHistorial(false);
      });
    return () => {
      cancelado = true;
    };
  }, [initial.id]);

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
          <label>
            Estado
            <select
              value={form.estado}
              onChange={(e) => setForm({ ...form, estado: e.target.value })}
            >
              {ESTADOS_ALUMNO.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
          </label>
          {form.estado === "becado" && (
            <p className="muted">
              Becado: no se le sumará ningún cobro mientras esté en este estado, aunque tenga
              tarifa registrada.
            </p>
          )}
          {form.estado === "prueba" && (
            <p className="muted">En prueba: cuenta como activo (asistencia y cobro normal).</p>
          )}
          {form.estado === "congelado" && (
            <p className="muted">
              Congelado: no aparece en asistencia ni en el cobro mensual (igual que retirado),
              pero puedes reactivarlo cuando quieras cambiando el estado de vuelta.
            </p>
          )}
          {form.estado === "retirado" && (
            <p className="muted">Retirado: no aparece en asistencia ni en el cobro mensual.</p>
          )}

          {form.id && (
            <div className="historial-tarifa">
              <button
                type="button"
                className="historial-tarifa-toggle"
                onClick={() => setHistorialAbierto((v) => !v)}
              >
                Historial de tarifa{historial.length > 0 ? ` (${historial.length})` : ""}
                <span className="historial-tarifa-caret">{historialAbierto ? "▲" : "▼"}</span>
              </button>
              {historialAbierto && (
                <div className="historial-tarifa-body">
                  {cargandoHistorial ? (
                    <p className="muted">Cargando…</p>
                  ) : historial.length === 0 ? (
                    <p className="muted">Todavía no hay cambios de tarifa registrados para este alumno.</p>
                  ) : (
                    <ul className="historial-tarifa-lista">
                      {historial.map((h) => (
                        <li key={h.id}>
                          {h.fecha} — {formatQ(h.tarifaAnterior)} → {formatQ(h.tarifaNueva)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

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

// Edita monto/método/fecha/nota de un pago ya registrado (nunca a qué
// alumno pertenece — reasignarlo a otro alumno queda fuera de esto, para
// mantenerlo simple). El saldo del alumno se ajusta solo por la diferencia
// entre el monto viejo y el nuevo (ver editar_pago en supabase-schema.sql),
// nunca sobrescribiéndolo, así que esto es seguro aunque el saldo ya haya
// cambiado por otro pago mientras tanto.
function EditarPagoModal({ pago, alumnoNombre, onGuardar, onCancel, enviando }) {
  const [monto, setMonto] = useState(String(pago.monto ?? ""));
  const [metodo, setMetodo] = useState(pago.metodo || METODOS_PAGO[0]);
  const [fecha, setFecha] = useState(pago.fecha);
  const [nota, setNota] = useState(pago.nota || "");
  const [error, setError] = useState(null);

  const montoNum = parseMonto(monto);
  const diferencia = isNaN(montoNum) ? null : Number((montoNum - Number(pago.monto || 0)).toFixed(2));

  function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (isNaN(montoNum) || montoNum <= 0) {
      setError("Ingresa un monto válido.");
      return;
    }
    if (!fecha) {
      setError("Elige una fecha.");
      return;
    }
    setError(null);
    onGuardar(pago, { monto: montoNum, metodo, fecha, nota: nota.trim() });
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Editar pago de {alumnoNombre(pago.alumnoId)}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>
          El saldo del alumno se ajustará solo por la diferencia entre el monto anterior y el
          nuevo, no se sobrescribe.
        </p>
        {error && <div className="form-error">{error}</div>}
        <div
          className="form"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit(e);
          }}
        >
          <div className="form-row">
            <label>
              Monto
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                autoFocus
              />
            </label>
            <label>
              Fecha
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </label>
          </div>
          {diferencia !== null && diferencia !== 0 && (
            <p className="muted" style={{ marginTop: -4 }}>
              Esto {diferencia > 0 ? "reduce" : "aumenta"} el saldo pendiente del alumno en{" "}
              {formatQ(Math.abs(diferencia))}.
            </p>
          )}
          <label>
            Método de pago
            <select value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              {METODOS_PAGO.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nota (opcional)
            <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={enviando}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" onClick={handleSubmit} disabled={enviando}>
              {enviando ? "Guardando…" : "Guardar cambios"}
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

function LogoMark({ size = 34 }) {
  return (
    <img
      src="/logo.png"
      alt="Atletic Guatemala"
      className="logo-mark"
      style={{ height: size, width: "auto" }}
      draggable={false}
    />
  );
}

function Styles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Jost:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');

      /*
        Tipografía: la guía de marca pide Futura (Book/Medium/LT Bold) en
        todos los materiales. Futura es una fuente comercial que no está
        disponible en Google Fonts ni en ningún CDN gratuito, así que no
        se puede cargar el archivo real desde aquí. Este stack es la
        solución honesta y pragmática:
          - 'Futura' / 'Futura PT' primero: si la persona que abre la app
            ya la tiene instalada (común en Mac, o con Adobe Fonts activo),
            ve la tipografía real de la marca sin que tengamos que hacer nada.
          - 'Jost' de respaldo: geométrica y de la misma familia visual que
            Futura/Kabel — es la que ya se cargaba antes desde Google Fonts.
          - 'Century Gothic' de respaldo: viene preinstalada en Windows/Office,
            es la más parecida a Futura que casi cualquier persona sin Mac
            va a tener realmente disponible.
          - sans-serif genérica al final, por si ninguna de las anteriores existe.
        Esta pila de "voz de marca" se usa en encabezados, el nombre/logo,
        las pestañas de navegación y los botones. El cuerpo de datos (tablas
        con números, formularios) se queda en Inter — ver nota más abajo.
      */
      .app-root {
        --blue: #00B6F1;
        --blue-dark: #0090C2;
        --charcoal: #404041;
        --ink: #26282C;
        --bg: #F4F6F7;
        --card: #FFFFFF;
        --border: #E4E8EA;
        --border-soft: #EEF1F2;
        --radius-sm: 7px;
        --radius-md: 10px;
        --radius-lg: 14px;
        --radius-pill: 999px;
        --shadow-card: 0 1px 2px rgba(38,40,44,0.04);
        --shadow-raised: 0 6px 16px rgba(38,40,44,0.08);
        --shadow-modal: 0 20px 48px rgba(24,26,29,0.22);
        --font-brand: 'Futura', 'Futura PT', 'Jost', 'Century Gothic', 'Inter', sans-serif;
        --font-body: 'Inter', system-ui, sans-serif;
        font-family: var(--font-body);
        font-size: 14.5px;
        color: var(--ink);
        background: linear-gradient(180deg, #EAF7FD 0%, var(--bg) 320px);
        min-height: 100%;
        border-radius: 12px;
        overflow: hidden;
        -webkit-font-smoothing: antialiased;
      }
      .logo-mark { display: block; object-fit: contain; }
      .app-root h1, .app-root h2, .app-root h3,
      .app-root .brand-name, .app-root .tab, .app-root button {
        font-family: var(--font-brand);
      }
      /* El cuerpo con datos densos (celdas de tabla, inputs, listas) se
         queda en Inter a propósito: las geométricas como Futura/Century
         Gothic son menos legibles en números pequeños, y esto es una
         herramienta financiera donde confundir una cifra sí importa. */
      .app-root table, .app-root input, .app-root select, .app-root textarea {
        font-family: var(--font-body);
      }

      .topbar {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 20px; background: var(--card); border-bottom: 1px solid var(--border);
      }
      .brand { display: flex; align-items: center; gap: 10px; }
      .brand-name { font-weight: 600; font-size: 17px; color: var(--charcoal); line-height: 1.15; letter-spacing: 0.1px; }
      .brand-sub { font-size: 12px; color: #8A8D90; font-family: var(--font-body); margin-top: 2px; }
      .sync-pill { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #8A8D90; }
      .sync-pill.ok { color: #158F63; }
      .topbar-right { display: flex; align-items: center; gap: 10px; }
      .reload-btn {
        display: flex; align-items: center; gap: 6px; font-size: 12px; color: #6C6F72;
        background: #F0F2F3; border: none; padding: 7px 12px; border-radius: var(--radius-pill); cursor: pointer;
        font-family: var(--font-body); transition: background 0.15s ease;
      }
      .reload-btn:hover { background: #E4E8EA; }
      .reload-btn:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
      .reload-btn:disabled { opacity: 0.6; cursor: default; }
      .spin { animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }

      .tabs {
        display: flex; gap: 2px; padding: 8px 16px 0; background: var(--card);
        overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; scrollbar-width: thin;
      }
      .tab {
        border: none; background: transparent; padding: 11px 16px; font-size: 13.5px; font-weight: 500;
        color: #8A8D90; cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap;
        border-radius: var(--radius-sm) var(--radius-sm) 0 0; transition: color 0.15s ease, background 0.15s ease;
        flex-shrink: 0;
      }
      .tab:hover { color: var(--charcoal); background: #F7F8F9; }
      .tab:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
      .tab.active { color: var(--blue-dark); border-bottom-color: var(--blue); font-weight: 600; }

      .content { padding: 22px; background: linear-gradient(180deg, #E1F4FC 0%, var(--bg) 380px); }
      .stack { display: flex; flex-direction: column; gap: 18px; }
      .two-col { flex-direction: row; align-items: flex-start; flex-wrap: wrap; }
      .two-col > .panel { flex: 1 1 320px; }

      .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
      .kpi-card {
        background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md);
        padding: 16px; display: flex; align-items: center; gap: 12px; box-shadow: var(--shadow-card);
        transition: box-shadow 0.15s ease, border-color 0.15s ease;
      }
      .kpi-icon { width: 38px; height: 38px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .kpi-label { font-size: 12px; color: #8A8D90; margin-bottom: 3px; }
      .kpi-value { font-size: 19px; font-weight: 700; color: var(--charcoal); font-family: var(--font-brand); letter-spacing: 0.1px; }

      .panel { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 18px 20px; box-shadow: var(--shadow-card); }
      .panel.highlight { border-color: #BEE9FA; background: #F7FCFE; }
      .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
      .panel h2 { font-size: 15px; font-weight: 600; color: var(--charcoal); margin: 0 0 12px; }
      .panel-head h2 { margin: 0; }
      .link-btn { background: none; border: none; color: var(--blue-dark); font-size: 13px; cursor: pointer; font-weight: 500; padding: 4px 2px; border-radius: 4px; }
      .link-btn:hover { text-decoration: underline; }
      .link-btn:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
      .muted { color: #8A8D90; font-size: 13px; line-height: 1.55; margin: 4px 0 0; }

      .cobro-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .cobro-preview { margin-top: 12px; font-size: 13px; color: var(--blue-dark); background: #E7F7FD; padding: 8px 12px; border-radius: var(--radius-sm); display: inline-block; }
      .cobro-mes-selector { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; font-size: 12px; color: #8A8D90; max-width: 320px; }
      .cobro-mes-selector select { font-size: 14px; color: var(--ink); padding: 9px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: #fff; width: 100%; }

      /* Envoltorio para que las tablas puedan desplazarse horizontalmente
         dentro de sí mismas en pantallas angostas, en vez de forzar scroll
         en toda la página. El degradado del borde derecho es la pista
         visual de que hay más columnas a la derecha; se oculta solo con
         JS de scroll nativo (data-at-end), así que aquí se deja siempre
         visible de forma sutil — es una pista, no un elemento crítico. */
      .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; border-radius: var(--radius-sm); position: relative; }
      .table-scroll::-webkit-scrollbar { height: 7px; }
      .table-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 999px; }
      .table-scroll::-webkit-scrollbar-track { background: transparent; }

      .table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .table th { text-align: left; font-weight: 500; color: #8A8D90; padding: 9px 10px; border-bottom: 1px solid var(--border); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; }
      .table td { padding: 11px 10px; border-bottom: 1px solid var(--border-soft); vertical-align: middle; }
      .table tr:last-child td { border-bottom: none; }
      .table tbody tr { transition: background 0.12s ease; }
      .table tbody tr:hover { background: #FAFBFC; }
      .table .num { text-align: right; }
      .table .debt { color: #C13F3B; font-weight: 600; }
      .table .th-check { width: 34px; padding-right: 0; }
      .table .th-check input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }
      .row-inactive { opacity: 0.5; }
      .cell-title { font-weight: 500; color: var(--charcoal); }
      .badge-becado { display: inline-block; margin-left: 7px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.2px; color: #B4790A; background: #FCF1DD; padding: 1.5px 7px; border-radius: var(--radius-pill); vertical-align: middle; }
      .cell-sub { font-size: 12px; color: #8A8D90; margin-top: 1px; }

      .badge { padding: 3px 10px; border-radius: var(--radius-pill); font-weight: 600; font-size: 12.5px; white-space: nowrap; }
      .pill-toggle {
        border: 1px solid var(--border); background: #F7F7F8; color: #8A8D90; font-size: 12px; padding: 6px 12px;
        border-radius: var(--radius-pill); cursor: pointer; min-height: 30px; transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
      }
      .pill-toggle:hover { border-color: #CBD3D6; }
      .pill-toggle:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
      .pill-toggle.on { background: #E7F7F1; color: #158F63; border-color: #CBEEDF; }
      .pill-ausente.on { background: #FBEAE9; color: #C13F3B; border-color: #F3CFCD; }
      .kpi-clickable { cursor: pointer; }
      .kpi-clickable:hover { border-color: #BEE9FA; box-shadow: var(--shadow-raised); }
      .asistencia-fecha { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #6C6F72; font-weight: 500; }
      .asistencia-fecha input { font-family: var(--font-body); font-size: 13.5px; padding: 8px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); }
      .asistencia-botones { display: flex; gap: 6px; justify-content: flex-end; }

      .actions { display: flex; gap: 2px; }
      .icon-btn {
        border: none; background: transparent; color: #8A8D90; cursor: pointer; padding: 7px; border-radius: var(--radius-sm);
        display: flex; align-items: center; justify-content: center; min-width: 30px; min-height: 30px; transition: background 0.15s ease, color 0.15s ease;
      }
      .icon-btn:hover { background: #F0F2F3; color: var(--charcoal); }
      .icon-btn:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }
      .icon-btn.danger:hover { background: #FBEAE9; color: #C13F3B; }

      .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: space-between; }
      .toolbar-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .search-box { display: flex; align-items: center; gap: 8px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 9px 12px; flex: 1 1 260px; color: #8A8D90; transition: border-color 0.15s ease; }
      .search-box:focus-within { border-color: var(--blue); box-shadow: 0 0 0 3px #E7F7FD; }
      .search-box input { border: none; outline: none; flex: 1; font-size: 13.5px; font-family: var(--font-body); background: transparent; min-width: 0; }

      .buscador-wrap { position: relative; }
      .buscador-input { border: 1px solid var(--border); }
      .buscador-input input { font-size: 14px; }
      .buscador-lista {
        position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: #fff;
        border: 1px solid var(--border); border-radius: var(--radius-sm); max-height: 240px; overflow-y: auto;
        box-shadow: var(--shadow-raised); z-index: 20;
      }
      .buscador-item {
        display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%;
        text-align: left; padding: 10px 12px; border: none; background: transparent; cursor: pointer;
        border-bottom: 1px solid var(--border-soft); font-family: var(--font-body); min-height: 44px;
      }
      .buscador-item:last-child { border-bottom: none; }
      .buscador-item:hover { background: #F7FCFE; }
      .buscador-vacio { padding: 14px 12px; font-size: 12.5px; color: #8A8D90; text-align: center; }
      .buscador-chip {
        display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--border);
        border-radius: var(--radius-sm); padding: 10px 12px; background: #F7FCFE; gap: 10px;
      }

      .meses-calc { background: #F7FCFE; border: 1px dashed #BEE9FA; border-radius: var(--radius-sm); padding: 12px; }
      .meses-calc-label { font-size: 12.5px; color: #6C6F72; font-weight: 500; display: flex; flex-direction: column; gap: 6px; }
      .meses-calc-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .meses-calc-input { width: 60px; font-family: var(--font-body); font-size: 14px; padding: 9px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border); text-align: center; }
      .meses-calc-hint { margin-top: 8px; margin-bottom: 0; }

      .btn-primary, .btn-secondary, .btn-danger {
        border: none; border-radius: var(--radius-sm); padding: 10px 16px; font-size: 13.5px; font-weight: 600;
        cursor: pointer; display: inline-flex; align-items: center; gap: 6px; justify-content: center;
        min-height: 40px; transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.05s ease;
      }
      .btn-primary { background: var(--blue); color: #fff; }
      .btn-primary:hover { background: var(--blue-dark); }
      .btn-primary:active { transform: translateY(1px); }
      .btn-primary:focus-visible, .btn-secondary:focus-visible, .btn-danger:focus-visible { outline: 2px solid var(--blue-dark); outline-offset: 2px; }
      .btn-primary:disabled { background: #CBD3D6; cursor: not-allowed; }
      .btn-primary.full { width: 100%; margin-top: 4px; }
      .btn-secondary { background: #F0F2F3; color: var(--charcoal); }
      .btn-secondary:hover { background: #E4E8EA; }
      .btn-danger { background: #C13F3B; color: #fff; }
      .btn-danger:hover { background: #A3312D; }

      .form-error { background: #FBEAE9; color: #C13F3B; font-size: 12.5px; padding: 10px 12px; border-radius: var(--radius-sm); margin-bottom: 12px; line-height: 1.5; }
      .checkbox-field { flex-direction: row !important; align-items: flex-start; gap: 9px !important; font-size: 13px !important; color: var(--ink) !important; font-weight: 400 !important; cursor: pointer; }
      .checkbox-field input[type="checkbox"] { width: 17px; height: 17px; margin-top: 2px; accent-color: var(--blue); flex-shrink: 0; }
      .checkbox-hint { color: #8A8D90; }
      .historial-tarifa { border-top: 1px solid var(--border-soft); padding-top: 12px; }
      .historial-tarifa-toggle {
        display: flex; align-items: center; justify-content: space-between; width: 100%;
        background: none; border: none; padding: 4px 0; font-size: 12.5px; font-weight: 500;
        color: #6C6F72; cursor: pointer; font-family: var(--font-body); min-height: 36px;
      }
      .historial-tarifa-caret { font-size: 9px; color: #8A8D90; }
      .historial-tarifa-body { margin-top: 8px; }
      .historial-tarifa-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #6C6F72; }
      .form { display: flex; flex-direction: column; gap: 14px; }
      .form-row { display: flex; gap: 12px; }
      .form-row > label { flex: 1; min-width: 0; }
      .form label { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: #6C6F72; font-family: var(--font-body); font-weight: 500; }
      .form input, .form select {
        font-family: var(--font-body); font-size: 15px; padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border);
        color: var(--ink); background: #fff; outline: none; transition: border-color 0.15s ease, box-shadow 0.15s ease; min-height: 42px; width: 100%;
      }
      .form input:focus, .form select:focus { border-color: var(--blue); box-shadow: 0 0 0 3px #E7F7FD; }

      .pago-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .pago-list li { padding-bottom: 10px; border-bottom: 1px solid var(--border-soft); }
      .pago-list li:last-child { border-bottom: none; padding-bottom: 0; }
      .pago-row { display: flex; justify-content: space-between; gap: 10px; }
      .pago-monto { color: #158F63; font-weight: 600; }
      .gasto-sub { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }

      .empty { text-align: center; padding: 36px 18px; color: #8A8D90; font-size: 13.5px; background: var(--card); border: 1px dashed var(--border); border-radius: var(--radius-md); }
      .empty.small { padding: 20px; }
      .empty.error { color: #C13F3B; border-color: #F3CFCD; background: #FBEAE9; }

      .modal-overlay {
        position: fixed; inset: 0; background: rgba(30,32,35,0.5); display: flex; align-items: center; justify-content: center;
        padding: 16px; z-index: 50;
      }
      .modal { background: #fff; border-radius: var(--radius-lg); padding: 22px; width: 100%; max-width: 440px; max-height: 90vh; overflow-y: auto; box-shadow: var(--shadow-modal); }
      .modal.small { max-width: 380px; }
      .modal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 16px; }
      .modal h3 { margin: 0; font-size: 16.5px; color: var(--charcoal); }
      .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }

      .toast {
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        background: var(--charcoal); color: #fff; padding: 11px 20px; border-radius: var(--radius-pill);
        font-size: 13px; box-shadow: 0 10px 28px rgba(0,0,0,0.22); z-index: 60; max-width: calc(100vw - 32px); text-align: center;
      }
      .toast-error { background: #C13F3B; }

      .login-wrap {
        min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;
        background: linear-gradient(160deg, #EAF7FD 0%, var(--bg) 55%, #F4F6F7 100%);
      }
      .login-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 30px 26px; width: 100%; max-width: 360px; display: flex; flex-direction: column; align-items: center; text-align: center; box-shadow: var(--shadow-raised); }
      .login-card .form { width: 100%; text-align: left; margin-top: 4px; }
      .pantalla-centrada { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 30px; text-align: center; color: #6C6F72; font-size: 14px; max-width: 420px; margin: 0 auto; }

      /* ---------- Responsivo: tablet-ish (≤640px) ---------- */
      @media (max-width: 640px) {
        .two-col { flex-direction: column; }
        .two-col > .panel { flex-basis: auto; }
        .form-row { flex-direction: column; }
        .content { padding: 14px; }
        .kpi-grid { grid-template-columns: repeat(2, 1fr); }
        .modal { padding: 18px; border-radius: var(--radius-md); }
      }

      /* ---------- Responsivo: teléfono angosto (≤480px), hasta ~360px ---------- */
      @media (max-width: 480px) {
        .app-root { border-radius: 0; font-size: 14px; }
        .topbar { padding: 12px 14px; flex-wrap: wrap; gap: 8px; }
        .brand-name { font-size: 15.5px; }
        .topbar-right { gap: 6px; flex-wrap: wrap; }
        .reload-btn { padding: 7px 10px; font-size: 11.5px; }
        .tabs { padding: 6px 10px 0; gap: 0; }
        .tab { padding: 10px 12px; font-size: 13px; min-height: 44px; }
        .content { padding: 12px; }
        .stack { gap: 14px; }
        .kpi-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
        .kpi-card { padding: 12px; gap: 10px; }
        .kpi-icon { width: 32px; height: 32px; }
        .kpi-value { font-size: 16.5px; }
        .kpi-label { font-size: 11px; }
        .panel { padding: 14px; }
        .toolbar { flex-direction: column; align-items: stretch; }
        .toolbar-actions { justify-content: stretch; }
        .toolbar-actions .btn-primary, .toolbar-actions .btn-secondary, .toolbar-actions .btn-danger { flex: 1 1 auto; }
        .search-box { flex-basis: auto; }
        .modal-overlay { padding: 0; align-items: flex-end; }
        .modal {
          max-width: 100%; width: 100%; border-radius: var(--radius-lg) var(--radius-lg) 0 0;
          max-height: 92vh; padding: 18px 16px calc(16px + env(safe-area-inset-bottom, 0px));
        }
        .modal.small { max-width: 100%; }
        .modal-actions { flex-direction: column-reverse; gap: 8px; }
        .modal-actions .btn-primary, .modal-actions .btn-secondary, .modal-actions .btn-danger { width: 100%; }
        .btn-primary, .btn-secondary, .btn-danger { min-height: 44px; }
        .icon-btn { min-width: 36px; min-height: 36px; }
        .pill-toggle { padding: 7px 12px; min-height: 34px; }
        .asistencia-botones { justify-content: stretch; }
        .asistencia-botones .pill-toggle { flex: 1 1 0; text-align: center; }
        .login-card { padding: 24px 18px; }
        .cobro-head { flex-direction: column; align-items: stretch; }
        .cobro-head .btn-primary { width: 100%; }
      }
    `}</style>
  );
}
