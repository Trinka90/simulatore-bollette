// Catalogo offerte: aggiornamento giornaliero dal Portale Offerte, filtri sull'utente, classifica.
import { leggiOfferte, leggiParametri, offerteValide, parametriValidi, scaricaUltimo, urlOfferte, urlParametri, isoGiorno } from "./opendata.js";
import { riepilogoOfferta, consumoAnnuo, eVariabile } from "./bolletta.js";

export const SITUAZIONI = { "01": "Cambio fornitore", "04": "Voltura (subentro con contatore attivo)", "02": "Prima attivazione", "03": "Riattivazione" };

/**
 * Scarica offerte e parametri del giorno. `scarica(url)` restituisce il testo (sul telefono: richiesta nativa).
 * avanzamento(msg) riceve i passi. Restituisce {data, E:{offerte}, G:{offerte}, parametri:{E,G}}.
 */
export async function aggiornaCatalogo(scarica, avanzamento = () => {}, oggi = new Date()) {
  const oggiIso = isoGiorno(oggi);
  const out = { scaricato: new Date().toISOString(), offerte: [], dataOfferte: {}, parametri: {} };
  for (const [c, nome] of [["E", "luce"], ["G", "gas"], ["D", "luce+gas"]]) {
    if (c !== "D") {
      avanzamento(`Scarico i parametri ${nome}…`);
      const p = await scaricaUltimo(scarica, (d) => urlParametri(c, d), parametriValidi, oggi);
      out.parametri[c] = { data: p.data, fonte: `Portale Offerte, parametri ${nome} del ${p.data.split("-").reverse().join("/")}`, valori: leggiParametri(p.testo) };
    }
    avanzamento(`Scarico le offerte ${nome}…`);
    let x;
    try { x = await scaricaUltimo(scarica, (d) => urlOfferte(c, d), offerteValide, oggi); }
    catch (e) { if (c === "D") continue; throw e; }   // senza il file dual si continua con luce e gas
    avanzamento(`Leggo le offerte ${nome}…`);
    const { offerte } = leggiOfferte(x.testo, x.data, oggiIso);
    out.offerte.push(...offerte);
    out.dataOfferte[c] = x.data;
  }
  out.data = [out.dataOfferte.E, out.dataOfferte.G].sort()[0];
  return out;
}

// ------------------------------------------------------------------ filtri
const inZona = (o, c) => {
  if (!o.zone) return true;
  if (!c) return true;
  return o.zone.r.includes(c.regione) || o.zone.p.includes(c.provincia) || o.zone.c.includes(c.istat);
};
const entro = (v, mm) => !mm || ((mm[0] == null || v >= mm[0]) && (!mm[1] || v <= mm[1]));

/** Dati dell'offerta palesemente incoerenti (es. prezzo e quota fissa invertiti dal venditore). */
export function anomalia(o) {
  for (const c of o.comp) for (const p of c.p) {
    if (p.u === "03" && Math.abs(p.pr) > 2) return `prezzo di ${p.pr} €/kWh nei dati del venditore`;
    if (p.u === "04" && Math.abs(p.pr) > 10) return `prezzo di ${p.pr} €/Smc nei dati del venditore`;
    if (p.u === "01" && Math.abs(p.pr) > 5000) return `quota fissa di ${p.pr} €/anno nei dati del venditore`;
  }
  return null;
}

/** Motivo per cui un'offerta non vale per l'utente, oppure null. */
export function esclusione(o, u, annuo, oggiIso, { dual = false } = {}) {
  if (!o.singola && !dual) return "si sottoscrive solo insieme a luce+gas (dual)";
  if (o.dal && o.dal > oggiIso) return "non ancora sottoscrivibile";
  if (o.res === "R" && !u.residente) return "solo per residenti";
  if (o.res === "NR" && u.residente) return "solo per non residenti";
  if (o.att.length && !o.att.includes("99") && !o.att.includes(u.situazione || "01")) return `non valida per: ${SITUAZIONI[u.situazione || "01"].toLowerCase()}`;
  if (!inZona(o, u.comune)) return "non disponibile nel tuo comune";
  if (o.forn === "LUCE" && !entro(u.luce.potenzaKw, o.pot)) return "potenza impegnata fuori dai limiti dell'offerta";
  if (!entro(annuo, o.cons)) return "consumo annuo fuori dai limiti dell'offerta";
  if (anomalia(o)) return "dati del venditore incoerenti (es. prezzo e quota fissa scambiati)";
  if (o.al && o.al < oggiIso) return "non più sottoscrivibile";
  return null;
}

/** Offerte valide per l'utente divise per fornitura, con i motivi delle esclusioni. */
export function filtra(offerte, u, R, oggiIso, { scadute = false } = {}) {
  const out = { LUCE: [], GAS: [], escluse: { LUCE: {}, GAS: {} }, scaduteDopo: { LUCE: [], GAS: [] } };
  const annuo = { LUCE: u.luce?.attiva ? consumoAnnuo(u, "LUCE", R) : 0, GAS: u.gas?.attiva ? consumoAnnuo(u, "GAS", R) : 0 };
  for (const o of offerte) {
    const f = o.forn;
    if (f === "DUAL") continue;
    if (f === "LUCE" && !u.luce?.attiva) continue;
    if (f === "GAS" && !u.gas?.attiva) continue;
    const e = esclusione(o, u, annuo[f], oggiIso);
    if (e === "non più sottoscrivibile") out.scaduteDopo[f].push(o);
    if (e === "non più sottoscrivibile" && scadute) { out[f].push(o); continue; }
    if (e) out.escluse[f][e] = (out.escluse[f][e] || 0) + 1;
    else out[f].push(o);
  }
  return out;
}

/** Classifica per spesa dei 12 mesi (scenario centrale); gli scenari si calcolano per le prime `nScenari`. */
export function classifica(offerte, u, ctx, nScenari = 40) {
  const r = [];
  for (const o of offerte) {
    try { r.push(riepilogoOfferta(o, u, ctx, false)); } catch (e) { console.error(o.id, e); }
  }
  r.sort((a, b) => a.centrale - b.centrale);
  for (const x of r.slice(0, nScenari)) {
    if (eVariabile(x.offerta)) Object.assign(x, (({ basso, alto }) => ({ basso, alto }))(riepilogoOfferta(x.offerta, u, ctx, true)));
  }
  return r;
}

/** Scadenza dell'offerta rispetto al passaggio: per sottoscriverla bisogna firmare entro `al`. */
export function scadenza(o, oggiIso) {
  if (!o.al || o.al >= "2090") return null;
  const giorni = Math.round((Date.parse(o.al) - Date.parse(oggiIso)) / 86400000);
  return { al: o.al, giorni };
}

/**
 * Pacchetti luce+gas dello stesso venditore (file dual del Portale): costo = offerta luce + offerta gas
 * collegate, calcolate con lo stesso motore, più gli sconti propri del pacchetto (€/anno o una tantum).
 */
export function classificaDual(offerte, u, ctx, oggiIso) {
  const perId = new Map(offerte.filter((o) => o.forn !== "DUAL").map((o) => [o.id, o]));
  const annuoL = consumoAnnuo(u, "LUCE", ctx.R), annuoG = consumoAnnuo(u, "GAS", ctx.R);
  const out = [], escluse = {};
  const conta = (m) => { escluse[m] = (escluse[m] || 0) + 1; };
  for (const d of offerte.filter((o) => o.forn === "DUAL")) {
    const e = esclusione({ ...d, singola: true, pot: null, cons: null }, u, 0, oggiIso);
    if (e) { conta(e); continue; }
    let migliore = null;
    for (const idL of d.ee) for (const idG of d.gas) {
      const L = perId.get(idL), G = perId.get(idG);
      if (!L || !G) continue;
      if (esclusione(L, u, annuoL, oggiIso, { dual: true }) || esclusione(G, u, annuoG, oggiIso, { dual: true })) continue;
      const rl = riepilogoOfferta(L, u, ctx, false), rg = riepilogoOfferta(G, u, ctx, false);
      let sconto = 0;
      for (const s of d.sc || []) {
        if (s.cond && s.cond !== "00" && !(["01", "02"].includes(s.cond) && u.bollettaWeb) && !(s.cond === "03" && u.bollettaWeb && u.domiciliazione)) continue;
        if (s.val === "03") continue;
        for (const p of s.p) if (p.u === "01" || p.u === "05") sconto += p.pr * (s.iva ? 1.1 : 1);
      }
      const tot = rl.centrale + rg.centrale - sconto;
      if (!migliore || tot < migliore.centrale) migliore = { dual: d, luce: rl, gas: rg, sconto, centrale: tot };
    }
    if (migliore) out.push(migliore); else conta("offerte luce o gas collegate non disponibili per te");
  }
  out.sort((a, b) => a.centrale - b.centrale);
  return { lista: out, escluse };
}
