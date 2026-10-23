// Download (richiesta nativa, senza limiti CORS) e salvataggio del catalogo sul telefono.
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";

export const nativo = () => Capacitor.isNativePlatform();
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

/** Scarica un file di testo. Sul telefono usa la richiesta nativa (il Portale non invia intestazioni CORS). */
export async function scaricaTesto(url) {
  if (nativo()) {
    const r = await CapacitorHttp.get({ url, responseType: "text", headers: { "User-Agent": UA, Accept: "*/*" }, connectTimeout: 20000, readTimeout: 120000 });
    if (r.status === 404) return null;
    if (r.status !== 200) throw new Error(`il Portale ha risposto ${r.status}`);
    return typeof r.data === "string" ? r.data : JSON.stringify(r.data);
  }
  const r = await fetch(url, { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

const FILE = "catalogo.json";
export async function salvaCatalogo(cat) {
  const testo = JSON.stringify(cat);
  if (nativo()) await Filesystem.writeFile({ path: FILE, data: testo, directory: Directory.Data, encoding: Encoding.UTF8 });
  else try { sessionStorage.setItem(FILE, testo); } catch { /* troppo grande per il browser: resta in memoria */ }
}
export async function caricaCatalogo() {
  try {
    if (nativo()) {
      const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
      return JSON.parse(r.data);
    }
    const t = sessionStorage.getItem(FILE);
    if (t) return JSON.parse(t);
  } catch { /* nessun catalogo salvato */ }
  return null;
}
/** Catalogo incluso nell'app (istantanea iniziale). */
export async function catalogoIniziale() {
  const r = await fetch("catalogo-iniziale.json");
  return r.json();
}
