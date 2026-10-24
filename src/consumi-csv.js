// Import dei consumi reali da file CSV (Portale Consumi ARERA, e-distribuzione, distributori gas).
// Il formato non è documentato e cambia tra sito e app: il lettore riconosce da solo
// - valori ogni 15 minuti / ogni ora, in righe (data, ora, valore) o in colonne (una riga per giorno);
// - consumi giornalieri o mensili, anche divisi per fascia F1/F2/F3;
// - letture progressive del contatore (si usano le differenze).

const MESI_IT = { gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12 };

function numero(s) {
  let t = String(s ?? "").trim().replace(/^"|"$/g, "").replace(/\s/g, "");
  if (!t || !/\d/.test(t)) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "");
  if (/^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}
/** Data (e ora, se presente) da una cella. Restituisce {y,m,d,h,mi} o null. */
export function dataOra(s) {
  const t = String(s ?? "").trim().replace(/^"|"$/g, "");
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(t);
  if (m) return { y: +m[3], m: +m[2], d: +m[1], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null };
  m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(t);
  if (m) return { y: +m[1], m: +m[2], d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null };
  m = /^(\d{4})(\d{2})$/.exec(t);                                   // 202607
  if (m && +m[2] >= 1 && +m[2] <= 12) return { y: +m[1], m: +m[2], d: null, h: null, mi: null };
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(t);                            // 07/2026
  if (m && +m[1] >= 1 && +m[1] <= 12) return { y: +m[2], m: +m[1], d: null, h: null, mi: null };
  m = /^([a-z]{3})[a-z]*[ -](\d{4})$/i.exec(t);                     // luglio 2026
  if (m && MESI_IT[m[1].toLowerCase()]) return { y: +m[2], m: MESI_IT[m[1].toLowerCase()], d: null, h: null, mi: null };
  return null;
}
const ora = (s) => { const m = /^(\d{1,2})[:.](\d{2})/.exec(String(s ?? "").trim().replace(/^"|"$/g, "")); return m ? { h: +m[1], mi: +m[2] } : null; };

// ---- fasce orarie ARERA (F1 lun-ven 8-19; F2 lun-ven 7-8 e 19-23, sabato 7-23; F3 il resto, domeniche e festivi)
function pasqua(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(Date.UTC(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
}
const festivi = new Map();
function festivo(y, m, d) {
  if (!festivi.has(y)) {
    const p = pasqua(y), lun = new Date(p.getTime() + 86400000);
    festivi.set(y, new Set(["1-1", "1-6", "4-25", "5-1", "6-2", "8-15", "11-1", "12-8", "12-25", "12-26", `${lun.getUTCMonth() + 1}-${lun.getUTCDate()}`]));
  }
  return festivi.get(y).has(`${m}-${d}`);
}
/** Fascia del quarto d'ora che inizia a h:mi. */
export function fasciaDi(y, m, d, h) {
  const g = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (g === 0 || festivo(y, m, d)) return "F3";
  if (g === 6) return h >= 7 && h < 23 ? "F2" : "F3";
  if (h >= 8 && h < 19) return "F1";
  if (h === 7 || (h >= 19 && h < 23)) return "F2";
  return "F3";
}

function separa(righe) {
  const campione = righe.slice(0, 30).join("\n");
  const sep = [";", "\t", ","].map((s) => [s, (campione.match(new RegExp(s === "\t" ? "\t" : `\\${s}`, "g")) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  return righe.map((r) => {
    const out = []; let cur = "", q = false;
    for (const ch of r) {
      if (ch === '"') q = !q;
      else if (ch === sep && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  });
}

/**
 * Legge un CSV di consumi. Restituisce
 * {tipo: "quartorario"|"orario"|"giornaliero"|"mensile"|"letture", unita, dal, al, perMese:{"AAAA-MM": q}, fasce:{F1,F2,F3}|null, righe:n}
 * oppure {errore}.
 */
export function leggiConsumiCsv(testo, fornitura = "LUCE") {
  const righe = testo.replace(/^﻿/, "").split(/\r?\n/).filter((r) => r.trim());
  if (righe.length < 2) return { errore: "Il file è vuoto." };
  const T = separa(righe);
  const intest = T.findIndex((r) => r.some((c) => /data|giorno|date|periodo|mese/i.test(c)));
  const head = intest >= 0 ? T[intest].map((c) => c.toLowerCase()) : [];
  const testoHead = head.join(" ") + " " + righe.slice(0, 5).join(" ").toLowerCase();
  let fattore = 1, unita = fornitura === "LUCE" ? "kWh" : "Smc";
  if (fornitura === "LUCE" && /\bwh\b/.test(testoHead) && !/kwh/.test(testoHead)) fattore = 1 / 1000;
  const dati = T.slice(intest + 1).filter((r) => r.some((c) => dataOra(c)));
  if (!dati.length) return { errore: "Non trovo date nel file." };
  const iData = dati[0].findIndex((c) => dataOra(c));
  const perMese = {}, fasce = { F1: 0, F2: 0, F3: 0 };
  let conFasce = false, dal = null, al = null, tipo = null;
  const aggiungi = (y, m, d, v, f) => {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    perMese[k] = (perMese[k] || 0) + v;
    if (f) { fasce[f] += v; conFasce = true; }
    const iso = `${k}-${String(d || 1).padStart(2, "0")}`;
    if (!dal || iso < dal) dal = iso;
    if (!al || iso > al) al = iso;
  };
  // numeri della riga dopo la colonna data (escluse ore)
  const valori = (r) => r.map((c, i) => (i === iData || ora(c) || dataOra(c) ? null : numero(c)));
  const larghezza = Math.max(...dati.slice(0, 20).map((r) => valori(r).filter((x) => x != null).length));

  if (larghezza >= 24) {
    // una riga per giorno, una colonna per quarto d'ora (96) o per ora (24)
    tipo = larghezza >= 90 ? "quartorario" : "orario";
    const passi = tipo === "quartorario" ? 96 : 24;
    const vals0 = dati.map(valori).flat().filter((x) => x != null);
    if (fattore === 1 && fornitura === "LUCE" && vals0.every((x) => Number.isInteger(x)) && vals0.reduce((a, b) => a + b, 0) / dati.length > 200) fattore = 1 / 1000;
    for (const r of dati) {
      const dt = dataOra(r[iData]);
      if (!dt?.d) continue;
      const v = valori(r).filter((x) => x != null).slice(0, passi + 4);
      v.slice(0, passi).forEach((x, i) => aggiungi(dt.y, dt.m, dt.d, x * fattore, fornitura === "LUCE" ? fasciaDi(dt.y, dt.m, dt.d, Math.floor(i * 24 / passi)) : null));
    }
  } else {
    // forma lunga: data [ora] valore [fascia]
    const iOra = dati[0].findIndex((c, i) => i !== iData && ora(c));
    const iFascia = head.findIndex((c) => /fascia/.test(c));
    let iVal = head.findIndex((c, i) => i !== iData && /(consum|prelie|energia|attiva|kwh|smc|valore|volume|quantit|lettura)/.test(c) && !/reattiva/.test(c));
    if (iVal < 0 || dati.every((r) => numero(r[iVal]) == null)) iVal = valori(dati[0]).findIndex((x) => x != null);
    if (iVal < 0) return { errore: "Non trovo la colonna dei consumi." };
    const letture = /lettura/.test(head[iVal] || "") && !/consum/.test(head[iVal] || "");
    const recs = dati.map((r) => {
      const dt = dataOra(r[iData]), o = iOra >= 0 ? ora(r[iOra]) : null;
      return { dt: { ...dt, h: o ? o.h : dt.h, mi: o ? o.mi : dt.mi }, v: numero(r[iVal]), f: iFascia >= 0 ? (/f\s*1/i.test(r[iFascia]) ? "F1" : /f\s*2/i.test(r[iFascia]) ? "F2" : /f\s*3/i.test(r[iFascia]) ? "F3" : null) : null };
    }).filter((x) => x.dt && x.v != null);
    if (!recs.length) return { errore: "Non trovo valori numerici di consumo." };
    const crescenti = recs.length > 2 && recs.every((x, i) => i === 0 || x.v >= recs[i - 1].v);
    if (letture || (crescenti && !recs[0].dt.h && recs.length < 400)) {
      // letture progressive: la differenza tra due letture si distribuisce sui giorni dell'intervallo
      tipo = "letture";
      const ts = (dt) => Date.UTC(dt.y, dt.m - 1, dt.d || 1);
      recs.sort((a, b) => ts(a.dt) - ts(b.dt));
      for (let i = 1; i < recs.length; i++) {
        const q = (recs[i].v - recs[i - 1].v) * fattore, t0 = ts(recs[i - 1].dt), t1 = ts(recs[i].dt);
        const gg = Math.round((t1 - t0) / 86400000);
        if (q < 0 || gg <= 0) continue;
        for (let t = t0; t < t1; t += 86400000) { const d = new Date(t); aggiungi(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), q / gg, null); }
      }
    } else {
      const conOra = recs.some((x) => x.dt.h != null);
      tipo = conOra ? (recs.some((x) => x.dt.mi % 60 !== 0) ? "quartorario" : "orario") : recs.some((x) => x.dt.d) ? "giornaliero" : "mensile";
      if (fattore === 1 && fornitura === "LUCE" && conOra && recs.every((x) => Number.isInteger(x.v)) && Math.max(...recs.map((x) => x.v)) > 30) fattore = 1 / 1000;
      for (const x of recs) {
        const f = x.f || (fornitura === "LUCE" && conOra ? fasciaDi(x.dt.y, x.dt.m, x.dt.d, x.dt.h) : null);
        aggiungi(x.dt.y, x.dt.m, x.dt.d, x.v * fattore, f);
      }
    }
  }
  const mesi = Object.keys(perMese).sort();
  if (!mesi.length) return { errore: "Nessun consumo trovato." };
  return { tipo, unita, dal, al, perMese, fasce: conFasce ? fasce : null, righe: dati.length };
}

/** Ultimi 12 mesi completi: {mesi:{1..12}, annuo, ripartizione|null, mancanti:[]} */
export function ultimi12(r) {
  const chiavi = Object.keys(r.perMese).sort();
  // esclude il primo e l'ultimo mese se parziali
  const [y0, m0, d0] = r.dal.split("-").map(Number), [y1, m1, d1] = r.al.split("-").map(Number);
  const fine = new Date(Date.UTC(y1, m1, 0)).getUTCDate();
  const usa = chiavi.filter((k) => !(k === `${y0}-${String(m0).padStart(2, "0")}` && d0 > 3) && !(k === `${y1}-${String(m1).padStart(2, "0")}` && d1 < fine - 2 && r.tipo !== "mensile"));
  const ult = usa.slice(-12), mesi = {}, mancanti = [];
  for (const k of ult) mesi[Number(k.slice(5))] = Math.round(r.perMese[k] * 10) / 10;
  for (let m = 1; m <= 12; m++) if (mesi[m] == null) mancanti.push(m);
  const f = r.fasce, tf = f ? f.F1 + f.F2 + f.F3 : 0;
  return { mesi, annuo: Object.values(mesi).reduce((a, b) => a + b, 0), mancanti, periodo: ult.length ? [ult[0], ult.at(-1)] : null,
    ripartizione: tf > 0 ? { F1: f.F1 / tf, F2: f.F2 / tf, F3: f.F3 / tf } : null };
}
