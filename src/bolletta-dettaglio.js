// Lettura del «dettaglio importi» di una bolletta (elementi di dettaglio, obbligatori per legge):
// ogni riga con descrizione, periodo, unità di misura, prezzo unitario, quantità e totale.
// Da qui si ricava cosa si paga voce per voce e i prezzi veri dell'offerta, anche senza CTE.
import { num } from "./bolletta-pdf.js";

const SEZ = [
  ["vendita", /spesa per (?:la vendita di|la materia) (?:energia|gas)|spesa per l['’]energia|materia (?:energia|gas naturale)/i],
  ["rete", /spesa per (?:la tariffa per l['’]uso della rete|il trasporto)/i],
  ["oneri", /spesa per (?:gli )?oneri (?:generali )?di sistema/i],
  ["imposte", /imposte e iva|^imposte/i],
];
const UNITA = String.raw`€\s*\/\s*kWh|€\s*\/\s*S?mc|€\s*\/\s*(?:cliente|POD|PDR|PdR|punto[^/]{0,20})\s*\/\s*(?:mese|anno|giorno)|€\s*\/\s*kW(?:\s+di\s+potenza\s+impegnata)?\s*\/\s*(?:mese|anno)|€\s*\/\s*kW|€`;
const RIGA = new RegExp(String.raw`(?:\b(?:V\d{1,2}|VF|N\d|E\d{1,2}|IV\d{1,2})\s+)(?:dal\s+(\d{2}\/\d{2}\/\d{2,4})\s+al\s+(\d{2}\/\d{2}\/\d{2,4})\s+)?(${UNITA})\s+(?:(-?[\d.]*\d(?:,\d+)?)\s+)?(?:(mesi\s*\d+|kW\s*[\d,]+\s*mesi\s*\d+|giorni\s*\d+|-?[\d.]*\d(?:,\d+)?)\s+)?(-?[\d.]*\d,\d{2})(?=\s|$)`, "gi");

const data = (s) => { if (!s) return null; const [g, m, a] = s.split("/"); return `${a.length === 2 ? "20" + a : a}-${m}-${g}`; };
const unita = (u) => u.replace(/\s+/g, " ").replace(/€ ?\/ ?/g, "€/").replace(/ ?\/ ?/g, "/").replace(/kW di potenza impegnata/, "kW").replace(/(?:cliente|POD|PDR|PdR)\//i, "").trim();

/** Righe del dettaglio importi (lavora per righe di testo, unendo le righe spezzate). */
export function righeDettaglio(testo) {
  const grezze = String(testo).replace(/\u00a0/g, " ").replace(/([A-Za-z])\s+([àèéìòù])(?=\s)/g, "$1$2").split(/\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  // una riga che comincia in minuscolo (o con «impegnata/») continua la precedente
  const linee = [];
  for (const l of grezze) { if (linee.length && /^[a-zà-ù(]/.test(l)) linee[linee.length - 1] += " " + l; else linee.push(l); }
  const RE = new RegExp("^(.*?)\\s*" + RIGA.source.replace(/^\(\?:\\b/, "(?:\\b") + "\\s*$", "i");
  const righe = [];
  let sezione = null, gruppo = null, dal = null, al = null;
  for (const l of linee) {
    const m = RE.exec(l);
    if (!m) {
      for (const [k, re] of SEZ) if (re.test(l) && !/^totale/i.test(l)) { sezione = k; gruppo = null; }
      if (!/^(?:totale|descrizione|quota (?:fissa|consumi|potenza|energia)$|pagina|bolletta sintetica)/i.test(l) && !/[\d.]*\d,\d{2}\s*$/.test(l) && l.length < 120 && !/S\.p\.A|Capitale Sociale|P\.\s?IVA|P\.I\.|Codice Fiscale|Sede Legale/i.test(l) && !SEZ.some(([, re]) => re.test(l))) gruppo = l;
      continue;
    }
    const [, descr, d1, d2, u, p, q, tot] = m;
    if (d1) { dal = data(d1); al = data(d2); }
    const qta = q ? (/mesi|kW|giorni/i.test(q) ? q.replace(/\s+/g, " ") : num(q)) : null;
    righe.push({ sezione, gruppo, descr: descr.trim(), dal, al, unita: unita(u), prezzo: p != null ? num(p) : null, quantita: qta, totale: num(tot) });
  }
  return righe;
}

/**
 * Analisi del dettaglio: cosa si paga, prezzi dell'offerta ricostruiti, tipo di prezzo.
 * Ritorna null se nel testo non ci sono righe di dettaglio.
 */
export function analizzaDettaglio(testo) {
  const righe = righeDettaglio(testo);
  if (righe.length < 3) return null;
  const t = String(testo).replace(/\s+/g, " ");
  const tot = (re) => { const m = new RegExp("(?:" + re.source + ")" + String.raw`\s+(-?[\d.]*\d,\d{2})`, "i").exec(t); return m ? num(m[1]) : null; };
  const totali = {
    vendita: tot(/Totale spesa per (?:l['’]energia|la vendita[^0-9]*|la materia[^0-9]*)/), rete: tot(/Totale spesa per il trasporto[^0-9]*/), oneri: tot(/Totale spesa oneri di sistema|Totale spesa per gli oneri[^0-9]*/),
    imposte: tot(/Totale imposte e IVA/), bolletta: tot(/Totale Bolletta/), daPagare: tot(/Totale da pagare/),
  };
  const canone = righe.filter((r) => /canone di abbonamento|canone rai|televisione/i.test(r.descr)).reduce((a, r) => a + r.totale, 0);
  const iva = /IVA\s+(\d+)%\s+su imponibile di euro\s+([\d.]*\d,\d{2})/i.exec(t);
  const luce = righe.some((r) => /kWh/.test(r.unita)), gas = righe.some((r) => /Smc|mc/.test(r.unita));
  const U = luce ? "€/kWh" : "€/Smc";
  const vend = righe.filter((r) => r.sezione === "vendita");
  const energia = vend.filter((r) => r.unita === U && /^(?:energia|materia prima|gas naturale|componente (?:energia|materia)|prezzo (?:energia|gas))/i.test(r.descr) && !/perdite|dispacciamento|sbilanciamento/i.test(r.descr));
  const perdite = vend.filter((r) => /perdite/i.test(r.descr));
  const consumo = energia.reduce((a, r) => a + (typeof r.quantita === "number" ? r.quantita : 0), 0);
  const fascia = (r) => /\bF1\b/.test(r.descr) ? "F1" : /\bF2\b/.test(r.descr) ? "F2" : /\bF3\b/.test(r.descr) ? "F3" : /F23|F2\s*\+\s*F3/i.test(r.descr) ? "F23" : "F0";
  const prezzi = {};
  for (const r of energia) (prezzi[fascia(r)] ||= new Set()).add(r.prezzo);
  const prezzoStabile = Object.values(prezzi).every((s) => s.size === 1);
  const mesi = new Set(energia.map((r) => (r.dal || "").slice(0, 7)).filter(Boolean));
  const quotaVendita = vend.filter((r) => /€\/mese|€\/anno|€\/giorno/.test(r.unita) && /commercializzazione|quota fissa|corrispettivo fisso|PCV|QVD/i.test(r.descr) && !/DISPbt/i.test(r.descr));
  const dispbt = vend.filter((r) => /DISPbt/i.test(r.descr) && /mese/.test(r.unita));
  const cdispd = vend.filter((r) => /CDispD|dispacciamento/i.test(r.descr) && r.unita === U && !/DISPbt/i.test(r.descr));
  const extraVend = vend.filter((r) => r.unita === U && !energia.includes(r) && !perdite.includes(r) && !cdispd.includes(r));
  const media = (rr, k = "prezzo") => (rr.length ? rr.reduce((a, r) => a + (r[k] || 0), 0) / rr.length : null);
  const mensile = (r) => (/anno/.test(r.unita) ? r.prezzo / 12 : /giorno/.test(r.unita) ? r.prezzo * 30.4 : r.prezzo);
  const giorni = (() => { const d = righe.filter((r) => r.dal && r.sezione !== "imposte"); if (!d.length) return null; const a = d.map((r) => r.dal).sort()[0], b = d.map((r) => r.al).sort().at(-1); return { dal: a, al: b }; })();
  const imponibile = (totali.vendita || 0) + (totali.rete || 0) + (totali.oneri || 0);
  const fissiMese = righe.filter((r) => /€\/(?:mese|anno|giorno)|€\/kW\//.test(r.unita) && r.sezione !== "imposte").reduce((a, r) => a + r.totale, 0) / Math.max(1, mesi.size);
  return {
    forn: luce ? "LUCE" : gas ? "GAS" : null, righe, totali, canone, iva: iva ? { aliquota: Number(iva[1]), imponibile: num(iva[2]) } : null,
    periodo: giorni, mesi: mesi.size, consumo,
    offerta: {
      prezzi: Object.fromEntries(Object.entries(prezzi).map(([f, s]) => [f, [...s].reduce((a, b) => a + b, 0) / s.size])),
      perditeSeparate: perdite.length > 0, quotaVenditaMese: quotaVendita.length ? quotaVendita.reduce((a, r) => a + mensile(r), 0) / Math.max(1, mesi.size) : null,
      dispbtMese: media(dispbt), cdispd: media(cdispd), extra: extraVend.map((r) => ({ nome: r.descr, prezzo: r.prezzo })),
      extraKwh: extraVend.length ? extraVend.reduce((a, r) => a + r.prezzo, 0) / Math.max(1, mesi.size) : 0,
    },
    tipoPrezzo: mesi.size >= 2 ? (prezzoStabile ? "uguale in tutti i mesi della bolletta: probabilmente prezzo fisso" : "cambia da un mese all'altro: prezzo variabile") : "un solo mese in bolletta: non si capisce se è fisso o variabile",
    prezzoMedio: consumo ? ((totali.bolletta ?? imponibile) / consumo) : null,
    fissiMese,
  };
}

/** Offerta ricostruita dalla bolletta (formato CTE dell'app), utile quando il codice offerta non è nel catalogo ARERA. */
export function offertaDaDettaglio(d, venditore = "") {
  if (!d?.forn) return null;
  const o = d.offerta, note = [];
  const quota = (o.quotaVenditaMese ?? 0) * 12;
  if (o.perditeSeparate) note.push("In bolletta le perdite di rete (+10%) sono fatturate a parte al prezzo dell'energia.");
  if (o.extra.length) note.push(`Corrispettivi del venditore in più: ${[...new Set(o.extra.map((x) => x.nome))].map((n) => { const v = o.extra.filter((x) => x.nome === n).map((x) => x.prezzo); return `${n} ${v.map((p) => String(p).replace(".", ",")).join(" / ")} ${d.forn === "GAS" ? "€/Smc" : "€/kWh"}`; }).join("; ")}.`);
  note.push(`Prezzo ${d.tipoPrezzo}.`);
  const base = { fornitura: d.forn, fornitore: venditore, nome: "Offerta attuale (dalla bolletta)", fonte: "bolletta", tipoPrezzo: /variabile/.test(d.tipoPrezzo) ? "indicizzato" : "fisso",
    quotaFissaAnnua: Math.round(quota * 100) / 100, note };
  if (d.forn === "LUCE") Object.assign(base, { prezzi: Object.keys(o.prezzi).length ? o.prezzi : { F0: null }, perdite: o.perditeSeparate ? "tutto" : "nessuna", cdispd: "arera", altriKwh: Math.round((o.extraKwh || 0) * 1e6) / 1e6 });
  else Object.assign(base, { prezzoSmc: o.prezzi.F0 ?? null, altriSmc: 0 });
  return base;
}
