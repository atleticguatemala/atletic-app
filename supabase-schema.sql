-- Atletic Guatemala — Control de pagos
-- Ejecuta este archivo completo en Supabase: Dashboard → SQL Editor → New query → pega todo → Run

create extension if not exists "pgcrypto";

-- ---------- Tablas ----------

create table if not exists alumnos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  encargado text,
  telefono text,
  categoria text,
  horario text,
  tarifa_mensual numeric not null default 0,
  becado boolean not null default false,
  saldo_pendiente numeric not null default 0,
  ultimo_mes_cobrado text,
  activo boolean not null default true,
  fecha_alta date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists pagos (
  id uuid primary key default gen_random_uuid(),
  alumno_id uuid references alumnos(id) on delete set null,
  monto numeric not null,
  metodo text,
  fecha date not null default current_date,
  nota text,
  created_at timestamptz not null default now()
);

create table if not exists gastos (
  id uuid primary key default gen_random_uuid(),
  categoria text,
  monto numeric not null,
  fecha date not null default current_date,
  nota text,
  created_at timestamptz not null default now()
);

create table if not exists cargos (
  id uuid primary key default gen_random_uuid(),
  mes text not null,
  fecha date not null default current_date,
  total_generado numeric not null default 0,
  cantidad_alumnos integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists ajustes (
  id uuid primary key default gen_random_uuid(),
  alumno_id uuid references alumnos(id) on delete set null,
  saldo_anterior numeric not null,
  saldo_nuevo numeric not null,
  motivo text not null,
  fecha date not null default current_date,
  created_at timestamptz not null default now()
);

-- Quién puede entrar a la app y con qué rol. Se llena a mano (ver README)
-- después de crear cada usuario en Authentication → Users.
create table if not exists perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  rol text not null default 'entrenador' check (rol in ('admin', 'entrenador')),
  created_at timestamptz not null default now()
);

-- Asistencia: un registro por alumno por día. Los entrenadores la crean
-- y la editan; nunca pueden ver saldo_pendiente, tarifa_mensual, pagos,
-- gastos ni cargos — eso está bloqueado a nivel de base de datos más
-- abajo (RLS), no solo escondido en la pantalla.
create table if not exists asistencias (
  id uuid primary key default gen_random_uuid(),
  alumno_id uuid references alumnos(id) on delete cascade,
  fecha date not null default current_date,
  presente boolean not null default true,
  nota text,
  entrenador_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (alumno_id, fecha)
);

-- ---------- Funciones atómicas ----------
-- Estas son la pieza clave que evita las "carreras" que tuvimos antes
-- (Por cobrar en Q0, el saldo duplicado de Andrés): en vez de que el
-- navegador lea el saldo, calcule el nuevo valor y sobrescriba todo el
-- registro (lo que puede pisar un cambio que pasó al mismo tiempo),
-- cada acción es UNA sola operación en la base de datos que Postgres
-- garantiza que se hace de forma completa o no se hace, aunque dos
-- personas/pestañas la disparen al mismo tiempo.

-- Registrar un pago: crea el pago Y descuenta el saldo, como una sola
-- operación (nunca queda "el pago se guardó pero el saldo no cambió").
create or replace function registrar_pago(p_alumno_id uuid, p_monto numeric, p_metodo text, p_fecha date, p_nota text)
returns pagos
language plpgsql
as $$
declare
  v_pago pagos;
begin
  insert into pagos (alumno_id, monto, metodo, fecha, nota)
  values (p_alumno_id, p_monto, p_metodo, p_fecha, p_nota)
  returning * into v_pago;

  update alumnos set saldo_pendiente = round(saldo_pendiente - p_monto, 2) where id = p_alumno_id;

  return v_pago;
end;
$$;

-- Anular un pago: lo borra Y le devuelve el monto al saldo, en una sola
-- operación. Esto es lo que falló "a mano" con Andrés Carrillo — aquí
-- queda garantizado que ambas cosas pasan juntas o ninguna pasa.
create or replace function anular_pago(p_pago_id uuid)
returns pagos
language plpgsql
as $$
declare
  v_pago pagos;
begin
  select * into v_pago from pagos where id = p_pago_id;
  if v_pago.id is null then
    return null;
  end if;

  delete from pagos where id = p_pago_id;

  update alumnos set saldo_pendiente = round(saldo_pendiente + v_pago.monto, 2) where id = v_pago.alumno_id;

  return v_pago;
end;
$$;

-- Generar el cobro mensual para una lista de alumnos: suma la tarifa al
-- saldo de cada uno y crea el registro de historial, todo junto. El
-- "and (ultimo_mes_cobrado is distinct from p_mes)" es la protección
-- contra doble clic / doble llamada: si por accidente se dispara dos
-- veces con la misma lista, la segunda vez no encuentra a nadie que
-- cobrar y no duplica nada.
create or replace function generar_cobro_mensual(p_mes text, p_alumno_ids uuid[])
returns cargos
language plpgsql
as $$
declare
  v_total numeric := 0;
  v_cantidad integer := 0;
  v_cargo cargos;
begin
  with actualizados as (
    update alumnos
    set saldo_pendiente = round(saldo_pendiente + tarifa_mensual, 2),
        ultimo_mes_cobrado = p_mes
    where id = any(p_alumno_ids)
      and (ultimo_mes_cobrado is distinct from p_mes)
      and becado = false
    returning tarifa_mensual
  )
  select coalesce(sum(tarifa_mensual), 0), count(*) into v_total, v_cantidad from actualizados;

  insert into cargos (mes, total_generado, cantidad_alumnos)
  values (p_mes, v_total, v_cantidad)
  returning * into v_cargo;

  return v_cargo;
end;
$$;

-- Corrección manual de saldo (el botón de la llave 🔧): cambia el saldo
-- Y deja el registro en "ajustes" en una sola operación, capturando el
-- saldo anterior justo antes de cambiarlo (nunca a partir de lo que la
-- pantalla tenía cargado, que podría estar desactualizado).
create or replace function corregir_saldo_alumno(p_alumno_id uuid, p_saldo_nuevo numeric, p_motivo text)
returns ajustes
language plpgsql
as $$
declare
  v_saldo_anterior numeric;
  v_ajuste ajustes;
begin
  select saldo_pendiente into v_saldo_anterior from alumnos where id = p_alumno_id for update;

  update alumnos set saldo_pendiente = round(p_saldo_nuevo, 2) where id = p_alumno_id;

  insert into ajustes (alumno_id, saldo_anterior, saldo_nuevo, motivo)
  values (p_alumno_id, v_saldo_anterior, round(p_saldo_nuevo, 2), p_motivo)
  returning * into v_ajuste;

  return v_ajuste;
end;
$$;

-- Devuelve el rol del usuario que está haciendo la consulta ('admin' o
-- 'entrenador', o null si no tiene perfil). security definer para que se
-- pueda usar dentro de las políticas de abajo sin caer en referencias
-- circulares con la propia tabla perfiles.
create or replace function mi_rol()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select rol from perfiles where id = auth.uid();
$$;

-- Lista de alumnos activos para pasar lista, SIN tarifa ni saldo. Es lo
-- único de "alumnos" que un entrenador puede llegar a ver, y solo a
-- través de esta función — nunca leyendo la tabla completa.
create or replace function alumnos_para_asistencia()
returns table(id uuid, nombre text, categoria text, horario text)
language sql
security definer
set search_path = public
stable
as $$
  select id, nombre, categoria, horario from alumnos where activo = true order by nombre;
$$;

-- Marcar/editar la asistencia de un alumno en una fecha. Se hace por
-- función (en vez de insert/update directo desde la pantalla) para que
-- el entrenador nunca necesite permiso de escritura directo sobre la
-- tabla si más adelante se vuelve más estricto, y para no depender de
-- que el cliente arme bien el "upsert".
create or replace function marcar_asistencia(p_alumno_id uuid, p_fecha date, p_presente boolean, p_nota text default null)
returns asistencias
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text := mi_rol();
  v_asistencia asistencias;
begin
  if v_rol is distinct from 'admin' and v_rol is distinct from 'entrenador' then
    raise exception 'No autorizado';
  end if;

  insert into asistencias (alumno_id, fecha, presente, nota, entrenador_id)
  values (p_alumno_id, p_fecha, p_presente, p_nota, auth.uid())
  on conflict (alumno_id, fecha)
  do update set presente = excluded.presente, nota = excluded.nota, entrenador_id = excluded.entrenador_id
  returning * into v_asistencia;

  return v_asistencia;
end;
$$;

-- ---------- Seguridad ----------
-- Ahora la app pide iniciar sesión (Supabase Auth). Hay dos roles:
--   - admin: ve y hace todo (alumnos, pagos, gastos, cobros, ajustes,
--     asistencia). Ese eres tú.
--   - entrenador: SOLO puede pasar lista de asistencia. No puede leer
--     ni la tabla de alumnos completa (con tarifa/saldo), ni pagos, ni
--     gastos, ni cargos, ni ajustes — estas políticas lo bloquean en la
--     base de datos, no solo en la pantalla, así que aunque alguien
--     abra las herramientas del navegador no puede sacar esos datos.
-- Cómo crear cuentas: ver README.md.

alter table alumnos enable row level security;
alter table pagos enable row level security;
alter table gastos enable row level security;
alter table cargos enable row level security;
alter table ajustes enable row level security;
alter table perfiles enable row level security;
alter table asistencias enable row level security;

drop policy if exists "acceso total alumnos" on alumnos;
drop policy if exists "solo admin alumnos" on alumnos;
create policy "solo admin alumnos" on alumnos for all using (mi_rol() = 'admin') with check (mi_rol() = 'admin');

drop policy if exists "acceso total pagos" on pagos;
drop policy if exists "solo admin pagos" on pagos;
create policy "solo admin pagos" on pagos for all using (mi_rol() = 'admin') with check (mi_rol() = 'admin');

drop policy if exists "acceso total gastos" on gastos;
drop policy if exists "solo admin gastos" on gastos;
create policy "solo admin gastos" on gastos for all using (mi_rol() = 'admin') with check (mi_rol() = 'admin');

drop policy if exists "acceso total cargos" on cargos;
drop policy if exists "solo admin cargos" on cargos;
create policy "solo admin cargos" on cargos for all using (mi_rol() = 'admin') with check (mi_rol() = 'admin');

drop policy if exists "acceso total ajustes" on ajustes;
drop policy if exists "solo admin ajustes" on ajustes;
create policy "solo admin ajustes" on ajustes for all using (mi_rol() = 'admin') with check (mi_rol() = 'admin');

drop policy if exists "ver propio perfil" on perfiles;
create policy "ver propio perfil" on perfiles for select using (id = auth.uid());

-- Asistencia: admin ve y edita todo; el entrenador también puede ver
-- todo (para saber quién ya está marcado) pero solo puede crear/editar/
-- borrar los registros que él mismo marcó.
drop policy if exists "admin todo asistencias" on asistencias;
create policy "admin todo asistencias" on asistencias for all using (mi_rol() = 'admin') with check (mi_rol() = 'admin');

drop policy if exists "entrenador ve asistencias" on asistencias;
create policy "entrenador ve asistencias" on asistencias for select using (mi_rol() = 'entrenador');

drop policy if exists "entrenador inserta asistencias" on asistencias;
create policy "entrenador inserta asistencias" on asistencias for insert with check (mi_rol() = 'entrenador' and entrenador_id = auth.uid());

drop policy if exists "entrenador actualiza propias" on asistencias;
create policy "entrenador actualiza propias" on asistencias for update using (mi_rol() = 'entrenador' and entrenador_id = auth.uid()) with check (mi_rol() = 'entrenador' and entrenador_id = auth.uid());

drop policy if exists "entrenador borra propias" on asistencias;
create policy "entrenador borra propias" on asistencias for delete using (mi_rol() = 'entrenador' and entrenador_id = auth.uid());

-- Ya no usamos la "anon key" para leer/escribir datos: todo pasa por un
-- usuario logueado (authenticated). Quita el acceso anónimo directo.
revoke all on alumnos, pagos, gastos, cargos, ajustes, perfiles, asistencias from anon;
grant select, insert, update, delete on alumnos, pagos, gastos, cargos, ajustes, asistencias to authenticated;
grant select on perfiles to authenticated;

grant execute on function mi_rol() to authenticated;
grant execute on function alumnos_para_asistencia() to authenticated;
grant execute on function marcar_asistencia(uuid, date, boolean, text) to authenticated;
grant execute on function registrar_pago(uuid, numeric, text, date, text) to authenticated;
grant execute on function anular_pago(uuid) to authenticated;
grant execute on function generar_cobro_mensual(text, uuid[]) to authenticated;
grant execute on function corregir_saldo_alumno(uuid, numeric, text) to authenticated;

-- ---------- Tiempo real ----------
-- Permite que, si tienes la app abierta en el celular y en la compu a la
-- vez, un cambio hecho en una se refleje solo en la otra sin recargar.
alter publication supabase_realtime add table alumnos;
alter publication supabase_realtime add table pagos;
alter publication supabase_realtime add table gastos;
alter publication supabase_realtime add table cargos;
alter publication supabase_realtime add table ajustes;
alter publication supabase_realtime add table asistencias;
