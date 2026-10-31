// Analisi completa di una CTE (Condizioni Tecnico Economiche).
// Obiettivo: nessuna sorpresa. Ogni frase che contiene un importo viene mostrata, classificata per voce
// (energia, quota fissa, sconti, penali, deposito, pagamento, servizi…) oppure segnalata come «da leggere».
// Le clausole senza importo ma rischiose (rinnovo, modifiche unilaterali, sconti che decadono…) diventano avvisi.
import { normalizza, num, tipoFornitura } from "./cte.js";
import { attivazioneDaTesto } from "./attivazione.js";

const IMPORTO = /(-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?)\s*(c(?:ent(?:esimi)?)?\s*€\s*\/\s*kWh|€\s*\/\s*kWh|€\s*\/\s*S?mc|€\s*\/\s*kW(?:\s*\/\s*(?:anno|mese))?|€\s*\/\s*(?:POD\s*\/\s*|PDR\s*\/\s*|punto[^/]{0,20}\/\s*|cliente\s*\/\s*)?(?:anno|mese|giorno)|€|euro|%)/gi;

export const SEZIONI = [
  ["stime", "Stime e spese di esempio del venditore", /cliente tipo|spesa (?:annua )?(?:stimata|per la materia|complessiva)|stima della spesa|consumo (?:annuo )?di \d/i],
  ["sconti", "Sconti e bonus", /sconto|scont[io]|bonus|premio|cashback|omaggi|riduzione del prezzo|accredit/i],
  ["penali", "Penali e costi di uscita", /penal|recesso anticipat|corrispettivo (?:di|per il) recesso|cessazione anticipat|disattivazione anticipat|in caso di recesso/i],
  ["deposito", "Deposito e garanzie", /deposit|cauzion|fideiussion|garanzia (?:di|del) pagament|anticipo (?:sui )?consumi/i],
  ["mora", "Ritardi nei pagamenti", /\bmora\b|interess[ie]|sollecit|ritardat\w* pagament|ritardo nel pagament|riattivazion|sospensione (?:della )?fornitura|distacco/i],
  ["pagamento", "Modalità e costi di pagamento", /bollettin|bonific|carta di credito|\bSDD\b|\bRID\b|domiciliazion|addebito (?:diretto|su conto)|modalit\w* di pagament|commission/i],
  ["bolletta", "Bolletta", /bolletta (?:in )?(?:formato )?cartace|invio cartace|formato cartace|spedizione (?:della )?bollett|copia (?:cartacea )?(?:della )?bollett|bolletta (?:web|online|elettronica|via e-?mail)/i],
  ["servizi", "Servizi aggiuntivi e opzioni", /assicuraz|polizz|manutenzion|assistenza (?:casa|tecnica|sanitaria)|energia verde|garanzi\w* d['’]origine|certificat\w* (?:verde|di origine)|opzion|servizio aggiuntiv|servizi accessori|abbonament|kit|caldaia|app\b/i],
  ["amministrativi", "Costi di attivazione e pratiche", /costo di attivazione|contributo (?:di )?(?:attivazione|allacciamento)|gestione (?:della )?pratic|oneri amministrativ|spese (?:di gestione|amministrative)|voltura|subentro|diritti fissi|una tantum/i],
  ["dispacciamento", "Dispacciamento e perdite di rete", /dispacciament|perdite di rete|\bperdite\b|sbilanciament/i],
  ["quota", "Quota fissa (commercializzazione)", /quota fissa|costo fisso|commercializzazion|\bPCV\b|\bQVD\b|corrispettivo fisso|corrispettivo annuo|€\s*\/\s*(?:POD\s*\/\s*|PDR\s*\/\s*|cliente\s*\/\s*)?(?:anno|mese)\b/i],
  ["energia", "Prezzo dell'energia / del gas", /prezzo|corrispettivo (?:per (?:i )?consum|energia|gas|materia)|componente (?:energia|materia)|materia prima|spread|\bPUN\b|\bPSV\b|\bF[0-3]\b|fascia|€\s*\/\s*kWh|€\s*\/\s*S?mc/i],
  ["regolate", "Voci regolate da ARERA (uguali per tutti i venditori)", /trasporto|gestione del contatore|oneri di sistema|accis|\bIVA\b|imposte|addizional|\bASOS\b|\bARIM\b|\bUC\d|canone rai/i],
];

// clausole da segnalare anche senza importo
const CLAUSOLE = [
  ["attenzione", "Rinnovo alla scadenza", /(?:alla scadenza|decorsi i \d+ mesi|al termine (?:del periodo|delle condizioni)|dopo i primi \d+ mesi)[^.]{0,220}/i],
  ["attenzione", "Il venditore può cambiare le condizioni", /(?:facolt\w* di (?:modificare|variare)|modifich\w* unilateral|variazion\w* unilateral|si riserva (?:il diritto|la facolt))[^.]{0,200}/i],
  ["attenzione", "Lo sconto può decadere", /(?:sconto|bonus)[^.]{0,120}(?:decad|non (?:sarà|verrà) (?:più )?applicat|perde|revoc|cessa)[^.]{0,120}/i],
  ["attenzione", "Servizio attivato automaticamente", /(?:attivat\w*|inclus\w*) (?:automaticamente|di default|d['’]ufficio)[^.]{0,160}/i],
  ["attenzione", "Durata minima o vincolo", /(?:durata minima|vincolo (?:di|contrattuale)|impegno (?:di|a) (?:permanenza|restare))[^.]{0,160}/i],
  ["info", "Prezzo indicizzato", /\b(?:PUN|PSV)\b(?:\s*Index)?(?:\s*GME)?[^.]{0,40}(?:\+|maggiorat|più|spread)[^.]{0,160}/i],
  ["info", "Perdite di rete", /perdite di rete[^.]{0,200}/i],
  ["info", "Tetto o limite al prezzo", /(?:prezzo massimo|tetto|non (?:potrà|potra) superare|cap\b)[^.]{0,160}/i],
  ["info", "Solo con domiciliazione o bolletta online", /(?:esclusivamente|solo|unicamente)[^.]{0,40}(?:domiciliazion|addebito|bolletta (?:web|online|elettronica|via e-?mail))[^.]{0,120}/i],
];

/** Frasi del documento: punto, a capo, punto e virgola; i pezzi troppo lunghi (tabelle) spezzati. */
export function frasi(testo) {
  const t = String(testo).replace(/ /g, " ").replace(/[ \t]+/g, " ");
  const grezze = t.split(/(?<=[.;])\s+(?=[A-ZÀ-Ü0-9])|\n+/);
  const out = [];
  for (let f of grezze) {
    f = f.trim();
    if (!f) continue;
    // valore staccato dalla sua etichetta (righe di tabella): lo riattacco alla riga precedente
    const parole = f.replace(IMPORTO, " ").replace(/[^A-Za-zÀ-ÿ]+/g, " ").trim();
    if (out.length && (parole.length < 4 || /^[:\-–]/.test(f) || /:\s*$/.test(out.at(-1)))) { out[out.length - 1] += " " + f; continue; }
    if (f.length < 4) continue;
    while (f.length > 320) { const i = f.lastIndexOf(" ", 300); out.push(f.slice(0, i > 100 ? i : 300).trim()); f = f.slice(i > 100 ? i : 300).trim(); }
    out.push(f);
  }
  return out;
}

const unita = (u) => u.replace(/\s+/g, "").replace(/^c(?:ent(?:esimi)?)?€/i, "c€").replace(/euro/i, "€");
export function importi(f) {
  const out = [];
  let m;
  IMPORTO.lastIndex = 0;
  while ((m = IMPORTO.exec(f))) {
    const v = num(m[1]);
    if (v == null) continue;
    // anni, articoli di legge, numeri di delibera non sono importi
    if (/^(?:19|20)\d{2}$/.test(m[1]) && m[2] === "%") continue;
    out.push({ v, u: unita(m[2]) });
  }
  return out;
}

/**
 * Analisi completa. catalogo: offerte del Portale (per il confronto con il codice offerta).
 * Ritorna { forn, natura, indice, durataMesi, codice, portale, sezioni:{id:{titolo, voci:[{frase, importi}]}},
 *           daLeggere:[frase], avvisi:[{livello, titolo, frase}], attivazione, riassunto, statistiche }
 */
export function analisiCompleta(testoGrezzo, catalogo = []) {
  const t = normalizza(testoGrezzo);
  const forn = tipoFornitura(t);
  const ff = frasi(testoGrezzo);
  const sezioni = Object.fromEntries(SEZIONI.map(([id, titolo]) => [id, { titolo, voci: [] }]));
  const daLeggere = [];
  let conImporti = 0;
  for (const f of ff) {
    const imp = importi(f);
    if (!imp.length) continue;
    conImporti++;
    const s = SEZIONI.find(([, , re]) => re.test(f));
    if (s) sezioni[s[0]].voci.push({ frase: f, importi: imp });
    else daLeggere.push({ frase: f, importi: imp });
  }
  // avvisi sulle clausole
  const avvisi = [];
  for (const [livello, titolo, re] of CLAUSOLE) {
    const m = re.exec(t);
    if (m) avvisi.push({ livello, titolo, frase: "…" + m[0].trim() + "…" });
  }
  if (sezioni.deposito.voci.length) avvisi.unshift({ livello: "attenzione", titolo: "Deposito cauzionale", frase: sezioni.deposito.voci[0].frase });
  if (sezioni.penali.voci.length) avvisi.unshift({ livello: "attenzione", titolo: "Costi se lasci prima", frase: sezioni.penali.voci[0].frase });
  if (sezioni.servizi.voci.length) avvisi.push({ livello: "attenzione", titolo: "Servizi a pagamento oltre all'energia", frase: sezioni.servizi.voci[0].frase });
  if (sezioni.bolletta.voci.some((v) => v.importi.some((i) => i.v > 0))) avvisi.push({ livello: "attenzione", titolo: "Costo per la bolletta", frase: sezioni.bolletta.voci.find((v) => v.importi.some((i) => i.v > 0)).frase });
  if (sezioni.pagamento.voci.some((v) => v.importi.some((i) => i.v > 0 && i.u !== "%"))) avvisi.push({ livello: "attenzione", titolo: "Costo legato al metodo di pagamento", frase: sezioni.pagamento.voci.find((v) => v.importi.some((i) => i.v > 0)).frase });

  // natura del prezzo
  const idx = forn === "GAS" ? "PSV" : "PUN";
  const RINNOVO = /alla scadenza|decorsi i \d+ mesi|al termine|dopo i primi \d+ mesi|in assenza di comunicazione|nuove condizioni|rinnov/i;
  const prezzoFrasi = ff.filter((f) => !RINNOVO.test(f)).join(" ");
  const reIdx = new RegExp(`\\b${idx}\\b|\\bTTF\\b|\\bPFOR\\b|indicizzat`, "i");
  const indicizzato = reIdx.test(prezzoFrasi) && /spread|\+\s*\d|maggiorat|indicizzat|variabil|\balfa\b|α/i.test(prezzoFrasi);
  const fissoParole = /prezzo fisso|bloccat\w*|invariabil\w*|fisso e invariabile|è fisso/i.test(prezzoFrasi);
  const poiIndice = !indicizzato && ff.some((f) => RINNOVO.test(f) && reIdx.test(f));
  const natura = indicizzato && fissoParole ? "misto (una parte fissa e una legata all'indice: leggi le frasi del prezzo)" : indicizzato ? "variabile" : fissoParole ? "fisso" : "non chiaro dal testo";
  const indiceTxt = indicizzato || poiIndice ? (/\bTTF\b/i.test(t) ? "TTF" : /PFOR/i.test(t) ? "PFOR (indice trimestrale)" : `${idx}${/index|gme/i.test(t) && idx === "PUN" ? " Index GME" : ""} del mese`) : null;
  const dm = /(?:bloccat\w*|fisso|invariabil\w*|valid\w*|durata(?: di)?|per)\s+(?:per\s+)?(\d{1,2})\s+mesi/i.exec(t);
  const durataMesi = dm ? Number(dm[1]) : null;

  // codice offerta e confronto con il Portale
  const cod = /\b(\d{6}[EGD]S[A-Z0-9_]{24})\b/i.exec(t)?.[1]?.toUpperCase() || null;
  const sulPortale = cod ? catalogo.find((o) => o.id === cod) : null;
  const portale = cod ? (sulPortale ? confrontaPortale(sulPortale, sezioni) : { trovata: false, testo: "Il codice offerta non è nel catalogo ARERA di oggi: offerta scaduta o non ancora pubblicata." }) : { trovata: false, testo: "La CTE non riporta il codice offerta ARERA (32 caratteri)." };

  const attivazione = attivazioneDaTesto(testoGrezzo);
  const conteggi = Object.fromEntries(Object.entries(sezioni).map(([k, v]) => [k, v.voci.length]));
  const riassunto = [
    `CTE ${forn === "GAS" ? "gas" : forn === "LUCE" ? "luce" : "di fornitura non riconosciuta"}`,
    `prezzo ${natura}${durataMesi ? ` per ${durataMesi} mesi` : ""}${indiceTxt ? (poiIndice ? `, poi variabile (${indiceTxt}) se non scegli altro` : ` (indice: ${indiceTxt})`) : ""}`,
    `${conImporti} frasi con importi: ${conImporti - daLeggere.length} classificate, ${daLeggere.length} da leggere`,
    avvisi.filter((a) => a.livello === "attenzione").length ? `${avvisi.filter((a) => a.livello === "attenzione").length} punti di attenzione` : "nessuna clausola a rischio trovata",
  ].join(" · ");
  return { forn, natura, poiIndice, indice: indiceTxt, durataMesi, codice: cod, portale, sezioni, daLeggere, avvisi, attivazione, riassunto,
    statistiche: { frasi: ff.length, conImporti, classificate: conImporti - daLeggere.length, daLeggere: daLeggere.length, conteggi } };
}

/** Confronta i prezzi della CTE con quelli dichiarati dal venditore al Portale Offerte. */
function confrontaPortale(o, sezioni) {
  const unitaP = { "01": "€/anno", "02": "€/kW", "03": "€/kWh", "04": "€/Smc", "05": "€" };
  const dichiarati = o.comp.flatMap((c) => c.p.map((p) => ({ nome: c.n, v: p.pr, u: unitaP[p.u] || "" })));
  const nellaCte = Object.values(sezioni).flatMap((s) => s.voci.flatMap((v) => v.importi));
  const conv = (i) => (i.u === "c€/kWh" ? { v: i.v / 100, u: "€/kWh" } : i.u.startsWith("€/") && /mese$/.test(i.u) ? { v: i.v * 12, u: "€/anno" } : { v: i.v, u: i.u.replace(/\/(?:POD|PDR|cliente)\//i, "/") });
  const cte = nellaCte.map(conv);
  const mancanti = dichiarati.filter((d) => d.v !== 0 && !cte.some((c) => (c.u === d.u || (d.u === "€/Smc" && c.u === "€/mc")) && Math.abs(c.v - d.v) <= Math.max(0.0005, Math.abs(d.v) * 0.005)));
  return {
    trovata: true, venditore: o.venditore, nome: o.nome,
    testo: mancanti.length ? `Sul Portale ARERA ci sono ${mancanti.length} valori che non ritrovo uguali nella CTE: controlla.` : "Tutti i prezzi dichiarati al Portale ARERA si ritrovano nella CTE.",
    dichiarati, mancanti,
  };
}
