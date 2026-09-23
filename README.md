# Atletic Guatemala — Control de pagos

App de uso interno para llevar el control de alumnos, pagos, gastos y el
cobro mensual de la academia. Ya no guarda los datos en el navegador: los
guarda en una base de datos real (Supabase), así que puedes abrirla desde
el celular y la computadora al mismo tiempo y ambos ven la misma
información, al instante.

Sigue estos pasos en orden. Ninguno necesita saber programar — son
formularios y botones — pero si te trabas en alguno, mándame el mensaje de
error y seguimos desde ahí.

## Paso 1 — Crear la base de datos (Supabase)

1. Ve a [supabase.com](https://supabase.com) y crea una cuenta gratis (puedes entrar con tu cuenta de Google).
2. Crea un proyecto nuevo (**New project**). Ponle un nombre, ej. "atletic-guatemala", elige una contraseña para la base (guárdala en un lugar seguro) y una región cercana (ej. la más cercana a Guatemala que ofrezcan). Tarda 1-2 minutos en crearse.
3. Ya adentro del proyecto, ve a **SQL Editor** (en el menú de la izquierda) → **New query**.
4. Abre el archivo `supabase-schema.sql` que viene en esta carpeta, copia **todo** su contenido, pégalo en el editor, y dale **Run**. Esto crea las tablas (alumnos, pagos, gastos, etc.) y las reglas que evitan que se dupliquen datos.
5. Ve a **Project Settings** (ícono de engrane) → **API**. Ahí vas a ver dos datos que necesitas para el siguiente paso:
   - **Project URL**
   - **anon public key** (una llave larga)

## Paso 2 — Conectar la app con la base de datos

1. En la carpeta de la app, copia el archivo `.env.example` y renómbralo a `.env`.
2. Ábrelo y pega ahí el **Project URL** y la **anon public key** que copiaste en el paso anterior.

## Paso 3 — Crear las cuentas (tú y tus entrenadores)

La app ahora pide iniciar sesión, y hay dos tipos de cuenta:

- **admin** (tú): ve y hace todo — alumnos, pagos, gastos, cobros, y también asistencia.
- **entrenador**: SOLO puede entrar a pasar lista de asistencia. No puede ver tarifas, saldos, pagos ni gastos — eso está bloqueado directamente en la base de datos, no solo escondido en la pantalla, así que ni abriendo las herramientas del navegador se puede sacar esa información.

Por ahora crear cuentas se hace a mano en el panel de Supabase (más adelante, si quieres, te puedo armar una pantalla para hacerlo sin salir de la app):

1. En tu proyecto de Supabase, ve a **Authentication → Users → Add user**. Créate tu propia cuenta (tu correo y una contraseña) y luego una por cada entrenador al que le quieras dar acceso.
2. Por cada usuario que crees, copia su **User UID** (aparece en la lista de usuarios).
3. Ve a **SQL Editor → New query** y corre esto, reemplazando los UID, nombres y el rol de cada quien (`admin` para ti, `entrenador` para cada entrenador):

   ```sql
   insert into perfiles (id, nombre, rol) values
     ('pega-aquí-tu-uid', 'Tu nombre', 'admin'),
     ('pega-aquí-el-uid-del-entrenador', 'Nombre del entrenador', 'entrenador');
   ```

4. Ya con eso, esa persona puede entrar a la app con el correo y la contraseña que le creaste en el paso 1.

Para agregar un entrenador nuevo más adelante, repites los pasos 1-3 solo para esa persona.

## Paso 4 — Publicar la app (Vercel)

La forma más sencilla es subir el código a GitHub y conectarlo con Vercel (gratis):

1. Crea una cuenta en [github.com](https://github.com) si no tienes una.
2. Crea un repositorio nuevo (puede ser privado) y sube el contenido de esta carpeta (GitHub te deja arrastrar los archivos directo desde el navegador si no quieres usar comandos — "uploading an existing file").
3. Ve a [vercel.com](https://vercel.com), crea una cuenta (puedes entrar con tu cuenta de GitHub) y dale **Add New → Project**.
4. Elige el repositorio que acabas de subir. Vercel detecta solo que es un proyecto de Vite.
5. Antes de darle a "Deploy", abre la sección **Environment Variables** y agrega las mismas dos que pusiste en tu `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Dale **Deploy**. En 1-2 minutos tendrás un link tipo `https://atletic-guatemala.vercel.app` — esa es tu app, ya en internet, accesible desde cualquier celular o computadora.

Cada vez que yo te mande una actualización del código, solo tienes que subir los archivos nuevos a ese mismo repositorio de GitHub y Vercel la vuelve a publicar sola.

## Importante sobre seguridad

La app ya pide inicio de sesión y separa lo que puede ver un entrenador de
lo que puedes ver tú, y esa separación está aplicada en la base de datos
(no solo en la pantalla). Aun así, trata el link de la app y las
contraseñas como algo privado — no las compartas en un grupo abierto.

## Para probarlo en tu computadora antes de publicarlo (opcional)

Si quieres verla funcionando en tu computadora antes de publicarla:

```
npm install
npm run dev
```

Y abre el link que te muestre en la terminal (normalmente `http://localhost:5173`).

## Qué cambia respecto a la versión anterior

- Los datos ya no viven en el navegador — viven en Supabase, así que se
  comparten entre todos tus dispositivos automáticamente y en tiempo real.
- Registrar/anular un pago, generar el cobro mensual y corregir un saldo
  ahora son operaciones "todo o nada" directamente en la base de datos
  (ver `supabase-schema.sql`), lo que elimina de raíz los problemas que
  tuvimos antes por tener varias pestañas abiertas o un doble clic.
- El botón "Corregir saldo" (🔧) y la protección contra doble clic siguen
  ahí, igual que antes.
- Nuevo: pestaña de **Asistencia**, y cuentas de **entrenador** que solo
  ven esa pestaña. Lo que un entrenador marca se refleja al instante en
  tu resumen general (tarjeta "Asistencia de hoy"), sin que tengas que
  hacer nada. Los entrenadores nunca pueden ver tarifas, saldos, pagos ni
  gastos — eso está bloqueado a nivel de base de datos.
