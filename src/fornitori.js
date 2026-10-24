// Chi è il venditore: nome leggibile, categoria e link alle recensioni.
// Categoria assegnata a mano sui principali marchi (nessun dato ufficiale per venditore è pubblico:
// ARERA pubblica i reclami per venditore solo in forma anonima).

const NAZIONALI = {
  "enel.it": "Enel Energia", "eniplenitude.com": "Plenitude (Eni)", "edisonenergia.it": "Edison Energia", "a2a.it": "A2A Energia",
  "heracomm.gruppohera.it": "Hera Comm", "estenergy.gruppohera.it": "EstEnergy (gruppo Hera)", "irenlucegas.it": "Iren",
  "seviren.it": "SEV (gruppo Iren)", "aceaenergia.it": "Acea Energia", "engie.it": "Engie", "eon-energia.com": "E.ON",
  "illumia.it": "Illumia", "pulsee.it": "Pulsee (Axpo)", "octopusenergy.it": "Octopus Energy", "nen.it": "NeN (gruppo A2A)",
  "fastweb.it": "Fastweb Energia", "poste.it": "Poste Energia", "optimaitalia.com": "Optima Italia", "enegan.it": "Enegan",
  "bluenergygroup.it": "Bluenergy", "dufercoenergia.com": "Duferco Energia", "it.met.com": "MET Energia Italia",
  "windtrelucegas.it": "WINDTRE Luce e Gas", "energit.it": "Energit", "vivienergia.it": "Vivi Energia", "segnoverde.it": "Segnoverde",
  "sorgenia.it": "Sorgenia", "iberdrola.it": "Iberdrola", "wekiwi.it": "Wekiwi", "tate.it": "Tate", "agsmaim.it": "AGSM AIM",
  "iliad.it": "Iliad", "alperia.eu": "Alperia", "dolomitienergia.it": "Dolomiti Energia", "estra.it": "Estra",
};
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
  if (NAZIONALI[sito]) return "nazionale";
  if (REGIONALI[sito]) return "regionale";
  return "piccolo";
}
export function nomeFornitore(sito, nomeGrezzo) {
  return NAZIONALI[sito] || REGIONALI[sito] || ALTRI_NOMI[sito] || nomeGrezzo;
}
export const ETICHETTE = {
  nazionale: { breve: "Grande fornitore", testo: "Grande fornitore nazionale, molto diffuso." },
  regionale: { breve: "Multiutility locale", testo: "Fornitore regionale o multiutility, spesso legato ai comuni o a un gruppo del territorio." },
  piccolo: { breve: "Piccolo fornitore", testo: "Fornitore piccolo o poco conosciuto: prima di firmare guarda le recensioni e le condizioni." },
};
export const recensioni = (o) => ({
  trustpilot: `https://it.trustpilot.com/search?query=${encodeURIComponent(o.sito || o.venditore)}`,
  google: `https://www.google.com/search?q=${encodeURIComponent(`${o.venditore} luce gas recensioni`)}`,
});
