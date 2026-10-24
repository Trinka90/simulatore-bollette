// Chi è il venditore: nome leggibile, categoria e link alle recensioni.
// Categoria assegnata a mano sui principali marchi (nessun dato ufficiale per venditore è pubblico:
// ARERA pubblica i reclami per venditore solo in forma anonima).

// Primi 10 gruppi del mercato elettrico italiano per energia venduta nel 2024 (ARERA, Relazione annuale 2025):
// Enel 26,8% · A2A 8,9% · Hera 6,6% · Edison 6,0% · Axpo 5,4% · Eni 4,8% · Engie 3,9% · Alperia 2,3% · Duferco 2,2% · Acea 2,1%.
const GRANDI = {
  "enel.it": "Enel Energia", "a2a.it": "A2A Energia", "nen.it": "NeN (gruppo A2A)", "heracomm.gruppohera.it": "Hera Comm",
  "estenergy.gruppohera.it": "EstEnergy (gruppo Hera)", "edisonenergia.it": "Edison Energia", "pulsee.it": "Pulsee (gruppo Axpo)",
  "eniplenitude.com": "Plenitude (gruppo Eni)", "engie.it": "Engie", "alperia.eu": "Alperia", "dufercoenergia.com": "Duferco Energia",
  "aceaenergia.it": "Acea Energia",
};
// Marchi diffusi in tutta Italia ma non tra i primi 10 gruppi (classificazione dell'app, non un dato ufficiale).
const NAZIONALI = {
  "irenlucegas.it": "Iren", "seviren.it": "SEV (gruppo Iren)", "eon-energia.com": "E.ON", "sorgenia.it": "Sorgenia",
  "octopusenergy.it": "Octopus Energy", "illumia.it": "Illumia", "estra.it": "Estra", "dolomitienergia.it": "Dolomiti Energia",
  "agsmaim.it": "AGSM AIM", "iberdrola.it": "Iberdrola", "fastweb.it": "Fastweb Energia", "poste.it": "Poste Energia",
  "windtrelucegas.it": "WINDTRE Luce e Gas", "optimaitalia.com": "Optima Italia", "iliad.it": "Iliad", "wekiwi.it": "Wekiwi", "tate.it": "Tate",
};
const ALTRI = { "it.met.com": "MET Energia Italia", "vivienergia.it": "Vivi Energia", "segnoverde.it": "Segnoverde", "energit.it": "Energit",
  "enegan.it": "Enegan", "bluenergygroup.it": "Bluenergy" };
const REGIONALI = {
  "estraprometeo.it": "Estra Prometeo", "acinque.it": "Acinque", "gelsia.it": "Gelsia", "cvaenergie.it": "CVA Energie",
  "sinergas.it": "Sinergas (AIMAG)", "etraenergia.it": "Etra Energia", "gaseluce.butangas.it": "Butangas", "gasplusvendite.it": "Gas Plus",
  "gassalesenergia.it": "Gas Sales Energia", "aceapinerolese-energia.it": "Acea Pinerolese Energia", "enostra.it": "ènostra (cooperativa)",
  "amg.pa.it": "AMG Energia", "asmset.ro.it": "ASM Set", "evg.bz.it": "EVG", "sel-bz.it": "SEL", "lene.it": "Lenergia",
  "agespenergia.it": "Agesp Energia", "asmenergia.com": "ASM Energia", "unoenergy.it": "Uno Energy", "teaenergia.it": "Tea Energia",
  "aspmenergia.com": "ASPM Energia", "cogeserenergia.it": "Cogeser Energia", "simecom.it": "Simecom", "sgrservizi.it": "SGR Servizi",
  "centrovenetoenergie.it": "Centro Veneto Energie", "venetoenergia.eu": "Veneto Energia", "metamer.it": "Metamer",
  "argos.company": "Argos", "energiapopolarespa.it": "Energia Popolare", "gala.it": "Gala", "eviso.it": "Eviso", "volty.it": "Volty",
  "convergenze.it": "Convergenze", "sienergia.it": "Sì Energia", "unionenergia.it": "Union Energia",
};
const ALTRI_NOMI = { "newtec.marche.it": "Newtec", "youandme.srl": "You&Me", "actonenergia.forini.com": "Acton Energia (Forini)", "offerte.vuscom.it": "Vuscom" };

export function categoria(sito) {
  if (GRANDI[sito]) return "grande";
  if (NAZIONALI[sito]) return "nazionale";
  if (REGIONALI[sito]) return "regionale";
  return "piccolo";
}
export function nomeFornitore(sito, nomeGrezzo) {
  return GRANDI[sito] || NAZIONALI[sito] || REGIONALI[sito] || ALTRI[sito] || ALTRI_NOMI[sito] || nomeGrezzo;
}
export const ETICHETTE = {
  grande: { breve: "Grande gruppo", testo: "Tra i primi 10 gruppi del mercato elettrico italiano per energia venduta (ARERA, Relazione annuale 2025)." },
  nazionale: { breve: "Marchio nazionale", testo: "Marchio diffuso in tutta Italia, ma non tra i primi 10 gruppi per energia venduta. Classificazione dell'app, non un dato ufficiale." },
  regionale: { breve: "Multiutility locale", testo: "Fornitore regionale o multiutility, spesso legato ai comuni o a un gruppo del territorio. Classificazione dell'app, non un dato ufficiale." },
  piccolo: { breve: "Fornitore minore", testo: "Non è tra i grandi gruppi né tra i marchi nazionali più diffusi: prima di firmare guarda le recensioni e le condizioni." },
};
export const recensioni = (o) => ({
  trustpilot: `https://it.trustpilot.com/search?query=${encodeURIComponent(o.sito || o.venditore)}`,
  google: `https://www.google.com/search?q=${encodeURIComponent(`${o.venditore} luce gas recensioni`)}`,
});
