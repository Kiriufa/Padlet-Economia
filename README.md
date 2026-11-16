# Tablero de tareas

Tablero tipo Padlet para organizar tareas en grupo, con tres columnas ("Por hacer", "En proceso" y "Hecho"), tarjetas que se arrastran, encargados y tiempo real.
Cada persona crea su cuenta (con email o con Google) y elige el nombre que verán los demás. Se invita a la gente con un enlace.

**Stack:** Vite + JavaScript (sin frameworks) · Supabase (Postgres, Auth, Realtime, Storage) · Vercel

## Probar la demo (sin configurar nada)

```bash
npm install
npm run demo
```

La demo funciona sin Supabase: trae datos de ejemplo y los guarda solo en tu navegador.
Si abres otra pestaña, entras como otra persona y ves los cambios al momento. El PIN de admin es `1234`.
En la web publicada también puedes verla añadiendo `?demo` a la dirección.

---

## 1. Crear el proyecto en Supabase

1. Entra en [supabase.com](https://supabase.com) → **New project**. Elige un nombre y una contraseña, y espera a que se cree.
2. Ve a **SQL Editor** → **New query**, pega todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**.
   Así se crean las tablas, la seguridad (RLS), las funciones, el tiempo real y el bucket `uploads`. Se puede ejecutar más de una vez sin problema.
3. Ve a **Project Settings → API** y copia dos datos:
   - **Project URL**
   - **anon public key**. En los proyectos nuevos se llama *Publishable key*; también sirve.

## 2. Cuentas con email

En **Authentication → Sign In / Providers → Email**, el proveedor de email viene activado de serie.

> **Importante para un grupo de 30-50 personas:** el correo que Supabase trae de serie solo envía unos pocos emails por hora.
> Con tanta gente creando cuenta a la vez, los correos de confirmación no llegarían a todos. Tienes dos opciones:
> - **La más simple:** desactiva **Confirm email** en ese mismo apartado. La gente entra nada más crear la cuenta.
> - **La más segura:** configura un servidor de correo propio en **Project Settings → Authentication → SMTP Settings** (por ejemplo, Resend o Brevo, que tienen plan gratuito).
>
> El correo de "¿Olvidaste la contraseña?" también usa este servidor.

## 3. Activar el inicio de sesión con Google (opcional)

**En Google Cloud** ([console.cloud.google.com](https://console.cloud.google.com)):

1. Crea un proyecto o usa uno que ya tengas.
2. Ve a **APIs y servicios → Pantalla de consentimiento de OAuth**, elige el tipo **Externo** y rellena el nombre de la app y tu email.
   Después pulsa **Publicar app**. Si no lo haces, solo podrán entrar las cuentas que añadas como usuarios de prueba.
3. Ve a **Credenciales → Crear credenciales → ID de cliente de OAuth** y elige el tipo **Aplicación web**.
   En **URI de redireccionamiento autorizados** pon:
   ```
   https://TU-PROYECTO.supabase.co/auth/v1/callback
   ```
   (Tu Project URL seguida de `/auth/v1/callback`.)
4. Copia el **ID de cliente** y el **Secreto de cliente**.

**En Supabase:**

1. Ve a **Authentication → Sign In / Providers → Google**, actívalo, pega el ID y el secreto, y guarda.
2. Ve a **Authentication → URL Configuration** → **Redirect URLs** y añade:
   ```
   http://localhost:5173/**
   https://TU-APP.vercel.app/**
   ```
   La segunda la tendrás después del paso 4. En **Site URL** pon la dirección de Vercel.

## 4. Arrancarlo en local

Necesitas [Node.js](https://nodejs.org) 18 o superior.

```bash
npm install
cp .env.example .env      # y rellena los dos valores
npm run dev
```

El archivo `.env` debe quedar así:

```
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=tu-clave-anon
```

Abre http://localhost:5173. El archivo `.env` no se sube a Git: está en `.gitignore`.

## 5. Subirlo a Vercel

1. Sube este repositorio a GitHub.
2. En [vercel.com](https://vercel.com) → **Add New → Project** → importa el repositorio. Vercel detecta Vite solo: el comando de build es `npm run build` y la carpeta de salida es `dist`.
3. En **Environment Variables** añade:
   | Nombre | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | tu Project URL |
   | `VITE_SUPABASE_ANON_KEY` | tu anon key |
4. Pulsa **Deploy**.
5. Copia la dirección que te da Vercel (`https://….vercel.app`) y añádela en Supabase, en **Authentication → URL Configuration** (paso 3). Sin esto no funcionan ni Google ni los enlaces de los correos.

---

## Cómo se usa

- **Para organizar:** crea tu cuenta → "Crear un tablero nuevo" → elige un nombre y un PIN de admin. Se abre la ventana **Invitar** con el enlace: cópialo o compártelo por WhatsApp, Classroom, etc. También la puedes abrir con el botón **Invitar** de arriba.
- **Para participar:** abre el enlace → crea tu cuenta con tu nombre (o entra si ya tienes una) → pasas directamente al tablero. También se puede escribir el código en "Unirme con un código".
- **Mis tableros:** al entrar ves todos tus tableros. Desde el menú del avatar puedes volver a esta lista, cambiar tu nombre o salir de un tablero.
- **Quién se encarga:** "Me lo quedo" te apunta a una tarea, "Asignar a…" apunta a otra persona, y "Soltar" te quita. Cada tarjeta muestra los nombres de los encargados.
- **Mover tarjetas:** arrástralas. En el móvil, mantén el dedo pulsado un momento y arrastra. Para cambiar de columna, lleva el dedo al borde de la pantalla o déjalo un instante sobre la pestaña de arriba.
- **Admin:** quien crea el tablero es el admin y es el único que puede borrar el tablero entero. Otra cuenta puede hacerse admin desde el menú del avatar → "Entrar como admin (PIN)". Después de 5 PIN incorrectos, esa cuenta queda bloqueada para ese tablero.

## Seguridad

- Hay que tener cuenta, y solo los miembros de un tablero pueden ver o tocar su contenido.
- Row Level Security:
  - Cualquier miembro del tablero puede crear, editar, mover y borrar cualquier tarjeta, y asignar o quitar a cualquier persona del tablero. Al borrar siempre se pide confirmación.
  - Quien no es miembro no puede hacer nada.
- El nombre de cada persona se guarda en `profiles` y solo se cambia con la función `set_my_name`, que lo actualiza en todos sus tableros.
- El PIN se guarda cifrado (bcrypt) y se comprueba en la función `claim_admin`. La tabla de tableros no se puede leer desde el navegador.
- Archivos: hasta 50 MB y solo de los tipos permitidos (imágenes, PDF, Office, OpenDocument, ZIP, TXT y CSV). Se comprueba en el navegador y también en el bucket.

> **Límite de 50 MB:** es el máximo por archivo del plan gratuito de Supabase.
> Para subirlo, necesitas el plan Pro. Después cambia el límite en **Storage → Settings**, en `file_size_limit` dentro de `schema.sql` y en `MAX_FILE_MB` de `src/utils.js`.

## Estructura

```
index.html
src/
  main.js       pantallas de entrada (Google, código, crear tablero)
  board.js      tablero: datos, tiempo real, filtros, encargados, admin
  card.js       cómo se pinta cada tarjeta (texto, imagen, archivo, enlace, YouTube)
  cardForm.js   formulario de crear/editar y subida de archivos
  dnd.js        drag & drop con ratón y táctil, sin librerías
  ui.js         utilidades de interfaz (diálogos, avisos, avatares)
  utils.js      constantes y funciones de apoyo
  demo.js       modo demo: imita Supabase en el navegador
  styles.css
supabase/schema.sql   todo el SQL
```
