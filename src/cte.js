// Lettura CTE: estrae i valori con la frase di origine. Nessun valore "indovinato":
// cio che non viene trovato resta vuoto e l'utente lo completa nella schermata di conferma.

const NUM = String.raw`(-?\d{1,4}(?:[.,]\d+)?)`;
const W = String.raw`[^€]{0,80}?`;
const FORNITORI = ["Enel Energia", "Edison Energia", "Edison", "Hera Comm", "A2A Energia", "Plenitude", "Eni Plenitude",
  "Iren", "Acea Energia", "Sorgenia", "Engie", "Estra", "Dolomiti Energia", "Octopus Energy", "Illumia", "Iberdrola",
  "E.ON", "Pulsee", "NeN", "Wekiwi", "Alperia", "AGSM AIM", "Duferco", "Tate", "Sinergy", "Optima", "Fastweb Energia",
  "Axpo", "Repower", "Green Network", "Enegan", "Bluenergy", "Argos", "Volty", "Convergenze", "Alia", "Gas Sales",
  "Edison Next", "Iliad", "Vivi Energia", "Servizio Elettrico Nazionale", "Lirica", "AGF Energy", "Tea Energia", "Uno Energy"];

export function normalizza(t) {
  return t.replace(/ /g, " ").replace(/€\s*\/\s*/g, "€/").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
}

export function num(s) {
  s = String(s).trim().replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "");
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

function cerca(testo, pattern) {
  const m = new RegExp(pattern, "i").exec(testo);
  if (!m) return null;
  const a = Math.max(0, m.index - 50), b = Math.min(testo.length, m.index + m[0].length + 25);
  return { valore: num(m.groups.v), frase: "…" + testo.slice(a, b).trim() + "…" };
}

export function tipoFornitura(t) {
  const kwh = (t.match(/€\/kWh/gi) || []).length, smc = (t.match(/€\/S?mc/gi) || []).length;
  if (!kwh && !smc) return null;
  if (kwh !== smc) return kwh > smc ? "LUCE" : "GAS";
  const g = (t.match(/gas naturale|\bPDR\b|\bSmc\b|\bPSV\b/gi) || []).length;
  const l = (t.match(/energia elettrica|\bPOD\b|\bkWh\b|\bPUN\b/gi) || []).length;
  return g > l ? "GAS" : "LUCE";
}

function fornitore(t) {
  for (const f of FORNITORI) if (new RegExp(`\\b${f.replace(/\./g, "\\.")}\\b`, "i").test(t)) return f;
  return "";
}

function nomeOfferta(t) {
  const m = /(?:nome (?:dell')?offerta|denominazione (?:dell')?offerta|offerta commerciale)\s*:?\s*([A-Z0-9][^\n.:;]{2,50}?)(?=\s{2,}|\s(?:codice|tipo|valid|cod\.|data|costo|prezzo|scheda|offerta a|per clienti|\d)|[.;:(]|$)/i.exec(t);
  return m ? m[1].trim() : "";
}

/** Analizza il testo di una CTE. Restituisce {tipo, indicizzata, campi:{nome:{valore,frase}}, info, avvisi}. */
export function analizza(testoGrezzo) {
  const t = normalizza(testoGrezzo);
  const tipo = tipoFornitura(t);
  const campi = {}, avvisi = [];
  const info = { fornitore: fornitore(t), nome: nomeOfferta(t) };
  if (!tipo) {
    avvisi.push("Non trovo prezzi in €/kWh né in €/Smc: il PDF potrebbe essere una scansione (immagine) o non essere una CTE.");
    return { tipo: null, indicizzata: false, campi, info, avvisi };
  }
  const u = tipo === "LUCE" ? "kWh" : "S?mc";
  const idx = tipo === "LUCE" ? "PUN" : "PSV";
  const indicizzata = new RegExp(`\\b${idx}\\b`).test(t) &&
    /spread|\+\s*\d|maggiorat|indicizzat|variabil|\balfa\b|α/i.test(t) &&
    !/prezzo fisso|bloccat|invariabil/i.test(t.slice(0, 1500));
  const prova = (nome, ...pats) => {
    for (const p of pats) {
      const r = cerca(t, p);
      if (r && r.valore !== null) { campi[nome] = r; return true; }
    }
    return false;
  };
  const V = String.raw`(?<v>${NUM.slice(1, -1)})`;

  // Scheda sintetica ARERA: "Costo per consumi", "Costo fisso anno"
  if (tipo === "LUCE") {
    const trovateFasce = ["F1", "F2", "F3"].map((f) => prova(f, String.raw`\b${f}\b[^€]{0,60}?${V}\s*€/kWh`));
    prova("F23", String.raw`(?:\bF23\b|F2\s*[+e/]\s*F3)${W}${V}\s*€/kWh`);
    if ("F23" in campi) { delete campi.F2; delete campi.F3; }
    if (!trovateFasce.some(Boolean) && !("F23" in campi)) {
      prova("F0",
        String.raw`costo per consumi${W}${V}\s*€/kWh`,
        String.raw`(?:\bF0\b|monorari\w*|fascia unica|prezzo (?:dell')?energia|prezzo luce|corrispettivo (?:per il )?consum\w*)${W}${V}\s*€/kWh`);
    }
    if ("F1" in campi && !("F2" in campi) && !("F23" in campi)) delete campi.F1;
  } else {
    prova("prezzo",
      String.raw`costo per consumi${W}${V}\s*€/S?mc`,
      String.raw`(?:prezzo|materia prima|componente|corrispettivo)[^€]{0,60}?gas${W}${V}\s*€/S?mc`,
      String.raw`(?:prezzo|corrispettivo)${W}${V}\s*€/S?mc`);
  }
  if (indicizzata) {
    prova("spread", String.raw`(?:spread|\balfa\b|α|${idx}\s*(?:index|gme)?\s*\+)[^€]{0,40}?${V}\s*€/${u}`);
  }
  prova("quotaAnno",
    String.raw`costo fisso anno${W}${V}\s*€`,
    String.raw`(?:quota fissa|costo fisso|corrispettivo (?:fisso|annuo)|commercializzazione|PCV|QVD)${W}${V}\s*€/(?:POD/|PDR/|punto[^/]{0,25}/|cliente/)?anno`);
  if (!("quotaAnno" in campi)) {
    prova("quotaMese", String.raw`(?:quota fissa|costo fisso|corrispettivo fisso|commercializzazione|PCV|QVD)${W}${V}\s*€/(?:POD/|PDR/|punto[^/]{0,25}/|cliente/)?mese`);
  }
  if (tipo === "LUCE") {
    prova("prezzoMax", String.raw`(?:prezzo massimo|tetto|non (?:potrà|potra) superare|al massimo pari a)[^€]{0,60}?${V}\s*€/kWh`);
  }

  // perdite di rete: suggerimento (da confermare)
  let perdite = indicizzata ? "indice" : "nessuna";
  if (/(?:prezzo|corrispettivo|prezzo luce)[^.]{0,40}(?:è|e'|sono)?\s*comprensiv\w* delle perdite/i.test(t)) perdite = "nessuna";
  if (/(?:prelevat\w*|consumat\w*|consumi)[^.]{0,30}(?:maggiorat\w*|comprensiv\w*|aumentat\w*)[^.]{0,15}perdite/i.test(t)) perdite = "tutto";
  if (/(?:al|il) PUN[^.]{0,30}(?:perdite|maggiorat)/i.test(t)) perdite = "indice";

  // indizi da far controllare
  const ctx = (re, msg) => {
    const m = re.exec(t);
    if (m) avvisi.push(`${msg} Frase: …${t.slice(Math.max(0, m.index - 50), m.index + m[0].length + 60).trim()}…`);
  };
  if (tipo === "LUCE") ctx(/perdite di rete/i, "Parla di perdite di rete: verifica se il prezzo è già comprensivo o va maggiorato del 10%.");
  ctx(/sconto|bonus/i, "Ci sono sconti o bonus: controlla se sono condizionati (domiciliazione, bolletta web…).");
  ctx(/(?:per|durata(?: di)?|bloccat\w* (?:per)?)\s*\d{1,2}\s*mesi/i, "Durata del prezzo:");
  if (!Object.keys(campi).length) avvisi.push("Nessun prezzo riconosciuto: inserisci i valori a mano.");
  return { tipo, indicizzata, campi, info, avvisi, perdite };
}

/** Converte il risultato dell'analisi in un'offerta (bozza da confermare). */
export function bozzaOfferta(an, nomeFile = "") {
  const c = (k) => an.campi[k]?.valore;
  const off = {
    fornitura: an.tipo || "LUCE", fornitore: an.info.fornitore, nome: an.info.nome || nomeFile.replace(/\.pdf$/i, ""),
    fonte: nomeFile ? `CTE ${nomeFile}` : "", tipoPrezzo: an.indicizzata ? "indicizzato" : "fisso",
    quotaFissaAnnua: c("quotaAnno") ?? (c("quotaMese") != null ? c("quotaMese") * 12 : null),
    note: [...an.avvisi],
  };
  if (off.fornitura === "LUCE") {
    let prezzi = {};
    if (c("F23") != null) prezzi = { F1: c("F1"), F23: c("F23") };
    else if (c("F2") != null) prezzi = { F1: c("F1"), F2: c("F2"), F3: c("F3") };
    else prezzi = { F0: c("F0") ?? c("spread") ?? null };
    Object.assign(off, { prezzi, perdite: an.perdite || (an.indicizzata ? "indice" : "nessuna"), prezzoMax: c("prezzoMax") ?? null, cdispd: "arera", altriKwh: 0 });
  } else {
    Object.assign(off, { prezzoSmc: c("prezzo") ?? c("spread") ?? null, altriSmc: 0 });
  }
  return off;
}

/** Estrazione testo da PDF con pdf.js (solo browser/app). */
export async function testoPdf(file, pdfjs) {
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    out += tc.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join("") + "\n";
  }
  return out;
}
