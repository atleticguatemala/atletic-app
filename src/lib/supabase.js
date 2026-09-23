import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // eslint-disable-next-line no-console
  console.error(
    "Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (revisa tu archivo .env o las variables de entorno en Vercel)."
  );
}

export const supabase = createClient(url, anonKey);
