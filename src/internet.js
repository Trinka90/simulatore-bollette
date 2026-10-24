// Confronto offerte internet casa (fibra, FTTC, FWA).
// Non esiste un open data ufficiale: il catalogo (data/internet.json) è raccolto a mano con fonte e data.
// Il costo è calcolato mese per mese su un orizzonte (12/24/36 mesi): canone promo e poi pieno,
// attivazione, rate del modem fuori canone, sconti per chi ha il mobile o la luce/gas dello stesso operatore.

export const TECNO = {
  FTTH: { nome: "Fibra fino a casa (FTTH)", breve: "FTTH" },
  FTTC: { nome: "Fibra fino all'armadio (FTTC)", breve: "FTTC" },
  FWA: { nome: "Senza fili (FWA)", breve: "FWA" },
};

/**
 * Profilo: { tecnologia: "FTTH"|"FTTC"|"FWA", mobile: "TIM"|..., energia: [siti luce/gas che hai o attiveresti], voce: bool }
 * Ritorna { totale, medio, mesi:[importo], voci:[{t, v}], incognite:[testo], condizioni:[testo] }
 */
export function costoInternet(o, p = {}, orizzonte = 24) {
  const voci = [], incognite = [], condizioni = [];
  const mesi = [];
  const haMobile = p.mobile && p.mobile === o.operatore;
  const haEnergia = o.energia ? (p.energia || []).includes(o.energia.sito) : false;
  let promoOk = !!o.promo;
  if (o.promo?.richiede === "mobile" && !haMobile) promoOk = false;
  if (o.promo?.richiede === "energia" && !haEnergia) promoOk = false;
  if (o.promo && !promoOk) condizioni.push(`Prezzo ${eu(o.promo.canone)} solo ${o.promo.condizione || "con una condizione"}: non applicato`);
  if (o.promo && promoOk && o.promo.richiede) condizioni.push(`Prezzo ${eu(o.promo.canone)} ${o.promo.condizione}: applicato`);
  if (o.energia?.obbligatoria) condizioni.push(`Si attiva solo insieme alla luce o al gas ${o.operatore}`);

  const pieno = o.canone ?? o.promo?.canone;
  if (o.canone == null && o.promo) incognite.push(`Prezzo dopo i primi ${o.promo.mesi} mesi non pubblicato: considerato uguale (${eu(o.promo.canone)})`);
  const scontoMobile = haMobile && o.sconto_mobile ? o.sconto_mobile : 0;
  if (o.sconto_mobile && !haMobile) condizioni.push(`−${eu(o.sconto_mobile)} al mese se hai anche il mobile ${o.operatore}: non applicato`);
  if (scontoMobile) condizioni.push(`−${eu(scontoMobile)} al mese perché hai il mobile ${o.operatore}`);

  let canoni = 0, nPromo = 0;
  for (let m = 1; m <= orizzonte; m++) {
    const promo = promoOk && m <= o.promo.mesi;
    if (promo) nPromo++;
    const c = Math.max(0, (promo ? o.promo.canone : pieno) - scontoMobile);
    mesi.push(c); canoni += c;
  }
  if (nPromo && nPromo < orizzonte) voci.push({ t: `Canone ${eu(o.promo.canone - scontoMobile)} × ${nPromo} mesi, poi ${eu(pieno - scontoMobile)} × ${orizzonte - nPromo}`, v: canoni });
  else voci.push({ t: `Canone ${eu(mesi[0])} × ${orizzonte} mesi`, v: canoni });

  let att = o.attivazione;
  if (att == null) { incognite.push("Costo di attivazione non pubblicato nella fonte: considerato 0 €"); att = 0; }
  if (att > 0) { voci.push({ t: "Attivazione (una volta)", v: att }); mesi[0] += att; }

  const md = o.modem || {};
  if (md.rata > 0 && !md.nel_canone) {
    const n = Math.min(md.mesi || orizzonte, orizzonte);
    voci.push({ t: `Modem ${eu(md.rata)} × ${n} rate`, v: md.rata * n });
    for (let m = 0; m < n; m++) mesi[m] += md.rata;
  }
  if (md.nel_canone && md.mesi > orizzonte) condizioni.push(`Il modem è pagato a rate per ${md.mesi} mesi: se lasci prima, paghi le rate residue`);

  const totale = mesi.reduce((a, b) => a + b, 0);
  return { totale, medio: totale / orizzonte, mesi, voci, incognite, condizioni, promoOk, scontoMobile };
}

/** Costo per lasciare dopo `dopoMesi` mesi (se noto). */
export function costoUscita(o, dopoMesi) {
  const r = o.recesso;
  if (o.modem?.nel_canone && o.modem.mesi > dopoMesi) {
    const residue = (o.modem.mesi - dopoMesi) * o.modem.rata;
    return { importo: residue + (r?.importo || 0), noto: true, testo: `${eu(residue)} di rate del modem residue${r?.testo ? "; " + r.testo : ""}` };
  }
  if (r?.importo != null) return { importo: r.entro_mesi == null || dopoMesi < r.entro_mesi ? r.importo : 0, noto: true, testo: r.testo };
  if (r?.testo) return { importo: null, noto: false, testo: r.testo };
  if (o.vincolo === 0) return { importo: null, noto: false, testo: "Nessun vincolo; il costo di disattivazione non è indicato nella fonte" };
  return { importo: null, noto: false, testo: "Non indicato: controlla la sintesi contrattuale" };
}

/** Offerte compatibili con la tecnologia disponibile all'indirizzo. */
export function compatibile(o, p) {
  if (!p.tecnologia) return true;
  if (p.tecnologia === "FTTH") return o.tecnologie.some((t) => t === "FTTH" || t === "FTTC" || t === "FWA");
  return o.tecnologie.includes(p.tecnologia) || (p.tecnologia === "FTTC" && o.tecnologie.includes("FWA"));
}

export function classificaInternet(offerte, p, orizzonte = 24, oggiIso = "") {
  const lista = [];
  for (const o of offerte) {
    if (!compatibile(o, p)) continue;
    if (p.voce && /assenti|^$/.test(o.chiamate || "")) continue;
    if (o.energia?.obbligatoria && !(p.energia || []).includes(o.energia.sito) && !p.cambioEnergia) continue;
    if (p.minDown && o.down && o.down < p.minDown) continue;
    const c = costoInternet(o, p, orizzonte);
    lista.push({ offerta: o, ...c, scaduta: !!(o.scade && oggiIso && o.scade < oggiIso) });
  }
  return lista.sort((a, b) => a.totale - b.totale);
}

/** Totale non affidabile: promo scaduta o prezzo dopo la promo non pubblicato entro l'orizzonte. */
export const incerta = (r, N) => r.scaduta || (r.offerta.canone == null && !!r.offerta.promo && r.offerta.promo.mesi < N);
export const migliore = (lista, N) => lista.find((r) => !incerta(r, N)) || lista[0];

/** L'abbonamento attuale inserito dall'utente come offerta del catalogo. */
export function offertaMia(m) {
  const promoRest = m.promoMesi > 0 && m.dopo != null && m.dopo !== m.canone;
  return {
    id: "MIA", mia: true, operatore: m.operatore || "Il tuo operatore", nome: m.nome || "Il tuo abbonamento attuale", sito: "",
    tecnologie: [m.tecnologia || "FTTH"], down: m.down || null, up: null,
    canone: promoRest ? m.dopo : m.canone, promo: promoRest ? { canone: m.canone, mesi: m.promoMesi, richiede: null, condizione: null } : null,
    attivazione: 0, modem: { incluso: true, rata: m.modemRata || 0, mesi: m.modemMesi || null }, vincolo: null, recesso: null,
    chiamate: m.chiamate || "", sconto_mobile: null, note: [], fonte: "inserito da te", verificato: null,
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
