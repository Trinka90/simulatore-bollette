// Analisi completa di una CTE (Condizioni Tecnico Economiche) letta da PDF.
// Obiettivo: nessuna sorpresa. Ogni importo del documento viene classificato in base alla sua etichetta
// (il testo che lo precede) e mostrato con la frase da cui viene; quello che non so classificare finisce
// in «da leggere». In più: che tipo di offerta è (scheda), clausole a rischio e cose dichiarate assenti.
import { num, tipoFornitura } from "./cte.js";
import { attivazioneDaTesto } from "./attivazione.js";

const NUM = String.raw`-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?`;
const DOPO_UNITA = String.raw`(?:c(?:ent(?:esimi)?)?\s*€\/kWh|€\/kWh|€\/S?mc|€\/kW(?:\/(?:anno|mese))?|€\/(?:POD\/|PDR\/|PdP\/|punto[^/]{0,20}\/|cliente\/)?(?:anno|mese|giorno)|€(?:\s*\+\s*iva)?(?:\s+(?:al|ogni|per)\s+(?:mese|anno))?|euro|%)`;
const IMPORTO = new RegExp(String.raw`(?:€\s*(${NUM})(\/(?:POD|PDR|PdP)\/(?:mese|anno))?)|(?:(${NUM})\s*(?:\([a-zà-ù ]+\)\s*)?(${DOPO_UNITA}))`, "gi");

/** Ripulisce il testo estratto dal PDF: accenti staccati ("sar à"), "€ /kWh", spazi. */
export function pulisci(t) {
  return String(t || "")
    .replace(/ /g, " ")
    .replace(/([A-Za-z])\s+([àèéìòùÀÈÉÌÒÙ])(?=[\s.,;:)!?'’]|$)/g, "$1$2")
    .replace(/€\s*\/\s*/g, "€/")
    .replace(/\s*\/\s*(?=(?:POD|PoD|PDR|PdR|PdP|anno|mese|kWh|Smc|kW|giorno)\b)/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

/** Frasi del documento (il testo è già su una riga sola). */
export function frasi(testo) {
  const t = /\n/.test(testo) && !/\s{2,}/.test(testo) && testo.split("\n").every((r) => r.length < 120) ? unisciRighe(testo) : pulisci(testo);
  const out = [];
  const ABBR = /(?:\b(?:Del|Delib|art|artt|n|ss|pag|es|ecc|lett|co|cfr|tel|all|cap|Rev|Ed|Sig|vs|nr|max|min|ca|rif|D\.Lgs|D\.L|D\.M|L|s\.m\.i|S\.p\.A|p\.es|e\.g|i\.e)\.)$/i;
  for (let f of t.split(/(?<=[.;!?])\s+(?=[A-ZÀ-Ü“"«(•])/)) {
    f = f.trim();
    if (out.length && ABBR.test(out.at(-1))) { out[out.length - 1] += " " + f; continue; }
    if (f.length >= 3) out.push(f);
  }
  return out;
}
// righe di tabella "etichetta" / "valore" su righe diverse: riattacca il valore all'etichetta
function unisciRighe(testo) {
  const righe = testo.split("\n").map((r) => pulisci(r)).filter(Boolean);
  const out = [];
  for (const r of righe) {
    const parole = r.replace(new RegExp(IMPORTO.source, "gi"), " ").replace(/[^A-Za-zÀ-ÿ]+/g, " ").trim();
    if (out.length && (parole.length < 4 || /:\s*$/.test(out.at(-1)))) out[out.length - 1] += " " + r;
    else out.push(r.endsWith(".") ? r : r + ".");
  }
  return out.join(" ");
}

const unita = (u) => {
  u = (u || "€").replace(/\s+/g, "");
  if (/^c/i.test(u)) return "c€/kWh";
  if (/\+iva/i.test(u)) return /mese/i.test(u) ? "€/mese+IVA" : "€+IVA";
  if (/^euro$/i.test(u)) return "€";
  if (/^€(al|ogni|per)mese$/i.test(u)) return "€/mese";
  return u.replace(/\/(?:POD|PDR|PdP|punto[^/]*|cliente)\//i, "/").replace(/€\/S?mc/i, "€/Smc");
};

// boilerplate obbligatorio ARERA sul rischio prezzo fisso/variabile: non descrive l'offerta
const BOILERPLATE = /propensione al rischio|optando per un prezzo|scelta di un['’]offerta (?:a prezzo fisso|di questo tipo)|rispetto ai corrispettivi variabili|rispetto a un['’]offerta a prezzo/i;
const IGNORA = /capitale sociale|mix energetico|fonti (?:primarie|rinnovabili)|carbone|nucleare|lignite|prodotti petroliferi|altre fonti|registro delle imprese|\bn\.\s*\d|PCS|potere calorifico|GJ\/Smc|temperatura|bar\b/i;
const STIME = /spesa annua stimata|cliente tipo|spesa (?:annua )?per la materia|stima (?:della )?spesa|minore spesa|maggiore spesa|servizio di (?:maggior )?tutela \(€\)|variazione percentuale della spesa|consumo annuo \((?:kWh|Smc)\)|cliente con potenza impegnata/i;

// regole sull'etichetta che precede l'importo (prima vince)
const REGOLE = [
  ["indennizzi", /indennizz|corrisponder[aà] al cliente|a favore del cliente/i],
  ["sconti", /scont|bonus|premio|cashback|accredit|omaggi/i],
  ["penali", /recesso|addebitare,? un onere|onere pari a|onere (?:per|di) recesso|penal|cessi il rapporto|cessazione anticipata/i],
  ["deposito", /deposit|cauzion|fideiuss/i],
  ["mora", /\bmora\b|interess|sollecit|ritardat|morosit|sospension|riduzione di potenza|riattivaz|disattivazione per/i],
  ["pratiche", /voltura|subentro|allacci|cessazione della presa|variazione di potenza|gestione (?:della )?pratica|contributo|una tantum|prestazion|oneri di gestione/i],
  ["pagamento", /bollettin|bonific|carta di credito|commission/i],
  ["bolletta", /cartace|invio (?:della )?bollett|spedizion/i],
  ["servizi", /servizi|applicazione|\bapp\b|manutenzion|caldaia|assicuraz|polizz|energia verde|garanzi\w* d['’ ]?origine|abbonament/i],
  ["dispacciamento", /dispacciament|\bdisp ?bt\b|\bcdispd\b/i],
  ["indici", /valore massimo raggiunto|media (?:mensile|aritmetica)|coefficiente|maggiorato di [\d,]+ €\/kWh/i],
  ["regolate", /trasporto|oneri (?:generali )?di sistema|accis|aliquot|\bIVA\b|imposte/i],
];
export const SEZIONI = {
  energia: "Prezzo dell'energia / del gas", quota: "Quota fissa (commercializzazione)", dispacciamento: "Dispacciamento",
  sconti: "Sconti e bonus", servizi: "Servizi e prodotti aggiuntivi", penali: "Costi se lasci prima", deposito: "Deposito e garanzie",
  mora: "Ritardi e morosità", pratiche: "Pratiche e prestazioni (voltura, subentro…)", pagamento: "Costi di pagamento", bolletta: "Bolletta",
  indennizzi: "Indennizzi a tuo favore", indici: "Indici e riferimenti", regolate: "Voci ARERA (uguali per tutti)", stime: "Stime di spesa del venditore",
};

const CODA = /^(?:\s*(?:una tantum|opzionale|opzionali|per \d+ mesi|\+ ?iva|al mese|cadauna|ad operazione|e(?=\s)|,|;|\)|\*))+/i;
const classeU = (u) => (/kWh|Smc/.test(u) ? "consumo" : /anno|mese/.test(u) ? "periodo" : u === "%" ? "%" : "€");
function classifica(prima, dopo, u, precedente) {
  const etichetta = prima.replace(CODA, "").slice(-170);
  for (const [k, re] of REGOLE) if (re.test(etichetta)) return k;
  // elenco nella stessa frase ("300 € nel primo anno, 200 € nel secondo…"): eredita la voce precedente
  if (precedente && precedente.classe === classeU(u) && etichetta.replace(/[^A-Za-zÀ-ÿ]/g, "").length < 45 && !/F[0-3]|monorari|triorari|fascia/i.test(etichetta)) return precedente.sez;
  if (/€\/kWh|€\/Smc|c€/.test(u)) return "energia";
  if (/€\/(?:anno|mese)/.test(u)) return "quota";
  for (const [k, re] of REGOLE) if (re.test(dopo)) return k;
  return null;
}

/**
 * Analisi completa. catalogo: offerte del Portale (codice offerta → confronto e nome del venditore).
 */
export function analisiCompleta(testoGrezzo, catalogo = []) {
  const ff = frasi(testoGrezzo);
  const t = ff.join(" ");
  const forn = tipoFornitura(t) || (/\bPDR\b|gas naturale|Smc/i.test(t) ? "GAS" : /\bPOD\b|energia elettrica|kWh/i.test(t) ? "LUCE" : null);
  const voci = [], daLeggere = [];
  let ignorati = 0, stime = 0;
  for (const f of ff) {
    if (BOILERPLATE.test(f)) continue;
    const re = new RegExp(IMPORTO.source, "gi");
    let m, fine = 0, prec = null;
    while ((m = re.exec(f))) {
      const v = num(m[1] ?? m[3]);
      const u = m[1] != null ? (m[2] ? unita("€" + m[2]) : "€") : unita(m[4]);
      if (v == null) continue;
      const prima = f.slice(fine, m.index), dopo = f.slice(m.index + m[0].length, m.index + m[0].length + 60);
      fine = m.index + m[0].length;
      const intorno = f.slice(Math.max(0, m.index - 300), m.index + 80);
      if (IGNORA.test(intorno) && (u === "%" || !/€/.test(prima.slice(-60)))) { ignorati++; continue; }
      if (STIME.test(f.slice(Math.max(0, m.index - 600), m.index))) { stime++; continue; }
      if (u === "%" && /\d{4}/.test(prima.slice(-8))) { ignorati++; continue; }
      // percentuali che non sono costi (perdite 10%, potenza ridotta al 15%, ripartizione F1/F2/F3)
      if (u === "%" && !/scont|interess|mora|maggior|iva|aliquot|bonus|riduzion\w* del prezzo/i.test(prima.slice(-120))) { ignorati++; continue; }
      const sez = classifica(prima, dopo, u, prec);
      prec = sez ? { sez, classe: classeU(u) } : null;
      const voce = { v, u, sezione: sez, opzionale: sez === "servizi" && /opzional|su richiesta|\battivabile|facoltativ|non inclus/i.test(f.slice(Math.max(0, m.index - 300), m.index + 150)), etichetta: prima.replace(CODA, "").slice(-110).trim(), frase: f.length > 360 ? "…" + f.slice(Math.max(0, m.index - 200), m.index + 140).trim() + "…" : f };
      if (sez) voci.push(voce); else daLeggere.push(voce);
    }
  }
  const unici = (lista) => { const out = []; for (const x of lista) { const g = out.find((y) => y.v === x.v && y.u === x.u && y.sezione === x.sezione); if (g) g.volte = (g.volte || 1) + 1; else out.push({ ...x }); } return out; };
  const sezioni = Object.fromEntries(Object.entries(SEZIONI).map(([k, titolo]) => [k, { titolo, voci: unici(voci.filter((x) => x.sezione === k)) }]));
  if (stime) sezioni.stime.voci.push({ v: stime, u: "valori", etichetta: "Tabelle di spesa stimata", frase: `${stime} importi nelle tabelle di stima di spesa del venditore (scheda sintetica/confrontabilità): servono solo a confrontare, non sono costi.` });

  const scheda = schedaOfferta(t, ff, voci, catalogo, forn);
  const avvisi = clausole(t, ff, scheda);
  const assenze = [];
  const as = (re, testo) => { if (re.test(t)) assenze.push(testo); };
  as(/non sono previst[ie] sconti|descrizione dello sconto[^.]{0,30}non sono previsti/i, "Nessuno sconto o bonus");
  as(/non sono previst[ie] prodotti e\/o servizi aggiuntivi/i, "Nessun servizio aggiuntivo");
  as(/onere di recesso anticipato nessuno|recesso è esercitabile senza oneri|recedere in qualunque momento e senza oneri/i, "Nessun costo per cambiare fornitore");
  as(/garanzie richieste al cliente nessuna/i, "Nessun deposito o garanzia richiesti");
  as(/(?:cartace\w*[^.]{0,80}(?:non prevede alcun onere|senza oneri|gratuit))|(?:modificare senza oneri[^.]{0,80}ricezione della bolletta)/i, "Bolletta cartacea senza costi");

  const portale = scheda.codice ? confrontaPortale(scheda.codice, catalogo, voci) : { trovata: false, testo: "La CTE non riporta il codice offerta ARERA (32 caratteri)." };
  const attivazione = attivazioneDaTesto(t);
  const att = avvisi.filter((a) => a.livello === "attenzione").length;
  const riassunto = [
    `${forn === "GAS" ? "Gas" : forn === "LUCE" ? "Luce" : "Fornitura non riconosciuta"}${scheda.venditore ? ` · ${scheda.venditore}` : ""}`,
    `prezzo ${scheda.natura}${scheda.durataMesi ? ` per ${scheda.durataMesi} mesi` : ""}${scheda.dopo ? `, poi ${scheda.dopo}` : ""}`,
    `${voci.length + daLeggere.length} importi letti: ${voci.length} classificati${daLeggere.length ? `, ${daLeggere.length} da leggere` : ""}`,
    att ? `${att} punti di attenzione` : "nessuna clausola a rischio trovata",
  ].join(" · ");
  return { forn, ...scheda, natura: scheda.natura, portale, sezioni, daLeggere, avvisi, assenze, attivazione, riassunto,
    statistiche: { frasi: ff.length, importi: voci.length + daLeggere.length, classificati: voci.length, daLeggere: daLeggere.length, ignorati, stime } };
}

const VENDITORI = [["PostePay", "Poste Energia (PostePay)"], ["Poste Energia", "Poste Energia (PostePay)"], ["MET Energia Italia", "MET Energia Italia"], ["Illumia", "Illumia"],
  ["Enel Energia", "Enel Energia"], ["Hera Comm", "Hera Comm"], ["Edison Energia", "Edison Energia"], ["A2A Energia", "A2A Energia"], ["Eni Plenitude", "Plenitude"], ["Plenitude", "Plenitude"],
  ["Iren Mercato", "Iren"], ["Acea Energia", "Acea Energia"], ["Sorgenia", "Sorgenia"], ["Engie", "Engie"], ["Estra", "Estra"], ["Dolomiti Energia", "Dolomiti Energia"], ["Octopus", "Octopus Energy"],
  ["Iberdrola", "Iberdrola"], ["E.ON", "E.ON"], ["Pulsee", "Pulsee"], ["Wekiwi", "Wekiwi"], ["Alperia", "Alperia"], ["AGSM AIM", "AGSM AIM"], ["Duferco", "Duferco Energia"], ["Enegan", "Enegan"],
  ["Optima", "Optima"], ["Axpo", "Axpo"], ["Argos", "Argos"], ["Sinergy", "Sinergy"], ["Vivi Energia", "Vivi Energia"], ["Tate", "Tate"], ["NeN", "NeN"], ["Agsm", "AGSM AIM"]];

function schedaOfferta(t, ff, voci, catalogo, forn) {
  const codice = /\b(\d{6}[EGD]S[A-Z0-9_]{24})\b/i.exec(t)?.[1]?.toUpperCase() || null;
  const sulPortale = codice ? catalogo.find((o) => o.id === codice) : null;
  const stessoVenditore = codice ? catalogo.find((o) => o.id.slice(0, 6) === codice.slice(0, 6)) : null;
  let venditore = sulPortale?.venditore || null;
  if (!venditore) for (const [k, n] of VENDITORI) if (new RegExp(`\\b${k.replace(/\./g, "\\.")}\\b`, "i").test(t)) { venditore = n; break; }
  if (!venditore && stessoVenditore) venditore = stessoVenditore.venditore;
  if (!venditore) venditore = /\b([A-Z][A-Za-z0-9&'’. -]{2,40}?)\s+S\.?p\.?A\.?/.exec(t)?.[1]?.trim() || null;
  const nome = sulPortale?.nome || /\d{2}\/\d{2}\/\d{4}\s+((?:[A-Z0-9][A-Z0-9’'+&.-]*\s+){0,6}[A-Z0-9][A-Z0-9’'+&.-]*)\s+L['’]offerta/.exec(t)?.[1] || /(?:fornitura|OFFERTA|Offerta)\s+((?:[A-Z0-9][A-Z0-9’'+&.-]*\s+){1,7}?[A-Z0-9][A-Z0-9’'+&.-]*)(?=\s+(?:Offerta|Codice|CODICE|L['’]offerta|VENDITA|Clienti|Le presenti|valida|VALIDA)\b)/.exec(t)?.[1]
    || /Poste Energia (?:Luce|Gas)/.exec(t)?.[0] || null;
  const dal = /(?:valid\w*|sottoscritt\w*)[^.]{0,40}?\bdal\s+(\d{2}\/\d{2}\/\d{4})/i.exec(t)?.[1] || null;
  const al = /(?:valid\w*|sottoscritt\w*)[^.]{0,60}?(?:fino (?:al|a)|entro il)\s+(\d{2}\/\d{2}\/\d{4})/i.exec(t)?.[1] || null;
  const destinatari = [];
  const rr = /riservat\w* (?:esclusivamente )?(?:ai|a) ((?:nuovi )?clienti[^.]{0,90})/i.exec(t);
  if (rr) destinatari.push(rr[1].replace(/\s+/g, " ").trim());
  // natura del prezzo (escludendo il testo standard ARERA sul rischio)
  const utili = ff.filter((f) => !BOILERPLATE.test(f));
  const DOPO = /(?:dal|a partire dal) \d+ ?(?:esimo|°)? mese|evoluzione automatica|al termine del periodo di validit|dopo i primi \d+ mesi|alla scadenza/i;
  const idxRe = forn === "GAS" ? /\bPSV\b|\bTTF\b|\bPFOR\b/ : /\bPUN\b/;
  const principali = utili.filter((f) => !DOPO.test(f));
  const fisso = principali.some((f) => /fiss[oa] (?:e|ed) invariabil|prezzo fisso|bloccat/i.test(f));
  const indic = principali.some((f) => idxRe.test(f) && /\+|spread|fee|maggiorat|α|alfa/i.test(f) && !/qualora|finch[eé] i POD/i.test(f));
  const natura = fisso && !indic ? "fisso" : indic && !fisso ? "variabile (legato all'indice)" : fisso && indic ? "fisso (con parti legate all'indice: leggi le frasi del prezzo)" : "non chiaro dal testo";
  const dur = /(?:fiss[oa] (?:e|ed) invariabil\w*|bloccat\w*|validit\w*|durata(?: di)?|primi)\s+(?:per\s+)?(?:(?:una durata|un periodo) di\s+)?(\d{1,2})\s+mesi/i.exec(utili.join(" "));
  const durataMesi = dur ? Number(dur[1]) : null;
  const fDopo = utili.find((f) => DOPO.test(f) && idxRe.test(f));
  const spreadDopo = fDopo ? /(?:\+|spread|fee)[^€]{0,60}?(\d+[.,]\d+)\s*€\/(kWh|Smc)/i.exec(fDopo) : null;
  const indiceNome = forn === "GAS" ? (/PSV\s*(?:DA|Day Ahead)/i.test(t) ? "PSV Day Ahead" : "PSV") : /PUN Index/i.test(t) ? "PUN Index GME" : "PUN";
  const dopo = fDopo ? `variabile (${indiceNome}${spreadDopo ? ` + ${spreadDopo[1].replace(".", ",")} €/${spreadDopo[2]}` : " + spread"})` : null;
  const perdite = /(?:comprensiv\w*|al lordo) (?:delle )?perdite/i.test(t) ? "incluse nel prezzo" : /(?:maggiorat\w*|aumentat\w*) (?:delle |del \d+% di )?perdite|\(1\s*\+\s*λ\)/i.test(t) ? "aggiunte ai consumi (+10% in bassa tensione)" : null;
  const disp = forn === "LUCE" ? (/dispacciamento[^.]{0,200}(?:ARERA|Autorit|TIV)|CDISPD[^.]{0,120}(?:ARERA|Autorit|TIV)/i.test(t) ? "valori ARERA (Cdispd)" : voci.some((v) => v.sezione === "dispacciamento") ? "corrispettivo del venditore" : null) : null;
  const soloSdd = /esclusivamente (?:il )?pagamento tramite (?:addebito|SEPA|SDD)|prevede esclusivamente il pagamento/i.test(t);
  const durataContratto = /durata del contratto\s+(indeterminata|\d+ mesi)/i.exec(t)?.[1] || (/tempo indeterminato/i.test(t) ? "indeterminata" : null);
  return { codice, venditore, nome, validita: { dal, al }, destinatari, natura, durataMesi, dopo, perdite, dispacciamento: disp, soloSdd, durataContratto };
}

function clausole(t, ff, scheda) {
  const avvisi = [];
  const add = (livello, titolo, re) => { const m = re.exec(t); if (m) avvisi.push({ livello, titolo, frase: "…" + m[0].trim() + "…" }); };
  add("attenzione", "Onere se lasci prima della scadenza", /(?:onere (?:di|per) recesso anticipato|recesso anticipato)[^.]{0,40}(?:addebit|applic|dovut|corrispettivo)[^.]{0,200}|\d+ ?€ nel primo anno[^.]{0,160}/i);
  add("attenzione", "Le nuove condizioni valgono se non disdici", /tacitamente (?:accettat|prorogat)\w*[^.]{0,160}/i);
  add("attenzione", "Il venditore può cambiare le condizioni", /(?:modificare unilateralmente|variazione unilaterale|facolt\w* di (?:modificare|variare)|si riserva (?:il diritto|la facolt)\w*)[^.]{0,180}/i);
  add("attenzione", "Possibili nuovi costi per le quote di emissione (ETS2)", /quote di emission[^.]{0,260}(?:diritto di modificare|includendo gli ulteriori costi|addebit)[^.]{0,120}|(?:diritto di modificare|includendo gli ulteriori costi)[^.]{0,200}quote di emission[^.]{0,80}/i);
  add("info", "Sconto già compreso nel prezzo indicato", /[^.]{0,120}rispetto alla medesima offerta senza sconto[^.]{0,60}/i);
  add("info", "Alla scadenza del prezzo fisso", /(?:con un preavviso|preavviso non inferiore)[^.]{0,40}(?:3|tre) mesi[^.]{0,200}/i);
  add("attenzione", "Lo sconto si perde se lasci prima", /(?:sconto|bonus)[^.]{0,80}(?:non verrà applicato|decad|perde|revoc|applicato parzialmente)[^.]{0,80}|(?:recesso|risoluzione anticipata)[^.]{0,80}lo sconto non verrà applicato[^.]{0,60}/i);
  add("attenzione", "Servizio a pagamento incluso nell'offerta", /(?:l['’]offerta include|include la messa a disposizione)[^.]{0,200}\.[^.]{0,80}(?:costo|€)[^.]{0,60}/i);
  add("attenzione", "Costi in caso di ritardo nei pagamenti", /(?:spese postali|costo di gestione amministrativa|interessi di mora)[^.]{0,200}/i);
  add("attenzione", "Deposito se non paghi con addebito su conto", /deposito cauzionale[^.]{0,200}/i);
  add("attenzione", "Offerta revocabile o a disponibilità limitata", /disponibilit\w* limitata[^.]{0,120}/i);
  add("info", "Riservata a", /riservat\w* (?:esclusivamente )?ai nuovi clienti[^.]{0,100}/i);
  add("info", "Pagamento con rata fissa (facoltativo)", /Rata Fissa[^.]{0,160}/i);
  add("info", "Il prezzo cambia dopo il periodo fisso", /(?:evoluzione automatica|al termine del periodo di validit\w*|a partire dal \d+ ?esimo mese)[^.]{0,220}/i);
  add("info", "Perdite di rete", /(?:comprensiv\w*|al lordo) (?:delle )?perdite[^.]{0,140}|perdite di rete (?:stabilit|quantificat|definit)[^.]{0,120}/i);
  add("info", "Prezzo del PCS / coefficiente C (gas)", /potere calorifico superiore[^.]{0,160}/i);
  add("info", "Esecuzione anticipata del contratto", /esecuzione anticipata[^.]{0,200}/i);
  if (scheda.soloSdd) avvisi.push({ livello: "info", titolo: "Pagamento solo con addebito su conto", frase: "…" + (/[^.]{0,60}esclusivamente[^.]{0,120}(?:SDD|SEPA|addebito)[^.]{0,60}/i.exec(t)?.[0] || "") + "…" });
  return avvisi;
}

/** Confronta i prezzi della CTE con quelli dichiarati dal venditore al Portale Offerte. */
function confrontaPortale(codice, catalogo, voci) {
  const o = catalogo.find((x) => x.id === codice);
  if (!o) return { trovata: false, testo: "Il codice offerta non è nell'elenco ARERA salvato sul telefono (offerta nuova o scaduta): aggiorna le offerte di oggi e riprova." };
  const unitaP = { "01": "€/anno", "02": "€/kW", "03": "€/kWh", "04": "€/Smc", "05": "€" };
  const dichiarati = o.comp.flatMap((c) => c.p.map((p) => ({ nome: c.n, v: p.pr, u: unitaP[p.u] || "" })));
  const cte = voci.map((i) => (i.u === "c€/kWh" ? { v: i.v / 100, u: "€/kWh" } : i.u === "€/mese" ? { v: i.v * 12, u: "€/anno" } : i));
  const mancanti = dichiarati.filter((d) => d.v !== 0 && !cte.some((c) => c.u === d.u && Math.abs(c.v - d.v) <= Math.max(0.0005, Math.abs(d.v) * 0.005)));
  return { trovata: true, venditore: o.venditore, nome: o.nome, dichiarati, mancanti,
    testo: mancanti.length ? `Sul Portale ARERA ${mancanti.length === 1 ? "c'è un valore" : `ci sono ${mancanti.length} valori`} che non ritrovo uguale nella CTE: la classifica usa quelli del Portale, controlla quale è giusto.` : "Tutti i prezzi dichiarati al Portale ARERA si ritrovano nella CTE." };
}

const DOPO_ETICHETTA = /dal \d+ ?(?:esimo|°)? mese|esimo mese|\bPUN\b|\bPSV\b|fee|spread|maggiorato|al netto delle perdite|massimo/i;
const OPZIONALE = /opzional|su richiesta|\battivabile|facoltativ|non inclus/i;
/** Servizi a pagamento che fanno parte dell'offerta (non opzionali): costo annuo. */
export function serviziObbligatori(a) {
  const sv = a.sezioni.servizi?.voci || [];
  const opz = (v) => v.opzionale || OPZIONALE.test(v.frase) || sv.some((x) => x.v === v.v && (x.opzionale || OPZIONALE.test(x.frase)));
  return sv.filter((v) => !opz(v) && /mese|anno/.test(v.u))
    .map((v) => ({ v, annuo: /mese/.test(v.u) ? v.v * 12 : v.v }));
}
/**
 * Completa la bozza dell'offerta con quanto letto nell'analisi completa: prezzi per fascia, quota fissa,
 * servizi obbligatori (aggiunti alla quota fissa), perdite di rete, sconto pluriennale.
 */
export function completaDaAnalisi(off, a) {
  const note = off.note || (off.note = []);
  const en = (a.sezioni.energia?.voci || []).filter((v) => !DOPO_ETICHETTA.test(v.etichetta));
  if (off.fornitura === "LUCE") {
    const fasce = {};
    for (const v of en) { if (v.u !== "€/kWh") continue; const f = /\b(F[0-3])\s*:?\s*$/i.exec(v.etichetta)?.[1]?.toUpperCase() || (/monorari/i.test(v.etichetta) ? "F0" : null); if (f && !(f in fasce)) fasce[f] = v.v; }
    if (!Object.keys(fasce).length && en.find((v) => v.u === "€/kWh")) fasce.F0 = en.find((v) => v.u === "€/kWh").v;
    if ("F0" in fasce) off.prezzi = { F0: fasce.F0 };
    else if (fasce.F1 != null && fasce.F2 != null && fasce.F3 != null) off.prezzi = { F1: fasce.F1, F2: fasce.F2, F3: fasce.F3 };
    if (a.perdite === "incluse nel prezzo") off.perdite = "nessuna";
    else if (/aggiunte/.test(a.perdite || "")) off.perdite = "tutto";
  } else {
    const g = en.find((v) => v.u === "€/Smc");
    if (g) off.prezzoSmc = g.v;
  }
  if (a.natura?.startsWith("fisso")) off.tipoPrezzo = "fisso";
  const q = a.sezioni.quota?.voci || [];
  const qa = q.find((v) => v.u === "€/anno")?.v ?? (q.find((v) => v.u === "€/mese") ? q.find((v) => v.u === "€/mese").v * 12 : null);
  if (qa != null) off.quotaFissaAnnua = qa;
  const obb = serviziObbligatori(a);
  if (obb.length && off.quotaFissaAnnua != null) {
    const extra = obb.reduce((s, x) => s + x.annuo, 0);
    off.quotaFissaAnnua += extra;
    note.push(`Quota fissa comprende ${String(Math.round(extra * 100) / 100).replace(".", ",")} €/anno di servizi a pagamento inclusi nell'offerta: ${obb.map((x) => `«${x.v.frase.slice(0, 120)}…»`).join("; ")}`);
  }
  // sconto "valore complessivo di X € ... primi N anni"
  for (const v of a.sezioni.sconti?.voci || []) {
    const m = /valore complessivo/i.test(v.etichetta) && /prim[ie] (due|tre|\d+) anni/i.exec(v.frase);
    if (m && off.quotaFissaAnnua != null) {
      const anni = { due: 2, tre: 3 }[m[1]] || Number(m[1]) || 1;
      off.quotaFissaAnnua -= v.v / anni;
      note.push(`Sconto di ${v.v} € in ${anni} anni: ${String(Math.round((v.v / anni) * 100) / 100).replace(".", ",")} € tolti ogni anno dalla quota fissa (si perde se lasci prima).`);
      break;
    }
  }
  if (a.venditore && !off.fornitore) off.fornitore = a.venditore;
  if (a.nome && (!off.nome || (off.fonte || "").includes(off.nome) || /\.pdf$|^cte|condizioni/i.test(off.nome))) off.nome = a.nome;
  return off;
}
