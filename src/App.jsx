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
  User,
  Camera,
  Calendar,
  Copy,
  MessageCircle,
  ChevronDown,
  ChevronRight,
  Menu,
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
    fechaNacimiento: r.fecha_nacimiento,
    colegio: r.colegio,
    contactoEmergenciaNombre: r.contacto_emergencia_nombre,
    contactoEmergenciaTelefono: r.contacto_emergencia_telefono,
    posicion: r.posicion,
    posicionSecundaria: r.posicion_secundaria,
    piernaDominante: r.pierna_dominante,
    fotoUrl: r.foto_url,
    numeroUniforme: r.numero_uniforme,
    tallaUniforme: r.talla_uniforme,
    uniformeEntregado: !!r.uniforme_entregado,
    soloCampeonato: !!r.solo_campeonato,
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
    tarifa_mensual: a.soloCampeonato ? 0 : Number(a.tarifaMensual) || 0,
    estado,
    becado,
    activo,
    fecha_nacimiento: a.fechaNacimiento || null,
    colegio: a.colegio || null,
    contacto_emergencia_nombre: a.contactoEmergenciaNombre || null,
    contacto_emergencia_telefono: a.contactoEmergenciaTelefono || null,
    posicion: a.posicion || null,
    posicion_secundaria: a.posicionSecundaria || null,
    pierna_dominante: a.piernaDominante || null,
    foto_url: a.fotoUrl || null,
    numero_uniforme: a.numeroUniforme === "" || a.numeroUniforme === undefined ? null : Number(a.numeroUniforme),
    talla_uniforme: a.tallaUniforme || null,
    uniforme_entregado: !!a.uniformeEntregado,
    solo_campeonato: !!a.soloCampeonato,
  };
}

// Staff (tabla "perfiles"): quién tiene acceso a la app, con qué rol, y
// -si es entrenador- de qué categorías está a cargo.
function perfilStaffFromDb(r) {
  return {
    id: r.id,
    nombre: r.nombre,
    rol: r.rol,
    telefono: r.telefono,
    correo: r.correo,
    activo: r.activo !== false,
    categorias: r.categorias || [],
  };
}
function perfilStaffToDb(p) {
  return {
    nombre: p.nombre,
    rol: p.rol,
    telefono: p.telefono || null,
    correo: p.correo || null,
    activo: p.activo !== false,
    categorias: p.rol === "entrenador" && p.categorias && p.categorias.length ? p.categorias : null,
  };
}

// Calcula la edad en años a partir de una fecha de nacimiento (YYYY-MM-DD).
// Devuelve null si no hay fecha (el alumno todavía no la tiene registrada),
// para que la pantalla sepa que no hay nada que mostrar en vez de un "0".
function calcularEdad(fechaNacimientoISO) {
  if (!fechaNacimientoISO) return null;
  const nacimiento = new Date(fechaNacimientoISO + "T00:00:00");
  if (isNaN(nacimiento.getTime())) return null;
  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const aunNoCumple =
    hoy.getMonth() < nacimiento.getMonth() ||
    (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() < nacimiento.getDate());
  if (aunNoCumple) edad -= 1;
  return edad;
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

// Lead del formulario público de inscripción (CRM). Igual que los demás
// mappers, solo traduce nombres de columna — no hay lógica de negocio acá.
function leadFromDb(r) {
  return {
    id: r.id,
    nombreAlumno: r.nombre_alumno,
    fechaNacimiento: r.fecha_nacimiento,
    fotoUrl: r.foto_url,
    feEdadUrl: r.fe_edad_url,
    genero: r.genero,
    posicion: r.posicion,
    programas: r.programas || [],
    tallaUniforme: r.talla_uniforme,
    nombrePadre: r.nombre_padre,
    fechaNacimientoPadre: r.fecha_nacimiento_padre,
    telefonoPadre: r.telefono_padre,
    correoPadre: r.correo_padre,
    nombreMadre: r.nombre_madre,
    fechaNacimientoMadre: r.fecha_nacimiento_madre,
    telefonoMadre: r.telefono_madre,
    correoMadre: r.correo_madre,
    alergias: r.alergias,
    condicionesMedicas: r.condiciones_medicas,
    medicamentos: r.medicamentos,
    tieneSeguro: r.tiene_seguro,
    seguroInfo: r.seguro_info,
    interesadoSeguro: r.interesado_seguro,
    aceptoTerminos: !!r.acepto_terminos,
    comentarios: r.comentarios,
    estado: r.estado || "nuevo",
    fechaPrueba: r.fecha_prueba,
    notasInternas: r.notas_internas,
    fuente: r.fuente,
    alumnoId: r.alumno_id,
    createdAt: r.created_at,
  };
}

function leadToDb(l) {
  return {
    nombre_alumno: l.nombreAlumno,
    fecha_nacimiento: l.fechaNacimiento || null,
    genero: l.genero || null,
    posicion: l.posicion || null,
    programas: l.programas && l.programas.length ? l.programas : null,
    talla_uniforme: l.tallaUniforme || null,
    nombre_padre: l.nombrePadre || null,
    fecha_nacimiento_padre: l.fechaNacimientoPadre || null,
    telefono_padre: l.telefonoPadre || null,
    correo_padre: l.correoPadre || null,
    nombre_madre: l.nombreMadre || null,
    fecha_nacimiento_madre: l.fechaNacimientoMadre || null,
    telefono_madre: l.telefonoMadre || null,
    correo_madre: l.correoMadre || null,
    alergias: l.alergias || null,
    condiciones_medicas: l.condicionesMedicas || null,
    medicamentos: l.medicamentos || null,
    tiene_seguro: l.tieneSeguro === undefined ? null : l.tieneSeguro,
    seguro_info: l.seguroInfo || null,
    interesado_seguro: l.interesadoSeguro === undefined ? null : l.interesadoSeguro,
    acepto_terminos: !!l.aceptoTerminos,
    comentarios: l.comentarios || null,
    estado: l.estado || "nuevo",
    fecha_prueba: l.fechaPrueba || null,
    notas_internas: l.notasInternas || null,
    fuente: l.fuente || "sitio web",
  };
}

// Calendario operativo: entrenamientos, partidos, torneos, clínicas,
// viajes, reuniones, actividades, suspensiones y eventos especiales.
// "rival", "horaConvocatoria", "uniforme", "indicaciones" y
// "alumnosConvocados" solo se usan de verdad cuando tipo === "partido"
// (la convocatoria), pero se guardan igual en cualquier evento por si
// hace falta más adelante.
function eventoFromDb(r) {
  return {
    id: r.id,
    titulo: r.titulo,
    tipo: r.tipo,
    fecha: r.fecha,
    hora: r.hora,
    categorias: r.categorias || [],
    horario: r.horario,
    lugar: r.lugar,
    rival: r.rival,
    horaConvocatoria: r.hora_convocatoria,
    uniforme: r.uniforme,
    indicaciones: r.indicaciones,
    notas: r.notas,
    alumnosConvocados: r.alumnos_convocados || [],
    serieId: r.serie_id,
    createdAt: r.created_at,
  };
}

function eventoToDb(e) {
  return {
    titulo: e.titulo,
    tipo: e.tipo,
    fecha: e.fecha || null,
    hora: e.hora || null,
    categorias: e.categorias && e.categorias.length ? e.categorias : null,
    horario: e.horario || null,
    lugar: e.lugar || null,
    rival: e.rival || null,
    hora_convocatoria: e.horaConvocatoria || null,
    uniforme: e.uniforme || null,
    indicaciones: e.indicaciones || null,
    notas: e.notas || null,
    alumnos_convocados: e.alumnosConvocados && e.alumnosConvocados.length ? e.alumnosConvocados : null,
    serie_id: e.serieId || null,
  };
}

// Área deportiva: biblioteca de ejercicios y sesiones de entrenamiento.
function ejercicioFromDb(r) {
  return {
    id: r.id,
    nombre: r.nombre,
    objetivo: r.objetivo,
    descripcion: r.descripcion,
    duracionMin: r.duracion_min,
    categorias: r.categorias || [],
    creadoPor: r.creado_por,
  };
}
function ejercicioToDb(e) {
  return {
    nombre: e.nombre,
    objetivo: e.objetivo || "tecnica",
    descripcion: e.descripcion || null,
    duracion_min: e.duracionMin === "" || e.duracionMin == null ? null : Number(e.duracionMin),
    categorias: e.categorias && e.categorias.length ? e.categorias : null,
  };
}

function sesionFromDb(r) {
  return {
    id: r.id,
    fecha: r.fecha,
    categoria: r.categoria,
    titulo: r.titulo,
    objetivoGeneral: r.objetivo_general,
    eventoId: r.evento_id,
    entrenadorId: r.entrenador_id,
  };
}
function sesionToDb(s) {
  return {
    fecha: s.fecha,
    categoria: s.categoria,
    titulo: s.titulo,
    objetivo_general: s.objetivoGeneral || null,
    evento_id: s.eventoId || null,
  };
}

function sesionEjercicioFromDb(r) {
  return {
    id: r.id,
    sesionId: r.sesion_id,
    ejercicioId: r.ejercicio_id,
    nombre: r.nombre,
    duracionMin: r.duracion_min,
    notas: r.notas,
    orden: r.orden,
  };
}

// Junta cada sesión con su lista de ejercicios (llegan por separado, de la
// tabla sesion_ejercicios, ya que es una relación uno-a-muchos).
function juntarSesionesConEjercicios(filasSesiones, filasSesionEjercicios) {
  const porSesion = {};
  filasSesionEjercicios.map(sesionEjercicioFromDb).forEach((se) => {
    if (!porSesion[se.sesionId]) porSesion[se.sesionId] = [];
    porSesion[se.sesionId].push(se);
  });
  return filasSesiones.map(sesionFromDb).map((s) => ({
    ...s,
    ejercicios: (porSesion[s.id] || []).sort((a, b) => a.orden - b.orden),
  }));
}

// ---------- Equipos y competencias: resultados de partidos ----------
function resultadoPartidoFromDb(r) {
  return {
    id: r.id,
    eventoId: r.evento_id,
    golesFavor: r.goles_favor,
    golesContra: r.goles_contra,
    observaciones: r.observaciones,
    entrenadorId: r.entrenador_id,
  };
}
function resultadoPartidoToDb(r) {
  return {
    evento_id: r.eventoId,
    goles_favor: r.golesFavor === "" || r.golesFavor == null ? 0 : Number(r.golesFavor),
    goles_contra: r.golesContra === "" || r.golesContra == null ? 0 : Number(r.golesContra),
    observaciones: r.observaciones || null,
  };
}
function golPartidoFromDb(r) {
  return {
    id: r.id,
    resultadoId: r.resultado_id,
    alumnoId: r.alumno_id,
    alumnoNombre: r.alumno_nombre,
    asistenciaAlumnoId: r.asistencia_alumno_id,
    asistenciaNombre: r.asistencia_nombre,
    minuto: r.minuto,
  };
}
function tarjetaPartidoFromDb(r) {
  return {
    id: r.id,
    resultadoId: r.resultado_id,
    alumnoId: r.alumno_id,
    alumnoNombre: r.alumno_nombre,
    tipo: r.tipo,
    minuto: r.minuto,
  };
}
// Junta cada resultado con sus goles y tarjetas (llegan por separado, de
// partido_goles y partido_tarjetas).
function juntarResultadosConDetalle(filasResultados, filasGoles, filasTarjetas) {
  const golesPor = {};
  filasGoles.map(golPartidoFromDb).forEach((g) => {
    if (!golesPor[g.resultadoId]) golesPor[g.resultadoId] = [];
    golesPor[g.resultadoId].push(g);
  });
  const tarjetasPor = {};
  filasTarjetas.map(tarjetaPartidoFromDb).forEach((t) => {
    if (!tarjetasPor[t.resultadoId]) tarjetasPor[t.resultadoId] = [];
    tarjetasPor[t.resultadoId].push(t);
  });
  return filasResultados.map(resultadoPartidoFromDb).map((r) => ({
    ...r,
    goles: golesPor[r.id] || [],
    tarjetas: tarjetasPor[r.id] || [],
  }));
}
function resultadoPartidoTipo(r) {
  if (Number(r.golesFavor) > Number(r.golesContra)) return "ganado";
  if (Number(r.golesFavor) < Number(r.golesContra)) return "perdido";
  return "empate";
}
function resultadoPartidoLabel(r) {
  const t = resultadoPartidoTipo(r);
  return t === "ganado" ? "Ganado" : t === "perdido" ? "Perdido" : "Empate";
}

// ---------- Campeonatos: inscripciones y cuota ----------
function campeonatoFromDb(r) {
  return {
    id: r.id,
    nombre: r.nombre,
    fecha: r.fecha,
    categorias: r.categorias || [],
    notas: r.notas,
  };
}
function campeonatoToDb(c) {
  return {
    nombre: c.nombre,
    fecha: c.fecha || null,
    categorias: c.categorias && c.categorias.length ? c.categorias : null,
    notas: c.notas || null,
  };
}
function inscripcionCampeonatoFromDb(r) {
  return {
    id: r.id,
    campeonatoId: r.campeonato_id,
    alumnoId: r.alumno_id,
    montoCuota: Number(r.monto_cuota) || 0,
    pagado: !!r.pagado,
    fechaPago: r.fecha_pago,
    nota: r.nota,
  };
}
// Junta cada campeonato con su lista de inscripciones (llegan por
// separado, de la tabla campeonato_inscripciones).
function juntarCampeonatosConInscripciones(filasCampeonatos, filasInscripciones) {
  const porCampeonato = {};
  filasInscripciones.map(inscripcionCampeonatoFromDb).forEach((ins) => {
    if (!porCampeonato[ins.campeonatoId]) porCampeonato[ins.campeonatoId] = [];
    porCampeonato[ins.campeonatoId].push(ins);
  });
  return filasCampeonatos.map(campeonatoFromDb).map((c) => ({
    ...c,
    inscripciones: porCampeonato[c.id] || [],
  }));
}

// ---------- Inventario ----------
function inventarioFromDb(r) {
  return {
    id: r.id,
    nombre: r.nombre,
    categoria: r.categoria,
    cantidadTotal: Number(r.cantidad_total) || 0,
    cantidadDanada: Number(r.cantidad_danada) || 0,
    sede: r.sede,
    notas: r.notas,
  };
}
function inventarioToDb(i) {
  const total = Number(i.cantidadTotal) || 0;
  let danada = Number(i.cantidadDanada) || 0;
  if (danada > total) danada = total; // nunca puede haber más dañadas que el total
  return {
    nombre: i.nombre,
    categoria: i.categoria || "Otro",
    cantidad_total: total,
    cantidad_danada: danada,
    sede: i.sede || null,
    notas: i.notas || null,
  };
}

// ---------- Evaluaciones deportivas ----------
// Cada evaluación califica a un alumno en 4 dimensiones (1 a 5): técnica,
// físico, táctico y actitud. "categoria" se guarda como snapshot (la
// categoría del alumno al momento de evaluar) para que el historial no
// cambie si el alumno luego sube de categoría.
function evaluacionFromDb(r) {
  return {
    id: r.id,
    alumnoId: r.alumno_id,
    entrenadorId: r.entrenador_id,
    fecha: r.fecha,
    categoria: r.categoria,
    tecnica: Number(r.tecnica) || 0,
    fisico: Number(r.fisico) || 0,
    tactico: Number(r.tactico) || 0,
    actitud: Number(r.actitud) || 0,
    comentarios: r.comentarios,
  };
}
function evaluacionToDb(e) {
  return {
    alumno_id: e.alumnoId,
    fecha: e.fecha || todayISO(),
    categoria: e.categoria || null,
    tecnica: Number(e.tecnica) || 3,
    fisico: Number(e.fisico) || 3,
    tactico: Number(e.tactico) || 3,
    actitud: Number(e.actitud) || 3,
    comentarios: e.comentarios || null,
  };
}
function promedioEvaluacion(e) {
  return (Number(e.tecnica) + Number(e.fisico) + Number(e.tactico) + Number(e.actitud)) / 4;
}

// Genera las fechas de las repeticiones de un evento (incluida la
// primera), desde "fecha" hasta "hasta" (incluida), según "frecuencia".
// Tope de 52 fechas como protección — nadie necesita repetir un evento
// más de un año seguido, y evita que un error de captura (una fecha
// "hasta" muy lejana) genere miles de filas sin querer.
function fechasRecurrencia(fecha, frecuencia, hasta) {
  const fechas = [fecha];
  if (!frecuencia || frecuencia === "ninguna" || !hasta) return fechas;
  const pasoDias = frecuencia === "semanal" ? 7 : frecuencia === "quincenal" ? 14 : null; // "mensual" se maneja aparte
  let actual = new Date(fecha + "T00:00:00");
  const limite = new Date(hasta + "T00:00:00");
  while (fechas.length < 52) {
    if (pasoDias) {
      actual = new Date(actual.getTime() + pasoDias * 86400000);
    } else {
      actual = new Date(actual.getFullYear(), actual.getMonth() + 1, actual.getDate());
    }
    if (actual > limite) break;
    fechas.push(actual.toISOString().slice(0, 10));
  }
  return fechas;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Arma la clave "YYYY-MM-DD" a partir de año/mes(0-indexado)/día locales,
// sin pasar por toISOString() (que convierte a UTC y puede correr la
// fecha un día si el navegador está en una zona horaria negativa).
function dateKeyLocal(year, monthIndex, day) {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

const DIAS_SEMANA_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// Arma la grilla de 42 celdas (6 semanas de 7 días, empezando en lunes)
// que cubre el mes visible, incluyendo los días de los meses vecinos que
// completan la primera y la última semana.
function construirMatrizMes(year, monthIndex) {
  const primerDia = new Date(year, monthIndex, 1);
  const offset = (primerDia.getDay() + 6) % 7; // getDay(): 0=Dom..6=Sáb → queremos que la semana empiece en lunes
  const inicio = new Date(year, monthIndex, 1 - offset);
  const hoyKey = todayISO();
  const celdas = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
    const key = dateKeyLocal(d.getFullYear(), d.getMonth(), d.getDate());
    celdas.push({ key, dia: d.getDate(), enMes: d.getMonth() === monthIndex, esHoy: key === hoyKey });
  }
  return celdas;
}

function formatDiaLargo(fechaISO) {
  if (!fechaISO) return "";
  const [y, m, d] = fechaISO.split("-").map(Number);
  const fecha = new Date(y, m - 1, d);
  const label = fecha.toLocaleDateString("es-GT", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Fecha de hoy +/- N días (N negativo = hacia atrás), en formato YYYY-MM-DD.
function fechaMasDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return dateKeyLocal(d.getFullYear(), d.getMonth(), d.getDate());
}

const TIPOS_EVENTO = [
  { value: "entrenamiento", label: "Entrenamiento" },
  { value: "partido", label: "Partido" },
  { value: "torneo", label: "Torneo" },
  { value: "clinica", label: "Clínica" },
  { value: "viaje", label: "Viaje" },
  { value: "reunion", label: "Reunión" },
  { value: "actividad", label: "Actividad" },
  { value: "suspension", label: "Suspensión" },
  { value: "evento_especial", label: "Evento especial" },
  { value: "clase_prueba", label: "Clase de prueba" },
];

function tipoEventoLabel(tipo) {
  return (TIPOS_EVENTO.find((t) => t.value === tipo) || {}).label || tipo;
}

// Arma el texto de la convocatoria (o del aviso, para cualquier otro tipo
// de evento) listo para copiar o mandar directo a WhatsApp.
function mensajeEvento(evento, nombresConvocados) {
  const fechaFmt = evento.fecha
    ? new Date(evento.fecha + "T00:00:00").toLocaleDateString("es-GT", { weekday: "long", day: "numeric", month: "long" })
    : "";
  const lineas = [];
  if (evento.tipo === "partido") {
    lineas.push(`⚽ Convocatoria — ${evento.titulo || "Partido"}`);
    if (evento.rival) lineas.push(`Rival: ${evento.rival}`);
    if (fechaFmt) lineas.push(`Fecha: ${fechaFmt}`);
    if (evento.horaConvocatoria) lineas.push(`Hora de convocatoria: ${evento.horaConvocatoria}`);
    if (evento.hora) lineas.push(`Hora del partido: ${evento.hora}`);
    if (evento.lugar) lineas.push(`Lugar: ${evento.lugar}`);
    if (evento.uniforme) lineas.push(`Uniforme: ${evento.uniforme}`);
    if (evento.indicaciones) lineas.push(`Indicaciones: ${evento.indicaciones}`);
    if (nombresConvocados && nombresConvocados.length) {
      lineas.push("");
      lineas.push("Convocados:");
      nombresConvocados.forEach((n) => lineas.push(`• ${n}`));
    }
  } else {
    lineas.push(`📅 ${tipoEventoLabel(evento.tipo)} — ${evento.titulo || ""}`);
    if (fechaFmt) lineas.push(`Fecha: ${fechaFmt}`);
    if (evento.hora) lineas.push(`Hora: ${evento.hora}`);
    if (evento.lugar) lineas.push(`Lugar: ${evento.lugar}`);
    if (evento.categorias && evento.categorias.length) lineas.push(`Categoría(s): ${evento.categorias.join(", ")}`);
    if (evento.indicaciones) lineas.push(`Indicaciones: ${evento.indicaciones}`);
  }
  lineas.push("");
  lineas.push("Atletic Guatemala");
  return lineas.join("\n");
}

// Limpia un teléfono guardado (con guiones, espacios, etc.) y le antepone
// el código de país de Guatemala si hace falta, para armar el link de
// WhatsApp de ese contacto en particular (wa.me/<numero>?text=...). Si no
// hay teléfono o no se puede reconocer, devuelve null y el botón de
// WhatsApp en pantalla cae de vuelta al link genérico (wa.me/?text=...).
function telefonoWhatsapp(telefono) {
  const digitos = (telefono || "").replace(/\D/g, "");
  if (!digitos) return null;
  if (digitos.length === 8) return "502" + digitos;
  if (digitos.length > 8) return digitos;
  return null;
}

// Arma el mensaje de recordatorio de pago para un alumno con saldo
// pendiente, listo para copiar o mandar directo a WhatsApp — igual que
// mensajeEvento, la app arma el texto pero quien decide a quién y cuándo
// mandarlo es la persona, nunca se manda nada automáticamente.
function mensajeRecordatorioPago(alumno) {
  const lineas = [];
  lineas.push(`Hola${alumno.encargado ? " " + alumno.encargado : ""}, le saludamos de Atletic Guatemala.`);
  lineas.push(
    `Le escribimos para recordarle que ${alumno.nombre}${
      alumno.categoria ? ` (categoría ${alumno.categoria})` : ""
    } tiene un saldo pendiente de ${formatQ(alumno.saldoPendiente)}.`
  );
  lineas.push("Le agradecemos ponerse al día cuando pueda. Cualquier duda, con gusto le apoyamos.");
  lineas.push("");
  lineas.push("Atletic Guatemala");
  return lineas.join("\n");
}

// Arma el reporte semanal de operación (CRM, cobros, asistencia y próximos
// eventos) de los últimos 7 días, listo para copiar o mandar por WhatsApp
// — pensado para el reporte que Alejandro le manda al dueño cada semana.
function generarReporteSemanal({ leads, alumnos, pagos, asistencias, eventos }) {
  const hastaKey = todayISO();
  const desdeKey = fechaMasDias(-6);
  const desdeFecha = new Date(desdeKey + "T00:00:00");
  const enUnaSemana = fechaMasDias(7);

  const leadsNuevos = leads.filter((l) => l.createdAt && new Date(l.createdAt) >= desdeFecha);
  const leadsSinContactar = leads.filter((l) => l.estado === "nuevo").length;
  const alumnosNuevos = alumnos.filter((a) => a.fechaAlta && a.fechaAlta >= desdeKey);

  const pagosSemana = pagos.filter((p) => p.fecha && p.fecha >= desdeKey);
  const totalCobrado = pagosSemana.reduce((s, p) => s + Number(p.monto || 0), 0);
  const alumnosActivos = alumnos.filter((a) => a.activo !== false);
  const totalPendiente = alumnosActivos.reduce((s, a) => s + Math.max(0, Number(a.saldoPendiente || 0)), 0);
  const alumnosConDeuda = alumnosActivos.filter((a) => Number(a.saldoPendiente || 0) > 0).length;

  const asistenciasSemana = asistencias.filter((x) => x.fecha && x.fecha >= desdeKey);
  const presentesSemana = asistenciasSemana.filter((x) => x.presente).length;
  const pctAsistencia = asistenciasSemana.length
    ? Math.round((presentesSemana / asistenciasSemana.length) * 100)
    : null;

  const eventosProximos = eventos
    .filter((e) => e.fecha && e.fecha >= hastaKey && e.fecha <= enUnaSemana)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.hora < b.hora ? -1 : 1));

  const lineas = [];
  lineas.push("📊 Reporte semanal — Atletic Guatemala");
  lineas.push(`Del ${formatDiaLargo(desdeKey)} al ${formatDiaLargo(hastaKey)}`);
  lineas.push("");
  lineas.push("👥 CRM");
  lineas.push(`• Leads nuevos: ${leadsNuevos.length}`);
  lineas.push(`• Sin contactar todavía: ${leadsSinContactar}`);
  lineas.push(`• Alumnos inscritos esta semana: ${alumnosNuevos.length}`);
  lineas.push("");
  lineas.push("💵 Cobros");
  lineas.push(`• Pagos registrados: ${pagosSemana.length} (${formatQ(totalCobrado)})`);
  lineas.push(`• Alumnos con saldo pendiente: ${alumnosConDeuda} (${formatQ(totalPendiente)} en total)`);
  lineas.push("");
  lineas.push("✅ Asistencia");
  lineas.push(
    pctAsistencia === null
      ? "• Sin asistencia marcada esta semana."
      : `• ${pctAsistencia}% de asistencia (${presentesSemana}/${asistenciasSemana.length} marcados)`
  );
  lineas.push("");
  lineas.push("📅 Próximos 7 días");
  if (eventosProximos.length === 0) {
    lineas.push("• Sin eventos programados.");
  } else {
    eventosProximos.slice(0, 8).forEach((e) => {
      lineas.push(`• ${e.fecha.slice(8, 10)}/${e.fecha.slice(5, 7)} — ${tipoEventoLabel(e.tipo)}: ${e.titulo}`);
    });
    if (eventosProximos.length > 8) lineas.push(`• +${eventosProximos.length - 8} más en el calendario.`);
  }
  lineas.push("");
  lineas.push("Atletic Guatemala");
  return lineas.join("\n");
}

// Columnas del pipeline de leads, en el orden fijo que pidió el dueño.
const ESTADOS_LEAD = [
  { value: "nuevo", label: "Nuevo" },
  { value: "contactado", label: "Contactado" },
  { value: "prueba_programada", label: "Prueba programada" },
  { value: "asistio", label: "Asistió" },
  { value: "inscrito", label: "Inscrito" },
  { value: "no_inscrito", label: "No inscrito" },
];

function estadoLeadInfo(estado) {
  switch (estado) {
    case "contactado":
      return { label: "Contactado", color: "#0090C2", bg: "#E7F7FD" };
    case "prueba_programada":
      return { label: "Prueba programada", color: "#B4790A", bg: "#FCF1DD" };
    case "asistio":
      return { label: "Asistió", color: "#6C4FB6", bg: "#F0EBFB" };
    case "inscrito":
      return { label: "Inscrito", color: "#158F63", bg: "#E7F7F1" };
    case "no_inscrito":
      return { label: "No inscrito", color: "#8A8D90", bg: "#F0F2F3" };
    case "nuevo":
    default:
      return { label: "Nuevo", color: "#C13F3B", bg: "#FBEAE9" };
  }
}

// Teléfono de contacto de un lead: prefiere el del padre, si no el de la
// madre — mismo criterio que usa convertir_lead_a_alumno del lado del SQL.
function telefonoContactoLead(lead) {
  return lead.telefonoPadre || lead.telefonoMadre || "";
}

function nombreContactoLead(lead) {
  return lead.nombrePadre || lead.nombreMadre || "";
}

// Días desde que el lead se creó (no hay columna de "última actualización"
// de etapa todavía, así que se usa created_at como pidió la especificación).
function diasDesde(fechaISO) {
  if (!fechaISO) return null;
  const inicio = new Date(fechaISO);
  if (isNaN(inicio.getTime())) return null;
  const ms = Date.now() - inicio.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
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

const ROLES_STAFF = [
  { value: "admin", label: "Administrador" },
  { value: "administrativo", label: "Administrativo" },
  { value: "asistente", label: "Asistente" },
  { value: "entrenador", label: "Entrenador" },
];
function rolLabel(rol) {
  const r = ROLES_STAFF.find((x) => x.value === rol);
  return r ? r.label : rol || "—";
}

const OBJETIVOS_EJERCICIO = [
  { value: "tecnica", label: "Técnica" },
  { value: "fisico", label: "Físico" },
  { value: "tactico", label: "Táctico" },
  { value: "otro", label: "Otro" },
];
function objetivoEjercicioLabel(v) {
  const o = OBJETIVOS_EJERCICIO.find((x) => x.value === v);
  return o ? o.label : v || "—";
}

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

const POSICIONES = [
  "Portero",
  "Defensa central",
  "Lateral derecho",
  "Lateral izquierdo",
  "Mediocampista defensivo",
  "Mediocampista central",
  "Mediocampista ofensivo",
  "Extremo derecho",
  "Extremo izquierdo",
  "Delantero",
];

const PIERNA_DOMINANTE = ["Derecha", "Izquierda", "Ambas"];

const TALLAS_UNIFORME = ["4", "6", "8", "10", "12", "14", "16", "XS", "S", "M", "L", "XL"];

const CATEGORIAS_GASTO = ["Cancha", "Pago a entrenador", "Equipo y material", "Publicidad", "Otro"];

const CATEGORIAS_INVENTARIO = [
  "Balones",
  "Conos y agilidad",
  "Petos",
  "Arcos portátiles",
  "Mallas y redes",
  "Botiquín",
  "Uniformes de entrenamiento",
  "Otro",
];

// Sedes de la academia (las mismas del sitio público). Se usa como campo
// opcional en Inventario para anotar dónde está cada artículo; un artículo
// sin sede se entiende como de uso general/compartido entre sedes.
const SEDES = ["Hacienda Real", "Colegio Discovery"];

// Dimensiones que califica cada evaluación deportiva, de 1 (bajo) a 5 (alto).
const DIMENSIONES_EVALUACION = [
  { key: "tecnica", label: "Técnica" },
  { key: "fisico", label: "Físico" },
  { key: "tactico", label: "Táctico" },
  { key: "actitud", label: "Actitud" },
];

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
          setPerfil({
            id: data.id,
            nombre: data.nombre,
            rol: data.rol,
            activo: data.activo !== false,
            categorias: data.categorias || [],
          });
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

  if (!perfil.activo) {
    return (
      <PantallaCentrada
        mensaje="Tu cuenta fue desactivada. Pídele al administrador de la academia que la reactive desde Staff."
        error
        onLogout={cerrarSesion}
      />
    );
  }

  if (perfil.rol === "entrenador") {
    return <PanelEntrenador perfil={perfil} onLogout={cerrarSesion} />;
  }

  if (perfil.rol === "asistente") {
    return <PanelAsistente perfil={perfil} onLogout={cerrarSesion} />;
  }

  if (perfil.rol === "administrativo") {
    return <PanelAdministrativo perfil={perfil} onLogout={cerrarSesion} />;
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
  const [eventos, setEventos] = useState([]);
  const [ejercicios, setEjercicios] = useState([]);
  const [sesiones, setSesiones] = useState([]);
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [marcandoIds, setMarcandoIds] = useState(() => new Set());
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState("asistencia");
  const [ejercicioModal, setEjercicioModal] = useState(null);
  const [confirmDeleteEjercicio, setConfirmDeleteEjercicio] = useState(null);
  const [sesionModal, setSesionModal] = useState(null);
  const [confirmDeleteSesion, setConfirmDeleteSesion] = useState(null);
  const [resultadoModal, setResultadoModal] = useState(null); // { evento, resultado } | null
  const [confirmDeleteResultado, setConfirmDeleteResultado] = useState(null);
  const [evaluaciones, setEvaluaciones] = useState([]);
  const [evaluacionModal, setEvaluacionModal] = useState(null); // null | {} (nueva) | evaluación (editar)
  const [confirmDeleteEvaluacion, setConfirmDeleteEvaluacion] = useState(null);

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

  async function cargar() {
    const [a, s, ev, ej, se, sej, rp, pg, pt, eva] = await Promise.all([
      supabase.rpc("alumnos_para_asistencia"),
      supabase.from("asistencias").select("*").order("fecha", { ascending: false }),
      supabase.rpc("eventos_para_entrenador"),
      supabase.from("ejercicios").select("*").order("nombre"),
      supabase.from("sesiones").select("*").order("fecha", { ascending: false }),
      supabase.from("sesion_ejercicios").select("*"),
      supabase.from("resultados_partido").select("*"),
      supabase.from("partido_goles").select("*"),
      supabase.from("partido_tarjetas").select("*"),
      supabase.from("evaluaciones").select("*").order("fecha", { ascending: false }),
    ]);
    setAlumnos(a.data || []);
    setAsistencias((s.data || []).map(asistenciaFromDb));
    setEventos((ev.data || []).map(eventoFromDb));
    setEjercicios((ej.data || []).map(ejercicioFromDb));
    setSesiones(juntarSesionesConEjercicios(se.data || [], sej.data || []));
    setResultados(juntarResultadosConDetalle(rp.data || [], pg.data || [], pt.data || []));
    setEvaluaciones((eva.data || []).map(evaluacionFromDb));
  }

  // Guarda un ejercicio de la biblioteca: si trae id, lo actualiza; si no,
  // lo crea a nombre de este entrenador (creado_por = su propio id).
  async function guardarEjercicio(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      const payload = ejercicioToDb(data);
      const { error } = esNuevo
        ? await supabase.from("ejercicios").insert([{ ...payload, creado_por: perfil.id }])
        : await supabase.from("ejercicios").update(payload).eq("id", data.id);
      if (error) {
        showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
        return;
      }
      await cargar();
      setEjercicioModal(null);
      showToast(esNuevo ? "Ejercicio agregado." : "Cambios guardados.");
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarEjercicio(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("ejercicios").delete().eq("id", id);
      setConfirmDeleteEjercicio(null);
      if (!error) {
        setEjercicios((prev) => prev.filter((e) => e.id !== id));
        showToast("Ejercicio eliminado.");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  // Guarda una sesión completa: la fila de "sesiones" y, aparte, reemplaza
  // TODOS sus ejercicios por la lista actual del formulario (más simple y
  // confiable que ir comparando cuáles cambiaron uno por uno).
  async function guardarSesion(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      const payload = sesionToDb(data);
      let sesionId = data.id;
      if (esNuevo) {
        const { data: fila, error } = await supabase
          .from("sesiones")
          .insert([{ ...payload, entrenador_id: perfil.id }])
          .select()
          .single();
        if (error || !fila) {
          showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
          return;
        }
        sesionId = fila.id;
      } else {
        const { error } = await supabase.from("sesiones").update(payload).eq("id", sesionId);
        if (error) {
          showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
          return;
        }
        await supabase.from("sesion_ejercicios").delete().eq("sesion_id", sesionId);
      }
      if (data.ejercicios.length) {
        const filas = data.ejercicios.map((ej, i) => ({
          sesion_id: sesionId,
          ejercicio_id: ej.ejercicioId || null,
          nombre: ej.nombre,
          duracion_min: ej.duracionMin === "" || ej.duracionMin == null ? null : Number(ej.duracionMin),
          notas: ej.notas || null,
          orden: i,
        }));
        const { error: errEj } = await supabase.from("sesion_ejercicios").insert(filas);
        if (errEj) {
          showToast("La sesión se guardó, pero no se pudieron guardar sus ejercicios. Vuelve a intentarlo.", true);
          return;
        }
      }
      await cargar();
      setSesionModal(null);
      showToast(esNuevo ? "Sesión creada." : "Cambios guardados.");
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarSesion(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("sesiones").delete().eq("id", id);
      setConfirmDeleteSesion(null);
      if (!error) {
        setSesiones((prev) => prev.filter((s) => s.id !== id));
        showToast("Sesión eliminada.");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  // Guarda el resultado de un partido: la fila de "resultados_partido" (a
  // nombre de este entrenador) y, aparte, reemplaza TODOS sus goles y
  // tarjetas por la lista actual del formulario.
  async function guardarResultado(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      const payload = resultadoPartidoToDb(data);
      let resultadoId = data.id;
      if (esNuevo) {
        const { data: fila, error } = await supabase
          .from("resultados_partido")
          .insert([{ ...payload, entrenador_id: perfil.id }])
          .select()
          .single();
        if (error || !fila) {
          showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
          return;
        }
        resultadoId = fila.id;
      } else {
        const { error } = await supabase.from("resultados_partido").update(payload).eq("id", resultadoId);
        if (error) {
          showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
          return;
        }
        await supabase.from("partido_goles").delete().eq("resultado_id", resultadoId);
        await supabase.from("partido_tarjetas").delete().eq("resultado_id", resultadoId);
      }
      if (data.goles.length) {
        const filas = data.goles.map((g) => ({
          resultado_id: resultadoId,
          alumno_id: g.alumnoId || null,
          alumno_nombre: g.alumnoNombre,
          asistencia_alumno_id: g.asistenciaAlumnoId || null,
          asistencia_nombre: g.asistenciaNombre || null,
          minuto: g.minuto === "" || g.minuto == null ? null : Number(g.minuto),
        }));
        const { error: errGoles } = await supabase.from("partido_goles").insert(filas);
        if (errGoles) {
          showToast("El resultado se guardó, pero no se pudieron guardar los goles. Vuelve a intentarlo.", true);
          return;
        }
      }
      if (data.tarjetas.length) {
        const filas = data.tarjetas.map((t) => ({
          resultado_id: resultadoId,
          alumno_id: t.alumnoId || null,
          alumno_nombre: t.alumnoNombre,
          tipo: t.tipo,
          minuto: t.minuto === "" || t.minuto == null ? null : Number(t.minuto),
        }));
        const { error: errTarjetas } = await supabase.from("partido_tarjetas").insert(filas);
        if (errTarjetas) {
          showToast("El resultado se guardó, pero no se pudieron guardar las tarjetas. Vuelve a intentarlo.", true);
          return;
        }
      }
      await cargar();
      setResultadoModal(null);
      showToast(esNuevo ? "Resultado registrado." : "Cambios guardados.");
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarResultado(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("resultados_partido").delete().eq("id", id);
      setConfirmDeleteResultado(null);
      if (!error) {
        setResultados((prev) => prev.filter((r) => r.id !== id));
        showToast("Resultado eliminado.");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  // Guarda una evaluación deportiva a nombre de este entrenador
  // (entrenador_id = perfil.id, obligatorio por la RLS de la tabla).
  async function guardarEvaluacion(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      const payload = evaluacionToDb(data);
      const { error } = esNuevo
        ? await supabase.from("evaluaciones").insert([{ ...payload, entrenador_id: perfil.id }])
        : await supabase.from("evaluaciones").update(payload).eq("id", data.id);
      if (error) {
        showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
        return;
      }
      await cargar();
      setEvaluacionModal(null);
      showToast(esNuevo ? "Evaluación registrada." : "Cambios guardados.");
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarEvaluacion(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("evaluaciones").delete().eq("id", id);
      setConfirmDeleteEvaluacion(null);
      if (!error) {
        setEvaluaciones((prev) => prev.filter((e) => e.id !== id));
        showToast("Evaluación eliminada.");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
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
      .on("postgres_changes", { event: "*", schema: "public", table: "sesiones" }, () => cargar())
      .on("postgres_changes", { event: "*", schema: "public", table: "sesion_ejercicios" }, () => cargar())
      .on("postgres_changes", { event: "*", schema: "public", table: "ejercicios" }, () => cargar())
      .on("postgres_changes", { event: "*", schema: "public", table: "resultados_partido" }, () => cargar())
      .on("postgres_changes", { event: "*", schema: "public", table: "partido_goles" }, () => cargar())
      .on("postgres_changes", { event: "*", schema: "public", table: "partido_tarjetas" }, () => cargar())
      .on("postgres_changes", { event: "*", schema: "public", table: "evaluaciones" }, () => cargar())
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
            <div className="brand-sub">Entrenador</div>
          </div>
        </div>
        <button className="reload-btn" onClick={onLogout} title="Cerrar sesión">
          <LogOut size={14} />
          {perfil?.nombre ? perfil.nombre : "Salir"}
        </button>
      </header>

      <nav className="tabs">
        {[
          { key: "asistencia", label: "Asistencia" },
          { key: "calendario", label: "Calendario" },
          { key: "sesiones", label: "Sesiones" },
          { key: "biblioteca", label: "Biblioteca" },
          { key: "resultados", label: "Partidos" },
          { key: "evaluaciones", label: "Evaluaciones" },
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
            {tab === "asistencia" && (
              <AsistenciaView
                alumnosActivos={alumnos}
                asistencias={asistencias}
                onMarcar={marcarAsistencia}
                onDesmarcar={desmarcarAsistencia}
                marcandoIds={marcandoIds}
              />
            )}
            {tab === "calendario" && <CalendarioEntrenadorView eventos={eventos} />}
            {tab === "sesiones" && (
              <SesionesView
                sesiones={sesiones}
                mostrarEntrenador={false}
                onNuevo={() => setSesionModal({})}
                onEditar={(s) => setSesionModal(s)}
                onEliminar={(s) => setConfirmDeleteSesion(s)}
              />
            )}
            {tab === "biblioteca" && (
              <BibliotecaEjerciciosView
                ejercicios={ejercicios}
                miId={perfil.id}
                esAdmin={false}
                onNuevo={() => setEjercicioModal({})}
                onEditar={(e) => setEjercicioModal(e)}
                onEliminar={(e) => setConfirmDeleteEjercicio(e)}
              />
            )}
            {tab === "resultados" && (
              <ResultadosPartidosView
                eventos={eventos}
                resultados={resultados}
                mostrarEntrenador={false}
                onRegistrar={(evento) => setResultadoModal({ evento, resultado: null })}
                onEditar={(evento, resultado) => setResultadoModal({ evento, resultado })}
                onEliminar={(r) => setConfirmDeleteResultado(r)}
              />
            )}
            {tab === "evaluaciones" && (
              <EvaluacionesView
                evaluaciones={evaluaciones}
                alumnos={alumnos}
                mostrarEntrenador={false}
                onNuevo={() => setEvaluacionModal({})}
                onEditar={(ev) => setEvaluacionModal(ev)}
                onEliminar={(ev) => setConfirmDeleteEvaluacion(ev)}
              />
            )}
          </>
        )}
      </main>

      {ejercicioModal !== null && (
        <EjercicioModal
          initial={ejercicioModal}
          onSave={guardarEjercicio}
          onCancel={() => setEjercicioModal(null)}
          enviando={enviando}
        />
      )}
      {confirmDeleteEjercicio && (
        <ConfirmDialog
          title={`¿Eliminar "${confirmDeleteEjercicio.nombre}"?`}
          body="Se borra de la biblioteca compartida. Las sesiones que ya lo usaban no se afectan (queda guardado en su propio plan)."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarEjercicio(confirmDeleteEjercicio.id)}
          onCancel={() => setConfirmDeleteEjercicio(null)}
          disabled={enviando}
        />
      )}
      {sesionModal !== null && (
        <SesionModal
          initial={sesionModal}
          categoriasDisponibles={perfil.categorias || []}
          ejerciciosDisponibles={ejercicios}
          onSave={guardarSesion}
          onCancel={() => setSesionModal(null)}
          enviando={enviando}
        />
      )}
      {confirmDeleteSesion && (
        <ConfirmDialog
          title={`¿Eliminar la sesión "${confirmDeleteSesion.titulo}"?`}
          body="No podrá deshacerse."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarSesion(confirmDeleteSesion.id)}
          onCancel={() => setConfirmDeleteSesion(null)}
          disabled={enviando}
        />
      )}

      {resultadoModal !== null && (
        <ResultadoModal
          evento={resultadoModal.evento}
          initial={resultadoModal.resultado}
          alumnosDisponibles={
            (resultadoModal.evento.categorias || []).length
              ? alumnos.filter((a) => resultadoModal.evento.categorias.includes(a.categoria))
              : alumnos
          }
          onSave={guardarResultado}
          onCancel={() => setResultadoModal(null)}
          enviando={enviando}
        />
      )}
      {confirmDeleteResultado && (
        <ConfirmDialog
          title="¿Eliminar este resultado?"
          body="Se borran también los goleadores y tarjetas registrados para este partido. No podrá deshacerse."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarResultado(confirmDeleteResultado.id)}
          onCancel={() => setConfirmDeleteResultado(null)}
          disabled={enviando}
        />
      )}

      {evaluacionModal !== null && (
        <EvaluacionModal
          initial={evaluacionModal}
          alumnosDisponibles={alumnos}
          onSave={guardarEvaluacion}
          onCancel={() => setEvaluacionModal(null)}
          enviando={enviando}
        />
      )}
      {confirmDeleteEvaluacion && (
        <ConfirmDialog
          title="¿Eliminar esta evaluación?"
          body="No podrá deshacerse."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarEvaluacion(confirmDeleteEvaluacion.id)}
          onCancel={() => setConfirmDeleteEvaluacion(null)}
          disabled={enviando}
        />
      )}

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

// Agrupa las pestañas en bloques ("pestañas maestras") para que la barra
// lateral no muestre una lista larga y plana. Un grupo con un solo tab
// (ej. "Resumen", "CRM") se dibuja como un botón directo, sin flecha ni
// hijos que desplegar — solo los grupos con más de un tab son expandibles.
const GRUPOS_NAV_ADMIN = [
  { key: "resumen", label: "Resumen", tabs: [{ key: "resumen", label: "Resumen" }] },
  {
    key: "financiero",
    label: "Financiero",
    tabs: [
      { key: "pago", label: "Registrar pago" },
      { key: "gasto", label: "Gastos" },
      { key: "cobro", label: "Cobro mensual" },
      { key: "cartera", label: "Cartera" },
      { key: "margen", label: "Margen" },
      { key: "campeonatos", label: "Campeonatos" },
    ],
  },
  {
    key: "alumnos",
    label: "Alumnos",
    tabs: [
      { key: "alumnos", label: "Alumnos" },
      { key: "asistencia", label: "Asistencia" },
      { key: "uniformes", label: "Uniformes" },
      { key: "inventario", label: "Inventario" },
    ],
  },
  {
    key: "captacion",
    label: "Captación",
    tabs: [
      { key: "crm", label: "CRM" },
      { key: "calendario", label: "Calendario" },
      { key: "reporte", label: "Reporte semanal" },
    ],
  },
  {
    key: "deportiva",
    label: "Área deportiva",
    tabs: [
      { key: "sesiones", label: "Sesiones" },
      { key: "biblioteca", label: "Biblioteca" },
      { key: "resultados", label: "Partidos" },
      { key: "evaluaciones", label: "Evaluaciones" },
    ],
  },
  { key: "staff", label: "Staff", tabs: [{ key: "staff", label: "Staff" }] },
];

const GRUPOS_NAV_ADMINISTRATIVO = [
  { key: "crm", label: "CRM", tabs: [{ key: "crm", label: "CRM" }] },
  {
    key: "alumnos",
    label: "Alumnos",
    tabs: [
      { key: "alumnos", label: "Alumnos" },
      { key: "asistencia", label: "Asistencia" },
      { key: "uniformes", label: "Uniformes" },
      { key: "inventario", label: "Inventario" },
    ],
  },
  {
    key: "financiero",
    label: "Financiero",
    tabs: [
      { key: "pago", label: "Registrar pago" },
      { key: "cobro", label: "Cobro mensual" },
      { key: "cartera", label: "Cartera" },
      { key: "campeonatos", label: "Campeonatos" },
    ],
  },
  {
    key: "captacion",
    label: "Captación",
    tabs: [
      { key: "calendario", label: "Calendario" },
      { key: "reporte", label: "Reporte semanal" },
    ],
  },
];

// Dado un tab (ej. "asistencia"), devuelve la key del grupo al que
// pertenece (ej. "alumnos") — para los accesos directos que cambian de tab
// sin pasar por la barra lateral (ej. los botones del Resumen), así el
// grupo correcto queda abierto y el tab activo se ve resaltado.
function grupoDeTab(grupos, tabKey) {
  const g = grupos.find((gr) => gr.tabs.some((t) => t.key === tabKey));
  return g ? g.key : null;
}

// Barra lateral de navegación agrupada. Componente puro (sin estado propio
// aparte de si el menú móvil está abierto) para que Admin y Administrativo
// compartan exactamente la misma lógica — cada panel solo le pasa su
// arreglo de grupos y guarda su propio "openGroup" con useState.
function SidebarNav({ grupos, tab, setTab, openGroup, setOpenGroup }) {
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);

  function irATab(tabKey, groupKey) {
    setTab(tabKey);
    setOpenGroup(groupKey);
    setMenuMovilAbierto(false);
  }

  return (
    <>
      <button
        className="sidebar-toggle-movil"
        onClick={() => setMenuMovilAbierto((v) => !v)}
        aria-label="Abrir menú"
      >
        <Menu size={18} />
        {grupos.flatMap((g) => g.tabs).find((t) => t.key === tab)?.label || "Menú"}
      </button>
      <nav className={"sidebar" + (menuMovilAbierto ? " sidebar-abierto-movil" : "")}>
        {grupos.map((g) => {
          const esDirecto = g.tabs.length === 1 && g.tabs[0].key === g.key;
          const grupoActivo = g.tabs.some((t) => t.key === tab);
          if (esDirecto) {
            return (
              <button
                key={g.key}
                className={"sidebar-tab sidebar-tab-grupo" + (grupoActivo ? " active" : "")}
                onClick={() => irATab(g.tabs[0].key, g.key)}
              >
                {g.label}
              </button>
            );
          }
          const abierto = openGroup === g.key;
          return (
            <div key={g.key} className="sidebar-group">
              <button
                className={"sidebar-group-header" + (grupoActivo ? " active" : "")}
                onClick={() => setOpenGroup(abierto ? null : g.key)}
              >
                {g.label}
                {abierto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              {abierto && (
                <div className="sidebar-subtabs">
                  {g.tabs.map((t) => (
                    <button
                      key={t.key}
                      className={"sidebar-tab" + (tab === t.key ? " active" : "")}
                      onClick={() => irATab(t.key, g.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </>
  );
}

// Panel para el rol "administrativo" (ej. la persona que atiende leads,
// registra alumnos y cobra el día a día, sin manejar decisiones
// financieras). Reutiliza los mismos componentes que PanelAdmin (CRM,
// Alumnos, Registrar pago) pero con menos pestañas — y lo que no le toca
// (gastos, cobro mensual, corregir saldo, margen, editar/anular pagos,
// eliminar alumnos) está bloqueado también a nivel de base de datos
// (ver supabase-schema.sql), no solo escondido aquí en la pantalla.
function PanelAdministrativo({ perfil, onLogout }) {
  const [loading, setLoading] = useState(true);
  const [alumnos, setAlumnos] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [leads, setLeads] = useState([]);
  const [cargos, setCargos] = useState([]);
  const [asistencias, setAsistencias] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [inventario, setInventario] = useState([]);
  const [inventarioModal, setInventarioModal] = useState(null); // null | {} (nuevo) | artículo (editar)
  const [tab, setTab] = useState("crm");
  const [openGroup, setOpenGroup] = useState("crm"); // grupo de la barra lateral abierto
  const [toast, setToast] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [marcandoIds, setMarcandoIds] = useState(() => new Set());
  const [mesCobroSeleccionado, setMesCobroSeleccionado] = useState(monthKeyOf(todayISO()));
  const [confirmCargo, setConfirmCargo] = useState(false);
  const [eventoModal, setEventoModal] = useState(null); // null | {} (nuevo) | evento (editar)
  const [convocatoriaModal, setConvocatoriaModal] = useState(null);
  const [filtroTipoEvento, setFiltroTipoEvento] = useState("");
  const [filtroCategoriaEvento, setFiltroCategoriaEvento] = useState("");
  const [campeonatos, setCampeonatos] = useState([]);
  const [campeonatoModal, setCampeonatoModal] = useState(null); // null | {} (nuevo) | campeonato (editar)

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

  const [alumnoModal, setAlumnoModal] = useState(null); // null | {} (nuevo) | alumno (editar)
  const [pagoForm, setPagoForm] = useState({
    alumnoId: "",
    monto: "",
    metodo: "Efectivo",
    fecha: todayISO(),
    nota: "",
  });
  const [leadModal, setLeadModal] = useState(null);
  const [confirmConvertirLead, setConfirmConvertirLead] = useState(null);
  const [confirmDeleteLead, setConfirmDeleteLead] = useState(null);

  async function cargarDatos({ silent } = {}) {
    const [a, p, l, c, s, ev, cp, ci, inv] = await Promise.all([
      supabase.from("alumnos").select("*").order("nombre"),
      supabase.from("pagos").select("*").order("created_at", { ascending: false }),
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase.from("cargos").select("*").order("created_at", { ascending: false }),
      supabase.from("asistencias").select("*").order("fecha", { ascending: false }),
      supabase.from("eventos").select("*").order("fecha", { ascending: true }),
      supabase.from("campeonatos").select("*").order("fecha", { ascending: false }),
      supabase.from("campeonato_inscripciones").select("*"),
      supabase.from("inventario").select("*").order("nombre"),
    ]);
    setAlumnos((a.data || []).map(alumnoFromDb));
    setPagos((p.data || []).map(pagoFromDb));
    setLeads((l.data || []).map(leadFromDb));
    setCargos((c.data || []).map(cargoFromDb));
    setAsistencias((s.data || []).map(asistenciaFromDb));
    setEventos((ev.data || []).map(eventoFromDb));
    setCampeonatos(juntarCampeonatosConInscripciones(cp.data || [], ci.data || []));
    setInventario((inv.data || []).map(inventarioFromDb));
    if (!silent && !a.error && !p.error && !l.error) {
      showToast(`Datos actualizados: ${(a.data || []).length} alumnos, ${(l.data || []).length} leads.`);
    }
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await cargarDatos({ silent: true });
      setLoading(false);
    })();
    const canal = supabase
      .channel("atletic-cambios-administrativo")
      .on("postgres_changes", { event: "*", schema: "public", table: "alumnos" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "campeonatos" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "campeonato_inscripciones" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "pagos" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "cargos" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "asistencias" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "eventos" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "inventario" }, () => cargarDatos({ silent: true }))
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentMonthKey = monthKeyOf(todayISO());
  const alumnosActivos = alumnos.filter((a) => a.activo !== false);
  // Los alumnos "solo campeonato" no entrenan ni pagan mensualidad, así que
  // quedan fuera del cobro mensual, la cartera y el margen — todo lo que
  // depende de la tarifa mensual recurrente.
  const alumnosMensuales = alumnosActivos.filter((a) => !a.soloCampeonato);
  const becadosActivosCount = alumnosMensuales.filter((a) => a.becado).length;
  const pendientesGenerar = alumnosMensuales.filter(
    (a) => !a.becado && a.ultimoMesCobrado !== mesCobroSeleccionado
  );
  const mesesCobroDisponibles = (() => {
    const [anioActual, mesActual] = monthKeyOf(todayISO()).split("-").map(Number);
    const meses = [];
    for (let m = mesActual; m <= 12; m++) {
      meses.push(`${anioActual}-${String(m).padStart(2, "0")}`);
    }
    return meses;
  })();
  const alumnosFiltrados = alumnos.filter((a) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return (
      a.nombre.toLowerCase().includes(q) ||
      (a.encargado || "").toLowerCase().includes(q) ||
      (a.categoria || "").toLowerCase().includes(q)
    );
  });

  const leadsDelMes = leads.filter((l) => monthKeyOf((l.createdAt || "").slice(0, 10)) === currentMonthKey);
  const tasaConversionLeads =
    leadsDelMes.length === 0
      ? 0
      : Math.round((leadsDelMes.filter((l) => l.estado === "inscrito").length / leadsDelMes.length) * 100);
  const leadsSinSeguimiento = leads.filter((l) => l.estado === "nuevo" && (diasDesde(l.createdAt) || 0) > 3);

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

  function noAutorizado() {
    showToast("No tienes permiso para eso. Pídele a un administrador.", true);
  }

  async function guardarInventario(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      const payload = inventarioToDb(data);
      const { error } = esNuevo
        ? await supabase.from("inventario").insert([payload])
        : await supabase.from("inventario").update(payload).eq("id", data.id);
      if (error) {
        showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
        return;
      }
      await cargarDatos({ silent: true });
      setInventarioModal(null);
      showToast(esNuevo ? "Artículo agregado." : "Cambios guardados.");
    } finally {
      terminarEnvio();
    }
  }

  async function guardarCampeonato(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      const payload = campeonatoToDb(data);
      const { error } = esNuevo
        ? await supabase.from("campeonatos").insert([payload])
        : await supabase.from("campeonatos").update(payload).eq("id", data.id);
      if (error) {
        showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
        return;
      }
      await cargarDatos({ silent: true });
      setCampeonatoModal(null);
      showToast(esNuevo ? "Campeonato creado." : "Cambios guardados.");
    } finally {
      terminarEnvio();
    }
  }

  async function inscribirAlumnoCampeonato(campeonatoId, alumnoId, montoCuota) {
    const { error } = await supabase
      .from("campeonato_inscripciones")
      .insert([{ campeonato_id: campeonatoId, alumno_id: alumnoId, monto_cuota: montoCuota }]);
    if (error) {
      showToast("No se pudo inscribir al alumno (revisa tu conexión). Inténtalo de nuevo.", true);
      return;
    }
    await cargarDatos({ silent: true });
    showToast("Alumno inscrito.");
  }

  async function actualizarInscripcionCampeonato(inscripcion, cambios) {
    const payload = {};
    if ("montoCuota" in cambios) payload.monto_cuota = cambios.montoCuota;
    if ("pagado" in cambios) payload.pagado = cambios.pagado;
    if ("fechaPago" in cambios) payload.fecha_pago = cambios.fechaPago;
    const { error } = await supabase.from("campeonato_inscripciones").update(payload).eq("id", inscripcion.id);
    if (error) {
      showToast("No se pudo guardar el cambio (revisa tu conexión). Inténtalo de nuevo.", true);
      return;
    }
    await cargarDatos({ silent: true });
  }

  async function eliminarInscripcionCampeonato(inscripcion) {
    const { error } = await supabase.from("campeonato_inscripciones").delete().eq("id", inscripcion.id);
    if (error) {
      showToast("No se pudo quitar la inscripción (revisa tu conexión). Inténtalo de nuevo.", true);
      return;
    }
    await cargarDatos({ silent: true });
    showToast("Inscripción eliminada.");
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
        await cargarDatos({ silent: true });
        setPagoForm({ alumnoId: "", monto: "", metodo: "Efectivo", fecha: todayISO(), nota: "" });
        showToast("Pago registrado.");
      } else {
        showToast("No se pudo guardar el pago (revisa tu conexión). No se perdió lo que escribiste — dale clic de nuevo.", true);
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
      const { error } = await supabase.rpc("generar_cobro_mensual", {
        p_mes: mesCobroSeleccionado,
        p_alumno_ids: afectados.map((a) => a.id),
      });
      setConfirmCargo(false);
      if (!error) {
        await cargarDatos({ silent: true });
        showToast(`Cobro de ${monthLabel(mesCobroSeleccionado)} generado para ${afectados.length} alumno(s).`);
      } else {
        showToast("No se pudo generar el cobro (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

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

  async function guardarEvento(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      let error;
      if (data.id) {
        const payload = eventoToDb(data);
        ({ error } = await supabase.from("eventos").update(payload).eq("id", data.id));
      } else if (data.repetir && data.frecuencia !== "ninguna" && data.hasta) {
        // Evento con repetición: se generan varias filas (una por fecha),
        // todas compartiendo un serie_id para poder identificarlas como
        // parte de la misma serie más adelante.
        const fechas = fechasRecurrencia(data.fecha, data.frecuencia, data.hasta);
        const serieId = crypto.randomUUID ? crypto.randomUUID() : uid();
        const filas = fechas.map((fecha) => ({ ...eventoToDb(data), fecha, serie_id: serieId }));
        ({ error } = await supabase.from("eventos").insert(filas));
      } else {
        ({ error } = await supabase.from("eventos").insert(eventoToDb(data)));
      }
      if (!error) {
        await cargarDatos({ silent: true });
        setEventoModal(null);
        showToast(esNuevo ? "Evento agregado." : "Evento actualizado.");
      } else {
        showToast("No se pudo guardar el evento (revisa tu conexión). Vuelve a intentarlo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  async function cambiarEstadoLead(leadId, estado) {
    const { error } = await supabase.from("leads").update({ estado }).eq("id", leadId);
    if (!error) {
      await cargarDatos({ silent: true });
    } else {
      showToast("No se pudo mover el lead (revisa tu conexión). Inténtalo de nuevo.", true);
    }
  }

  async function guardarNotasLead(leadId, notas) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("leads").update({ notas_internas: notas || null }).eq("id", leadId);
      if (!error) {
        await cargarDatos({ silent: true });
        showToast("Notas guardadas.");
      } else {
        showToast("No se pudieron guardar las notas (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarLead(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("leads").delete().eq("id", id);
      setConfirmDeleteLead(null);
      if (!error) {
        setLeads((prev) => prev.filter((l) => l.id !== id));
        setLeadModal(null);
        showToast("Contacto eliminado del CRM.");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  async function actualizarUniformeEntregado(alumnoId, entregado) {
    const { error } = await supabase.from("alumnos").update({ uniforme_entregado: entregado }).eq("id", alumnoId);
    if (!error) {
      setAlumnos((prev) => prev.map((a) => (a.id === alumnoId ? { ...a, uniformeEntregado: entregado } : a)));
    } else {
      showToast("No se pudo actualizar (revisa tu conexión). Inténtalo de nuevo.", true);
    }
  }

  async function convertirLead(lead, { categoria, horario, tarifaMensual }) {
    if (!iniciarEnvio()) return false;
    try {
      const { error } = await supabase.rpc("convertir_lead_a_alumno", {
        p_lead_id: lead.id,
        p_tarifa_mensual: tarifaMensual,
        p_categoria: categoria,
        p_horario: horario,
      });
      if (!error) {
        await cargarDatos({ silent: true });
        showToast(`${lead.nombreAlumno} se agregó como alumno.`);
        return true;
      } else {
        showToast("No se pudo convertir el lead (revisa tu conexión). Inténtalo de nuevo.", true);
        return false;
      }
    } finally {
      terminarEnvio();
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
            <div className="brand-sub">Administrativo</div>
          </div>
        </div>
        <button className="reload-btn" onClick={onLogout} title="Cerrar sesión">
          <LogOut size={14} />
          {perfil?.nombre ? perfil.nombre : "Salir"}
        </button>
      </header>

      <div className="app-shell">
        <SidebarNav
          grupos={GRUPOS_NAV_ADMINISTRATIVO}
          tab={tab}
          setTab={setTab}
          openGroup={openGroup}
          setOpenGroup={setOpenGroup}
        />
        <main className="content">
        {loading ? (
          <div className="empty">Cargando información…</div>
        ) : (
          <>
            {tab === "crm" && (
              <CrmView
                leads={leads}
                leadsDelMesCount={leadsDelMes.length}
                tasaConversionLeads={tasaConversionLeads}
                leadsSinSeguimientoCount={leadsSinSeguimiento.length}
                monthLabelStr={monthLabel(currentMonthKey)}
                onCambiarEstado={cambiarEstadoLead}
                onAbrirLead={(l) => setLeadModal(l)}
              />
            )}

            {tab === "alumnos" && (
              <AlumnosView
                alumnos={alumnosFiltrados}
                busqueda={busqueda}
                setBusqueda={setBusqueda}
                onNuevo={() => setAlumnoModal({})}
                onEditar={(a) => setAlumnoModal(a)}
                onEliminar={noAutorizado}
                onEliminarVarios={noAutorizado}
                onCorregirSaldo={noAutorizado}
              />
            )}

            {tab === "pago" && (
              <PagoView
                alumnosActivos={alumnosMensuales}
                pagoForm={pagoForm}
                setPagoForm={setPagoForm}
                onSubmit={registrarPago}
                pagosRecientes={pagos.slice(0, 10)}
                alumnoNombre={alumnoNombre}
                onAnular={noAutorizado}
                onEditar={noAutorizado}
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

            {tab === "cartera" && <CarteraView alumnosActivos={alumnosMensuales} />}

            {tab === "campeonatos" && (
              <CampeonatosView
                campeonatos={campeonatos}
                alumnos={alumnos}
                puedeEliminar={false}
                onNuevo={() => setCampeonatoModal({})}
                onEditar={(c) => setCampeonatoModal(c)}
                onEliminar={noAutorizado}
                onInscribir={inscribirAlumnoCampeonato}
                onActualizarInscripcion={actualizarInscripcionCampeonato}
                onEliminarInscripcion={eliminarInscripcionCampeonato}
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

            {tab === "uniformes" && (
              <UniformesView alumnosActivos={alumnosActivos} onMarcarEntregado={actualizarUniformeEntregado} />
            )}

            {tab === "inventario" && (
              <InventarioView
                inventario={inventario}
                puedeEliminar={false}
                onNuevo={() => setInventarioModal({})}
                onEditar={(i) => setInventarioModal(i)}
                onEliminar={noAutorizado}
              />
            )}

            {tab === "calendario" && (
              <CalendarioView
                eventos={eventos}
                alumnos={alumnos}
                onNuevo={(fecha) => setEventoModal(fecha ? { fecha } : {})}
                onEditar={(e) => setEventoModal(e)}
                onConvocatoria={(e) => setConvocatoriaModal(e)}
                filtroTipo={filtroTipoEvento}
                setFiltroTipo={setFiltroTipoEvento}
                filtroCategoria={filtroCategoriaEvento}
                setFiltroCategoria={setFiltroCategoriaEvento}
              />
            )}

            {tab === "reporte" && (
              <ReporteSemanalView leads={leads} alumnos={alumnos} pagos={pagos} asistencias={asistencias} eventos={eventos} />
            )}
          </>
        )}
        </main>
      </div>

      {eventoModal !== null && (
        <EventoModal
          initial={eventoModal}
          alumnos={alumnos}
          onSave={guardarEvento}
          onCancel={() => setEventoModal(null)}
          enviando={enviando}
        />
      )}

      {convocatoriaModal && (
        <ConvocatoriaModal evento={convocatoriaModal} alumnos={alumnos} onCerrar={() => setConvocatoriaModal(null)} />
      )}

      {campeonatoModal !== null && (
        <CampeonatoModal
          initial={campeonatoModal}
          onSave={guardarCampeonato}
          onCancel={() => setCampeonatoModal(null)}
          enviando={enviando}
        />
      )}

      {inventarioModal !== null && (
        <InventarioModal
          initial={inventarioModal}
          onSave={guardarInventario}
          onCancel={() => setInventarioModal(null)}
          enviando={enviando}
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

      {alumnoModal !== null && (
        <AlumnoModal
          initial={alumnoModal}
          onSave={guardarAlumno}
          onCancel={() => setAlumnoModal(null)}
          enviando={enviando}
          showToast={showToast}
        />
      )}

      {leadModal && (
        <LeadDetalleModal
          lead={leadModal}
          onCerrar={() => setLeadModal(null)}
          onGuardarNotas={guardarNotasLead}
          onConvertir={() => setConfirmConvertirLead(leadModal)}
          onEliminar={() => setConfirmDeleteLead(leadModal)}
          enviando={enviando}
        />
      )}

      {confirmConvertirLead && (
        <ConvertirLeadModal
          lead={confirmConvertirLead}
          onConfirmar={async (datos) => {
            const ok = await convertirLead(confirmConvertirLead, datos);
            if (ok) {
              setConfirmConvertirLead(null);
              setLeadModal(null);
            }
          }}
          onCancelar={() => setConfirmConvertirLead(null)}
          enviando={enviando}
        />
      )}

      {confirmDeleteLead && (
        <ConfirmDialog
          title={`¿Eliminar a "${confirmDeleteLead.nombreAlumno || "este contacto"}"?`}
          body="Se borrará este contacto del CRM (junto con sus notas y archivos) y no podrá deshacerse."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarLead(confirmDeleteLead.id)}
          onCancel={() => setConfirmDeleteLead(null)}
          disabled={enviando}
        />
      )}

      {toast && <div className={"toast" + (toast.isError ? " toast-error" : "")}>{toast.msg}</div>}
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
  const [leads, setLeads] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [staff, setStaff] = useState([]);
  const [ejercicios, setEjercicios] = useState([]);
  const [sesiones, setSesiones] = useState([]);
  const [resultados, setResultados] = useState([]);
  const [tab, setTab] = useState("resumen");
  const [openGroup, setOpenGroup] = useState("resumen"); // grupo de la barra lateral abierto
  const [toast, setToast] = useState(null);
  const [eventoModal, setEventoModal] = useState(null); // null | {} (nuevo) | evento (editar)
  const [convocatoriaModal, setConvocatoriaModal] = useState(null);
  const [confirmDeleteEvento, setConfirmDeleteEvento] = useState(null);
  const [confirmDeleteSerieEvento, setConfirmDeleteSerieEvento] = useState(null);
  const [filtroTipoEvento, setFiltroTipoEvento] = useState("");
  const [filtroCategoriaEvento, setFiltroCategoriaEvento] = useState("");
  const [staffModal, setStaffModal] = useState(null); // null | {} (nuevo) | staff (editar)
  const [confirmDeleteStaff, setConfirmDeleteStaff] = useState(null);
  const [ejercicioModal, setEjercicioModal] = useState(null);
  const [confirmDeleteEjercicio, setConfirmDeleteEjercicio] = useState(null);
  const [sesionModal, setSesionModal] = useState(null);
  const [confirmDeleteSesion, setConfirmDeleteSesion] = useState(null);
  const [resultadoModal, setResultadoModal] = useState(null); // { evento, resultado } | null
  const [confirmDeleteResultado, setConfirmDeleteResultado] = useState(null);
  const [campeonatos, setCampeonatos] = useState([]);
  const [campeonatoModal, setCampeonatoModal] = useState(null); // null | {} (nuevo) | campeonato (editar)
  const [confirmDeleteCampeonato, setConfirmDeleteCampeonato] = useState(null);
  const [inventario, setInventario] = useState([]);
  const [inventarioModal, setInventarioModal] = useState(null); // null | {} (nuevo) | artículo (editar)
  const [confirmDeleteInventario, setConfirmDeleteInventario] = useState(null);
  const [evaluaciones, setEvaluaciones] = useState([]);
  const [evaluacionModal, setEvaluacionModal] = useState(null); // null | {} (nueva) | evaluación (editar)
  const [confirmDeleteEvaluacion, setConfirmDeleteEvaluacion] = useState(null);

  // Cambia de tab abriendo también el grupo de la barra lateral al que
  // pertenece — para los accesos directos (ej. botones del Resumen) que no
  // pasan por SidebarNav.
  function irTab(tabKey) {
    setTab(tabKey);
    const g = grupoDeTab(GRUPOS_NAV_ADMIN, tabKey);
    if (g) setOpenGroup(g);
  }

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
    const [a, p, c, g, j, s, l, ev, st, ej, se, sej, rp, pg, pt, cp, ci, inv, eva] = await Promise.all([
      supabase.from("alumnos").select("*").order("nombre"),
      supabase.from("pagos").select("*").order("created_at", { ascending: false }),
      supabase.from("cargos").select("*").order("created_at", { ascending: false }),
      supabase.from("gastos").select("*").order("created_at", { ascending: false }),
      supabase.from("ajustes").select("*").order("created_at", { ascending: false }),
      supabase.from("asistencias").select("*").order("fecha", { ascending: false }),
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase.from("eventos").select("*").order("fecha", { ascending: true }),
      supabase.from("perfiles").select("*").order("nombre"),
      supabase.from("ejercicios").select("*").order("nombre"),
      supabase.from("sesiones").select("*").order("fecha", { ascending: false }),
      supabase.from("sesion_ejercicios").select("*"),
      supabase.from("resultados_partido").select("*"),
      supabase.from("partido_goles").select("*"),
      supabase.from("partido_tarjetas").select("*"),
      supabase.from("campeonatos").select("*").order("fecha", { ascending: false }),
      supabase.from("campeonato_inscripciones").select("*"),
      supabase.from("inventario").select("*").order("nombre"),
      supabase.from("evaluaciones").select("*").order("fecha", { ascending: false }),
    ]);
    setAlumnos((a.data || []).map(alumnoFromDb));
    setPagos((p.data || []).map(pagoFromDb));
    setCargos((c.data || []).map(cargoFromDb));
    setGastos((g.data || []).map(gastoFromDb));
    setAjustes((j.data || []).map(ajusteFromDb));
    setAsistencias((s.data || []).map(asistenciaFromDb));
    setLeads((l.data || []).map(leadFromDb));
    setEventos((ev.data || []).map(eventoFromDb));
    setStaff((st.data || []).map(perfilStaffFromDb));
    setEjercicios((ej.data || []).map(ejercicioFromDb));
    setSesiones(juntarSesionesConEjercicios(se.data || [], sej.data || []));
    setResultados(juntarResultadosConDetalle(rp.data || [], pg.data || [], pt.data || []));
    setCampeonatos(juntarCampeonatosConInscripciones(cp.data || [], ci.data || []));
    setInventario((inv.data || []).map(inventarioFromDb));
    setEvaluaciones((eva.data || []).map(evaluacionFromDb));

    const algunFallo = [a, p, c, g, j, s, l, ev, st, ej, se, sej, rp, pg, pt, cp, ci, inv, eva].some((r) => r.error);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "eventos" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "perfiles" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "ejercicios" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "sesiones" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "sesion_ejercicios" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "resultados_partido" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "partido_goles" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "partido_tarjetas" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "campeonatos" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "campeonato_inscripciones" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "inventario" }, () => cargarDatos({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "evaluaciones" }, () => cargarDatos({ silent: true }))
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
  // Los alumnos "solo campeonato" no entrenan ni pagan mensualidad, así que
  // quedan fuera del cobro mensual, la cartera y el margen — todo lo que
  // depende de la tarifa mensual recurrente.
  const alumnosMensuales = alumnosActivos.filter((a) => !a.soloCampeonato);
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
    () => alumnosMensuales.reduce((s, a) => s + Math.max(0, Number(a.saldoPendiente || 0)), 0),
    [alumnosMensuales]
  );

  const pagosHoy = pagos.filter((p) => p.fecha === todayISO()).length;

  // Los becados nunca entran al cobro mensual: no se les suma tarifa.
  const becadosActivosCount = alumnosMensuales.filter((a) => a.becado).length;
  const pendientesGenerar = alumnosMensuales.filter(
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

  async function guardarEvento(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      let error;
      if (data.id) {
        const payload = eventoToDb(data);
        ({ error } = await supabase.from("eventos").update(payload).eq("id", data.id));
      } else if (data.repetir && data.frecuencia !== "ninguna" && data.hasta) {
        // Evento con repetición: se generan varias filas (una por fecha),
        // todas compartiendo un serie_id para poder identificarlas como
        // parte de la misma serie más adelante.
        const fechas = fechasRecurrencia(data.fecha, data.frecuencia, data.hasta);
        const serieId = crypto.randomUUID ? crypto.randomUUID() : uid();
        const filas = fechas.map((fecha) => ({ ...eventoToDb(data), fecha, serie_id: serieId }));
        ({ error } = await supabase.from("eventos").insert(filas));
      } else {
        ({ error } = await supabase.from("eventos").insert(eventoToDb(data)));
      }
      if (!error) {
        await cargarDatos({ silent: true });
        setEventoModal(null);
        showToast(esNuevo ? "Evento agregado." : "Evento actualizado.");
      } else {
        showToast("No se pudo guardar el evento (revisa tu conexión). Vuelve a intentarlo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarEvento(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("eventos").delete().eq("id", id);
      setConfirmDeleteEvento(null);
      if (!error) {
        setEventos((prev) => prev.filter((e) => e.id !== id));
        showToast("Evento eliminado.");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Sigue en tu calendario — inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarSerieEvento(serieId) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("eventos").delete().eq("serie_id", serieId);
      setConfirmDeleteSerieEvento(null);
      if (!error) {
        setEventos((prev) => prev.filter((e) => e.serieId !== serieId));
        showToast("Serie de eventos eliminada.");
      } else {
        showToast("No se pudo eliminar la serie (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  // Guarda un miembro del staff: si trae id, actualiza su perfil existente
  // (rol, categorías, contacto); si no trae id, crea uno NUEVO — pero eso
  // solo funciona si esa persona YA tiene un login creado en Supabase
  // (Authentication → Users) y el id pegado corresponde a esa cuenta; si
  // no existe, la base de datos rechaza la inserción (llave foránea).
  async function guardarStaff(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      const payload = perfilStaffToDb(data);
      if (esNuevo) {
        if (!data.id_nuevo || !data.id_nuevo.trim()) {
          showToast("Pega el ID del usuario (de Supabase → Authentication → Users).", true);
          return;
        }
        const { error } = await supabase.from("perfiles").insert([{ id: data.id_nuevo.trim(), ...payload }]);
        if (error) {
          showToast(
            error.message && error.message.includes("foreign key")
              ? "Ese ID no corresponde a ningún usuario creado en Supabase. Créalo primero en Authentication → Users."
              : "No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.",
            true
          );
          return;
        }
      } else {
        const { error } = await supabase.from("perfiles").update(payload).eq("id", data.id);
        if (error) {
          showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
          return;
        }
      }
      await cargarDatos({ silent: true });
      setStaffModal(null);
      showToast(esNuevo ? "Colaborador agregado." : "Cambios guardados.");
    } finally {
      terminarEnvio();
    }
  }

  async function toggleActivoStaff(p) {
    const { error } = await supabase.from("perfiles").update({ activo: !p.activo }).eq("id", p.id);
    if (!error) {
      setStaff((prev) => prev.map((x) => (x.id === p.id ? { ...x, activo: !p.activo } : x)));
      showToast(!p.activo ? "Cuenta activada." : "Cuenta desactivada.");
    } else {
      showToast("No se pudo actualizar (revisa tu conexión). Inténtalo de nuevo.", true);
    }
  }

  async function eliminarStaff(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("perfiles").delete().eq("id", id);
      setConfirmDeleteStaff(null);
      if (!error) {
        setStaff((prev) => prev.filter((x) => x.id !== id));
        showToast("Perfil de staff eliminado (su login en Supabase no se borró).");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  // Guarda un ejercicio de la biblioteca: si trae id, lo actualiza; si no,
  // lo crea a tu nombre (creado_por = tu propio id).
  async function guardarEjercicio(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      const payload = ejercicioToDb(data);
      const { error } = esNuevo
        ? await supabase.from("ejercicios").insert([{ ...payload, creado_por: perfil.id }])
        : await supabase.from("ejercicios").update(payload).eq("id", data.id);
      if (error) {
        showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
        return;
      }
      await cargarDatos({ silent: true });
      setEjercicioModal(null);
      showToast(esNuevo ? "Ejercicio agregado." : "Cambios guardados.");
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarEjercicio(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("ejercicios").delete().eq("id", id);
      setConfirmDeleteEjercicio(null);
      if (!error) {
        setEjercicios((prev) => prev.filter((e) => e.id !== id));
        showToast("Ejercicio eliminado.");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  // Guarda una sesión completa: la fila de "sesiones" (a nombre del
  // entrenador elegido en el formulario) y reemplaza todos sus ejercicios
  // por la lista actual.
  async function guardarSesion(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      const payload = sesionToDb(data);
      let sesionId = data.id;
      if (esNuevo) {
        if (!data.entrenadorId) {
          showToast("Elige a qué entrenador corresponde esta sesión.", true);
          return;
        }
        const { data: fila, error } = await supabase
          .from("sesiones")
          .insert([{ ...payload, entrenador_id: data.entrenadorId }])
          .select()
          .single();
        if (error || !fila) {
          showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
          return;
        }
        sesionId = fila.id;
      } else {
        const { error } = await supabase.from("sesiones").update(payload).eq("id", sesionId);
        if (error) {
          showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
          return;
        }
        await supabase.from("sesion_ejercicios").delete().eq("sesion_id", sesionId);
      }
      if (data.ejercicios.length) {
        const filas = data.ejercicios.map((ej, i) => ({
          sesion_id: sesionId,
          ejercicio_id: ej.ejercicioId || null,
          nombre: ej.nombre,
          duracion_min: ej.duracionMin === "" || ej.duracionMin == null ? null : Number(ej.duracionMin),
          notas: ej.notas || null,
          orden: i,
        }));
        const { error: errEj } = await supabase.from("sesion_ejercicios").insert(filas);
        if (errEj) {
          showToast("La sesión se guardó, pero no se pudieron guardar sus ejercicios. Vuelve a intentarlo.", true);
          return;
        }
      }
      await cargarDatos({ silent: true });
      setSesionModal(null);
      showToast(esNuevo ? "Sesión creada." : "Cambios guardados.");
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarSesion(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("sesiones").delete().eq("id", id);
      setConfirmDeleteSesion(null);
      if (!error) {
        setSesiones((prev) => prev.filter((s) => s.id !== id));
        showToast("Sesión eliminada.");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  // Guarda el resultado de un partido (a tu propio nombre, como "quién lo
  // registró") y, aparte, reemplaza TODOS sus goles y tarjetas por la lista
  // actual del formulario.
  async function guardarResultado(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      const payload = resultadoPartidoToDb(data);
      let resultadoId = data.id;
      if (esNuevo) {
        const { data: fila, error } = await supabase
          .from("resultados_partido")
          .insert([{ ...payload, entrenador_id: perfil.id }])
          .select()
          .single();
        if (error || !fila) {
          showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
          return;
        }
        resultadoId = fila.id;
      } else {
        const { error } = await supabase.from("resultados_partido").update(payload).eq("id", resultadoId);
        if (error) {
          showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
          return;
        }
        await supabase.from("partido_goles").delete().eq("resultado_id", resultadoId);
        await supabase.from("partido_tarjetas").delete().eq("resultado_id", resultadoId);
      }
      if (data.goles.length) {
        const filas = data.goles.map((g) => ({
          resultado_id: resultadoId,
          alumno_id: g.alumnoId || null,
          alumno_nombre: g.alumnoNombre,
          asistencia_alumno_id: g.asistenciaAlumnoId || null,
          asistencia_nombre: g.asistenciaNombre || null,
          minuto: g.minuto === "" || g.minuto == null ? null : Number(g.minuto),
        }));
        const { error: errGoles } = await supabase.from("partido_goles").insert(filas);
        if (errGoles) {
          showToast("El resultado se guardó, pero no se pudieron guardar los goles. Vuelve a intentarlo.", true);
          return;
        }
      }
      if (data.tarjetas.length) {
        const filas = data.tarjetas.map((t) => ({
          resultado_id: resultadoId,
          alumno_id: t.alumnoId || null,
          alumno_nombre: t.alumnoNombre,
          tipo: t.tipo,
          minuto: t.minuto === "" || t.minuto == null ? null : Number(t.minuto),
        }));
        const { error: errTarjetas } = await supabase.from("partido_tarjetas").insert(filas);
        if (errTarjetas) {
          showToast("El resultado se guardó, pero no se pudieron guardar las tarjetas. Vuelve a intentarlo.", true);
          return;
        }
      }
      await cargarDatos({ silent: true });
      setResultadoModal(null);
      showToast(esNuevo ? "Resultado registrado." : "Cambios guardados.");
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarResultado(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("resultados_partido").delete().eq("id", id);
      setConfirmDeleteResultado(null);
      if (!error) {
        setResultados((prev) => prev.filter((r) => r.id !== id));
        showToast("Resultado eliminado.");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  // Guarda una evaluación deportiva a nombre de este admin (entrenador_id =
  // perfil.id, igual que en resultados de partidos, para llevar registro de
  // quién la hizo). Al editar una ya existente de otro entrenador, se
  // conserva su entrenador_id original (no se toca en el payload).
  async function guardarEvaluacion(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      const payload = evaluacionToDb(data);
      const { error } = esNuevo
        ? await supabase.from("evaluaciones").insert([{ ...payload, entrenador_id: perfil.id }])
        : await supabase.from("evaluaciones").update(payload).eq("id", data.id);
      if (error) {
        showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
        return;
      }
      await cargarDatos({ silent: true });
      setEvaluacionModal(null);
      showToast(esNuevo ? "Evaluación registrada." : "Cambios guardados.");
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarEvaluacion(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("evaluaciones").delete().eq("id", id);
      setConfirmDeleteEvaluacion(null);
      if (!error) {
        setEvaluaciones((prev) => prev.filter((e) => e.id !== id));
        showToast("Evaluación eliminada.");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  async function guardarCampeonato(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      const payload = campeonatoToDb(data);
      const { error } = esNuevo
        ? await supabase.from("campeonatos").insert([payload])
        : await supabase.from("campeonatos").update(payload).eq("id", data.id);
      if (error) {
        showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
        return;
      }
      await cargarDatos({ silent: true });
      setCampeonatoModal(null);
      showToast(esNuevo ? "Campeonato creado." : "Cambios guardados.");
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarCampeonato(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("campeonatos").delete().eq("id", id);
      setConfirmDeleteCampeonato(null);
      if (!error) {
        setCampeonatos((prev) => prev.filter((c) => c.id !== id));
        showToast("Campeonato eliminado.");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  async function guardarInventario(data) {
    if (!iniciarEnvio()) return;
    try {
      const esNuevo = !data.id;
      const payload = inventarioToDb(data);
      const { error } = esNuevo
        ? await supabase.from("inventario").insert([payload])
        : await supabase.from("inventario").update(payload).eq("id", data.id);
      if (error) {
        showToast("No se pudo guardar (revisa tu conexión). Inténtalo de nuevo.", true);
        return;
      }
      await cargarDatos({ silent: true });
      setInventarioModal(null);
      showToast(esNuevo ? "Artículo agregado." : "Cambios guardados.");
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarInventario(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("inventario").delete().eq("id", id);
      setConfirmDeleteInventario(null);
      if (!error) {
        setInventario((prev) => prev.filter((i) => i.id !== id));
        showToast("Artículo eliminado.");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  async function inscribirAlumnoCampeonato(campeonatoId, alumnoId, montoCuota) {
    const { error } = await supabase
      .from("campeonato_inscripciones")
      .insert([{ campeonato_id: campeonatoId, alumno_id: alumnoId, monto_cuota: montoCuota }]);
    if (error) {
      showToast("No se pudo inscribir al alumno (revisa tu conexión). Inténtalo de nuevo.", true);
      return;
    }
    await cargarDatos({ silent: true });
    showToast("Alumno inscrito.");
  }

  async function actualizarInscripcionCampeonato(inscripcion, cambios) {
    const payload = {};
    if ("montoCuota" in cambios) payload.monto_cuota = cambios.montoCuota;
    if ("pagado" in cambios) payload.pagado = cambios.pagado;
    if ("fechaPago" in cambios) payload.fecha_pago = cambios.fechaPago;
    const { error } = await supabase.from("campeonato_inscripciones").update(payload).eq("id", inscripcion.id);
    if (error) {
      showToast("No se pudo guardar el cambio (revisa tu conexión). Inténtalo de nuevo.", true);
      return;
    }
    await cargarDatos({ silent: true });
  }

  async function eliminarInscripcionCampeonato(inscripcion) {
    const { error } = await supabase.from("campeonato_inscripciones").delete().eq("id", inscripcion.id);
    if (error) {
      showToast("No se pudo quitar la inscripción (revisa tu conexión). Inténtalo de nuevo.", true);
      return;
    }
    await cargarDatos({ silent: true });
    showToast("Inscripción eliminada.");
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

  // Mueve un lead a otra etapa del pipeline (el <select> de la tarjeta).
  // Simple update directo a la tabla — está permitido por RLS solo para
  // admin (ver "solo admin leads" en supabase-schema.sql).
  async function cambiarEstadoLead(leadId, estado) {
    const { error } = await supabase.from("leads").update({ estado }).eq("id", leadId);
    if (!error) {
      await cargarDatos({ silent: true });
    } else {
      showToast("No se pudo mover el lead (revisa tu conexión). Inténtalo de nuevo.", true);
    }
  }

  // Guarda las notas internas del lead (privadas, solo las ve el staff).
  async function guardarNotasLead(leadId, notas) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("leads").update({ notas_internas: notas || null }).eq("id", leadId);
      if (!error) {
        await cargarDatos({ silent: true });
        showToast("Notas guardadas.");
      } else {
        showToast("No se pudieron guardar las notas (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  async function eliminarLead(id) {
    if (!iniciarEnvio()) return;
    try {
      const { error } = await supabase.from("leads").delete().eq("id", id);
      setConfirmDeleteLead(null);
      if (!error) {
        setLeads((prev) => prev.filter((l) => l.id !== id));
        setLeadModal(null);
        showToast("Contacto eliminado del CRM.");
      } else {
        showToast("No se pudo eliminar (revisa tu conexión). Inténtalo de nuevo.", true);
      }
    } finally {
      terminarEnvio();
    }
  }

  async function actualizarUniformeEntregado(alumnoId, entregado) {
    const { error } = await supabase.from("alumnos").update({ uniforme_entregado: entregado }).eq("id", alumnoId);
    if (!error) {
      setAlumnos((prev) => prev.map((a) => (a.id === alumnoId ? { ...a, uniformeEntregado: entregado } : a)));
    } else {
      showToast("No se pudo actualizar (revisa tu conexión). Inténtalo de nuevo.", true);
    }
  }

  // Convierte un lead en alumno: crea el alumno Y marca el lead como
  // inscrito en una sola operación en la base de datos (ver
  // convertir_lead_a_alumno en supabase-schema.sql), con la categoría,
  // horario y tarifa que el admin eligió en el paso de confirmación.
  async function convertirLead(lead, { categoria, horario, tarifaMensual }) {
    if (!iniciarEnvio()) return false;
    try {
      const { error } = await supabase.rpc("convertir_lead_a_alumno", {
        p_lead_id: lead.id,
        p_tarifa_mensual: tarifaMensual,
        p_categoria: categoria,
        p_horario: horario,
      });
      if (!error) {
        await cargarDatos({ silent: true });
        showToast(`${lead.nombreAlumno} se agregó como alumno.`);
      } else {
        showToast("No se pudo convertir el lead (revisa tu conexión). Inténtalo de nuevo.", true);
      }
      return !error;
    } finally {
      terminarEnvio();
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

  const conDeuda = alumnosMensuales
    .filter((a) => Number(a.saldoPendiente || 0) > 0)
    .sort((a, b) => Number(b.saldoPendiente || 0) - Number(a.saldoPendiente || 0))
    .slice(0, 8);

  // Alumnos activos no becados a los que todavía no se les generó el
  // cobro del mes en curso — mismo criterio que "pendientesGenerar" en
  // Cobro mensual, pero fijo al mes de hoy (sin importar qué mes tenga
  // seleccionado ahí), para avisar en el Resumen.
  const pendientesMesActual = useMemo(
    () =>
      alumnosMensuales
        .filter((a) => !a.becado && a.ultimoMesCobrado !== currentMonthKey)
        .sort((a, b) => Number(b.saldoPendiente || 0) - Number(a.saldoPendiente || 0)),
    [alumnosMensuales, currentMonthKey]
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

  // KPIs del CRM: leads del mes en curso, tasa de conversión de ese mismo
  // período, y cuántos siguen "nuevo" sin que nadie los haya contactado en
  // más de 3 días (para que no se enfríen).
  const leadsDelMes = useMemo(
    () => leads.filter((l) => monthKeyOf((l.createdAt || "").slice(0, 10)) === currentMonthKey),
    [leads, currentMonthKey]
  );
  const tasaConversionLeads = useMemo(() => {
    if (leadsDelMes.length === 0) return 0;
    const inscritos = leadsDelMes.filter((l) => l.estado === "inscrito").length;
    return Math.round((inscritos / leadsDelMes.length) * 100);
  }, [leadsDelMes]);
  const leadsSinSeguimiento = useMemo(
    () => leads.filter((l) => l.estado === "nuevo" && (diasDesde(l.createdAt) || 0) > 3),
    [leads]
  );

  const [leadModal, setLeadModal] = useState(null); // lead abierto en el detalle, o null
  const [confirmConvertirLead, setConfirmConvertirLead] = useState(null); // lead a convertir, o null
  const [confirmDeleteLead, setConfirmDeleteLead] = useState(null); // lead a eliminar, o null

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

      <div className="app-shell">
        <SidebarNav
          grupos={GRUPOS_NAV_ADMIN}
          tab={tab}
          setTab={setTab}
          openGroup={openGroup}
          setOpenGroup={setOpenGroup}
        />
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
                onIrAlumnos={() => irTab("alumnos")}
                presentesHoy={presentesHoy}
                asistenciasHoyCount={asistenciasHoy.length}
                onIrAsistencia={() => irTab("asistencia")}
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
                alumnosActivos={alumnosMensuales}
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

            {tab === "cartera" && <CarteraView alumnosActivos={alumnosMensuales} />}

            {tab === "asistencia" && (
              <AsistenciaView
                alumnosActivos={alumnosActivos}
                asistencias={asistencias}
                onMarcar={marcarAsistencia}
                marcandoIds={marcandoIds}
              />
            )}

            {tab === "uniformes" && (
              <UniformesView alumnosActivos={alumnosActivos} onMarcarEntregado={actualizarUniformeEntregado} />
            )}

            {tab === "inventario" && (
              <InventarioView
                inventario={inventario}
                puedeEliminar
                onNuevo={() => setInventarioModal({})}
                onEditar={(i) => setInventarioModal(i)}
                onEliminar={(i) => setConfirmDeleteInventario(i)}
              />
            )}

            {tab === "margen" && (
              <MargenView alumnosActivos={alumnosMensuales} totalGastosMes={totalGastosMes} monthLabelStr={monthLabel(currentMonthKey)} />
            )}

            {tab === "crm" && (
              <CrmView
                leads={leads}
                leadsDelMesCount={leadsDelMes.length}
                tasaConversionLeads={tasaConversionLeads}
                leadsSinSeguimientoCount={leadsSinSeguimiento.length}
                monthLabelStr={monthLabel(currentMonthKey)}
                onCambiarEstado={cambiarEstadoLead}
                onAbrirLead={(l) => setLeadModal(l)}
              />
            )}

            {tab === "calendario" && (
              <CalendarioView
                eventos={eventos}
                alumnos={alumnos}
                onNuevo={(fecha) => setEventoModal(fecha ? { fecha } : {})}
                onEditar={(e) => setEventoModal(e)}
                onEliminar={(e) => setConfirmDeleteEvento(e)}
                onEliminarSerie={(e) => setConfirmDeleteSerieEvento(e)}
                onConvocatoria={(e) => setConvocatoriaModal(e)}
                filtroTipo={filtroTipoEvento}
                setFiltroTipo={setFiltroTipoEvento}
                filtroCategoria={filtroCategoriaEvento}
                setFiltroCategoria={setFiltroCategoriaEvento}
              />
            )}

            {tab === "reporte" && (
              <ReporteSemanalView leads={leads} alumnos={alumnos} pagos={pagos} asistencias={asistencias} eventos={eventos} />
            )}

            {tab === "staff" && (
              <StaffView
                staff={staff}
                onNuevo={() => setStaffModal({})}
                onEditar={(p) => setStaffModal(p)}
                onToggleActivo={toggleActivoStaff}
                onEliminar={(p) => setConfirmDeleteStaff(p)}
              />
            )}

            {tab === "sesiones" && (
              <SesionesView
                sesiones={sesiones}
                staffNombre={(id) => (staff.find((p) => p.id === id) || {}).nombre}
                mostrarEntrenador
                onNuevo={() => setSesionModal({})}
                onEditar={(s) => setSesionModal(s)}
                onEliminar={(s) => setConfirmDeleteSesion(s)}
              />
            )}

            {tab === "biblioteca" && (
              <BibliotecaEjerciciosView
                ejercicios={ejercicios}
                miId={perfil.id}
                esAdmin
                onNuevo={() => setEjercicioModal({})}
                onEditar={(e) => setEjercicioModal(e)}
                onEliminar={(e) => setConfirmDeleteEjercicio(e)}
              />
            )}

            {tab === "resultados" && (
              <ResultadosPartidosView
                eventos={eventos}
                resultados={resultados}
                staffNombre={(id) => (staff.find((p) => p.id === id) || {}).nombre}
                mostrarEntrenador
                onRegistrar={(evento) => setResultadoModal({ evento, resultado: null })}
                onEditar={(evento, resultado) => setResultadoModal({ evento, resultado })}
                onEliminar={(r) => setConfirmDeleteResultado(r)}
              />
            )}

            {tab === "evaluaciones" && (
              <EvaluacionesView
                evaluaciones={evaluaciones}
                alumnos={alumnos}
                staffNombre={(id) => (staff.find((p) => p.id === id) || {}).nombre}
                mostrarEntrenador
                onNuevo={() => setEvaluacionModal({})}
                onEditar={(ev) => setEvaluacionModal(ev)}
                onEliminar={(ev) => setConfirmDeleteEvaluacion(ev)}
              />
            )}

            {tab === "campeonatos" && (
              <CampeonatosView
                campeonatos={campeonatos}
                alumnos={alumnos}
                puedeEliminar
                onNuevo={() => setCampeonatoModal({})}
                onEditar={(c) => setCampeonatoModal(c)}
                onEliminar={(c) => setConfirmDeleteCampeonato(c)}
                onInscribir={inscribirAlumnoCampeonato}
                onActualizarInscripcion={actualizarInscripcionCampeonato}
                onEliminarInscripcion={eliminarInscripcionCampeonato}
              />
            )}
          </>
        )}
        </main>
      </div>

      {eventoModal !== null && (
        <EventoModal
          initial={eventoModal}
          alumnos={alumnos}
          onSave={guardarEvento}
          onCancel={() => setEventoModal(null)}
          enviando={enviando}
        />
      )}

      {ejercicioModal !== null && (
        <EjercicioModal
          initial={ejercicioModal}
          onSave={guardarEjercicio}
          onCancel={() => setEjercicioModal(null)}
          enviando={enviando}
        />
      )}
      {confirmDeleteEjercicio && (
        <ConfirmDialog
          title={`¿Eliminar "${confirmDeleteEjercicio.nombre}"?`}
          body="Se borra de la biblioteca compartida. Las sesiones que ya lo usaban no se afectan (queda guardado en su propio plan)."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarEjercicio(confirmDeleteEjercicio.id)}
          onCancel={() => setConfirmDeleteEjercicio(null)}
          disabled={enviando}
        />
      )}
      {sesionModal !== null && (
        <SesionModal
          initial={sesionModal}
          categoriasDisponibles={CATEGORIAS}
          ejerciciosDisponibles={ejercicios}
          entrenadoresDisponibles={staff.filter((p) => p.rol === "entrenador" && p.activo)}
          onSave={guardarSesion}
          onCancel={() => setSesionModal(null)}
          enviando={enviando}
        />
      )}
      {confirmDeleteSesion && (
        <ConfirmDialog
          title={`¿Eliminar la sesión "${confirmDeleteSesion.titulo}"?`}
          body="No podrá deshacerse."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarSesion(confirmDeleteSesion.id)}
          onCancel={() => setConfirmDeleteSesion(null)}
          disabled={enviando}
        />
      )}

      {resultadoModal !== null && (
        <ResultadoModal
          evento={resultadoModal.evento}
          initial={resultadoModal.resultado}
          alumnosDisponibles={
            (resultadoModal.evento.categorias || []).length
              ? alumnos.filter((a) => resultadoModal.evento.categorias.includes(a.categoria))
              : alumnos
          }
          onSave={guardarResultado}
          onCancel={() => setResultadoModal(null)}
          enviando={enviando}
        />
      )}
      {confirmDeleteResultado && (
        <ConfirmDialog
          title="¿Eliminar este resultado?"
          body="Se borran también los goleadores y tarjetas registrados para este partido. No podrá deshacerse."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarResultado(confirmDeleteResultado.id)}
          onCancel={() => setConfirmDeleteResultado(null)}
          disabled={enviando}
        />
      )}

      {campeonatoModal !== null && (
        <CampeonatoModal
          initial={campeonatoModal}
          onSave={guardarCampeonato}
          onCancel={() => setCampeonatoModal(null)}
          enviando={enviando}
        />
      )}
      {confirmDeleteCampeonato && (
        <ConfirmDialog
          title={`¿Eliminar el campeonato "${confirmDeleteCampeonato.nombre}"?`}
          body="Se borran también todas sus inscripciones y el registro de cuotas pagadas/pendientes. No podrá deshacerse."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarCampeonato(confirmDeleteCampeonato.id)}
          onCancel={() => setConfirmDeleteCampeonato(null)}
          disabled={enviando}
        />
      )}

      {inventarioModal !== null && (
        <InventarioModal
          initial={inventarioModal}
          onSave={guardarInventario}
          onCancel={() => setInventarioModal(null)}
          enviando={enviando}
        />
      )}
      {confirmDeleteInventario && (
        <ConfirmDialog
          title={`¿Eliminar "${confirmDeleteInventario.nombre}"?`}
          body="No podrá deshacerse."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarInventario(confirmDeleteInventario.id)}
          onCancel={() => setConfirmDeleteInventario(null)}
          disabled={enviando}
        />
      )}

      {evaluacionModal !== null && (
        <EvaluacionModal
          initial={evaluacionModal}
          alumnosDisponibles={alumnos.filter((a) => a.activo)}
          onSave={guardarEvaluacion}
          onCancel={() => setEvaluacionModal(null)}
          enviando={enviando}
        />
      )}
      {confirmDeleteEvaluacion && (
        <ConfirmDialog
          title="¿Eliminar esta evaluación?"
          body="No podrá deshacerse."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarEvaluacion(confirmDeleteEvaluacion.id)}
          onCancel={() => setConfirmDeleteEvaluacion(null)}
          disabled={enviando}
        />
      )}

      {staffModal !== null && (
        <StaffModal
          initial={staffModal}
          onSave={guardarStaff}
          onCancel={() => setStaffModal(null)}
          enviando={enviando}
        />
      )}

      {confirmDeleteStaff && (
        <ConfirmDialog
          title={`¿Eliminar el perfil de "${confirmDeleteStaff.nombre || "este colaborador"}"?`}
          body="Pierde el acceso a la app de inmediato. Su login en Supabase no se borra — puedes volver a crearle un perfil después si hace falta."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarStaff(confirmDeleteStaff.id)}
          onCancel={() => setConfirmDeleteStaff(null)}
          disabled={enviando}
        />
      )}

      {convocatoriaModal && (
        <ConvocatoriaModal evento={convocatoriaModal} alumnos={alumnos} onCerrar={() => setConvocatoriaModal(null)} />
      )}

      {confirmDeleteEvento && (
        <ConfirmDialog
          title={`¿Eliminar "${confirmDeleteEvento.titulo}"?`}
          body="Se borrará solo esta fecha del calendario y no podrá deshacerse."
          confirmLabel="Eliminar"
          onConfirm={() => eliminarEvento(confirmDeleteEvento.id)}
          onCancel={() => setConfirmDeleteEvento(null)}
          disabled={enviando}
        />
      )}

      {confirmDeleteSerieEvento && (
        <ConfirmDialog
          title={`¿Eliminar toda la serie "${confirmDeleteSerieEvento.titulo}"?`}
          body="Se borrarán todas las fechas repetidas de este evento (pasadas y futuras) y no podrá deshacerse."
          confirmLabel="Eliminar serie"
          danger
          onConfirm={() => eliminarSerieEvento(confirmDeleteSerieEvento.serieId)}
          onCancel={() => setConfirmDeleteSerieEvento(null)}
          disabled={enviando}
        />
      )}

      {alumnoModal !== null && (
        <AlumnoModal
          initial={alumnoModal}
          onSave={guardarAlumno}
          onCancel={() => setAlumnoModal(null)}
          enviando={enviando}
          showToast={showToast}
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

      {leadModal && (
        <LeadDetalleModal
          lead={leadModal}
          onCerrar={() => setLeadModal(null)}
          onGuardarNotas={guardarNotasLead}
          onConvertir={() => setConfirmConvertirLead(leadModal)}
          onEliminar={() => setConfirmDeleteLead(leadModal)}
          enviando={enviando}
        />
      )}

      {confirmConvertirLead && (
        <ConvertirLeadModal
          lead={confirmConvertirLead}
          onConfirmar={async (datos) => {
            const ok = await convertirLead(confirmConvertirLead, datos);
            if (ok) {
              setConfirmConvertirLead(null);
              setLeadModal(null);
            }
          }}
          onCancelar={() => setConfirmConvertirLead(null)}
          enviando={enviando}
        />
      )}

      {confirmDeleteLead && (
        <ConfirmDialog
          title={`¿Eliminar a "${confirmDeleteLead.nombreAlumno || "este contacto"}"?`}
          body="Se borrará este contacto del CRM (junto con sus notas y archivos) y no podrá deshacerse."
          confirmLabel="Eliminar"
          danger
          onConfirm={() => eliminarLead(confirmDeleteLead.id)}
          onCancel={() => setConfirmDeleteLead(null)}
          disabled={enviando}
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

// Avatar circular del alumno: su foto si tiene, o si no un círculo con sus
// iniciales (o el ícono genérico de persona si ni nombre hay todavía).
function AvatarAlumno({ nombre, fotoUrl, size = 30 }) {
  const iniciales = (nombre || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  const estilo = { width: size, height: size, fontSize: Math.max(10, size * 0.38) };
  if (fotoUrl) {
    return <img src={fotoUrl} alt="" className="avatar-alumno" style={estilo} />;
  }
  return (
    <div className="avatar-alumno avatar-alumno-placeholder" style={estilo}>
      {iniciales || <User size={Math.round(size * 0.55)} />}
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
                      <div className="cell-alumno">
                        <AvatarAlumno nombre={a.nombre} fotoUrl={a.fotoUrl} size={30} />
                        <div>
                          <div className="cell-title">
                            {a.nombre}
                            {a.numeroUniforme != null && <span className="badge-numero">#{a.numeroUniforme}</span>}
                            {a.becado && <span className="badge-becado">Becado</span>}
                            {a.soloCampeonato && <span className="badge-campeonato">Solo campeonato</span>}
                          </div>
                          <div className="cell-sub">{a.telefono || ""}</div>
                        </div>
                      </div>
                    </td>
                    <td>{a.categoria}</td>
                    <td>{a.horario}</td>
                    <td>{a.encargado || "—"}</td>
                    <td className="num">{a.soloCampeonato || a.becado ? "—" : formatQ(a.tarifaMensual)}</td>
                    <td className="num">
                      {a.soloCampeonato ? (
                        <span className="muted">—</span>
                      ) : a.becado ? (
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

// Agenda de solo lectura para el entrenador: los eventos ya le llegan
// filtrados a sus categorías (ver eventos_para_entrenador en
// supabase-schema.sql) y SIN el campo de notas, así que aquí solo hay que
// mostrarlos — nada de editar, borrar ni convocatoria. Por defecto solo
// próximos, para no llenar la pantalla de historial en el celular.
function CalendarioEntrenadorView({ eventos }) {
  const [filtro, setFiltro] = useState("proximos");
  const hoyISO = todayISO();

  const visibles = useMemo(() => {
    return eventos
      .filter((e) => (filtro === "proximos" ? e.fecha >= hoyISO : true))
      .sort((a, b) => (a.fecha + (a.hora || "")).localeCompare(b.fecha + (b.hora || "")));
  }, [eventos, filtro, hoyISO]);

  return (
    <div className="stack">
      <div className="toolbar">
        <div />
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="proximos">Próximos</option>
          <option value="todos">Todos</option>
        </select>
      </div>

      {visibles.length === 0 ? (
        <div className="empty">
          {filtro === "proximos" ? "No hay nada agendado para tus categorías todavía." : "No hay eventos para tus categorías."}
        </div>
      ) : (
        visibles.map((e) => (
          <div key={e.id} className="panel evento-fila">
            <div className="evento-fila-info">
              <div className="evento-fila-titulo">
                <span className={"evento-tipo-pill evento-tipo-" + e.tipo}>{tipoEventoLabel(e.tipo)}</span>
                {e.titulo}
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {formatDiaLargo(e.fecha)}
                {[e.hora, e.lugar].filter(Boolean).length > 0 ? " · " + [e.hora, e.lugar].filter(Boolean).join(" · ") : ""}
              </div>
              {e.tipo === "partido" && (e.rival || e.horaConvocatoria || e.uniforme) && (
                <div className="muted" style={{ fontSize: 13 }}>
                  {[
                    e.rival ? "Rival: " + e.rival : null,
                    e.horaConvocatoria ? "Convocatoria: " + e.horaConvocatoria : null,
                    e.uniforme ? "Uniforme: " + e.uniforme : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
              {e.indicaciones && (
                <div className="muted" style={{ fontSize: 13 }}>
                  {e.indicaciones}
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// Biblioteca de ejercicios: compartida entre admin, administrativo y
// todos los entrenadores. Se usa como catálogo del que se pica al armar
// una sesión (ver SesionModal más abajo). "puedeEditar" decide, por cada
// fila, si le toca el lápiz/basurero (admin ve todo pero según RLS solo
// puede editar/borrar el admin o quien lo creó — se refleja aquí para no
// mostrar un botón que igual la base de datos va a rechazar).
function BibliotecaEjerciciosView({ ejercicios, miId, esAdmin, onNuevo, onEditar, onEliminar }) {
  const [busqueda, setBusqueda] = useState("");
  const [filtroObjetivo, setFiltroObjetivo] = useState("");

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return ejercicios
      .filter((e) => (filtroObjetivo ? e.objetivo === filtroObjetivo : true))
      .filter((e) => (q ? e.nombre.toLowerCase().includes(q) : true))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [ejercicios, busqueda, filtroObjetivo]);

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="search-box">
          <Search size={16} />
          <input placeholder="Buscar ejercicio…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <div className="toolbar-actions">
          <select value={filtroObjetivo} onChange={(e) => setFiltroObjetivo(e.target.value)}>
            <option value="">Todos los objetivos</option>
            {OBJETIVOS_EJERCICIO.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button className="btn-primary" onClick={onNuevo}>
            <Plus size={16} /> Agregar ejercicio
          </button>
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div className="empty">
          {ejercicios.length === 0
            ? "Todavía no hay ejercicios en la biblioteca. Agrega el primero con el botón de arriba."
            : "No hay ejercicios que coincidan."}
        </div>
      ) : (
        <div className="panel">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Objetivo</th>
                  <th>Duración</th>
                  <th>Categorías</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((e) => {
                  const puedeEditar = esAdmin || e.creadoPor === miId;
                  return (
                    <tr key={e.id}>
                      <td className="cell-title">{e.nombre}</td>
                      <td>{objetivoEjercicioLabel(e.objetivo)}</td>
                      <td>{e.duracionMin ? `${e.duracionMin} min` : "—"}</td>
                      <td>{e.categorias.length ? e.categorias.join(", ") : <span className="muted">Todas</span>}</td>
                      <td>
                        {puedeEditar && (
                          <div className="actions">
                            <button className="icon-btn" onClick={() => onEditar(e)} aria-label="Editar">
                              <Pencil size={15} />
                            </button>
                            <button className="icon-btn" onClick={() => onEliminar(e)} aria-label="Eliminar">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
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

function EjercicioModal({ initial, onSave, onCancel, enviando }) {
  const [form, setForm] = useState({
    id: initial.id || null,
    nombre: initial.nombre || "",
    objetivo: initial.objetivo || "tecnica",
    descripcion: initial.descripcion || "",
    duracionMin: initial.duracionMin ?? "",
    categorias: initial.categorias || [],
  });
  const [error, setError] = useState(null);

  function toggleCategoria(c) {
    setForm((prev) => {
      const set = new Set(prev.categorias);
      if (set.has(c)) set.delete(c);
      else set.add(c);
      return { ...prev, categorias: Array.from(set) };
    });
  }

  function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!form.nombre.trim()) {
      setError("Escribe el nombre del ejercicio.");
      return;
    }
    setError(null);
    onSave(form);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{form.id ? "Editar ejercicio" : "Nuevo ejercicio"}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="form">
          <label>
            Nombre
            <input
              type="text"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              placeholder="Ej: Rondo 4v2"
              autoFocus
            />
          </label>
          <div className="form-row">
            <label>
              Objetivo
              <select value={form.objetivo} onChange={(e) => setForm({ ...form, objetivo: e.target.value })}>
                {OBJETIVOS_EJERCICIO.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Duración sugerida (min)
              <input
                type="number"
                min="0"
                value={form.duracionMin}
                onChange={(e) => setForm({ ...form, duracionMin: e.target.value })}
              />
            </label>
          </div>
          <label>
            Descripción
            <textarea
              rows={3}
              value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              placeholder="Cómo se hace, qué trabaja, variantes…"
            />
          </label>
          <div>
            <div className="form-section-label">
              Categorías {form.categorias.length > 0 && `(${form.categorias.length})`}
              {form.categorias.length === 0 && <span className="muted"> — ninguna elegida = sirve para todas</span>}
            </div>
            <div className="evento-convocados-lista">
              {CATEGORIAS.map((c) => (
                <label key={c} className="checkbox-item">
                  <input type="checkbox" checked={form.categorias.includes(c)} onChange={() => toggleCategoria(c)} />
                  {c}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel} disabled={enviando}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Lista de sesiones de entrenamiento planificadas. Se usa tanto en el
// panel del entrenador (solo las suyas) como en el panel de Admin (todas,
// con la columna de quién la armó, para dar seguimiento sin tener que
// planificarlas ellos mismos).
function SesionesView({ sesiones, staffNombre, mostrarEntrenador, onNuevo, onEditar, onEliminar }) {
  const [filtroCategoria, setFiltroCategoria] = useState("");

  const visibles = useMemo(() => {
    return sesiones
      .filter((s) => (filtroCategoria ? s.categoria === filtroCategoria : true))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [sesiones, filtroCategoria]);

  const categoriasConSesiones = useMemo(
    () => Array.from(new Set(sesiones.map((s) => s.categoria))).sort(),
    [sesiones]
  );

  return (
    <div className="stack">
      <div className="toolbar">
        <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categoriasConSesiones.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="toolbar-actions">
          <button className="btn-primary" onClick={onNuevo}>
            <Plus size={16} /> Nueva sesión
          </button>
        </div>
      </div>

      {visibles.length === 0 ? (
        <div className="empty">
          {sesiones.length === 0
            ? "No hay sesiones planificadas todavía. Arma la primera con el botón de arriba."
            : "No hay sesiones que coincidan con ese filtro."}
        </div>
      ) : (
        visibles.map((s) => (
          <div key={s.id} className="panel evento-fila">
            <div className="evento-fila-info">
              <div className="evento-fila-titulo">
                {s.titulo}
                <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                  {s.categoria}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {formatDiaLargo(s.fecha)}
                {mostrarEntrenador ? " · " + (staffNombre(s.entrenadorId) || "(sin nombre)") : ""}
                {" · "}
                {s.ejercicios.length} {s.ejercicios.length === 1 ? "ejercicio" : "ejercicios"}
              </div>
            </div>
            <div className="evento-fila-acciones">
              <button className="icon-btn" onClick={() => onEditar(s)} aria-label="Editar">
                <Pencil size={16} />
              </button>
              <button className="icon-btn danger" onClick={() => onEliminar(s)} aria-label="Eliminar">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// Arma o edita una sesión: datos generales + la lista de ejercicios que la
// componen, picados de la biblioteca. Los ejercicios de la sesión viven en
// el estado local del formulario hasta que se guarda todo junto.
function SesionModal({ initial, categoriasDisponibles, ejerciciosDisponibles, entrenadoresDisponibles, onSave, onCancel, enviando }) {
  const [form, setForm] = useState({
    id: initial.id || null,
    fecha: initial.fecha || todayISO(),
    categoria: initial.categoria || categoriasDisponibles[0] || "",
    titulo: initial.titulo || "",
    objetivoGeneral: initial.objetivoGeneral || "",
    entrenadorId: initial.entrenadorId || (entrenadoresDisponibles && entrenadoresDisponibles[0] ? entrenadoresDisponibles[0].id : null),
    ejercicios: (initial.ejercicios || []).map((x) => ({ ...x })),
  });
  const [ejercicioAAgregar, setEjercicioAAgregar] = useState("");
  const [error, setError] = useState(null);

  function agregarEjercicio() {
    if (!ejercicioAAgregar) return;
    const ej = ejerciciosDisponibles.find((x) => x.id === ejercicioAAgregar);
    if (!ej) return;
    setForm((prev) => ({
      ...prev,
      ejercicios: [
        ...prev.ejercicios,
        { ejercicioId: ej.id, nombre: ej.nombre, duracionMin: ej.duracionMin ?? "", notas: "" },
      ],
    }));
    setEjercicioAAgregar("");
  }

  function quitarEjercicio(idx) {
    setForm((prev) => ({ ...prev, ejercicios: prev.ejercicios.filter((_, i) => i !== idx) }));
  }

  function moverEjercicio(idx, delta) {
    setForm((prev) => {
      const lista = [...prev.ejercicios];
      const destino = idx + delta;
      if (destino < 0 || destino >= lista.length) return prev;
      [lista[idx], lista[destino]] = [lista[destino], lista[idx]];
      return { ...prev, ejercicios: lista };
    });
  }

  function actualizarEjercicio(idx, campo, valor) {
    setForm((prev) => {
      const lista = [...prev.ejercicios];
      lista[idx] = { ...lista[idx], [campo]: valor };
      return { ...prev, ejercicios: lista };
    });
  }

  function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!form.titulo.trim()) {
      setError("Escribe un título para la sesión.");
      return;
    }
    if (!form.categoria) {
      setError("Elige la categoría de esta sesión.");
      return;
    }
    if (!form.fecha) {
      setError("Elige una fecha.");
      return;
    }
    setError(null);
    onSave(form);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{form.id ? "Editar sesión" : "Nueva sesión"}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="form">
          <label>
            Título
            <input
              type="text"
              value={form.titulo}
              onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              placeholder="Ej: Resistencia y pase corto"
              autoFocus
            />
          </label>
          {entrenadoresDisponibles && (
            <label>
              Entrenador
              <select value={form.entrenadorId || ""} onChange={(e) => setForm({ ...form, entrenadorId: e.target.value })}>
                {entrenadoresDisponibles.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre || "(sin nombre)"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="form-row">
            <label>
              Fecha
              <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
            </label>
            <label>
              Categoría
              <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                {categoriasDisponibles.length === 0 && <option value="">Sin categorías asignadas</option>}
                {categoriasDisponibles.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Objetivo general de la sesión (opcional)
            <input
              type="text"
              value={form.objetivoGeneral}
              onChange={(e) => setForm({ ...form, objetivoGeneral: e.target.value })}
            />
          </label>

          <div>
            <div className="form-section-label">Ejercicios ({form.ejercicios.length})</div>
            {form.ejercicios.length === 0 && (
              <div className="empty" style={{ padding: 14 }}>
                Todavía no agregas ningún ejercicio.
              </div>
            )}
            <div className="stack" style={{ gap: 8 }}>
              {form.ejercicios.map((ej, idx) => (
                <div key={idx} className="panel" style={{ padding: 10 }}>
                  <div className="form-row" style={{ alignItems: "center", flexWrap: "nowrap" }}>
                    <div style={{ flex: 2, fontWeight: 600 }}>{ej.nombre}</div>
                    <input
                      type="number"
                      min="0"
                      style={{ flex: "0 0 90px" }}
                      value={ej.duracionMin}
                      onChange={(e) => actualizarEjercicio(idx, "duracionMin", e.target.value)}
                      placeholder="min"
                    />
                    <button type="button" className="icon-btn" onClick={() => moverEjercicio(idx, -1)} aria-label="Subir" disabled={idx === 0}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => moverEjercicio(idx, 1)}
                      aria-label="Bajar"
                      disabled={idx === form.ejercicios.length - 1}
                    >
                      ↓
                    </button>
                    <button type="button" className="icon-btn danger" onClick={() => quitarEjercicio(idx)} aria-label="Quitar">
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={ej.notas}
                    onChange={(e) => actualizarEjercicio(idx, "notas", e.target.value)}
                    placeholder="Notas para esta sesión (opcional)"
                    style={{ marginTop: 6 }}
                  />
                </div>
              ))}
            </div>
            <div className="form-row" style={{ marginTop: 10 }}>
              <select value={ejercicioAAgregar} onChange={(e) => setEjercicioAAgregar(e.target.value)}>
                <option value="">
                  {ejerciciosDisponibles.length === 0 ? "No hay ejercicios en la biblioteca todavía" : "Elige un ejercicio…"}
                </option>
                {ejerciciosDisponibles.map((ej) => (
                  <option key={ej.id} value={ej.id}>
                    {ej.nombre}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-secondary" onClick={agregarEjercicio} disabled={!ejercicioAAgregar}>
                <Plus size={15} /> Agregar
              </button>
            </div>
            {ejerciciosDisponibles.length === 0 && (
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                Agrega ejercicios primero en la pestaña "Biblioteca de ejercicios".
              </div>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel} disabled={enviando}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Lista de partidos (eventos tipo "partido" del calendario) con su
// resultado, si ya se registró. Se usa tanto en el panel del entrenador
// (solo los de sus categorías, vía eventos_para_entrenador) como en el de
// Admin (todos, con la columna de quién lo registró). Un partido sin
// resultado todavía muestra el botón "Registrar resultado" en vez de
// editar/eliminar.
function ResultadosPartidosView({ eventos, resultados, staffNombre, mostrarEntrenador, onRegistrar, onEditar, onEliminar }) {
  const [filtroCategoria, setFiltroCategoria] = useState("");

  const resultadoPorEvento = useMemo(() => {
    const m = {};
    resultados.forEach((r) => {
      m[r.eventoId] = r;
    });
    return m;
  }, [resultados]);

  const categoriasDisponibles = useMemo(() => {
    const set = new Set();
    eventos.filter((e) => e.tipo === "partido").forEach((e) => (e.categorias || []).forEach((c) => set.add(c)));
    return Array.from(set).sort();
  }, [eventos]);

  const partidos = useMemo(() => {
    return eventos
      .filter((e) => e.tipo === "partido")
      .filter((e) => (filtroCategoria ? (e.categorias || []).includes(filtroCategoria) : true))
      .sort((a, b) => (b.fecha + (b.hora || "")).localeCompare(a.fecha + (a.hora || "")));
  }, [eventos, filtroCategoria]);

  return (
    <div className="stack">
      <div className="toolbar">
        <div />
        <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categoriasDisponibles.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {partidos.length === 0 ? (
        <div className="empty">
          No hay partidos agendados en el calendario todavía. Agrégalos desde la pestaña "Calendario" como evento tipo "Partido".
        </div>
      ) : (
        partidos.map((evento) => {
          const resultado = resultadoPorEvento[evento.id];
          return (
            <div key={evento.id} className="panel evento-fila">
              <div className="evento-fila-info">
                <div className="evento-fila-titulo">
                  {evento.titulo}
                  {evento.rival ? " vs " + evento.rival : ""}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {formatDiaLargo(evento.fecha)}
                  {(evento.categorias || []).length ? " · " + evento.categorias.join(", ") : ""}
                  {mostrarEntrenador && resultado ? " · " + (staffNombre(resultado.entrenadorId) || "—") : ""}
                </div>
                {resultado ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 16 }}>
                      {resultado.golesFavor} - {resultado.golesContra}
                    </span>
                    <span className={"resultado-pill resultado-" + resultadoPartidoTipo(resultado)}>
                      {resultadoPartidoLabel(resultado)}
                    </span>
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                    Sin resultado registrado
                  </div>
                )}
              </div>
              <div className="actions">
                {resultado ? (
                  <>
                    <button className="icon-btn" onClick={() => onEditar(evento, resultado)} aria-label="Editar">
                      <Pencil size={15} />
                    </button>
                    <button className="icon-btn" onClick={() => onEliminar(resultado)} aria-label="Eliminar">
                      <Trash2 size={15} />
                    </button>
                  </>
                ) : (
                  <button className="btn-secondary" onClick={() => onRegistrar(evento)}>
                    Registrar resultado
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// Formulario de resultado de un partido: marcador, goleadores (con
// asistencia opcional) y tarjetas. "alumnosDisponibles" es la lista de
// jugadores de donde elegir (ya viene filtrada por categoría del partido).
function ResultadoModal({ evento, initial, alumnosDisponibles, onSave, onCancel, enviando }) {
  const [form, setForm] = useState({
    id: (initial && initial.id) || null,
    eventoId: evento.id,
    golesFavor: initial ? initial.golesFavor : 0,
    golesContra: initial ? initial.golesContra : 0,
    observaciones: (initial && initial.observaciones) || "",
    goles: ((initial && initial.goles) || []).map((g) => ({ ...g })),
    tarjetas: ((initial && initial.tarjetas) || []).map((t) => ({ ...t })),
  });
  const [golAAgregar, setGolAAgregar] = useState("");
  const [asistenciaAAgregar, setAsistenciaAAgregar] = useState("");
  const [tarjetaAAgregar, setTarjetaAAgregar] = useState("");
  const [tarjetaTipo, setTarjetaTipo] = useState("amarilla");

  function agregarGol() {
    if (!golAAgregar) return;
    const al = alumnosDisponibles.find((a) => a.id === golAAgregar);
    if (!al) return;
    const asist = asistenciaAAgregar ? alumnosDisponibles.find((a) => a.id === asistenciaAAgregar) : null;
    setForm((prev) => ({
      ...prev,
      goles: [
        ...prev.goles,
        {
          alumnoId: al.id,
          alumnoNombre: al.nombre,
          asistenciaAlumnoId: asist ? asist.id : null,
          asistenciaNombre: asist ? asist.nombre : null,
          minuto: "",
        },
      ],
    }));
    setGolAAgregar("");
    setAsistenciaAAgregar("");
  }
  function quitarGol(idx) {
    setForm((prev) => ({ ...prev, goles: prev.goles.filter((_, i) => i !== idx) }));
  }
  function actualizarGolMinuto(idx, minuto) {
    setForm((prev) => {
      const lista = [...prev.goles];
      lista[idx] = { ...lista[idx], minuto };
      return { ...prev, goles: lista };
    });
  }

  function agregarTarjeta() {
    if (!tarjetaAAgregar) return;
    const al = alumnosDisponibles.find((a) => a.id === tarjetaAAgregar);
    if (!al) return;
    setForm((prev) => ({
      ...prev,
      tarjetas: [...prev.tarjetas, { alumnoId: al.id, alumnoNombre: al.nombre, tipo: tarjetaTipo, minuto: "" }],
    }));
    setTarjetaAAgregar("");
  }
  function quitarTarjeta(idx) {
    setForm((prev) => ({ ...prev, tarjetas: prev.tarjetas.filter((_, i) => i !== idx) }));
  }
  function actualizarTarjetaMinuto(idx, minuto) {
    setForm((prev) => {
      const lista = [...prev.tarjetas];
      lista[idx] = { ...lista[idx], minuto };
      return { ...prev, tarjetas: lista };
    });
  }

  function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    onSave(form);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            Resultado: {evento.titulo}
            {evento.rival ? " vs " + evento.rival : ""}
          </h3>
          <button className="icon-btn" onClick={onCancel} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="form">
          <div className="muted" style={{ fontSize: 13 }}>
            {formatDiaLargo(evento.fecha)}
          </div>
          <div className="form-row">
            <label>
              Goles a favor
              <input
                type="number"
                min="0"
                value={form.golesFavor}
                onChange={(e) => setForm({ ...form, golesFavor: e.target.value })}
              />
            </label>
            <label>
              Goles en contra
              <input
                type="number"
                min="0"
                value={form.golesContra}
                onChange={(e) => setForm({ ...form, golesContra: e.target.value })}
              />
            </label>
          </div>

          <div>
            <div className="form-section-label">Goleadores ({form.goles.length})</div>
            {form.goles.length === 0 && (
              <div className="empty" style={{ padding: 14 }}>
                Todavía no agregas ningún gol.
              </div>
            )}
            <div className="stack" style={{ gap: 8 }}>
              {form.goles.map((g, idx) => (
                <div key={idx} className="panel" style={{ padding: 10 }}>
                  <div className="form-row" style={{ alignItems: "center", flexWrap: "nowrap" }}>
                    <div style={{ flex: 2, fontWeight: 600 }}>
                      {g.alumnoNombre}
                      {g.asistenciaNombre ? <span className="muted"> · asist. {g.asistenciaNombre}</span> : null}
                    </div>
                    <input
                      type="number"
                      min="0"
                      style={{ flex: "0 0 90px" }}
                      value={g.minuto}
                      onChange={(e) => actualizarGolMinuto(idx, e.target.value)}
                      placeholder="min"
                    />
                    <button type="button" className="icon-btn danger" onClick={() => quitarGol(idx)} aria-label="Quitar">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {alumnosDisponibles.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                No hay alumnos disponibles para elegir (revisa la categoría del partido).
              </div>
            ) : (
              <div className="form-row" style={{ marginTop: 10 }}>
                <select value={golAAgregar} onChange={(e) => setGolAAgregar(e.target.value)}>
                  <option value="">Elige quién anotó…</option>
                  {alumnosDisponibles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
                <select value={asistenciaAAgregar} onChange={(e) => setAsistenciaAAgregar(e.target.value)}>
                  <option value="">Sin asistencia</option>
                  {alumnosDisponibles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-secondary" onClick={agregarGol} disabled={!golAAgregar}>
                  <Plus size={15} /> Agregar gol
                </button>
              </div>
            )}
          </div>

          <div>
            <div className="form-section-label">Tarjetas ({form.tarjetas.length})</div>
            {form.tarjetas.length === 0 && (
              <div className="empty" style={{ padding: 14 }}>
                No hay tarjetas registradas.
              </div>
            )}
            <div className="stack" style={{ gap: 8 }}>
              {form.tarjetas.map((t, idx) => (
                <div key={idx} className="panel" style={{ padding: 10 }}>
                  <div className="form-row" style={{ alignItems: "center", flexWrap: "nowrap" }}>
                    <span className={"tarjeta-pill tarjeta-" + t.tipo}>{t.tipo === "amarilla" ? "Amarilla" : "Roja"}</span>
                    <div style={{ flex: 2, fontWeight: 600 }}>{t.alumnoNombre}</div>
                    <input
                      type="number"
                      min="0"
                      style={{ flex: "0 0 90px" }}
                      value={t.minuto}
                      onChange={(e) => actualizarTarjetaMinuto(idx, e.target.value)}
                      placeholder="min"
                    />
                    <button type="button" className="icon-btn danger" onClick={() => quitarTarjeta(idx)} aria-label="Quitar">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {alumnosDisponibles.length > 0 && (
              <div className="form-row" style={{ marginTop: 10 }}>
                <select value={tarjetaAAgregar} onChange={(e) => setTarjetaAAgregar(e.target.value)}>
                  <option value="">Elige jugador…</option>
                  {alumnosDisponibles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
                <select value={tarjetaTipo} onChange={(e) => setTarjetaTipo(e.target.value)}>
                  <option value="amarilla">Amarilla</option>
                  <option value="roja">Roja</option>
                </select>
                <button type="button" className="btn-secondary" onClick={agregarTarjeta} disabled={!tarjetaAAgregar}>
                  <Plus size={15} /> Agregar tarjeta
                </button>
              </div>
            )}
          </div>

          <label>
            Observaciones (opcional)
            <textarea
              rows={2}
              value={form.observaciones}
              onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel} disabled={enviando}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Lista de campeonatos con sus inscripciones (master-detail: se hace clic
// en un campeonato para desplegar sus inscritos debajo). Cada inscripción
// tiene su propia cuota (puede variar de un alumno a otro) y si ya la
// pagó. Sirve tanto para alumnos regulares como para los marcados "solo
// campeonato" — cualquiera puede inscribirse.
function CampeonatosView({
  campeonatos,
  alumnos,
  puedeEliminar,
  onNuevo,
  onEditar,
  onEliminar,
  onInscribir,
  onActualizarInscripcion,
  onEliminarInscripcion,
}) {
  const [campeonatoAbiertoId, setCampeonatoAbiertoId] = useState(null);
  const [alumnoAInscribir, setAlumnoAInscribir] = useState("");
  const [montoInscribir, setMontoInscribir] = useState("");

  const campeonatoAbierto = campeonatos.find((c) => c.id === campeonatoAbiertoId) || null;

  const alumnosDisponiblesParaInscribir = useMemo(() => {
    if (!campeonatoAbierto) return [];
    const yaInscritos = new Set(campeonatoAbierto.inscripciones.map((i) => i.alumnoId));
    return alumnos.filter((a) => !yaInscritos.has(a.id)).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [campeonatoAbierto, alumnos]);

  function alumnoNombre(id) {
    return (alumnos.find((a) => a.id === id) || {}).nombre || "(alumno eliminado)";
  }

  function handleInscribir() {
    if (!alumnoAInscribir || !campeonatoAbierto) return;
    const monto = parseMonto(montoInscribir);
    onInscribir(campeonatoAbierto.id, alumnoAInscribir, isNaN(monto) ? 0 : monto);
    setAlumnoAInscribir("");
    setMontoInscribir("");
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <div />
        <button className="btn-primary" onClick={onNuevo}>
          <Plus size={16} /> Nuevo campeonato
        </button>
      </div>

      {campeonatos.length === 0 ? (
        <div className="empty">
          Todavía no hay campeonatos registrados. Agrega el primero con el botón de arriba.
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {campeonatos.map((c) => {
            const total = c.inscripciones.length;
            const pagados = c.inscripciones.filter((i) => i.pagado).length;
            const recaudado = c.inscripciones.filter((i) => i.pagado).reduce((s, i) => s + i.montoCuota, 0);
            const pendiente = c.inscripciones.filter((i) => !i.pagado).reduce((s, i) => s + i.montoCuota, 0);
            const abierto = campeonatoAbiertoId === c.id;
            return (
              <div key={c.id} className="panel">
                <div className="evento-fila" style={{ padding: 0 }}>
                  <div
                    className="evento-fila-info"
                    style={{ cursor: "pointer" }}
                    onClick={() => setCampeonatoAbiertoId(abierto ? null : c.id)}
                  >
                    <div className="evento-fila-titulo">
                      {abierto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      {c.nombre}
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {c.fecha ? formatDiaLargo(c.fecha) : "Sin fecha"}
                      {(c.categorias || []).length ? " · " + c.categorias.join(", ") : ""}
                      {" · " + total + " inscrito" + (total === 1 ? "" : "s") + " (" + pagados + " pagado" + (pagados === 1 ? "" : "s") + ")"}
                    </div>
                    {total > 0 && (
                      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                        Recaudado {formatQ(recaudado)}
                        {pendiente > 0 ? " · pendiente " + formatQ(pendiente) : ""}
                      </div>
                    )}
                  </div>
                  <div className="actions">
                    <button className="icon-btn" onClick={() => onEditar(c)} aria-label="Editar">
                      <Pencil size={15} />
                    </button>
                    {puedeEliminar && (
                      <button className="icon-btn" onClick={() => onEliminar(c)} aria-label="Eliminar">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {abierto && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-soft)" }}>
                    {c.inscripciones.length === 0 ? (
                      <div className="empty" style={{ padding: 14 }}>
                        Todavía no hay alumnos inscritos.
                      </div>
                    ) : (
                      <div className="table-scroll">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Alumno</th>
                              <th className="num">Cuota</th>
                              <th>Estado</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.inscripciones.map((ins) => (
                              <tr key={ins.id}>
                                <td className="cell-title">{alumnoNombre(ins.alumnoId)}</td>
                                <td className="num">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    style={{ width: 90, textAlign: "right" }}
                                    defaultValue={ins.montoCuota}
                                    onBlur={(e) => {
                                      const monto = parseMonto(e.target.value);
                                      if (!isNaN(monto) && monto >= 0 && monto !== ins.montoCuota) {
                                        onActualizarInscripcion(ins, { montoCuota: monto });
                                      }
                                    }}
                                  />
                                </td>
                                <td>
                                  <button
                                    className="badge"
                                    style={
                                      ins.pagado
                                        ? { color: "#158F63", background: "#E7F7F1", cursor: "pointer", border: "none" }
                                        : { color: "#B4790A", background: "#FCF1DD", cursor: "pointer", border: "none" }
                                    }
                                    onClick={() =>
                                      onActualizarInscripcion(ins, {
                                        pagado: !ins.pagado,
                                        fechaPago: !ins.pagado ? todayISO() : null,
                                      })
                                    }
                                  >
                                    {ins.pagado ? "Pagado" : "Pendiente"}
                                  </button>
                                </td>
                                <td className="actions">
                                  <button className="icon-btn" onClick={() => onEliminarInscripcion(ins)} aria-label="Quitar">
                                    <Trash2 size={15} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="form-row" style={{ marginTop: 10 }}>
                      <select value={alumnoAInscribir} onChange={(e) => setAlumnoAInscribir(e.target.value)}>
                        <option value="">
                          {alumnosDisponiblesParaInscribir.length === 0 ? "No hay más alumnos para inscribir" : "Elige un alumno…"}
                        </option>
                        {alumnosDisponiblesParaInscribir.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.nombre}
                            {a.soloCampeonato ? " (solo campeonato)" : ""}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="Cuota (Q)"
                        style={{ maxWidth: 120 }}
                        value={montoInscribir}
                        onChange={(e) => setMontoInscribir(e.target.value)}
                      />
                      <button type="button" className="btn-secondary" onClick={handleInscribir} disabled={!alumnoAInscribir}>
                        <Plus size={15} /> Inscribir
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CampeonatoModal({ initial, onSave, onCancel, enviando }) {
  const [form, setForm] = useState({
    id: initial.id || null,
    nombre: initial.nombre || "",
    fecha: initial.fecha || "",
    categorias: initial.categorias || [],
    notas: initial.notas || "",
  });
  const [error, setError] = useState(null);

  function toggleCategoria(c) {
    setForm((prev) => {
      const set = new Set(prev.categorias);
      if (set.has(c)) set.delete(c);
      else set.add(c);
      return { ...prev, categorias: Array.from(set) };
    });
  }

  function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!form.nombre.trim()) {
      setError("Escribe el nombre del campeonato.");
      return;
    }
    setError(null);
    onSave(form);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{form.id ? "Editar campeonato" : "Nuevo campeonato"}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="form">
          <label>
            Nombre
            <input
              type="text"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              placeholder="Ej: Copa Interligas 2026"
              autoFocus
            />
          </label>
          <label>
            Fecha (opcional)
            <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
          </label>
          <div>
            <div className="form-section-label">
              Categorías {form.categorias.length > 0 && `(${form.categorias.length})`}
              {form.categorias.length === 0 && <span className="muted"> — ninguna elegida = aplica a todas</span>}
            </div>
            <div className="evento-convocados-lista">
              {CATEGORIAS.map((c) => (
                <label key={c} className="checkbox-item">
                  <input type="checkbox" checked={form.categorias.includes(c)} onChange={() => toggleCategoria(c)} />
                  {c}
                </label>
              ))}
            </div>
          </div>
          <label>
            Notas (opcional)
            <textarea rows={2} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel} disabled={enviando}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Inventario de equipo de la academia (balones, conos, petos, arcos,
// botiquín, etc.) — separado del control de uniformes por alumno, que
// sigue viviendo en la ficha de cada alumno. "Buen estado" se calcula
// restando las dañadas del total, así nunca queda desincronizado.
function InventarioView({ inventario, puedeEliminar, onNuevo, onEditar, onEliminar }) {
  const [busqueda, setBusqueda] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroSede, setFiltroSede] = useState("");

  const sedesDisponibles = useMemo(() => {
    const set = new Set();
    inventario.forEach((i) => i.sede && set.add(i.sede));
    return Array.from(set).sort();
  }, [inventario]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return inventario
      .filter((i) => (filtroCategoria ? i.categoria === filtroCategoria : true))
      .filter((i) => (filtroSede ? i.sede === filtroSede : true))
      .filter((i) => (q ? i.nombre.toLowerCase().includes(q) : true))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [inventario, busqueda, filtroCategoria, filtroSede]);

  const totalArticulos = inventario.reduce((s, i) => s + i.cantidadTotal, 0);
  const totalDanados = inventario.reduce((s, i) => s + i.cantidadDanada, 0);

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="search-box">
          <Search size={16} />
          <input placeholder="Buscar artículo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <div className="toolbar-actions">
          <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
            <option value="">Todas las categorías</option>
            {CATEGORIAS_INVENTARIO.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {sedesDisponibles.length > 0 && (
            <select value={filtroSede} onChange={(e) => setFiltroSede(e.target.value)}>
              <option value="">Todas las sedes</option>
              {sedesDisponibles.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <button className="btn-primary" onClick={onNuevo}>
            <Plus size={16} /> Agregar artículo
          </button>
        </div>
      </div>

      {inventario.length > 0 && (
        <div className="muted" style={{ fontSize: 13 }}>
          {totalArticulos} artículo{totalArticulos === 1 ? "" : "s"} en total
          {totalDanados > 0 ? ` · ${totalDanados} en mal estado` : ""}
        </div>
      )}

      {filtrados.length === 0 ? (
        <div className="empty">
          {inventario.length === 0
            ? "Todavía no hay artículos en el inventario. Agrega el primero con el botón de arriba."
            : "No hay artículos que coincidan."}
        </div>
      ) : (
        <div className="panel">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Artículo</th>
                  <th>Categoría</th>
                  <th className="num">Total</th>
                  <th className="num">Buen estado</th>
                  <th className="num">Dañado</th>
                  <th>Sede</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((i) => {
                  const buenEstado = Math.max(0, i.cantidadTotal - i.cantidadDanada);
                  return (
                    <tr key={i.id}>
                      <td className="cell-title">{i.nombre}</td>
                      <td>{i.categoria}</td>
                      <td className="num">{i.cantidadTotal}</td>
                      <td className="num">{buenEstado}</td>
                      <td className="num">
                        {i.cantidadDanada > 0 ? (
                          <span className="badge" style={{ color: "#C13F3B", background: "#FBEAE9" }}>
                            {i.cantidadDanada}
                          </span>
                        ) : (
                          <span className="muted">0</span>
                        )}
                      </td>
                      <td>{i.sede || <span className="muted">—</span>}</td>
                      <td>
                        <div className="actions">
                          <button className="icon-btn" onClick={() => onEditar(i)} aria-label="Editar">
                            <Pencil size={15} />
                          </button>
                          {puedeEliminar && (
                            <button className="icon-btn" onClick={() => onEliminar(i)} aria-label="Eliminar">
                              <Trash2 size={15} />
                            </button>
                          )}
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

function InventarioModal({ initial, onSave, onCancel, enviando }) {
  const [form, setForm] = useState({
    id: initial.id || null,
    nombre: initial.nombre || "",
    categoria: initial.categoria || CATEGORIAS_INVENTARIO[0],
    cantidadTotal: initial.cantidadTotal != null ? String(initial.cantidadTotal) : "",
    cantidadDanada: initial.cantidadDanada != null ? String(initial.cantidadDanada) : "0",
    sede: initial.sede || "",
    notas: initial.notas || "",
  });
  const [error, setError] = useState(null);

  function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const total = Number(form.cantidadTotal);
    const danada = Number(form.cantidadDanada);
    const problemas = [];
    if (!form.nombre.trim()) problemas.push("Escribe el nombre del artículo.");
    if (form.cantidadTotal === "" || isNaN(total) || total < 0) problemas.push("Ingresa una cantidad total válida.");
    if (form.cantidadDanada !== "" && (isNaN(danada) || danada < 0)) problemas.push("Ingresa una cantidad dañada válida.");
    if (!isNaN(total) && !isNaN(danada) && danada > total) problemas.push("La cantidad dañada no puede ser mayor que el total.");
    if (problemas.length > 0) {
      setError(problemas.join(" "));
      return;
    }
    setError(null);
    onSave({ ...form, cantidadTotal: total, cantidadDanada: isNaN(danada) ? 0 : danada });
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{form.id ? "Editar artículo" : "Nuevo artículo"}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="form">
          <label>
            Nombre
            <input
              type="text"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              placeholder="Ej: Balones No. 4"
              autoFocus
            />
          </label>
          <div className="form-row">
            <label>
              Categoría
              <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                {CATEGORIAS_INVENTARIO.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sede (opcional)
              <select value={form.sede} onChange={(e) => setForm({ ...form, sede: e.target.value })}>
                <option value="">Sin especificar / ambas</option>
                {SEDES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              Cantidad total
              <input
                type="number"
                min="0"
                value={form.cantidadTotal}
                onChange={(e) => setForm({ ...form, cantidadTotal: e.target.value })}
              />
            </label>
            <label>
              Cantidad dañada
              <input
                type="number"
                min="0"
                value={form.cantidadDanada}
                onChange={(e) => setForm({ ...form, cantidadDanada: e.target.value })}
              />
            </label>
          </div>
          <label>
            Notas (opcional)
            <textarea rows={2} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel} disabled={enviando}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Selector de calificación 1 a 5 (chips numerados en vez de un <select>,
// para calificar rápido desde el celular en la cancha).
function RatingChips({ value, onChange }) {
  return (
    <div className="rating-chips">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          type="button"
          key={n}
          className={"rating-chip" + (n <= value ? " active" : "")}
          onClick={() => onChange(n)}
          aria-label={`Calificar ${n} de 5`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

// Puntitos de solo lectura para mostrar una calificación en una lista sin
// ocupar tanto espacio como los RatingChips (que son para el formulario).
function RatingDots({ value }) {
  return (
    <span className="rating-dots" aria-label={`${value} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={"rating-dot" + (n <= value ? " filled" : "")} />
      ))}
    </span>
  );
}

// Lista de evaluaciones deportivas (una por alumno por fecha). Se puede
// filtrar por alumno. "mostrarEntrenador" (vista admin) agrega quién la
// registró; el entrenador solo ve y administra las suyas (ya limitado por
// las políticas de la base de datos).
function EvaluacionesView({ evaluaciones, alumnos, staffNombre, mostrarEntrenador, onNuevo, onEditar, onEliminar }) {
  const [filtroAlumno, setFiltroAlumno] = useState("");

  const alumnosConEvaluacion = useMemo(() => {
    const ids = new Set(evaluaciones.map((e) => e.alumnoId));
    return alumnos.filter((a) => ids.has(a.id)).sort((x, y) => x.nombre.localeCompare(y.nombre));
  }, [evaluaciones, alumnos]);

  const lista = useMemo(() => {
    return evaluaciones
      .filter((e) => (filtroAlumno ? e.alumnoId === filtroAlumno : true))
      .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  }, [evaluaciones, filtroAlumno]);

  function nombreAlumno(id) {
    const a = alumnos.find((x) => x.id === id);
    return a ? a.nombre : "Alumno ya no disponible";
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <select value={filtroAlumno} onChange={(e) => setFiltroAlumno(e.target.value)}>
          <option value="">Todos los alumnos</option>
          {alumnosConEvaluacion.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </select>
        <button className="btn-primary" onClick={onNuevo}>
          <Plus size={15} /> Nueva evaluación
        </button>
      </div>

      {lista.length === 0 ? (
        <div className="empty">
          {filtroAlumno
            ? "Este alumno todavía no tiene evaluaciones registradas."
            : "Todavía no hay evaluaciones registradas. Usa \"Nueva evaluación\" para calificar a un alumno."}
        </div>
      ) : (
        lista.map((ev) => (
          <div key={ev.id} className="panel evaluacion-fila">
            <div className="evaluacion-fila-info">
              <div className="evento-fila-titulo">
                {nombreAlumno(ev.alumnoId)}
                <span className="muted" style={{ fontWeight: 400 }}> · {formatDiaLargo(ev.fecha)}</span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {ev.categoria || "Sin categoría"}
                {mostrarEntrenador ? " · " + (staffNombre(ev.entrenadorId) || "—") : ""}
              </div>
              <div className="evaluacion-dims">
                {DIMENSIONES_EVALUACION.map((d) => (
                  <div key={d.key} className="evaluacion-dim">
                    <span className="muted" style={{ fontSize: 12 }}>{d.label}</span>
                    <RatingDots value={ev[d.key]} />
                  </div>
                ))}
              </div>
              {ev.comentarios && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{ev.comentarios}</div>}
            </div>
            <div className="actions">
              <button className="icon-btn" onClick={() => onEditar(ev)} aria-label="Editar">
                <Pencil size={15} />
              </button>
              <button className="icon-btn" onClick={() => onEliminar(ev)} aria-label="Eliminar">
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// Formulario de evaluación: elige alumno (solo al crear), calificaciones
// 1-5 en las 4 dimensiones y comentarios libres. La categoría se guarda
// como snapshot de la del alumno en ese momento.
function EvaluacionModal({ initial, alumnosDisponibles, onSave, onCancel, enviando }) {
  const esNuevo = !(initial && initial.id);
  const [form, setForm] = useState({
    id: (initial && initial.id) || null,
    alumnoId: (initial && initial.alumnoId) || "",
    fecha: (initial && initial.fecha) || todayISO(),
    categoria: (initial && initial.categoria) || "",
    tecnica: (initial && initial.tecnica) || 3,
    fisico: (initial && initial.fisico) || 3,
    tactico: (initial && initial.tactico) || 3,
    actitud: (initial && initial.actitud) || 3,
    comentarios: (initial && initial.comentarios) || "",
  });
  const [error, setError] = useState(null);

  function elegirAlumno(alumnoId) {
    const al = alumnosDisponibles.find((a) => a.id === alumnoId);
    setForm((prev) => ({ ...prev, alumnoId, categoria: al ? al.categoria || "" : prev.categoria }));
  }

  function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!form.alumnoId) {
      setError("Elige a qué alumno vas a evaluar.");
      return;
    }
    if (!form.fecha) {
      setError("Elige la fecha de la evaluación.");
      return;
    }
    setError(null);
    onSave(form);
  }

  const alumnoActual = alumnosDisponibles.find((a) => a.id === form.alumnoId);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{esNuevo ? "Nueva evaluación" : "Editar evaluación"}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="form">
          <div className="form-row">
            <label>
              Alumno
              {esNuevo ? (
                <select value={form.alumnoId} onChange={(e) => elegirAlumno(e.target.value)} autoFocus>
                  <option value="">Elige un alumno…</option>
                  {alumnosDisponibles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="text" value={(alumnoActual && alumnoActual.nombre) || "Alumno"} disabled />
              )}
            </label>
            <label>
              Fecha
              <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
            </label>
          </div>

          <div className="form-section-label">Calificación (1 a 5)</div>
          <div className="stack" style={{ gap: 10 }}>
            {DIMENSIONES_EVALUACION.map((d) => (
              <div key={d.key} className="form-row" style={{ alignItems: "center", flexWrap: "nowrap" }}>
                <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{d.label}</div>
                <RatingChips value={form[d.key]} onChange={(n) => setForm({ ...form, [d.key]: n })} />
              </div>
            ))}
          </div>

          <label>
            Comentarios (opcional)
            <textarea
              rows={3}
              value={form.comentarios}
              onChange={(e) => setForm({ ...form, comentarios: e.target.value })}
              placeholder="Observaciones sobre el desempeño del alumno…"
            />
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel} disabled={enviando}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Calendario operativo: grilla de mes estilo Google Calendar. Cada celda
// muestra los eventos de ese día (como pastillas de color según el tipo);
// al hacer clic en un día se selecciona y se abre el panel de abajo con el
// detalle de sus eventos y el botón para agregar uno nuevo justo ahí. Un
// evento de tipo "partido" tiene además su botón de Convocatoria aparte.
function CalendarioView({ eventos, alumnos, onNuevo, onEditar, onEliminar, onEliminarSerie, onConvocatoria, filtroTipo, setFiltroTipo, filtroCategoria, setFiltroCategoria }) {
  const hoy = new Date();
  const [mesVisible, setMesVisible] = useState(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const [diaSeleccionado, setDiaSeleccionado] = useState(todayISO());

  const eventosFiltrados = eventos.filter(
    (e) =>
      (filtroTipo ? e.tipo === filtroTipo : true) &&
      (filtroCategoria ? (e.categorias || []).includes(filtroCategoria) : true)
  );

  const eventosPorDia = {};
  eventosFiltrados.forEach((e) => {
    if (!e.fecha) return;
    if (!eventosPorDia[e.fecha]) eventosPorDia[e.fecha] = [];
    eventosPorDia[e.fecha].push(e);
  });
  Object.values(eventosPorDia).forEach((lista) => lista.sort((a, b) => (a.hora || "").localeCompare(b.hora || "")));

  const celdas = construirMatrizMes(mesVisible.getFullYear(), mesVisible.getMonth());
  const eventosDelDia = eventosPorDia[diaSeleccionado] || [];

  function irMes(delta) {
    setMesVisible((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  function irHoy() {
    const h = new Date();
    setMesVisible(new Date(h.getFullYear(), h.getMonth(), 1));
    setDiaSeleccionado(todayISO());
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="toolbar-actions" style={{ flexWrap: "wrap" }}>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
            <option value="">Todos los tipos</option>
            {TIPOS_EVENTO.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
            <option value="">Todas las categorías</option>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary" onClick={() => onNuevo(diaSeleccionado)}>
          <Plus size={16} /> Nuevo evento
        </button>
      </div>

      <div className="calendario-header">
        <div className="calendario-nav">
          <button className="icon-btn" onClick={() => irMes(-1)} aria-label="Mes anterior">
            ‹
          </button>
          <div className="calendario-mes-label">
            {monthLabel(`${mesVisible.getFullYear()}-${pad2(mesVisible.getMonth() + 1)}`)}
          </div>
          <button className="icon-btn" onClick={() => irMes(1)} aria-label="Mes siguiente">
            ›
          </button>
        </div>
        <button className="btn-secondary" onClick={irHoy}>
          Hoy
        </button>
      </div>

      <div className="calendario-grid">
        {DIAS_SEMANA_CORTOS.map((d) => (
          <div key={d} className="calendario-dia-header">
            {d}
          </div>
        ))}
        {celdas.map((c) => {
          const eventosCelda = eventosPorDia[c.key] || [];
          const visibles = eventosCelda.slice(0, 3);
          const restantes = eventosCelda.length - visibles.length;
          return (
            <div
              key={c.key}
              className={
                "calendario-celda" +
                (c.enMes ? "" : " calendario-celda-fuera") +
                (c.esHoy ? " calendario-celda-hoy" : "") +
                (c.key === diaSeleccionado ? " calendario-celda-seleccionada" : "")
              }
              onClick={() => setDiaSeleccionado(c.key)}
            >
              <div className="calendario-celda-numero">{c.dia}</div>
              <div className="calendario-celda-eventos">
                {visibles.map((e) => (
                  <div
                    key={e.id}
                    className={"calendario-evento-pill evento-tipo-" + e.tipo}
                    title={e.titulo}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onEditar(e);
                    }}
                  >
                    {e.hora ? e.hora.slice(0, 5) + " " : ""}
                    {e.titulo}
                  </div>
                ))}
                {restantes > 0 && <div className="calendario-evento-mas">+{restantes} más</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: eventosDelDia.length ? 12 : 0 }}>
          <div className="form-section-label" style={{ marginBottom: 0 }}>
            {formatDiaLargo(diaSeleccionado)}
          </div>
          <button className="btn-secondary" onClick={() => onNuevo(diaSeleccionado)}>
            <Plus size={15} /> Agregar aquí
          </button>
        </div>
        {eventosDelDia.length === 0 ? (
          <div className="empty">No hay eventos este día.</div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {eventosDelDia.map((e) => (
              <FilaEventoDia
                key={e.id}
                e={e}
                onEditar={onEditar}
                onEliminar={onEliminar}
                onEliminarSerie={onEliminarSerie}
                onConvocatoria={onConvocatoria}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilaEventoDia({ e, onEditar, onEliminar, onEliminarSerie, onConvocatoria }) {
  return (
    <div className="panel evento-fila">
      <div className="evento-fila-info">
        <div className="evento-fila-titulo">
          <span className={"evento-tipo-pill evento-tipo-" + e.tipo}>{tipoEventoLabel(e.tipo)}</span>
          {e.titulo}
          {e.serieId && (
            <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
              (se repite)
            </span>
          )}
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {[e.hora, (e.categorias || []).join(", "), e.lugar].filter(Boolean).join(" · ") || "Sin más detalles"}
        </div>
      </div>
      <div className="evento-fila-acciones">
        {e.tipo === "partido" && (
          <button className="btn-secondary" onClick={() => onConvocatoria(e)}>
            <MessageCircle size={15} /> Convocatoria
          </button>
        )}
        <button className="icon-btn" onClick={() => onEditar(e)} aria-label="Editar">
          <Pencil size={16} />
        </button>
        {e.serieId && onEliminarSerie && (
          <button className="btn-secondary" onClick={() => onEliminarSerie(e)} title="Eliminar todas las repeticiones de este evento">
            <Trash2 size={14} /> Serie
          </button>
        )}
        {onEliminar && (
          <button className="icon-btn danger" onClick={() => onEliminar(e)} aria-label="Eliminar">
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function EventoModal({ initial, alumnos, onSave, onCancel, enviando }) {
  const [form, setForm] = useState({
    id: initial.id || null,
    titulo: initial.titulo || "",
    tipo: initial.tipo || "entrenamiento",
    fecha: initial.fecha || todayISO(),
    hora: initial.hora || "",
    categorias: initial.categorias || [],
    horario: initial.horario || "",
    lugar: initial.lugar || "",
    rival: initial.rival || "",
    horaConvocatoria: initial.horaConvocatoria || "",
    uniforme: initial.uniforme || "",
    indicaciones: initial.indicaciones || "",
    notas: initial.notas || "",
    alumnosConvocados: initial.alumnosConvocados || [],
    repetir: false,
    frecuencia: "semanal",
    hasta: "",
  });
  const [error, setError] = useState(null);
  const esPartido = form.tipo === "partido";
  const esEdicion = Boolean(form.id);

  const alumnosDeCategoria = form.categorias.length
    ? alumnos.filter((a) => form.categorias.includes(a.categoria) && a.activo !== false)
    : alumnos.filter((a) => a.activo !== false);

  function toggleCategoria(c) {
    setForm((prev) => {
      const set = new Set(prev.categorias);
      if (set.has(c)) set.delete(c);
      else set.add(c);
      return { ...prev, categorias: Array.from(set) };
    });
  }

  function toggleConvocado(id) {
    setForm((prev) => {
      const set = new Set(prev.alumnosConvocados);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, alumnosConvocados: Array.from(set) };
    });
  }

  function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!form.titulo.trim()) {
      setError("Escribe un título para el evento.");
      return;
    }
    if (!form.fecha) {
      setError("Elige una fecha.");
      return;
    }
    if (form.repetir && form.frecuencia !== "ninguna" && !form.hasta) {
      setError("Elige hasta qué fecha se debe repetir el evento.");
      return;
    }
    if (form.repetir && form.hasta && form.hasta < form.fecha) {
      setError("La fecha de \"repetir hasta\" no puede ser anterior a la fecha del evento.");
      return;
    }
    setError(null);
    onSave(form);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{form.id ? "Editar evento" : "Nuevo evento"}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="form">
          <label>
            Título
            <input
              type="text"
              value={form.titulo}
              onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              placeholder={esPartido ? "Ej: Atletic vs. Halcones" : "Ej: Entrenamiento categoría 2014-2015"}
              autoFocus
            />
          </label>
          <div className="form-row">
            <label>
              Tipo
              <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                {TIPOS_EVENTO.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <div className="form-section-label">
              Categorías {form.categorias.length > 0 && `(${form.categorias.length})`}
              {form.categorias.length === 0 && <span className="muted"> — ninguna elegida = todas / no aplica</span>}
            </div>
            <div className="evento-convocados-lista">
              {CATEGORIAS.map((c) => (
                <label key={c} className="checkbox-item">
                  <input type="checkbox" checked={form.categorias.includes(c)} onChange={() => toggleCategoria(c)} />
                  {c}
                </label>
              ))}
            </div>
          </div>
          <div className="form-row">
            <label>
              Fecha
              <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
            </label>
            <label>
              Hora {esPartido ? "del partido" : ""}
              <input type="time" value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} />
            </label>
          </div>
          <label>
            Lugar
            <input type="text" value={form.lugar} onChange={(e) => setForm({ ...form, lugar: e.target.value })} />
          </label>

          {!esEdicion && (
            <div>
              <label className="checkbox-item">
                <input
                  type="checkbox"
                  checked={form.repetir}
                  onChange={(e) => setForm({ ...form, repetir: e.target.checked })}
                />
                Repetir este evento
              </label>
              {form.repetir && (
                <div className="form-row" style={{ marginTop: 8 }}>
                  <label>
                    Frecuencia
                    <select value={form.frecuencia} onChange={(e) => setForm({ ...form, frecuencia: e.target.value })}>
                      <option value="semanal">Cada semana</option>
                      <option value="quincenal">Cada quince días</option>
                      <option value="mensual">Cada mes</option>
                    </select>
                  </label>
                  <label>
                    Repetir hasta
                    <input type="date" value={form.hasta} onChange={(e) => setForm({ ...form, hasta: e.target.value })} />
                  </label>
                </div>
              )}
            </div>
          )}

          {esPartido && (
            <>
              <div className="form-row">
                <label>
                  Rival
                  <input type="text" value={form.rival} onChange={(e) => setForm({ ...form, rival: e.target.value })} />
                </label>
                <label>
                  Hora de convocatoria
                  <input
                    type="time"
                    value={form.horaConvocatoria}
                    onChange={(e) => setForm({ ...form, horaConvocatoria: e.target.value })}
                  />
                </label>
              </div>
              <label>
                Uniforme
                <input type="text" value={form.uniforme} onChange={(e) => setForm({ ...form, uniforme: e.target.value })} />
              </label>
              <label>
                Indicaciones especiales
                <textarea
                  rows={2}
                  value={form.indicaciones}
                  onChange={(e) => setForm({ ...form, indicaciones: e.target.value })}
                />
              </label>
              <div>
                <div className="form-section-label">
                  Convocados ({form.alumnosConvocados.length})
                  {form.categorias.length === 0 && (
                    <span className="muted"> — elige una o más categorías para filtrar la lista</span>
                  )}
                </div>
                <div className="evento-convocados-lista">
                  {alumnosDeCategoria.length === 0 ? (
                    <p className="muted">No hay alumnos activos en esta categoría.</p>
                  ) : (
                    alumnosDeCategoria.map((a) => (
                      <label key={a.id} className="checkbox-item">
                        <input
                          type="checkbox"
                          checked={form.alumnosConvocados.includes(a.id)}
                          onChange={() => toggleConvocado(a.id)}
                        />
                        {a.nombre}
                      </label>
                    ))
                  )}
                </div>
              </div>
            </>
          )}

          {!esPartido && (
            <label>
              Notas
              <textarea rows={2} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
            </label>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={enviando}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" onClick={handleSubmit} disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Muestra el mensaje ya armado (convocatoria de partido, o aviso de
// cualquier otro tipo de evento) listo para copiar o abrir directo en
// WhatsApp — el dueño elige a qué grupo/contacto mandarlo desde ahí, la
// app no manda nada por su cuenta.
function ConvocatoriaModal({ evento, alumnos, onCerrar }) {
  const nombresConvocados = (evento.alumnosConvocados || [])
    .map((id) => {
      const a = alumnos.find((x) => x.id === id);
      return a ? a.nombre : null;
    })
    .filter(Boolean);
  const texto = mensajeEvento(evento, nombresConvocados);
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Si el navegador bloquea el portapapeles, el textarea de abajo se
      // puede seleccionar y copiar a mano — no hace falta más manejo.
    }
  }

  return (
    <div className="modal-overlay" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{evento.tipo === "partido" ? "Convocatoria" : "Aviso"}</h3>
          <button className="icon-btn" onClick={onCerrar} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="form">
          <textarea readOnly rows={12} value={texto} style={{ fontFamily: "inherit" }} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={copiar}>
            <Copy size={15} /> {copiado ? "¡Copiado!" : "Copiar texto"}
          </button>
          <a
            className="btn-primary"
            href={`https://wa.me/?text=${encodeURIComponent(texto)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle size={15} /> Abrir en WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

// CRM de leads: pipeline por etapa (Nuevo → Contactado → Prueba
// programada → Asistió → Inscrito / No inscrito) del formulario público de
// inscripción. Nada de información médica se muestra aquí en la tarjeta
// compacta — eso solo se ve dentro del detalle (ver LeadDetalleModal), con
// el mismo cuidado que ya tiene esta app con los datos financieros.
function CrmView({
  leads,
  leadsDelMesCount,
  tasaConversionLeads,
  leadsSinSeguimientoCount,
  monthLabelStr,
  onCambiarEstado,
  onAbrirLead,
}) {
  return (
    <div className="stack">
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#E7F7FD", color: "#0090C2" }}>
            <Users size={18} />
          </div>
          <div>
            <div className="kpi-label">Leads en {monthLabelStr}</div>
            <div className="kpi-value">{leadsDelMesCount}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#E7F7F1", color: "#158F63" }}>
            <ArrowUpRight size={18} />
          </div>
          <div>
            <div className="kpi-label">Tasa de conversión ({monthLabelStr})</div>
            <div className="kpi-value">{tasaConversionLeads}%</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#FBEAE9", color: "#C13F3B" }}>
            <AlertTriangle size={18} />
          </div>
          <div>
            <div className="kpi-label">Sin seguimiento (+3 días)</div>
            <div className="kpi-value">{leadsSinSeguimientoCount}</div>
          </div>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="empty">
          Todavía no ha llegado ningún lead del formulario de inscripción.
        </div>
      ) : (
        <div className="crm-pipeline">
          {ESTADOS_LEAD.map((col) => {
            const leadsCol = leads.filter((l) => l.estado === col.value);
            const info = estadoLeadInfo(col.value);
            return (
              <div className="crm-columna" key={col.value}>
                <div className="crm-columna-head">
                  <span className="badge" style={{ color: info.color, background: info.bg }}>
                    {col.label}
                  </span>
                  <span className="crm-columna-count">{leadsCol.length}</span>
                </div>
                <div className="crm-columna-lista">
                  {leadsCol.length === 0 ? (
                    <div className="empty small">Vacío.</div>
                  ) : (
                    leadsCol.map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        onAbrir={() => onAbrirLead(lead)}
                        onCambiarEstado={(estado) => onCambiarEstado(lead.id, estado)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Tarjeta compacta de un lead dentro de una columna del pipeline. Muestra
// solo lo necesario para triage rápido — nombre, contacto, programa(s) y
// cuánto tiempo lleva en la etapa — nunca datos médicos ni notas internas.
function LeadCard({ lead, onAbrir, onCambiarEstado }) {
  const dias = diasDesde(lead.createdAt);
  const telefono = telefonoContactoLead(lead);
  const programas = (lead.programas || []).join(", ");
  return (
    <div className="crm-card">
      <button type="button" className="crm-card-main" onClick={onAbrir}>
        <div className="cell-title">{lead.nombreAlumno || "(sin nombre)"}</div>
        {telefono && <div className="cell-sub">{telefono}</div>}
        {programas && <div className="cell-sub crm-card-programa">{programas}</div>}
        {lead.fechaPrueba && (
          <div className="cell-sub crm-card-prueba">Prueba deseada: {formatDiaLargo(lead.fechaPrueba)}</div>
        )}
        <div className="crm-card-dias">
          {dias === null ? "" : dias === 0 ? "Hoy" : `Hace ${dias} día(s)`}
        </div>
      </button>
      <select
        className="crm-card-select"
        value={lead.estado}
        onChange={(e) => onCambiarEstado(e.target.value)}
        onClick={(e) => e.stopPropagation()}
      >
        {ESTADOS_LEAD.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Detalle de un lead: todos los campos capturados (incluida la información
// médica, que aquí SÍ se muestra porque es la vista de detalle, con acceso
// solo para admin), más "notas internas" (editable, privado) y el botón
// para convertirlo en alumno.
function LeadDetalleModal({ lead, onCerrar, onGuardarNotas, onConvertir, onEliminar, enviando }) {
  const [notas, setNotas] = useState(lead.notasInternas || "");

  return (
    <div className="modal-overlay" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{lead.nombreAlumno || "(sin nombre)"}</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {onEliminar && (
              <button className="icon-btn danger" onClick={onEliminar} aria-label="Eliminar contacto" title="Eliminar contacto">
                <Trash2 size={16} />
              </button>
            )}
            <button className="icon-btn" onClick={onCerrar} aria-label="Cerrar">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="crm-detalle-body">
          <div className="form-section-label">Datos del alumno</div>
          {(lead.fotoUrl || lead.feEdadUrl) && (
            <div className="crm-detalle-archivos" style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12 }}>
              {lead.fotoUrl && (
                <a href={lead.fotoUrl} target="_blank" rel="noopener noreferrer" title="Ver foto en tamaño completo">
                  <img
                    src={lead.fotoUrl}
                    alt={"Foto de " + (lead.nombreAlumno || "alumno")}
                    style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", border: "1px solid #ddd" }}
                  />
                </a>
              )}
              {lead.feEdadUrl && (
                <a href={lead.feEdadUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                  Ver fe de edad
                </a>
              )}
            </div>
          )}
          <div className="crm-detalle-grid">
            <DetalleCampo label="Fecha de nacimiento" valor={lead.fechaNacimiento} />
            <DetalleCampo label="Género" valor={lead.genero} />
            <DetalleCampo label="Posición" valor={lead.posicion} />
            <DetalleCampo label="Talla de uniforme" valor={lead.tallaUniforme} />
            <DetalleCampo label="Programa(s)" valor={(lead.programas || []).join(", ")} />
            <DetalleCampo
              label="Día preferido para la prueba"
              valor={lead.fechaPrueba ? formatDiaLargo(lead.fechaPrueba) : null}
            />
          </div>

          <div className="form-section-label">Padre</div>
          <div className="crm-detalle-grid">
            <DetalleCampo label="Nombre" valor={lead.nombrePadre} />
            <DetalleCampo label="Fecha de nacimiento" valor={lead.fechaNacimientoPadre} />
            <DetalleCampo label="Teléfono" valor={lead.telefonoPadre} />
            <DetalleCampo label="Correo" valor={lead.correoPadre} />
          </div>

          <div className="form-section-label">Madre</div>
          <div className="crm-detalle-grid">
            <DetalleCampo label="Nombre" valor={lead.nombreMadre} />
            <DetalleCampo label="Fecha de nacimiento" valor={lead.fechaNacimientoMadre} />
            <DetalleCampo label="Teléfono" valor={lead.telefonoMadre} />
            <DetalleCampo label="Correo" valor={lead.correoMadre} />
          </div>

          <div className="form-section-label">Información médica</div>
          <div className="crm-detalle-grid">
            <DetalleCampo label="Alergias" valor={lead.alergias} ancho />
            <DetalleCampo label="Condiciones médicas" valor={lead.condicionesMedicas} ancho />
            <DetalleCampo label="Medicamentos que no puede ingerir" valor={lead.medicamentos} ancho />
            <DetalleCampo label="¿Tiene seguro médico?" valor={lead.tieneSeguro === null || lead.tieneSeguro === undefined ? "" : lead.tieneSeguro ? "Sí" : "No"} />
            <DetalleCampo label="Aseguradora / teléfono / póliza" valor={lead.seguroInfo} ancho />
            <DetalleCampo
              label="¿Le interesa info de seguro?"
              valor={lead.interesadoSeguro === null || lead.interesadoSeguro === undefined ? "" : lead.interesadoSeguro ? "Sí, interesado" : "No gracias"}
            />
          </div>

          {lead.comentarios && (
            <>
              <div className="form-section-label">Comentarios</div>
              <p className="muted" style={{ marginTop: 6 }}>{lead.comentarios}</p>
            </>
          )}

          <div className="form-section-label">Notas internas (solo staff)</div>
          <div className="form" style={{ gap: 8 }}>
            <textarea
              rows={3}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Ej: llamé el martes, quedó de confirmar horario…"
            />
            <button
              type="button"
              className="btn-secondary"
              style={{ alignSelf: "flex-start" }}
              onClick={() => onGuardarNotas(lead.id, notas)}
              disabled={enviando}
            >
              Guardar notas
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCerrar} disabled={enviando}>
            Cerrar
          </button>
          <button type="button" className="btn-primary" onClick={onConvertir} disabled={enviando}>
            Convertir en alumno
          </button>
        </div>
      </div>
    </div>
  );
}

function DetalleCampo({ label, valor, ancho }) {
  return (
    <div className={"crm-detalle-campo" + (ancho ? " ancho" : "")}>
      <div className="crm-detalle-label">{label}</div>
      <div className="crm-detalle-valor">{valor || valor === false ? String(valor) : "—"}</div>
    </div>
  );
}

// Paso de confirmación para convertir un lead en alumno: el admin elige
// categoría, horario y tarifa mensual (lo que el lead marcó en "programas"
// no coincide necesariamente con CATEGORIAS/HORARIOS de esta app, así que
// no se adivina — se elige aquí a mano) y luego llama a
// convertir_lead_a_alumno.
function ConvertirLeadModal({ lead, onConfirmar, onCancelar, enviando }) {
  const [categoria, setCategoria] = useState(CATEGORIAS[0]);
  const [horario, setHorario] = useState(HORARIOS[0]);
  const [tarifaMensual, setTarifaMensual] = useState("");
  const [error, setError] = useState(null);

  function handleConfirmar() {
    const tarifaNum = parseMonto(tarifaMensual);
    if (tarifaMensual === "" || isNaN(tarifaNum) || tarifaNum < 0) {
      setError("Ingresa una tarifa mensual válida (por ejemplo 425 o 425.00).");
      return;
    }
    setError(null);
    onConfirmar({ categoria, horario, tarifaMensual: tarifaNum });
  }

  return (
    <div className="modal-overlay" onClick={enviando ? undefined : onCancelar}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <h3>Convertir a {lead.nombreAlumno} en alumno</h3>
        <p className="muted">
          El programa que marcó en el formulario ({(lead.programas || []).join(", ") || "—"}) no
          se traduce solo — elige aquí la categoría, el horario y la tarifa mensual que le
          corresponden en la academia.
        </p>
        {error && <div className="form-error">{error}</div>}
        <div className="form">
          <label>
            Categoría
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            Horario
            <select value={horario} onChange={(e) => setHorario(e.target.value)}>
              {HORARIOS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tarifa mensual
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={tarifaMensual}
              onChange={(e) => setTarifaMensual(e.target.value)}
              autoFocus
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancelar} disabled={enviando}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" onClick={handleConfirmar} disabled={enviando}>
              {enviando ? "Convirtiendo…" : "Convertir en alumno"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Pasar lista. La usan tanto el admin como los entrenadores — a los
// entrenadores se les pasa una lista de alumnos SIN tarifa ni saldo
// (viene de la función alumnos_para_asistencia(), que nunca expone esas
// columnas), así que este componente ni siquiera tiene esos datos
// disponibles para mostrar por accidente.
// Cartera / seguimiento de cobros: alumnos activos con saldo pendiente,
// ordenados de mayor a menor deuda, cada uno con un mensaje de recordatorio
// ya armado listo para copiar o mandar directo a WhatsApp al teléfono del
// encargado. Nadie se manda automáticamente — la persona elige y confirma
// el envío desde su propio WhatsApp, igual que con las convocatorias.
function CarteraView({ alumnosActivos }) {
  const [busqueda, setBusqueda] = useState("");
  const [copiadoId, setCopiadoId] = useState(null);

  const conDeuda = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return alumnosActivos
      .filter((a) => Number(a.saldoPendiente || 0) > 0)
      .filter((a) =>
        q
          ? a.nombre.toLowerCase().includes(q) ||
            (a.encargado || "").toLowerCase().includes(q) ||
            (a.categoria || "").toLowerCase().includes(q)
          : true
      )
      .sort((a, b) => Number(b.saldoPendiente || 0) - Number(a.saldoPendiente || 0));
  }, [alumnosActivos, busqueda]);

  const totalDeuda = conDeuda.reduce((s, a) => s + Number(a.saldoPendiente || 0), 0);

  async function copiar(a) {
    try {
      await navigator.clipboard.writeText(mensajeRecordatorioPago(a));
      setCopiadoId(a.id);
      setTimeout(() => setCopiadoId(null), 2000);
    } catch {
      // Si el navegador bloquea el portapapeles no pasa nada — el botón de
      // WhatsApp de al lado no depende de esto y sigue funcionando.
    }
  }

  return (
    <div className="stack">
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#FBEAE9", color: "#C13F3B" }}>
            <AlertTriangle size={18} />
          </div>
          <div>
            <div className="kpi-label">Alumnos con saldo pendiente</div>
            <div className="kpi-value">{conDeuda.length}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#FCF1DD", color: "#B4790A" }}>
            <Wallet size={18} />
          </div>
          <div>
            <div className="kpi-label">Total por cobrar</div>
            <div className="kpi-value">{formatQ(totalDeuda)}</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              placeholder="Buscar por nombre, encargado o categoría…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
        </div>
      </div>

      {conDeuda.length === 0 ? (
        <div className="empty">No hay alumnos con saldo pendiente. Todo al día.</div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {conDeuda.map((a) => {
            const tone = saldoTone(Number(a.saldoPendiente || 0), Number(a.tarifaMensual || 0));
            const numeroWa = telefonoWhatsapp(a.telefono);
            const texto = mensajeRecordatorioPago(a);
            return (
              <div key={a.id} className="panel cartera-fila">
                <div className="cartera-fila-info">
                  <div className="cartera-fila-titulo">
                    {a.nombre}
                    <span className="badge" style={{ color: tone.color, background: tone.bg }}>
                      {tone.label}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {[a.categoria, a.encargado, a.telefono].filter(Boolean).join(" · ") || "Sin más datos"}
                  </div>
                </div>
                <div className="cartera-fila-monto num debt">{formatQ(a.saldoPendiente)}</div>
                <div className="cartera-fila-acciones">
                  <button className="btn-secondary" onClick={() => copiar(a)}>
                    <Copy size={15} /> {copiadoId === a.id ? "¡Copiado!" : "Copiar"}
                  </button>
                  <a
                    className="btn-primary"
                    href={`https://wa.me/${numeroWa || ""}?text=${encodeURIComponent(texto)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle size={15} /> WhatsApp
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Reporte semanal de operación: un resumen de CRM, cobros, asistencia y
// próximos eventos de los últimos 7 días, ya armado en texto para copiar o
// mandar por WhatsApp — pensado para el reporte que Alejandro le manda al
// dueño cada semana, sin tener que armarlo a mano.
function ReporteSemanalView({ leads, alumnos, pagos, asistencias, eventos }) {
  const [copiado, setCopiado] = useState(false);
  const texto = useMemo(
    () => generarReporteSemanal({ leads, alumnos, pagos, asistencias, eventos }),
    [leads, alumnos, pagos, asistencias, eventos]
  );

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Si el navegador bloquea el portapapeles, el texto de abajo se
      // puede seleccionar y copiar a mano — no hace falta más manejo.
    }
  }

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head">
          <h2>Reporte semanal</h2>
          <span className="muted">Últimos 7 días, armado automáticamente</span>
        </div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Revísalo antes de mandarlo — puedes ajustar el texto a mano si hace falta agregar algo.
        </p>
        <textarea
          readOnly
          rows={18}
          value={texto}
          style={{ fontFamily: "inherit", width: "100%", boxSizing: "border-box" }}
        />
        <div className="modal-actions" style={{ justifyContent: "flex-start", marginTop: 12 }}>
          <button type="button" className="btn-secondary" onClick={copiar}>
            <Copy size={15} /> {copiado ? "¡Copiado!" : "Copiar texto"}
          </button>
          <a
            className="btn-primary"
            href={`https://wa.me/?text=${encodeURIComponent(texto)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle size={15} /> Abrir en WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

// Seguimiento de uniformes: quién tiene número y talla asignados, y quién
// ya recibió su uniforme o sigue pendiente. El número y la talla se editan
// desde la ficha del alumno (Editar) — aquí solo se da seguimiento a la
// entrega, con un botón rápido para marcarla sin tener que abrir el modal.
function UniformesView({ alumnosActivos, onMarcarEntregado }) {
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("pendientes");

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return alumnosActivos
      .filter((a) =>
        filtro === "todos" ? true : filtro === "pendientes" ? !a.uniformeEntregado : a.uniformeEntregado
      )
      .filter((a) =>
        q ? a.nombre.toLowerCase().includes(q) || (a.categoria || "").toLowerCase().includes(q) : true
      )
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [alumnosActivos, busqueda, filtro]);

  const pendientesCount = alumnosActivos.filter((a) => !a.uniformeEntregado).length;

  return (
    <div className="stack">
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#FCF1DD", color: "#B4790A" }}>
            <AlertTriangle size={18} />
          </div>
          <div>
            <div className="kpi-label">Uniformes pendientes de entregar</div>
            <div className="kpi-value">{pendientesCount}</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              placeholder="Buscar por nombre o categoría…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            <option value="pendientes">Pendientes</option>
            <option value="entregados">Entregados</option>
            <option value="todos">Todos</option>
          </select>
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div className="empty">
          {filtro === "pendientes" ? "Nadie tiene el uniforme pendiente. Todo entregado." : "No hay alumnos que coincidan."}
        </div>
      ) : (
        <div className="panel">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Categoría</th>
                  <th>Talla</th>
                  <th>Número</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((a) => (
                  <tr key={a.id}>
                    <td className="cell-title">{a.nombre}</td>
                    <td>{a.categoria}</td>
                    <td>{a.tallaUniforme || "—"}</td>
                    <td>{a.numeroUniforme != null ? `#${a.numeroUniforme}` : "—"}</td>
                    <td>
                      <button
                        type="button"
                        className={"pill-toggle" + (a.uniformeEntregado ? " on" : "")}
                        onClick={() => onMarcarEntregado(a.id, !a.uniformeEntregado)}
                      >
                        {a.uniformeEntregado ? "Entregado" : "Marcar entregado"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Staff: quién tiene acceso a la app, con qué rol, y (si es entrenador)
// de qué categorías está a cargo. Crear el LOGIN sigue siendo manual en
// Supabase (Authentication → Users) — esta pantalla es para todo lo demás:
// completar sus datos, asignarle categorías, y activar/desactivar su
// acceso sin tocar SQL.
function StaffView({ staff, onNuevo, onEditar, onToggleActivo, onEliminar }) {
  const activos = staff.filter((p) => p.activo).length;

  return (
    <div className="stack">
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: "#E7F7F1", color: "#158F63" }}>
            <Users size={18} />
          </div>
          <div>
            <div className="kpi-label">Staff con acceso activo</div>
            <div className="kpi-value">{activos}</div>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div />
        <div className="toolbar-actions">
          <button className="btn-primary" onClick={onNuevo}>
            <Plus size={16} /> Agregar colaborador
          </button>
        </div>
      </div>

      {staff.length === 0 ? (
        <div className="empty">
          No hay nadie en Staff todavía. Primero crea su login en Supabase (Authentication → Users), y luego agrégalo aquí con el botón de arriba.
        </div>
      ) : (
        <div className="panel">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Rol</th>
                  <th>Categorías</th>
                  <th>Contacto</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {staff.map((p) => (
                  <tr key={p.id}>
                    <td className="cell-title">{p.nombre || "(sin nombre)"}</td>
                    <td>{rolLabel(p.rol)}</td>
                    <td>
                      {p.rol === "entrenador"
                        ? p.categorias.length
                          ? p.categorias.join(", ")
                          : <span className="muted">Sin asignar</span>
                        : <span className="muted">—</span>}
                    </td>
                    <td>
                      {p.telefono || p.correo ? (
                        <>
                          {p.telefono}
                          {p.telefono && p.correo ? " · " : ""}
                          {p.correo}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={"pill-toggle" + (p.activo ? " on" : " pill-ausente on")}
                        onClick={() => onToggleActivo(p)}
                      >
                        {p.activo ? "Activo" : "Desactivado"}
                      </button>
                    </td>
                    <td>
                      <div className="actions">
                        <button className="icon-btn" onClick={() => onEditar(p)} aria-label="Editar">
                          <Pencil size={15} />
                        </button>
                        <button className="icon-btn" onClick={() => onEliminar(p)} aria-label="Eliminar">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StaffModal({ initial, onSave, onCancel, enviando }) {
  const esNuevo = !initial.id;
  const [form, setForm] = useState({
    id: initial.id || null,
    id_nuevo: "",
    nombre: initial.nombre || "",
    rol: initial.rol || "entrenador",
    telefono: initial.telefono || "",
    correo: initial.correo || "",
    categorias: initial.categorias || [],
  });
  const [error, setError] = useState(null);

  function toggleCategoria(c) {
    setForm((prev) => {
      const set = new Set(prev.categorias);
      if (set.has(c)) set.delete(c);
      else set.add(c);
      return { ...prev, categorias: Array.from(set) };
    });
  }

  function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!form.nombre.trim()) {
      setError("Escribe su nombre.");
      return;
    }
    if (esNuevo && !form.id_nuevo.trim()) {
      setError("Pega el ID del usuario que ya creaste en Supabase (Authentication → Users → clic en la persona → \"User UID\").");
      return;
    }
    setError(null);
    onSave(form);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{esNuevo ? "Agregar colaborador" : "Editar colaborador"}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="form">
          {esNuevo && (
            <label>
              ID del usuario (de Supabase → Authentication → Users)
              <input
                type="text"
                value={form.id_nuevo}
                onChange={(e) => setForm({ ...form, id_nuevo: e.target.value })}
                placeholder="Pega aquí el User UID — primero créale el login allá"
                autoFocus
              />
            </label>
          )}
          <label>
            Nombre
            <input
              type="text"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              autoFocus={!esNuevo}
            />
          </label>
          <div className="form-row">
            <label>
              Rol
              <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })}>
                {ROLES_STAFF.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Teléfono
              <input
                type="tel"
                value={form.telefono}
                onChange={(e) => setForm({ ...form, telefono: e.target.value })}
              />
            </label>
          </div>
          <label>
            Correo
            <input
              type="email"
              value={form.correo}
              onChange={(e) => setForm({ ...form, correo: e.target.value })}
            />
          </label>

          {form.rol === "entrenador" && (
            <div>
              <div className="form-section-label">
                Categorías a su cargo {form.categorias.length > 0 && `(${form.categorias.length})`}
                {form.categorias.length === 0 && <span className="muted"> — sin asignar, no vería alumnos todavía</span>}
              </div>
              <div className="evento-convocados-lista">
                {CATEGORIAS.map((c) => (
                  <label key={c} className="checkbox-item">
                    <input type="checkbox" checked={form.categorias.includes(c)} onChange={() => toggleCategoria(c)} />
                    {c}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel} disabled={enviando}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

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

function AlumnoModal({ initial, onSave, onCancel, enviando, showToast }) {
  const [form, setForm] = useState({
    id: initial.id || null,
    nombre: initial.nombre || "",
    encargado: initial.encargado || "",
    telefono: initial.telefono || "",
    categoria: initial.categoria || CATEGORIAS[0],
    horario: initial.horario || HORARIOS[0],
    tarifaMensual: initial.tarifaMensual != null ? String(initial.tarifaMensual) : "",
    estado: initial.estado || estadoDeRespaldo(!!initial.becado, initial.activo !== false),
    fechaNacimiento: initial.fechaNacimiento || "",
    colegio: initial.colegio || "",
    contactoEmergenciaNombre: initial.contactoEmergenciaNombre || "",
    contactoEmergenciaTelefono: initial.contactoEmergenciaTelefono || "",
    posicion: initial.posicion || "",
    posicionSecundaria: initial.posicionSecundaria || "",
    piernaDominante: initial.piernaDominante || "",
    fotoUrl: initial.fotoUrl || "",
    numeroUniforme: initial.numeroUniforme != null ? String(initial.numeroUniforme) : "",
    tallaUniforme: initial.tallaUniforme || "",
    uniformeEntregado: !!initial.uniformeEntregado,
    soloCampeonato: !!initial.soloCampeonato,
  });
  const [error, setError] = useState(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);

  // Sube la foto apenas se elige el archivo (no espera a que se guarde todo
  // el formulario): valida tipo/tamaño, la sube al bucket 'fotos-alumnos'
  // con un nombre único, y guarda la URL pública en el campo fotoUrl.
  async function handleFotoSeleccionada(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast && showToast("Elige un archivo de imagen (jpg, png, etc.).", true);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast && showToast("La foto pesa más de 5MB. Elige una más liviana.", true);
      return;
    }
    setSubiendoFoto(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const base = form.id || `nuevo-${Date.now()}`;
      const ruta = `${base}-${Date.now()}.${ext}`;
      const { error: errSubida } = await supabase.storage
        .from("fotos-alumnos")
        .upload(ruta, file, { upsert: true });
      if (errSubida) {
        showToast && showToast("No se pudo subir la foto (revisa tu conexión). Inténtalo de nuevo.", true);
        return;
      }
      const { data } = supabase.storage.from("fotos-alumnos").getPublicUrl(ruta);
      setForm((prev) => ({ ...prev, fotoUrl: data?.publicUrl || "" }));
    } finally {
      setSubiendoFoto(false);
    }
  }

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
    let tarifaNum = 0;
    if (!form.soloCampeonato) {
      tarifaNum = parseMonto(form.tarifaMensual);
      if (form.tarifaMensual === "" || isNaN(tarifaNum) || tarifaNum < 0) {
        problemas.push("Ingresa una tarifa mensual válida (por ejemplo 425 o 425.00).");
      }
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
          <div className="foto-alumno-picker">
            <div className="avatar-alumno-wrap">
              {subiendoFoto ? (
                <div className="avatar-alumno avatar-alumno-placeholder" style={{ width: 72, height: 72 }}>
                  <Loader2 size={22} className="spin" />
                </div>
              ) : (
                <AvatarAlumno nombre={form.nombre} fotoUrl={form.fotoUrl} size={72} />
              )}
            </div>
            <label className="btn-secondary foto-alumno-btn">
              <Camera size={15} />
              {form.fotoUrl ? "Cambiar foto" : "Subir foto"}
              <input
                type="file"
                accept="image/*"
                onChange={handleFotoSeleccionada}
                disabled={subiendoFoto}
                style={{ display: "none" }}
              />
            </label>
          </div>
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
          <label className="checkbox-item" style={{ border: "1px solid var(--border-soft)", borderRadius: 10 }}>
            <input
              type="checkbox"
              checked={form.soloCampeonato}
              onChange={(e) => setForm({ ...form, soloCampeonato: e.target.checked })}
            />
            Solo campeonato (no entrena ni paga mensualidad — solo la cuota del campeonato en que participe)
          </label>
          {!form.soloCampeonato && (
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
          )}
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

          <div className="form-section-label">Datos deportivos</div>
          <label>
            Fecha de nacimiento
            <input
              type="date"
              value={form.fechaNacimiento}
              onChange={(e) => setForm({ ...form, fechaNacimiento: e.target.value })}
            />
            {form.fechaNacimiento && (
              <span className="edad-calculada">{calcularEdad(form.fechaNacimiento)} años</span>
            )}
          </label>
          <label>
            Colegio
            <input
              type="text"
              value={form.colegio}
              onChange={(e) => setForm({ ...form, colegio: e.target.value })}
            />
          </label>
          <div className="form-row">
            <label>
              Posición
              <select
                value={form.posicion}
                onChange={(e) => setForm({ ...form, posicion: e.target.value })}
              >
                <option value="">Sin definir</option>
                {POSICIONES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Posición secundaria
              <select
                value={form.posicionSecundaria}
                onChange={(e) => setForm({ ...form, posicionSecundaria: e.target.value })}
              >
                <option value="">Ninguna</option>
                {POSICIONES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Pierna dominante
            <select
              value={form.piernaDominante}
              onChange={(e) => setForm({ ...form, piernaDominante: e.target.value })}
            >
              <option value="">Sin definir</option>
              {PIERNA_DOMINANTE.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <div className="form-section-label">Uniforme</div>
          <div className="form-row">
            <label>
              Número de camiseta
              <input
                type="number"
                min="0"
                value={form.numeroUniforme}
                onChange={(e) => setForm({ ...form, numeroUniforme: e.target.value })}
              />
            </label>
            <label>
              Talla
              <select value={form.tallaUniforme} onChange={(e) => setForm({ ...form, tallaUniforme: e.target.value })}>
                <option value="">Sin definir</option>
                {TALLAS_UNIFORME.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="checkbox-item">
            <input
              type="checkbox"
              checked={form.uniformeEntregado}
              onChange={(e) => setForm({ ...form, uniformeEntregado: e.target.checked })}
            />
            Uniforme entregado
          </label>

          <div className="form-section-label">Contacto de emergencia</div>
          <div className="form-row">
            <label>
              Nombre
              <input
                type="text"
                value={form.contactoEmergenciaNombre}
                onChange={(e) => setForm({ ...form, contactoEmergenciaNombre: e.target.value })}
              />
            </label>
            <label>
              Teléfono
              <input
                type="text"
                value={form.contactoEmergenciaTelefono}
                onChange={(e) => setForm({ ...form, contactoEmergenciaTelefono: e.target.value })}
              />
            </label>
          </div>

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

      /* ---------- Barra lateral agrupada (Admin / Administrativo) ---------- */
      .app-shell { display: flex; align-items: flex-start; }
      .sidebar-toggle-movil { display: none; }
      .sidebar {
        width: 208px; flex-shrink: 0; align-self: stretch;
        background: var(--card); border-right: 1px solid var(--border-soft);
        padding: 14px 10px; display: flex; flex-direction: column; gap: 3px;
      }
      .sidebar-group { display: flex; flex-direction: column; }
      .sidebar-group-header {
        display: flex; align-items: center; justify-content: space-between; gap: 6px;
        width: 100%; text-align: left; border: none; background: transparent;
        padding: 10px 12px; font-size: 13.5px; font-weight: 600; color: var(--charcoal);
        cursor: pointer; border-radius: var(--radius-sm); font-family: var(--font-brand);
        transition: background 0.15s ease, color 0.15s ease;
      }
      .sidebar-group-header svg { color: #ABB0B3; flex-shrink: 0; }
      .sidebar-group-header:hover { background: #F7F8F9; }
      .sidebar-group-header:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
      .sidebar-group-header.active { color: var(--blue-dark); }
      .sidebar-subtabs { display: flex; flex-direction: column; padding-left: 8px; margin: 2px 0 6px; }
      .sidebar-tab {
        border: none; background: transparent; text-align: left; padding: 9px 12px;
        font-size: 13px; font-weight: 500; color: #8A8D90; cursor: pointer;
        border-radius: var(--radius-sm); font-family: var(--font-body);
        transition: color 0.15s ease, background 0.15s ease;
      }
      .sidebar-tab:hover { color: var(--charcoal); background: #F7F8F9; }
      .sidebar-tab:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
      .sidebar-tab.active { color: var(--blue-dark); background: #E6F8FE; font-weight: 600; }
      .sidebar-tab-grupo {
        font-family: var(--font-brand); font-size: 13.5px; font-weight: 600; color: var(--charcoal);
      }
      .sidebar-tab-grupo.active { color: var(--blue-dark); background: #E6F8FE; }

      .content { padding: 22px; background: linear-gradient(180deg, #E1F4FC 0%, var(--bg) 380px); flex: 1; min-width: 0; }
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
      .badge-numero { display: inline-block; margin-left: 7px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.2px; color: #6C6F72; background: #EFEFF0; padding: 1.5px 7px; border-radius: var(--radius-pill); vertical-align: middle; }
      .badge-campeonato { display: inline-block; margin-left: 7px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.2px; color: #0090C2; background: #E7F7FD; padding: 1.5px 7px; border-radius: var(--radius-pill); vertical-align: middle; }

      .cell-alumno { display: flex; align-items: center; gap: 10px; }
      .avatar-alumno { border-radius: 50%; object-fit: cover; flex-shrink: 0; }
      .avatar-alumno-placeholder { display: flex; align-items: center; justify-content: center; background: #E7F7FD; color: #0090C2; font-weight: 700; letter-spacing: 0.3px; }
      .foto-alumno-picker { display: flex; align-items: center; gap: 14px; }
      .avatar-alumno-wrap { flex-shrink: 0; }
      .foto-alumno-btn { display: inline-flex !important; flex-direction: row !important; align-items: center; gap: 6px; cursor: pointer; width: auto; font-size: 13px !important; color: var(--charcoal) !important; }
      .form-section-label { font-size: 12px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase; color: #8A8D90; border-top: 1px solid var(--border-soft); padding-top: 14px; margin-top: 2px; }
      .edad-calculada { font-size: 12px; color: #8A8D90; font-weight: 400; }
      .cell-sub { font-size: 12px; color: #8A8D90; margin-top: 1px; }

      /* Calendario operativo */
      /* Checkboxes: en vez del cuadrito gris del sistema operativo, se ven
         en el azul de marca (accent-color, soportado por todos los
         navegadores modernos) y cada fila de "checkbox-item" (categorías,
         convocados, etc.) resalta al pasar el mouse para que se note que
         es clicable. */
      input[type="checkbox"] { accent-color: var(--blue); width: 17px; height: 17px; cursor: pointer; flex-shrink: 0; }
      .checkbox-item { display: flex; align-items: center; gap: 9px; font-weight: 400; font-size: 14px; padding: 7px 9px; border-radius: 8px; cursor: pointer; transition: background 0.12s; }
      .checkbox-item:hover { background: #F4F6F7; }
      .evento-convocados-lista { max-height: 220px; overflow-y: auto; border: 1px solid var(--border-soft); border-radius: 10px; padding: 6px 10px; margin-top: 6px; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0 6px; }
      .evento-fila { display: flex; align-items: center; gap: 14px; padding: 12px 14px; }
      .evento-fila-fecha { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 46px; flex-shrink: 0; background: var(--bg-soft, #F4F6F8); border-radius: 8px; padding: 6px 0; }
      .evento-fila-dia { font-size: 18px; font-weight: 700; color: var(--charcoal); line-height: 1; }
      .evento-fila-mes { font-size: 11px; text-transform: uppercase; color: #8A8D90; margin-top: 2px; }
      .evento-fila-info { flex: 1; min-width: 0; }
      .evento-fila-titulo { font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .evento-fila-acciones { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
      .evento-tipo-pill { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; padding: 2px 8px; border-radius: 999px; background: #E7F7FD; color: #0090C2; }
      .evento-tipo-partido { background: #FBEAE9; color: #C13F3B; }
      .evento-tipo-torneo { background: #FBEAE9; color: #C13F3B; }
      .evento-tipo-entrenamiento { background: #E7F7F1; color: #158F63; }
      .evento-tipo-suspension { background: #F1EAFB; color: #6B3FC1; }
      .evento-tipo-clase_prueba { background: #FCF1DD; color: #B4790A; }

      /* Resultados de partidos (Equipos y competencias) */
      .resultado-pill { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; padding: 2px 8px; border-radius: 999px; }
      .resultado-ganado { background: #E7F7F1; color: #158F63; }
      .resultado-perdido { background: #FBEAE9; color: #C13F3B; }
      .resultado-empate { background: #F1EFEA; color: #6A6D70; }
      .tarjeta-pill { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; padding: 2px 8px; border-radius: 999px; flex-shrink: 0; }
      .tarjeta-amarilla { background: #FCF1DD; color: #B4790A; }
      .tarjeta-roja { background: #FBEAE9; color: #C13F3B; }

      /* Evaluaciones deportivas */
      .evaluacion-fila { display: flex; align-items: flex-start; gap: 14px; padding: 12px 14px; }
      .evaluacion-fila-info { flex: 1; min-width: 0; }
      .evaluacion-dims { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; }
      .evaluacion-dim { display: flex; flex-direction: column; gap: 3px; }
      .rating-chips { display: flex; gap: 5px; }
      .rating-chip { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--border-soft); background: #fff; font-weight: 700; font-size: 13px; cursor: pointer; color: #8A8D90; transition: background 0.12s, color 0.12s, border-color 0.12s; }
      .rating-chip:hover { background: #F4F6F7; }
      .rating-chip.active { background: var(--blue); border-color: var(--blue); color: #fff; }
      .rating-dots { display: inline-flex; gap: 2px; }
      .rating-dot { width: 8px; height: 8px; border-radius: 50%; background: #E3E6E8; }
      .rating-dot.filled { background: var(--blue); }

      /* Cartera / recordatorios de pago */
      .cartera-fila { display: flex; align-items: center; gap: 14px; padding: 12px 14px; flex-wrap: wrap; }
      .cartera-fila-info { flex: 1; min-width: 160px; }
      .cartera-fila-titulo { font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .cartera-fila-monto { font-size: 16px; font-weight: 700; flex-shrink: 0; }
      .cartera-fila-acciones { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

      .calendario-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
      .calendario-nav { display: flex; align-items: center; gap: 4px; }
      .calendario-mes-label { font-size: 17px; font-weight: 700; color: var(--charcoal); min-width: 160px; text-align: center; text-transform: capitalize; }
      .calendario-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
      .calendario-dia-header { text-align: center; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #8A8D90; padding: 4px 0; }
      .calendario-celda {
        min-height: 90px; background: #fff; border: 1px solid var(--border-soft); border-radius: 10px;
        padding: 6px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; transition: border-color 0.15s ease, background 0.15s ease;
      }
      .calendario-celda:hover { border-color: #BEE9FA; }
      .calendario-celda-fuera { background: #FAFBFB; color: #B7BCBF; }
      .calendario-celda-fuera .calendario-celda-numero { color: #C4C9CC; }
      .calendario-celda-hoy { border-color: var(--blue, #00B6F1); }
      .calendario-celda-seleccionada { background: #E7F7FD; border-color: var(--blue, #00B6F1); }
      .calendario-celda-numero { font-size: 12.5px; font-weight: 700; color: var(--charcoal); }
      .calendario-celda-eventos { display: flex; flex-direction: column; gap: 3px; }
      .calendario-evento-pill {
        font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 6px; background: #E7F7FD; color: #0090C2;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .calendario-evento-pill.evento-tipo-partido, .calendario-evento-pill.evento-tipo-torneo { background: #FBEAE9; color: #C13F3B; }
      .calendario-evento-pill.evento-tipo-entrenamiento { background: #E7F7F1; color: #158F63; }
      .calendario-evento-pill.evento-tipo-suspension { background: #F1EAFB; color: #6B3FC1; }
      .calendario-evento-pill.evento-tipo-clase_prueba { background: #FCF1DD; color: #B4790A; }
      .calendario-evento-mas { font-size: 10.5px; color: #8A8D90; padding: 0 4px; }
      @media (max-width: 720px) {
        .calendario-celda { min-height: 60px; }
        .calendario-mes-label { min-width: 0; font-size: 15px; }
        .calendario-evento-pill { font-size: 10px; }
      }

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
      .form textarea {
        font-family: var(--font-body); font-size: 15px; padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border);
        color: var(--ink); background: #fff; outline: none; transition: border-color 0.15s ease, box-shadow 0.15s ease; width: 100%; resize: vertical;
      }
      .form textarea:focus { border-color: var(--blue); box-shadow: 0 0 0 3px #E7F7FD; }

      /* ---------- CRM de leads ---------- */
      .crm-pipeline { display: flex; gap: 12px; align-items: flex-start; overflow-x: auto; padding-bottom: 6px; }
      .crm-columna {
        background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md);
        flex: 0 0 250px; display: flex; flex-direction: column; max-height: 72vh; box-shadow: var(--shadow-card);
      }
      .crm-columna-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 12px 10px; border-bottom: 1px solid var(--border-soft); }
      .crm-columna-count { font-size: 12px; color: #8A8D90; font-weight: 600; }
      .crm-columna-lista { display: flex; flex-direction: column; gap: 8px; padding: 10px; overflow-y: auto; }
      .crm-card { background: #FAFBFC; border: 1px solid var(--border-soft); border-radius: var(--radius-sm); padding: 10px; display: flex; flex-direction: column; gap: 8px; }
      .crm-card-main { display: flex; flex-direction: column; gap: 2px; text-align: left; background: none; border: none; padding: 0; cursor: pointer; font-family: var(--font-body); }
      .crm-card-main:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
      .crm-card-programa { color: #6C6F72; }
      .crm-card-prueba { color: #0090C2; font-weight: 600; }
      .crm-card-dias { font-size: 11px; color: #8A8D90; margin-top: 3px; }
      .crm-card-select {
        font-family: var(--font-body); font-size: 12px; padding: 6px 8px; border-radius: var(--radius-sm);
        border: 1px solid var(--border); background: #fff; color: var(--ink); width: 100%;
      }
      .crm-detalle-body { display: flex; flex-direction: column; gap: 6px; }
      .crm-detalle-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 4px; }
      .crm-detalle-campo.ancho { grid-column: 1 / -1; }
      .crm-detalle-label { font-size: 11px; color: #8A8D90; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 2px; }
      .crm-detalle-valor { font-size: 13.5px; color: var(--ink); word-break: break-word; }

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

        /* La barra lateral se vuelve un menú desplegable angosto: un botón
           que muestra el bloque/tab activo, y al tocarlo se abre la lista
           completa encima del contenido (en vez de ocupar espacio fijo al
           lado, que en un teléfono dejaría muy poco lugar para el resto). */
        .app-shell { flex-direction: column; position: relative; }
        .sidebar-toggle-movil {
          display: flex; align-items: center; gap: 8px; width: 100%;
          background: var(--card); border: none; border-bottom: 1px solid var(--border-soft);
          padding: 13px 16px; font-size: 13.5px; font-weight: 600; color: var(--charcoal);
          cursor: pointer; font-family: var(--font-brand); text-align: left;
        }
        .sidebar {
          display: none; width: 100%; border-right: none; border-bottom: 1px solid var(--border-soft);
          box-shadow: var(--shadow-raised);
        }
        .sidebar.sidebar-abierto-movil { display: flex; }
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
        .crm-columna { flex-basis: 82vw; max-height: 60vh; }
        .crm-detalle-grid { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}
