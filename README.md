# Tablero de tareas

Tablero tipo Padlet para organizar tareas en grupo, con tres columnas ("Por hacer", "En proceso" y "Hecho"), tarjetas que se arrastran, encargados y tiempo real.
Cada persona crea una cuenta sencilla (usuario y contraseña, sin email) que guarda su nombre y los tableros en los que está. Se invita a la gente con un enlace.

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

## 2. Ajuste obligatorio: desactivar la confirmación por email

Las cuentas son de **usuario + contraseña**, sin email. Por dentro, Supabase necesita un email, así que la app usa uno interno que nadie ve: `usuario@usuarios.invalid`, un dominio reservado que nunca recibe correo.

En Supabase → **Authentication → Sign In / Providers → Email**:
- Deja activado **Enable Email provider**.
- **Desactiva "Confirm email"** y guarda.

Si no lo desactivas, la gente no podrá entrar después de crear la cuenta.

> **Contraseñas olvidadas:** como no hay email, no se pueden recuperar. Si alguien la olvida, puede crear otro usuario y volver a unirse con el enlace del tablero.
> Si quieres liberar su usuario antiguo, bórralo en **Authentication → Users**.
>
> Si Supabase rechazara el dominio interno con un error de "email inválido", añade la variable `VITE_USER_DOMAIN` con un dominio tuyo, en `.env` y en Vercel (por ejemplo, `VITE_USER_DOMAIN=usuarios.midominio.com`).
> No se envía nada a ese dominio. Hazlo antes de que nadie cree cuentas: si lo cambias después, los usuarios ya creados no podrán entrar.

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
5. Listo: comparte la dirección que te da Vercel (`https://….vercel.app`).

---

## Cómo se usa

- **Para organizar:** crea tu cuenta (tu nombre, un usuario y una contraseña) → "Crear un tablero nuevo" → elige un nombre y un PIN de admin. Se abre la ventana **Invitar** con el enlace: cópialo o compártelo por WhatsApp, Classroom, etc. También la puedes abrir con el botón **Invitar** de arriba.
- **Para participar:** abre el enlace → crea tu cuenta (o entra si ya tienes una) → pasas directamente al tablero. En el mismo dispositivo la sesión se queda abierta. También se puede escribir el código en "Unirme con un código".
- **Mis tableros:** al entrar ves todos tus tableros. Desde el menú del avatar puedes volver a esta lista, cambiar tu nombre o salir de un tablero.
- **Quién se encarga:** "Me lo quedo" te apunta a una tarea, "Asignar a…" apunta a otra persona, y "Soltar" te quita. Cada tarjeta muestra los nombres de los encargados.
- **Mover tarjetas:** arrástralas. En el móvil, mantén el dedo pulsado un momento y arrastra. Para cambiar de columna, lleva el dedo al borde de la pantalla o déjalo un instante sobre la pestaña de arriba.
- **Admin:** quien crea el tablero es el admin y es el único que puede borrar el tablero entero. Otra cuenta puede hacerse admin desde el menú del avatar → "Entrar como admin (PIN)". Después de 5 PIN incorrectos, esa cuenta queda bloqueada para ese tablero.

## Seguridad

- Hay que tener cuenta (usuario y contraseña), y solo los miembros de un tablero pueden ver o tocar su contenido.
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
  main.js       entrar, crear cuenta, mis tableros, unirse y crear tablero
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
