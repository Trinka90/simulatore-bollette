// Lettura di una bolletta luce o gas (PDF con testo, formato "Bolletta 2.0" ARERA).
// Ogni dato trovato è restituito con la frase da cui viene, per poterlo controllare.
import { normalizza } from "./cte.js";

/** Numero all'italiana: 3.175 = tremila, 1.234,56 · 12,5 · 6. */
export function num(x) {
  let s = String(x).trim().replace(/\s/g, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "");
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

const N = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)`; // 1.234,56 · 1234 · 12,5

function trova(t, re, conv = (m) => num(m[1])) {
  const m = re.exec(t);
  if (!m) return null;
  const v = conv(m);
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) return null;
  const a = Math.max(0, m.index - 40), b = Math.min(t.length, m.index + m[0].length + 20);
  return { valore: v, frase: "…" + t.slice(a, b).replace(/\s+/g, " ").trim() + "…" };
}
const data = (s) => { const m = /(\d{2})[/.-](\d{2})[/.-](\d{2,4})/.exec(s); if (!m) return null; const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2]}-${m[1]}`; };

/** Consumo di una fascia: numero seguito direttamente da kWh (un prezzo avrebbe "€/kWh" in mezzo). Il più alto vince. */
function fascia(t, f) {
  const re = new RegExp(String.raw`\b${f}\b[^€\n]{0,40}?${N}\s*kWh(?!\s*\/)`, "gi");
  let m, best = null;
  while ((m = re.exec(t))) {
    const v = num(m[1]);
    if (v != null && (best == null || v > best.valore)) best = { valore: v, frase: "…" + m[0].trim() + "…" };
  }
  return best;
}

/**
 * Analizza il testo di una bolletta. comuni: [{istat,nome,sigla,provincia,regione}].
 * Restituisce {tipo, campi:{nome:{valore,frase}}, avvisi}.
 */
export function analizzaBolletta(testo, comuni = []) {
  const t = normalizza(testo);
  const c = {}, avvisi = [];
  const set = (k, r) => { if (r) c[k] = r; };
  const pod = trova(t, /\b(IT\d{3}E\d{7,9}[A-Z]?)\b/i, (m) => m[1].toUpperCase());
  const pdr = trova(t, /\bPDR\b[^0-9]{0,40}(\d{14})\b/i, (m) => m[1]);
  const kwh = (t.match(/kWh/gi) || []).length, smc = (t.match(/\bS?mc\b|Smc/gi) || []).length;
  const tipo = pod && !pdr ? "LUCE" : pdr && !pod ? "GAS" : kwh || smc ? (kwh >= smc ? "LUCE" : "GAS") : null;
  if (!tipo) return { tipo: null, campi: c, avvisi: ["Non trovo kWh né Smc: il PDF potrebbe essere una scansione o non essere una bolletta."] };
  const U = tipo === "LUCE" ? "kWh" : "S?mc";
  set("pod", tipo === "LUCE" ? pod : pdr);
  set("codiceOfferta", trova(t, /\b(\d{6}[EGD]S[A-Z0-9_]{24})\b/i, (m) => m[1].toUpperCase()));
  set("nomeOfferta", trova(t, /(?:nome\s+(?:dell'\s*)?offerta|denominazione\s+(?:dell'\s*)?offerta|offerta(?:\s+commerciale)?)\s*:\s*([A-Za-z0-9][^\n:;]{2,60}?)(?=\s{2,}|\s(?:codice|cod\.|valid|data|prezzo|tipo)|[;\n]|$)/i, (m) => m[1].trim()));
  set("consumoAnnuo", trova(t, new RegExp(String.raw`consumo\s+annuo[^0-9]{0,120}?${N}\s*${U}`, "i")));
  set("consumoPeriodo", trova(t, new RegExp(String.raw`(?:consum[oi]\s+(?:fatturat[oi]|effettiv[oi]|rilevat[oi]|stimat[oi]|del\s+periodo|totale|nel\s+periodo)|totale\s+consumi?)[^0-9]{0,60}?${N}\s*${U}(?!\s*\/)`, "i")));
  const per = trova(t, /(?:periodo(?:\s+di\s+(?:fatturazione|riferimento))?|fornitura|consumi)\s*:?\s*(?:dal\s*)?(\d{2}[/.-]\d{2}[/.-]\d{2,4})\s*(?:-|–|al|a)\s*(\d{2}[/.-]\d{2}[/.-]\d{2,4})/i,
    (m) => ({ dal: data(m[1]), al: data(m[2]) }));
  if (per && per.valore.dal && per.valore.al && per.valore.al >= per.valore.dal) c.periodo = per;
  set("totale", trova(t, /totale\s+(?:da\s+pagare|bolletta|fattura|documento|importo\s+da\s+pagare)[^0-9€\n]{0,40}?(?:€|euro)?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i));
  const t12 = t.replace(/ultim([io])\s+12\s+mesi/gi, "ultim$1 dodici mesi");
  set("spesaAnnua", trova(t12, /spesa\s+(?:annua|totale\s+(?:degli|negli)\s+ultimi\s+dodici\s+mesi|sostenuta)[^0-9€\n]{0,60}?(?:€|euro)?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i));
  const canone = trova(t, /canone\s+(?:di\s+)?(?:abbonamento\s+(?:alla\s+)?(?:televisione|tv)|rai)[^0-9€\n]{0,60}?(?:€|euro)?\s*(\d{1,3},\d{2})/i);
  if (canone) c.canoneRai = canone;
  else if (/canone\s+(?:rai|tv|di\s+abbonamento\s+alla\s+televisione)/i.test(t)) c.canoneRai = { valore: true, frase: "canone RAI citato in bolletta" };
  if (tipo === "LUCE") {
    set("potenza", trova(t, /potenza\s+(?:contrattualmente\s+)?impegnata[^0-9]{0,40}?(\d+(?:[.,]\d+)?)\s*kW\b/i));
    for (const f of ["F1", "F2", "F3"]) set(f, fascia(t, f));
    if (/non\s+residente/i.test(t)) c.residente = { valore: false, frase: "«non residente»" };
    else if (/(?:domestic[oa]\s+residente|uso\s+domestico\s+residente|cliente\s+residente|residente\s*:\s*s[iì])/i.test(t)) c.residente = { valore: true, frase: "«domestico residente»" };
  } else {
    const cat = trova(t, /(?:categoria|tipologia)\s+d['’]?\s*uso[^A-Za-z0-9]{0,10}(C[123]|riscaldamento|cottura[^.\n]{0,40}|uso\s+tecnologico)/i, (m) => m[1]);
    if (cat) {
      const v = cat.valore.toLowerCase();
      cat.valore = v === "c1" || /^riscaldamento/.test(v) ? "riscaldamento" : v === "c2" || /cottura/.test(v) ? "cottura" : "entrambi";
      c.uso = cat;
    }
    set("coeffC", trova(t, /coefficiente\s+(?:di\s+(?:conversione|correzione)\s*)?\(?C\)?[^0-9]{0,20}(\d[.,]\d{3,6})/i));
  }
  // comune di fornitura: "CAP COMUNE (PR)" vicino a "fornitura"
  const parte = (() => { const i = t.search(/(?:indirizzo|luogo|punto|sede)\s+di\s+fornitura|fornitura\s+(?:in|presso)/i); return i >= 0 ? t.slice(i, i + 400) : t; })();
  const reCap = /\b(\d{5})\s+([A-ZÀ-Ü][A-Za-zÀ-ÿ'’. -]{1,40}?)\s*\(?\b([A-Z]{2})\b\)?/g;
  for (const testoZona of [parte, t]) {
    let m;
    reCap.lastIndex = 0;
    while ((m = reCap.exec(testoZona))) {
      const nome = m[2].trim().toLowerCase(), sigla = m[3].toUpperCase();
      const com = comuni.find((x) => x.sigla === sigla && x.nome.toLowerCase() === nome) || comuni.find((x) => x.sigla === sigla && nome.startsWith(x.nome.toLowerCase()));
      if (com) { c.comune = { valore: com, frase: `…${m[0].trim()}…` }; break; }
    }
    if (c.comune) break;
  }
  // consumo medio (giornaliero, mensile o annuo) e storico dei consumi, se la bolletta li riporta
  const medio = trova(t, new RegExp(String.raw`consumo\s+medio\s+(giornaliero|mensile|annuo|al\s+giorno|al\s+mese)[^0-9]{0,60}?${N}\s*${U}`, "i"),
    (m) => ({ q: num(m[2]), per: /giorn/i.test(m[1]) ? "giorno" : /mes/i.test(m[1]) ? "mese" : "anno" }));
  if (medio && medio.valore.q != null) c.consumoMedio = medio;
  const st = storicoConsumi(t, U);
  if (st.length) c.storico = { valore: st, frase: `${st.length} periodi nello storico dei consumi` };
  if (!c.consumoAnnuo && st.length) {
    const r = consumiDaBollette(st.map((x) => ({ ...x })));
    if (r && r.coperti >= 11) c.consumoAnnuo = { valore: Math.round(Object.values(r.mesi).reduce((a, b) => a + b, 0)), frase: "somma dello storico dei consumi degli ultimi 12 mesi" };
  }
  if (tipo === "LUCE" && !c.consumoPeriodo && c.F1 && c.F2 && c.F3) c.consumoPeriodo = { valore: c.F1.valore + c.F2.valore + c.F3.valore, frase: "somma delle fasce F1+F2+F3" };
  if (!c.consumoAnnuo) avvisi.push("Non trovo il consumo annuo: controlla la sezione «consumi» della bolletta.");
  if (!c.codiceOfferta) avvisi.push("Non trovo il codice offerta (32 caratteri): senza, non posso ritrovare la tua offerta nel catalogo ARERA.");
  return { tipo, campi: c, avvisi };
}

/** Ripartisce il consumo di un periodo sui mesi solari, in proporzione ai giorni. {"AAAA-MM": quantità} */
export function consumoPerMese(dal, al, q) {
  const d0 = Date.parse(dal + "T00:00:00Z"), d1 = Date.parse(al + "T00:00:00Z");
  const giorni = Math.round((d1 - d0) / 86400000) + 1;
  const out = {};
  for (let d = d0; d <= d1; d += 86400000) {
    const k = new Date(d).toISOString().slice(0, 7);
    out[k] = (out[k] || 0) + q / giorni;
  }
  return out;
}

/**
 * Dalle bollette salvate ricostruisce i consumi dei 12 mesi solari (1..12) più recenti coperti.
 * Restituisce {mesi:{1..12}, coperti:n, daStima:[mesi mancanti]} oppure null.
 */
export function consumiDaBollette(bollette) {
  const perMese = {}, daStorico = {};
  for (const b of bollette) {
    if (!b.dal || !b.al || !(b.consumo > 0)) continue;
    for (const [k, v] of Object.entries(consumoPerMese(b.dal, b.al, b.consumo))) perMese[k] = (perMese[k] || 0) + v;
  }
  // storico riportato nelle bollette: riempie solo i mesi non coperti da una bolletta (vince la bolletta più recente)
  for (const b of [...bollette].sort((a, b) => (a.al || "").localeCompare(b.al || ""))) {
    for (const x of b.storico || []) {
      if (!(x.consumo >= 0)) continue;
      for (const [k, v] of Object.entries(consumoPerMese(x.dal, x.al, x.consumo))) {
        if (!(k in daStorico) || daStorico[k].src !== x) daStorico[k] = { v: (daStorico[k]?.src === x ? daStorico[k].v : 0) + v, src: x };
      }
    }
  }
  for (const [k, { v }] of Object.entries(daStorico)) if (!(k in perMese)) perMese[k] = v;
  const chiavi = Object.keys(perMese).sort();
  if (!chiavi.length) return null;
  const ultimi = {};
  for (const k of chiavi) ultimi[Number(k.slice(5))] = { v: perMese[k], k }; // il più recente per ogni mese solare vince
  const mesi = {}, mancanti = [];
  for (let m = 1; m <= 12; m++) { if (ultimi[m]) mesi[m] = Math.round(ultimi[m].v * 10) / 10; else mancanti.push(m); }
  return { mesi, coperti: 12 - mancanti.length, mancanti };
}

const MESI3 = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const ultimoGiorno = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/**
 * Storico dei consumi ("Andamento/Storico dei consumi", grafico o tabella): righe "mese anno quantità"
 * oppure "dal–al quantità". Restituisce [{dal, al, consumo}] ordinati.
 */
export function storicoConsumi(t, U = "kWh") {
  const i = t.search(/(?:storico|andamento|riepilogo)\s+(?:dei\s+)?consumi|consumi\s+(?:degli\s+)?ultimi/i);
  if (i < 0) return [];
  const z = t.slice(i, i + 2500);
  const out = [];
  const reM = new RegExp(String.raw`\b(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)[a-z]*\.?[\s/'-]*(20\d{2}|\d{2})\s*:?\s*${N}\s*(?:${U})?(?!\s*(?:€|euro|%|\/))`, "gi");
  let m;
  while ((m = reM.exec(z))) {
    const mese = MESI3.indexOf(m[1].toLowerCase()) + 1, anno = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    const q = num(m[3]);
    if (q == null || anno < 2015 || anno > 2100) continue;
    const mm = String(mese).padStart(2, "0");
    out.push({ dal: `${anno}-${mm}-01`, al: `${anno}-${mm}-${ultimoGiorno(anno, mese)}`, consumo: q });
  }
  if (!out.length) {
    const reP = new RegExp(String.raw`(\d{2}[/.-]\d{2}[/.-]\d{4})\s*(?:-|–|al)\s*(\d{2}[/.-]\d{2}[/.-]\d{4})[^0-9€]{0,20}?${N}\s*(?:${U})?(?!\s*(?:€|euro|%|\/))`, "gi");
    while ((m = reP.exec(z))) {
      const q = num(m[3]), dal = data(m[1]), al = data(m[2]);
      if (q != null && dal && al && al > dal) out.push({ dal, al, consumo: q });
    }
  }
  // tieni un valore per periodo, in ordine
  const visti = new Map();
  for (const x of out) visti.set(x.dal + x.al, x);
  return [...visti.values()].sort((a, b) => a.dal.localeCompare(b.dal));
}
