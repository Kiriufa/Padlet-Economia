# Tablero de tareas

Tablero tipo Padlet para organizar tareas en grupo, con tres columnas ("Por hacer", "En proceso" y "Hecho"), tarjetas que se arrastran, encargados y tiempo real.
Se entra con Google y el código del tablero.

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

## 2. Activar el inicio de sesión con Google

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

## 3. Arrancarlo en local

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

## 4. Subirlo a Vercel

1. Sube este repositorio a GitHub.
2. En [vercel.com](https://vercel.com) → **Add New → Project** → importa el repositorio. Vercel detecta Vite solo: el comando de build es `npm run build` y la carpeta de salida es `dist`.
3. En **Environment Variables** añade:
   | Nombre | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | tu Project URL |
   | `VITE_SUPABASE_ANON_KEY` | tu anon key |
4. Pulsa **Deploy**.
5. Copia la dirección que te da Vercel (`https://….vercel.app`) y añádela en Supabase, en **Authentication → URL Configuration** (paso 2).

---

## Cómo se usa

- **Para organizar:** entra con Google → "Crea un tablero nuevo" → elige un nombre y un PIN de admin. Pulsa **Código: XXXXXX** para copiar el enlace de invitación y compártelo.
- **Para participar:** abre el enlace, o entra y escribe el código. La app recuerda el último tablero.
- **Mover tarjetas:** arrástralas. En el móvil, mantén el dedo pulsado un momento y arrastra. Para cambiar de columna, deja el dedo un instante sobre la pestaña de arriba.
- **Admin desde otra cuenta:** menú del avatar → "Entrar como admin (PIN)". Después de 5 PIN incorrectos, esa cuenta queda bloqueada para ese tablero.

## Seguridad

- Hay que iniciar sesión con Google, y solo los miembros de un tablero pueden ver o tocar su contenido.
- Row Level Security:
  - Solo el autor o el admin pueden editar o borrar una tarjeta.
  - Cualquier miembro puede crear tarjetas, moverlas (con la función `move_card`, que solo cambia la columna y el orden) y asignar a gente del tablero.
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
