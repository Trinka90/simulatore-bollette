// Confronto offerte internet casa (fibra, FTTC, FWA).
// Non esiste un open data ufficiale: il catalogo (data/internet.json) è raccolto a mano con fonte e data.
// Il costo è calcolato mese per mese su un orizzonte (12/24/36 mesi): canone promo e poi pieno,
// attivazione, rate del modem fuori canone, sconti per chi ha il mobile o la luce/gas dello stesso operatore.

export const TECNO = {
  FTTH: { nome: "Fibra fino a casa (FTTH)", breve: "FTTH" },
  FTTC: { nome: "Fibra fino all'armadio (FTTC)", breve: "FTTC" },
  FWA: { nome: "Senza fili (FWA)", breve: "FWA" },
};

/** Lo sconto vale per questo profilo? */
export function scontoValido(o, x, p = {}, oggiIso = "") {
  if (x.scade && oggiIso && x.scade < oggiIso) return false;
  switch (x.richiede) {
    case "mobile": return p.mobile === o.operatore;
    case "energia": return !!o.energia && (p.energia || []).includes(o.energia.sito);
    case "energia2": return !!o.energia && (p.energia || []).includes(o.energia.sito) && !!p.dueForniture;
    case "domiciliazione": return p.domiciliazione !== false;
    case "altro": return false;
    default: return true;
  }
}

/**
 * Costo mese per mese su `orizzonte` mesi.
 * Profilo: { tecnologia, mobile: operatore della SIM, energia: [siti luce/gas], dueForniture, domiciliazione, voce, minDown }
 * Ritorna { totale, medio, mesi:[importo], fasi:[{da,a,v}], voci:[{t,v}], applicati, esclusi, dubbi }
 */
export function costoInternet(o, p = {}, orizzonte = 24, oggiIso = "") {
  const applicati = [], esclusi = [];
  for (const x of o.sconti || []) (scontoValido(o, x, p, oggiIso) ? applicati : esclusi).push(x);
  const mesi = [];
  let canoni = 0, sconti = 0;
  const rate = {};
  for (let m = 1; m <= orizzonte; m++) {
    let v = o.listino; canoni += o.listino;
    for (const x of applicati) if (!x.mesi || m <= x.mesi) { v -= x.importo; sconti += x.importo; }
    for (const r of o.rate || []) if (m >= r.da && m <= r.a) { v += r.importo; rate[r.voce] = (rate[r.voce] || 0) + r.importo; }
    mesi.push(Math.max(0, v));
  }
  const voci = [{ t: `Canone di listino ${eu(o.listino)} × ${orizzonte} mesi`, v: canoni }];
  if (sconti) voci.push({ t: "Sconti applicati", v: -sconti });
  for (const [k, v] of Object.entries(rate)) voci.push({ t: `${k} (rate mensili)`, v });
  for (const u of o.unaTantum || []) { voci.push({ t: `${u.voce} (una volta)${u.dubbio ? " *" : ""}`, v: u.importo }); mesi[0] += u.importo; }
  const totale = mesi.reduce((a, b) => a + b, 0);
  const fasi = [];
  mesi.forEach((v, i) => { const f = fasi.at(-1); if (i > 0 && f && Math.abs(f.v - v) < 0.005) f.a = i + 1; else fasi.push({ da: i + 1, a: i + 1, v }); });
  // la prima fase può includere i costi una tantum: la fase "tipica" la ricalcolo senza
  const una = (o.unaTantum || []).reduce((a, u) => a + u.importo, 0);
  const mensili = mesi.map((v, i) => (i === 0 ? v - una : v));
  const fasiM = [];
  mensili.forEach((v, i) => { const f = fasiM.at(-1); if (f && Math.abs(f.v - v) < 0.005) f.a = i + 1; else fasiM.push({ da: i + 1, a: i + 1, v }); });
  return { totale, medio: totale / orizzonte, mesi, fasi: fasiM, unaTantum: una, voci, applicati, esclusi, dubbi: o.dubbi || [] };
}

/** Prezzo in parole: "19,90 € per 12 mesi, poi 21,90 € fino al 24°, poi 29,90 €". */
export function descriviFasi(fasi) {
  return fasi.map((f, i) => i === 0 ? (fasi.length > 1 ? `${eu(f.v)} per ${f.a} mesi` : `${eu(f.v)} al mese`)
    : i < fasi.length - 1 ? `poi ${eu(f.v)} fino al ${f.a}° mese` : `poi ${eu(f.v)}`).join(", ");
}

/** Costo per lasciare dopo `dopoMesi` mesi. */
export function costoUscita(o, dopoMesi) {
  const u = o.uscita;
  if (!u) return { importo: null, noto: false, testo: "Non indicato: controlla la sintesi contrattuale" };
  const parti = [];
  let tot = 0, noto = u.importo != null;
  const dovuto = u.importo != null && (u.entro_mesi == null || dopoMesi < u.entro_mesi);
  if (dovuto) { tot += u.importo; parti.push(`${eu(u.importo)} di disattivazione${u.migrazione != null ? ` (${eu(u.migrazione)} se passi a un altro operatore)` : ""}`); }
  else if (u.importo != null) parti.push("nessun costo di disattivazione");
  if (u.rateResidue) {
    let res = 0;
    for (const r of o.rate || []) for (let m = dopoMesi + 1; m <= r.a; m++) if (m >= r.da) res += r.importo;
    if (res > 0) { tot += res; parti.push(`${eu(res)} di rate residue (attivazione/modem)`); }
  }
  if (u.rataResidua && dopoMesi < u.rataResidua.mesi) {
    const res = u.rataResidua.importo * (u.rataResidua.mesi - dopoMesi);
    tot += res; noto = true; parti.push(`${eu(res)} di rate di attivazione residue`);
  }
  if (!noto) parti.push("costo di disattivazione non indicato");
  return { importo: noto ? tot : null, noto, testo: parti.join(" + ") };
}

/** Offerte compatibili con la tecnologia disponibile all'indirizzo. */
export function compatibile(o, p) {
  if (!p.tecnologia) return true;
  if (p.tecnologia === "FTTH") return true;
  return o.tecnologie.includes(p.tecnologia) || (p.tecnologia === "FTTC" && o.tecnologie.includes("FWA"));
}

export function classificaInternet(offerte, p, orizzonte = 24, oggiIso = "") {
  const lista = [];
  for (const o of offerte) {
    if (!compatibile(o, p)) continue;
    if (p.voce && !o.voce) continue;
    if (o.soloPer === "mobile" && p.mobile !== o.operatore) continue;
    if (o.energia?.obbligatoria && !(p.energia || []).includes(o.energia.sito) && !p.cambioEnergia) continue;
    if (p.minDown && o.down && o.down < p.minDown) continue;
    const c = costoInternet(o, p, orizzonte, oggiIso);
    lista.push({ offerta: o, ...c, scaduta: !!(o.scade && oggiIso && o.scade < oggiIso) });
  }
  return lista.sort((a, b) => a.totale - b.totale);
}

/** Totale meno affidabile: offerta scaduta o fonte non ufficiale. */
export const incerta = (r) => r.scaduta || r.offerta.fonteTipo === "comparatore";
export const migliore = (lista) => lista.find((r) => !incerta(r)) || lista[0];

/** L'abbonamento attuale inserito dall'utente nel formato del catalogo. */
export function offertaMia(m) {
  const promo = m.promoMesi > 0 && m.dopo != null && m.dopo > m.canone;
  return {
    id: "MIA", mia: true, operatore: m.operatore || "Il tuo operatore", nome: m.nome || "Il tuo abbonamento attuale", sito: "",
    tecnologie: [m.tecnologia || "FTTH"], down: m.down || null, up: null,
    listino: promo ? m.dopo : m.canone, sconti: promo ? [{ importo: m.dopo - m.canone, mesi: m.promoMesi, richiede: null, condizione: "prezzo attuale" }] : [],
    rate: m.modemRata > 0 ? [{ voce: "Modem", importo: m.modemRata, da: 1, a: m.modemMesi || 999 }] : [], unaTantum: [],
    vincolo: null, uscita: null, chiamate: m.chiamate || "", voce: true, note: [], dubbi: [], fonte: "inserito da te", fonteTipo: "mio", verificato: null,
  };
}

/**
 * Pacchetto energia + internet dello stesso fornitore contro la scelta migliore separata.
 * energiaAnnua: spesa annua luce (e gas) con l'offerta del fornitore; orizzonte in mesi.
 */
export function confrontoPacchetto({ energiaPacchetto, internetPacchetto, energiaMigliore, internetMigliore, orizzonte }) {
  const f = orizzonte / 12;
  const pacchetto = energiaPacchetto * f + internetPacchetto;
  const separati = energiaMigliore * f + internetMigliore;
  return { pacchetto, separati, differenza: pacchetto - separati };
}

// --------------------------------------------------------------- sintesi contrattuale (PDF)
const num = (s) => {
  s = String(s).replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "");
  return parseFloat(s.replace(",", "."));
};
const EURO = String.raw`(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:€|euro|eur)`;

/**
 * Legge la Sintesi contrattuale (modello UE obbligatorio, Reg. 2019/2243) o una bolletta telefonica.
 * Ritorna i campi trovati: operatore, nome, canone, promoMesi, dopo, attivazione, recesso, modemRata, modemMesi, down, tecnologia.
 */
export function analizzaSintesi(testo) {
  const t = testo.replace(/\s+/g, " ");
  const out = {};
  const OPERATORI = ["TIM", "Fastweb", "Vodafone", "WINDTRE", "Wind Tre", "Iliad", "Sky", "Tiscali", "EOLO", "Linkem", "Plenitude", "Enel", "Iren", "Edison", "Open Fiber", "Aruba", "Sorgenia", "A2A", "Acea", "Hera"];
  for (const op of OPERATORI) if (new RegExp(`\\b${op}\\b`, "i").test(t)) { out.operatore = op === "Wind Tre" ? "WINDTRE" : op === "Sky" ? "Sky Wifi" : op; break; }
  const nome = t.match(/(?:nome (?:dell'?)?offerta|offerta commerciale|denominazione)\s*[:\-]?\s*([A-Za-z0-9À-ú+&' .-]{3,50}?)(?=\s{1,}(?:prezzo|costo|canone|servizi|velocit|durata|\d|$))/i);
  if (nome) out.nome = nome[1].trim();
  // canone mensile
  const canone = t.match(new RegExp(String.raw`(?:canone|prezzo|costo)[^€\d]{0,60}?(?:mensile|al mese|\/mese|mese)[^€\d]{0,30}?${EURO}`, "i"))
    || t.match(new RegExp(String.raw`${EURO}\s*(?:al mese|\/mese|mensili|ogni mese|\/ mese)`, "i"));
  if (canone) out.canone = num(canone[1]);
  // durata promo e prezzo dopo
  const promo = t.match(/(?:per (?:i )?primi|per)\s+(\d{1,2})\s*mesi/i);
  if (promo) out.promoMesi = +promo[1];
  const dopo = t.match(new RegExp(String.raw`(?:poi|successivamente|dal\s+\d{1,2}°?\s*mese|a partire dal\s+\d{1,2}°?\s*mese)[^€\d]{0,40}?${EURO}`, "i"));
  if (dopo) out.dopo = num(dopo[1]);
  const att = t.match(new RegExp(String.raw`(?:attivazione|contributo di attivazione|costo di attivazione|installazione)[^€\d]{0,60}?${EURO}`, "i"));
  if (att) out.attivazione = num(att[1]);
  else if (/attivazione\s+(?:gratuita|inclusa|0\s*€)/i.test(t)) out.attivazione = 0;
  const rec = t.match(new RegExp(String.raw`(?:disattivazione|recesso|cessazione)[^€\d]{0,80}?${EURO}`, "i"));
  if (rec) out.recesso = num(rec[1]);
  const mod = t.match(new RegExp(String.raw`(?:modem|router)[^€]{0,60}?${EURO}[^0-9]{0,20}(?:al mese|\/mese)?[^0-9]{0,20}?(?:per\s+)?(\d{2})\s*mesi`, "i"));
  if (mod) { out.modemRata = num(mod[1]); out.modemMesi = +mod[2]; }
  const vel = t.match(/(\d+(?:[.,]\d+)?)\s*(Gbit\/s|Gbps|Giga|Mbit\/s|Mbps|Mega)\b/i);
  if (vel) out.down = /^G/i.test(vel[2]) ? num(vel[1]) * 1000 : num(vel[1]);
  if (/FTTH|fibra fino a casa|fiber to the home/i.test(t)) out.tecnologia = "FTTH";
  else if (/FTTC|fiber to the cabinet|VDSL/i.test(t)) out.tecnologia = "FTTC";
  else if (/FWA|fixed wireless|wireless/i.test(t)) out.tecnologia = "FWA";
  return out;
}

function eu(v) { return (Math.round(v * 100) / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
