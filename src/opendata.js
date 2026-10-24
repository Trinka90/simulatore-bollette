// Open data del Portale Offerte (ARERA / Acquirente Unico, licenza CC-BY):
// - offerte del mercato libero, un file XML al giorno per luce (E) e gas (G);
// - parametri di calcolo (reti, oneri, dispacciamento, accise luce, IVA), un CSV al giorno.
// Il Portale rifiuta le connessioni dai server cloud: i file li scarica il telefono.
import { elementi, testo, testi, numero, figli, trova } from "./xml.js";

export const BASE = "https://www.ilportaleofferte.it/portaleOfferte/resources/opendata/csv";
const aaaammgg = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
export const urlOfferte = (c, d) => `${BASE}/offerteML/${d.getFullYear()}_${d.getMonth() + 1}/PO_Offerte_${c}_MLIBERO_${aaaammgg(d)}.xml`;
export const urlParametri = (c, d) => `${BASE}/parametriML/${d.getFullYear()}_${d.getMonth() + 1}/PO_Parametri_Mercato_Libero_${c}_${aaaammgg(d)}.csv`;
export const isoGiorno = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Prova i file di oggi e dei giorni precedenti finché ne trova uno valido. */
export async function scaricaUltimo(scarica, url, valido, oggi = new Date(), giorni = 10) {
  let ultimoErrore = null;
  for (let i = 0; i < giorni; i++) {
    const d = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate() - i);
    try {
      const t = await scarica(url(d));
      if (t && valido(t)) return { testo: t, data: isoGiorno(d) };
    } catch (e) { ultimoErrore = e; }
  }
  throw ultimoErrore || new Error("nessun file pubblicato negli ultimi giorni");
}

// ------------------------------------------------------------------ parametri
export function leggiParametri(csv) {
  const out = {};
  const righe = csv.replace(/^﻿/, "").split(/\r?\n/);
  for (const r of righe.slice(1)) {
    const m = /^\s*([\w]+)\s*[,;]\s*(-?[\d.,]+)/.exec(r);
    if (m) out[m[1]] = parseFloat(m[2].replace(",", "."));
  }
  return out;
}
export const parametriValidi = (t) => /nome_parametro/i.test(t.slice(0, 200)) && Object.keys(leggiParametri(t)).length > 10;

// ------------------------------------------------------------------ offerte
const dataIso = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const corto = (s, n) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s || "");

const NOMI_VENDITORI = {
  "enel.it": "Enel Energia", "enelenergia.it": "Enel Energia", "servizioelettriconazionale.it": "Servizio Elettrico Nazionale",
  "eni.com": "Plenitude", "eniplenitude.com": "Plenitude", "plenitude.com": "Plenitude", "edisonenergia.it": "Edison Energia",
  "hera.it": "Hera Comm", "heracomm.it": "Hera Comm", "a2a.eu": "A2A Energia", "a2aenergia.eu": "A2A Energia",
  "iren.it": "Iren", "irenlucegas.it": "Iren", "acea.it": "Acea Energia", "sorgenia.it": "Sorgenia", "engie.it": "Engie",
  "estra.it": "Estra", "dolomitienergia.it": "Dolomiti Energia", "octopusenergy.it": "Octopus Energy",
  "illumia.it": "Illumia", "iberdrola.it": "Iberdrola", "eon-energia.com": "E.ON", "eon.it": "E.ON", "pulsee.it": "Pulsee",
  "nen.it": "NeN", "wekiwi.it": "Wekiwi", "alperia.eu": "Alperia", "agsmaim.it": "AGSM AIM", "duferco.it": "Duferco Energia",
  "duferco-energia.it": "Duferco Energia", "tate.it": "Tate", "sinergy.it": "Sinergy", "optimaitalia.com": "Optima",
  "fastweb.it": "Fastweb", "axpo.com": "Axpo", "repower.com": "Repower", "enegan.it": "Enegan", "bluenergygroup.it": "Bluenergy",
  "iliad.it": "Iliad", "vivienergia.it": "Vivi Energia", "segnoverde.it": "Segnoverde", "poste.it": "Poste Energia",
  "posteitaliane.it": "Poste Energia", "heracomm.gruppohera.it": "Hera Comm", "estenergy.gruppohera.it": "EstEnergy (Hera)", "a2a.it": "A2A Energia",
  "aceaenergia.it": "Acea Energia", "estraprometeo.it": "Estra Prometeo", "seviren.it": "SEV (Iren)", "unionenergia.it": "Union Energia", "magisenergia.it": "Magis", "elitenergia.it": "Elit", "agsm.it": "AGSM AIM",
};
export function dominio(url) {
  if (!url) return "";
  return url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\d?\./, "").split(/[/?#]/)[0];
}
export function nomeVenditore(url, piva) {
  const d = dominio(url);
  if (NOMI_VENDITORI[d]) return NOMI_VENDITORI[d];
  if (!d) return `P.IVA ${piva || "?"}`;
  const base = d.replace(/\.(it|com|eu|net|org|energy|info|biz)$/i, "").split(".").pop();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

const TIPO = { "01": "fisso", "02": "variabile", "03": "flat", "04": "mista" };
const RES = { "01": "R", "02": "NR", "03": "T" };

export function normalizzaOfferta(o, rilevazione) {
  const det = figli(o, "DettaglioOfferta")[0];
  const mercato = testo(det, "TIPO_MERCATO");
  const sito = testo(det, "Contatti/URL_SITO_VENDITORE");
  const piva = testo(o, "IdentificativiOfferta/PIVA_UTENTE");
  const perdite = trova(o, (t) => /perdit/i.test(t));
  const zona = figli(o, "ZoneOfferta")[0];
  const zone = zona ? { r: testi(zona, "REGIONE"), p: testi(zona, "PROVINCIA"), c: testi(zona, "COMUNE") } : null;
  const car = figli(o, "CaratteristicheOfferta")[0];
  const minmax = (a, b) => {
    const x = numero(car, a), y = numero(car, b);
    return x == null && y == null ? null : [x || 0, y || null];
  };
  const per = (n) => {
    const pv = figli(n, "PeriodoValidita")[0];
    if (!pv) return {};
    const out = {};
    const d = numero(pv, "DURATA"); if (d) out.dur = d;
    const f = testo(pv, "VALIDO_FINO") || testo(pv, "VALIDA_FINO"); if (f) out.fino = f;
    const ms = numero(pv, "MESE_VALIDITA"); if (ms) out.mese = ms;
    return out;
  };
  return {
    id: testo(o, "IdentificativiOfferta/COD_OFFERTA"),
    piva, sito: dominio(sito), venditore: nomeVenditore(sito, piva),
    url: testo(det, "Contatti/URL_OFFERTA") || (sito ? `https://${dominio(sito)}` : ""),
    tel: testo(det, "Contatti/TELEFONO"),
    forn: mercato === "02" ? "GAS" : mercato === "01" ? "LUCE" : "DUAL",
    // pacchetti dual: codici delle offerte luce e gas da sottoscrivere insieme
    ee: testi(o, "OffertaDual/OFFERTE_CONGIUNTE_EE").concat(testi(o, "OffertaDUAL/OFFERTE_CONGIUNTE_EE")).flatMap((x) => x.split(/[|;,\s]+/)).filter(Boolean),
    gas: testi(o, "OffertaDual/OFFERTE_CONGIUNTE_GAS").concat(testi(o, "OffertaDUAL/OFFERTE_CONGIUNTE_GAS")).flatMap((x) => x.split(/[|;,\s]+/)).filter(Boolean),
    nome: testo(det, "NOME_OFFERTA") || "Offerta senza nome",
    descr: corto(testo(det, "DESCRIZIONE"), 500),
    cliente: testo(det, "TIPO_CLIENTE"),
    singola: (testo(det, "OFFERTA_SINGOLA") || "SI").toUpperCase() !== "NO",
    tipo: TIPO[testo(det, "TIPO_OFFERTA")] || "fisso",
    durata: (() => { const d = numero(det, "DURATA"); return d && d > 0 ? d : null; })(),
    dal: dataIso(testo(o, "ValiditaOfferta/DATA_INIZIO")),
    al: dataIso(testo(o, "ValiditaOfferta/DATA_FINE")),
    res: RES[testo(det, "DOMESTICO_RESIDENTE")] || "T",
    att: testi(det, "TIPOLOGIA_ATT_CONTR"),
    canali: figli(det, "ModalitaAttivazione").map((m) => testo(m, "MODALITA")).filter(Boolean),
    pag: figli(o, "MetodoPagamento").map((m) => testo(m, "MODALITA_PAGAMENTO")).filter(Boolean),
    cons: minmax("CONSUMO_MIN", "CONSUMO_MAX"),
    pot: minmax("POTENZA_MIN", "POTENZA_MAX"),
    zone: zone && (zone.r.length || zone.p.length || zone.c.length) ? zone : null,
    fasce: testo(o, "TipoPrezzo/TIPOLOGIA_FASCE") || "01",
    // Regole del Portale: i prezzi €/kWh si trasmettono già comprensivi delle perdite, salvo indicazione contraria
    perditeIncluse: perdite ? !/^n/i.test((perdite.testo || "").trim()) : true,
    idx: figli(o, "RiferimentiPrezzoEnergia").map((r) => ({ c: testo(r, "IDX_PREZZO_ENERGIA"), k: numero(r, "COEFFICIENTE"), altro: testo(r, "ALTRO") }))
      .filter((r) => r.c),
    disp: figli(o, "Dispacciamento").map((d) => ({ c: testo(d, "TIPO_DISPACCIAMENTO"), v: numero(d, "VALORE_DISP"), n: testo(d, "NOME") }))
      .filter((d) => d.c),
    reg: testi(o, "ComponentiRegolate/CODICE"),
    comp: figli(o, "ComponenteImpresa").map((c) => ({
      n: testo(c, "NOME") || testo(c, "DESCRIZIONE") || "Componente",
      m: testo(c, "MACROAREA"),
      opz: testo(c, "TIPOLOGIA") === "02",
      p: figli(c, "IntervalloPrezzi").map((p) => ({
        f: testo(p, "FASCIA_COMPONENTE"), da: numero(p, "CONSUMO_DA"), a: numero(p, "CONSUMO_A"),
        pr: numero(p, "PREZZO"), u: testo(p, "UNITA_MISURA"), ...per(p),
      })).filter((p) => p.pr != null),
    })),
    sc: figli(o, "Sconto").map((s) => ({
      n: testo(s, "NOME") || "Sconto", d: corto(testo(s, "DESCRIZIONE"), 300),
      cod: testo(s, "CODICE_COMPONENTE_FASCIA"), val: testo(s, "VALIDITA"),
      iva: testo(s, "IVA_SCONTO") !== "02", ...per(s),
      cond: testo(s, "Condizione/CONDIZIONE_APPLICAZIONE") || "00",
      condD: corto(testo(s, "Condizione/DESCRIZIONE_CONDIZIONE"), 200),
      p: figli(s, "PrezziSconto").map((p) => ({
        t: testo(p, "TIPOLOGIA"), u: testo(p, "UNITA_MISURA"), pr: numero(p, "PREZZO"),
        da: numero(p, "VALIDO_DA"), a: numero(p, "VALIDO_FINO"),
      })).filter((p) => p.pr != null),
    })),
    cond: figli(o, "CondizioniContrattuali").map((c) => ({
      t: testo(c, "TIPOLOGIA_CONDIZIONE"), d: corto(testo(c, "DESCRIZIONE"), 400), lim: testo(c, "LIMITANTE") === "01",
    })),
    serv: figli(o, "ProdottiServiziAggiuntivi").map((s) => testo(s, "NOME")).filter(Boolean),
    garanzie: corto(testo(det, "GARANZIE"), 300),
    fonte: `Portale Offerte ARERA, open data del ${rilevazione || "?"}`,
    rilevata: rilevazione || null,
  };
}

/** Legge un file XML del Portale. Tiene solo le offerte domestiche che si possono ancora sottoscrivere. */
export function leggiOfferte(xml, rilevazione, oggiIso = null) {
  const out = [];
  let scartate = 0;
  for (const o of elementi(xml, "offerta")) {
    if (!o) continue;
    const n = normalizzaOfferta(o, rilevazione);
    if (n.cliente !== "01" || (oggiIso && n.al && n.al < oggiIso)) { scartate++; continue; }
    delete n.cliente;
    out.push(n);
  }
  return { offerte: out, scartate };
}
export const offerteValide = (t) => /<(?:\w+:)?ListaOfferte/.test(t.slice(0, 2000)) || /<(?:\w+:)?offerta[\s>]/.test(t.slice(0, 5000));
