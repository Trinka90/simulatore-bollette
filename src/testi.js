// Testi e formati condivisi tra app e PDF.
import { FASCIA, NOMI_REGOLATE, CONDIZIONI_SCONTO, eVariabile } from "./bolletta.js";

export const eur = (v, d = 2) => (v ?? 0).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d }) + " €";
export const nf = (v, d = 6) => (v == null || Number.isNaN(v) ? "—" : Number(v).toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: d }));
export const dataIt = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
export const MESI_NOMI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
export const meseIt = (ym) => { const [a, m] = ym.split("-").map(Number); return `${MESI_NOMI[m - 1]} ${a}`; };

const primoPrezzo = (c) => c.p.find((p) => !p.dur && !p.fino && !p.mese) || c.p[0];
/** Prezzo in una riga: "PUN + 0,0088 €/kWh · 72 €/anno". */
export function descrizionePrezzo(o) {
  const u = o.forn === "LUCE" ? "kWh" : "Smc", cod = o.forn === "LUCE" ? "03" : "04";
  const perFascia = {};
  let fisso = 0;
  for (const c of o.comp) {
    if (c.opz && c.m === "06") continue;
    const ps = c.p.filter((p) => !p.dur && !p.fino && !p.mese).length ? c.p.filter((p) => !p.dur && !p.fino && !p.mese) : [primoPrezzo(c)];
    for (const p of ps) {
      if (p.u === cod) { const f = o.fasce === "01" || !p.f ? "F0" : FASCIA[p.f]; perFascia[f] = (perFascia[f] || 0) + p.pr; }
      if (p.u === "01") fisso += p.pr;
    }
  }
  const voci = Object.entries(perFascia);
  const uguali = voci.length > 1 && voci.every(([, v]) => Math.abs(v - voci[0][1]) < 1e-9);
  const prezzi = !voci.length ? "" : voci.length === 1 || uguali ? `${nf(voci[0][1])} €/${u}`
    : voci.map(([f, v]) => `${f} ${nf(v)}`).join(" · ") + ` €/${u}`;
  const indice = eVariabile(o) ? (o.forn === "LUCE" ? "PUN" : "PSV") + (prezzi ? " + " : "") : "";
  return `${indice}${prezzi}${fisso ? ` · ${nf(fisso, 2)} €/anno` : ""}`;
}

export const TIPI = { fisso: "PREZZO FISSO", variabile: "VARIABILE", flat: "FLAT", mista: "MISTA" };
export const CANALI = { "01": "solo online", "02": "qualsiasi canale", "03": "punto vendita", "04": "telefono", "05": "agenzia", "99": "altro" };
export const PAGAMENTI = { "01": "domiciliazione bancaria", "02": "domiciliazione postale", "03": "carta di credito", "04": "bollettino", "99": "altro" };
export const ATTIVAZIONI = { "01": "cambio fornitore", "02": "prima attivazione", "03": "riattivazione", "04": "voltura", "99": "tutti i casi" };
export const CONDIZIONI = { "01": "Attivazione", "02": "Disattivazione", "03": "Recesso", "04": "Offerta pluriennale", "05": "Oneri di recesso anticipato", "99": "Altro" };
export const VALIDITA_SCONTO = { "01": "all'ingresso", "02": "entro i primi 12 mesi", "03": "dopo i primi 12 mesi" };
export { NOMI_REGOLATE, CONDIZIONI_SCONTO };

export function durata(o) {
  if (o.mia) return "";
  if (eVariabile(o)) return o.durata ? `Condizioni valide ${o.durata} mesi, poi rinnovo` : "Condizioni a tempo indeterminato";
  return o.durata ? `Prezzo bloccato per ${o.durata} mesi` : "Prezzo fisso, durata non indicata";
}

export function descrUtenza(u, forn) {
  const c = u.comune ? `${u.comune.nome} (${u.comune.sigla})` : "comune non indicato";
  if (forn === "LUCE") {
    const L = u.luce;
    return `${c} · ${nf(L.annuo, 0)} kWh/anno · ${nf(L.potenzaKw)} kW · ${u.residente ? "residente" : "non residente"}${L.canoneRai ? " · canone RAI" : ""}${L.mesi ? " · consumi mensili tuoi" : ""}`;
  }
  const G = u.gas, uso = { cottura: "cucina e acqua calda", riscaldamento: "solo riscaldamento", entrambi: "riscaldamento, cucina e acqua calda" }[G.uso];
  return `${c} · ${nf(G.annuo, 0)} Smc/anno · ${uso}${G.mesi ? " · consumi mensili tuoi" : ` · zona climatica ${G.zona}`}`;
}
