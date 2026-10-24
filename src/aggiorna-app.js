// Aggiornamento automatico dell'app: all'apertura controlla su GitHub se c'è una versione nuova del codice,
// la scarica e la attiva subito. Serve un nuovo APK solo quando cambia la parte nativa (versioneNativa).
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { nativo, scaricaTesto } from "./archivio.js";

export const VERSIONE_WEB = __VERSIONE_WEB__;
export const VERSIONE_NATIVA = __VERSIONE_NATIVA__;
const URL_VERSIONE = "https://github.com/Trinka90/simulatore-bollette/releases/download/web/versione.json";

/** Da chiamare subito all'avvio: conferma che questa versione funziona (altrimenti il plugin torna alla precedente). */
export async function confermaAvvio() {
  if (!nativo()) return;
  try {
    await CapacitorUpdater.notifyAppReady();
    const { bundle } = await CapacitorUpdater.current();
    const { bundles } = await CapacitorUpdater.list();
    for (const b of bundles) if (b.id !== bundle.id && b.status !== "pending") await CapacitorUpdater.delete({ id: b.id }).catch(() => {});
  } catch (e) { console.error(e); }
}

/**
 * Controlla e installa l'aggiornamento. Restituisce:
 * null = già aggiornata; {apk} = serve installare un nuovo APK; non ritorna se l'app si ricarica aggiornata.
 */
export async function controllaAggiornamento(avviso = () => {}) {
  if (!nativo()) return null;
  const t = await scaricaTesto(URL_VERSIONE + "?t=" + Date.now());
  if (!t) return null;
  const v = JSON.parse(t);
  if (!v.web || String(v.web) === String(VERSIONE_WEB)) return null;
  if ((v.nativa || 0) > VERSIONE_NATIVA) return { apk: v.apk, web: v.web };
  avviso(`Aggiorno l'app alla versione ${v.web}…`);
  const b = await CapacitorUpdater.download({ url: v.zip, version: String(v.web) });
  await CapacitorUpdater.set({ id: b.id });
  return null;
}
