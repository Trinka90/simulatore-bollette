// Export PDF (jsPDF + autotable). Su Android salva nella cache e apre la condivisione.
import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";
applyPlugin(jsPDF);
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { MESI, totale } from "./simulazione.js";

const PRI = [15, 76, 92], SIM = [163, 90, 0], OK = [29, 122, 70], MUT = [93, 104, 117];
const eur = (v, d = 2) => (v ?? 0).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d }) + " €";
const nf = (v, d = 6) => (v == null ? "—" : Number(v).toLocaleString("it-IT", { maximumFractionDigits: d }));
const oggi = () => new Date().toLocaleDateString("it-IT");
const GRUPPI = [["vendita", "Spesa per la vendita"], ["rete", "Spesa per la rete"], ["oneri", "Oneri generali di sistema"],
  ["imposte", "Accise e addizionali"], ["iva", "IVA"], ["altro", "Altre partite (fuori campo IVA)"]];
const descrPrezzo = (o) => o.fornitura === "GAS"
  ? `${o.tipoPrezzo === "indicizzato" ? "PSV + " : ""}${nf(o.prezzoSmc)} €/Smc`
  : `${o.tipoPrezzo === "indicizzato" ? "PUN + " : ""}${Object.entries(o.prezzi).map(([k, v]) => `${k} ${nf(v)}`).join(", ")} €/kWh`;

function nuovo(titolo, sotto) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(...PRI);
  doc.text(titolo, 14, 18);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...MUT);
  doc.text(doc.splitTextToSize(sotto, 182), 14, 24);
  return doc;
}

function avvisoSimulazione(doc, y) {
  doc.setFillColor(253, 240, 220); doc.setDrawColor(240, 201, 138);
  const testo = doc.splitTextToSize("SIMULAZIONE - non sono fatture reali. I valori marcati SIMULATO (indici PUN/PSV futuri, " +
    "dispacciamento, tariffe ARERA non ancora pubblicate) sono stime: per ognuno è indicata la cifra applicata e l'origine.", 176);
  const hgt = testo.length * 4 + 6;
  doc.roundedRect(14, y, 182, hgt, 2, 2, "FD");
  doc.setTextColor(60, 40, 0); doc.setFontSize(8.5); doc.text(testo, 17, y + 5);
  return y + hgt + 4;
}

function pie(doc) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(...MUT);
    doc.text(`Simulatore Bollette · generato il ${oggi()} · pagina ${i}/${n}`, 14, 290);
  }
}

const stileTab = { styles: { fontSize: 8, cellPadding: 1.4, textColor: [22, 32, 42] }, headStyles: { fillColor: PRI, textColor: 255, fontSize: 7.5 },
  margin: { left: 14, right: 14 }, theme: "grid" };
const coloraTipo = (data) => {
  if (data.section !== "body") return;
  const t = String(data.cell.raw);
  if (t === "SIMULATO") { data.cell.styles.textColor = SIM; data.cell.styles.fontStyle = "bold"; }
  if (t === "REALE") { data.cell.styles.textColor = OK; data.cell.styles.fontStyle = "bold"; }
};

function metodo(doc, dati, y) {
  const met = dati.indici.metodo_simulazione;
  doc.autoTable({ ...stileTab, startY: y, head: [["Valore futuro", "Come è stato simulato"]],
    body: [["PUN", met.pun], ["PSV", met.psv], ["Dispacciamento CDISPD", met.cdispd],
      ["Scenari (offerte variabili)", `basso = simulati x ${met.scenari.basso}; alto = simulati x ${met.scenari.alto}. I mesi reali non cambiano.`],
      ["Tariffe ARERA", "Oltre la validità nota: ultimi valori pubblicati mantenuti invariati."],
      ["Dati aggiornati al", dati.aggiornato_al]],
    columnStyles: { 0: { cellWidth: 45, fontStyle: "bold" } } });
  return doc.lastAutoTable.finalY + 6;
}

function consumiTesto(u, tipo) {
  return tipo === "LUCE"
    ? `${nf(u.luce.consumoAnnuoKwh, 0)} kWh/anno, ${nf(u.luce.potenzaKw)} kW, ${u.luce.residente ? "residente" : "non residente"}${u.luce.canoneRai ? ", canone RAI" : ""}, profilo ${u.luce.profilo ? "personale" : "standard stimato"}`
    : `${nf(u.gas.consumoAnnuoSmc, 0)} Smc/anno, ${u.gas.riscaldamento ? "riscaldamento" : "cucina/acqua calda"}, profilo ${u.gas.profilo ? "personale" : "standard stimato"}`;
}

/** PDF del confronto: classifica + totali mensili per offerta. */
export async function pdfConfronto(R, utenza, dati, inizio) {
  const [a, m] = inizio.split("-").map(Number);
  const doc = nuovo("Confronto offerte luce e gas", `12 bollette simulate da ${MESI[m - 1]} ${a} · generato il ${oggi()}`);
  let y = avvisoSimulazione(doc, 30);
  for (const [tipo, lista] of Object.entries(R)) {
    if (!lista.length) continue;
    const u = tipo === "LUCE" ? "kWh" : "Smc";
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...PRI);
    doc.text(tipo === "LUCE" ? "Luce" : "Gas", 14, y + 4);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUT);
    doc.text(consumiTesto(utenza, tipo), 14, y + 9);
    const best = lista[0].centrale;
    doc.autoTable({ ...stileTab, startY: y + 12,
      head: [["#", "Offerta", "Prezzo", "Quota fissa", "Totale 12 mesi", "Scenari basso - alto", "Media/mese", `€/${u}`, "Differenza"]],
      body: lista.map((r, i) => [i + 1, `${r.offerta.fornitore}\n${r.offerta.nome}`, descrPrezzo(r.offerta),
        eur(r.offerta.quotaFissaAnnua || 0, 0) + "/anno", eur(r.centrale),
        r.offerta.tipoPrezzo === "indicizzato" ? `${eur(r.basso, 0)} - ${eur(r.alto, 0)}` : "prezzo fisso",
        eur(r.centrale / 12), nf(r.costoMedio, 4), i === 0 ? "migliore" : "+" + eur(r.centrale - best, 0)]),
      columnStyles: { 0: { cellWidth: 6 }, 1: { cellWidth: 38 }, 4: { fontStyle: "bold", halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" } },
      didParseCell: (d) => { if (d.section === "body" && d.row.index === 0) d.cell.styles.fillColor = [227, 243, 234]; } });
    // totali mensili
    const mesiEt = lista[0].ris.centrale.map((x) => x.etichetta.slice(0, 3) + " " + String(x.anno).slice(2));
    doc.autoTable({ ...stileTab, startY: doc.lastAutoTable.finalY + 3, styles: { ...stileTab.styles, fontSize: 6.5, cellPadding: 1 },
      head: [["Bolletta mensile (scenario centrale)", ...mesiEt]],
      body: lista.map((r) => [r.offerta.nome.slice(0, 28), ...r.ris.centrale.map((x) => nf(x.risultato.totale, 2))]),
      foot: [["Valori", ...lista[0].ris.centrale.map((x) => (x.simulato ? "SIM" : "REALE"))]],
      footStyles: { fillColor: [253, 240, 220], textColor: SIM, fontSize: 6 } });
    y = doc.lastAutoTable.finalY + 8;
    if (y > 250) { doc.addPage(); y = 16; }
  }
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...PRI);
  doc.text("Come sono stati simulati i valori futuri", 14, y); y = metodo(doc, dati, y + 3);
  // note offerte
  const tutte = [...R.LUCE, ...R.GAS].filter((r) => r.offerta.note?.length);
  if (tutte.length) {
    doc.autoTable({ ...stileTab, startY: y, head: [["Offerta", "Note e clausole da controllare"]],
      body: tutte.map((r) => [`${r.offerta.fornitore}\n${r.offerta.nome}`, r.offerta.note.join("\n")]),
      columnStyles: { 0: { cellWidth: 45 } } });
  }
  pie(doc);
  await salva(doc, `confronto_bollette_${inizio}.pdf`);
}

/** PDF delle 12 bollette dettagliate di un'offerta. */
export async function pdfBollette(o, ris, scenario, utenza, dati, inizio) {
  const mesi = ris[scenario];
  const unita = o.fornitura === "LUCE" ? "kWh" : "Smc";
  const doc = nuovo(`${o.fornitore} - ${o.nome}`, `${o.fornitura === "LUCE" ? "Energia elettrica" : "Gas naturale"} · ${descrPrezzo(o)} · quota fissa ${eur(o.quotaFissaAnnua || 0)}/anno · ` +
    `scenario ${scenario} · ${consumiTesto(utenza, o.fornitura)}`);
  let y = avvisoSimulazione(doc, 34);
  doc.autoTable({ ...stileTab, startY: y, head: [["Mese", `Consumo ${unita}`, ...Object.keys(ris).map((s) => `Totale ${s}`), "Valori"]],
    body: mesi.map((m, i) => [m.etichetta, nf(m.consumo, 1), ...Object.keys(ris).map((s) => eur(ris[s][i].risultato.totale)), m.simulato ? "SIMULATO" : "REALE"]),
    foot: [["Totale", nf(mesi.reduce((s, m) => s + m.consumo, 0), 0), ...Object.keys(ris).map((s) => eur(totale(ris[s]))), ""]],
    footStyles: { fillColor: PRI, textColor: 255 }, didParseCell: coloraTipo });
  y = metodo(doc, dati, doc.lastAutoTable.finalY + 6);
  if (o.note?.length) {
    doc.autoTable({ ...stileTab, startY: y, head: [["Note sull'offerta"]], body: o.note.map((x) => [x]) });
  }
  for (const m of mesi) {
    doc.addPage();
    const r = m.risultato;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...PRI);
    doc.text(`Bolletta simulata - ${m.etichetta}`, 14, 16);
    doc.setFontSize(9); doc.setTextColor(...(m.simulato ? SIM : OK));
    doc.text(m.simulato ? "CONTIENE VALORI SIMULATI" : "VALORI REALI", 196, 16, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setTextColor(...MUT);
    doc.text(`${o.fornitore} · ${o.nome} · periodo ${m.periodo.giorni} giorni · consumo ${nf(m.consumo, 3)} ${unita} · scenario ${scenario}`, 14, 22);
    const body = [];
    for (const [g, tit] of GRUPPI) {
      const voci = r.voci.filter((x) => x.gruppo === g);
      if (!voci.length) continue;
      body.push([{ content: tit, colSpan: 3, styles: { fontStyle: "bold", fillColor: [227, 239, 242] } },
        { content: eur(r.gruppo(g)), styles: { fontStyle: "bold", halign: "right", fillColor: [227, 239, 242] } }]);
      for (const x of voci) {
        body.push([x.descrizione, g === "iva" ? `su ${eur(x.quantita)}` : `${nf(x.quantita, 3)} ${x.unita}`,
          g === "iva" ? `${Math.round(x.prezzo * 100)}%` : nf(x.prezzo, 6), eur(x.importo)]);
      }
    }
    doc.autoTable({ ...stileTab, startY: 26, head: [["Voce", "Quantità", "Prezzo unitario", "Importo"]], body,
      foot: [[{ content: "TOTALE BOLLETTA", colSpan: 3 }, { content: eur(r.totale), styles: { halign: "right" } }]],
      footStyles: { fillColor: PRI, textColor: 255, fontSize: 10 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } } });
    doc.autoTable({ ...stileTab, startY: doc.lastAutoTable.finalY + 5, head: [["Valore applicato", "Tipo", "Cifra", "Origine"]],
      body: m.applicati.map((a) => [a.nome, a.tipo, a.valore == null ? "—" : `${nf(a.valore, 6)} ${a.unita}`, a.nota]),
      columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 20 }, 2: { cellWidth: 30, halign: "right" } }, didParseCell: coloraTipo });
    if (r.avvisi.length) {
      doc.setFontSize(7.5); doc.setTextColor(...MUT);
      doc.text(doc.splitTextToSize(r.avvisi.map((x) => "- " + x).join("\n"), 182), 14, doc.lastAutoTable.finalY + 5);
    }
  }
  pie(doc);
  const slug = (o.nome || "offerta").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
  await salva(doc, `bollette_${slug}_${scenario}.pdf`);
}

async function salva(doc, nome) {
  if (Capacitor.isNativePlatform()) {
    const base64 = doc.output("datauristring").split(",")[1];
    const w = await Filesystem.writeFile({ path: nome, data: base64, directory: Directory.Cache });
    await Share.share({ title: nome, url: w.uri, dialogTitle: "Salva o invia il PDF" });
  } else {
    doc.save(nome);
  }
}
