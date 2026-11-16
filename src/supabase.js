import { createClient } from '@supabase/supabase-js';
import { createDemoClient } from './demo.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Modo demo: sin Supabase, con datos de ejemplo guardados en el navegador.
// Se activa con VITE_DEMO=1 (npm run demo) o añadiendo ?demo a la dirección.
export const DEMO = import.meta.env.VITE_DEMO === '1' || new URLSearchParams(location.search).has('demo');
export const configured = DEMO || Boolean(url && key);
export const supabase = DEMO ? createDemoClient() : configured ? createClient(url, key) : null;
export const BUCKET = 'uploads';
