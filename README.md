# Simulatore Bollette (Android)

App Android per confrontare offerte luce e gas: alleghi le CTE in PDF, dichiari i consumi e ottieni
12 bollette mensili simulate per ogni offerta, con classifica ed export PDF.

## Installare l'app
1. Dal telefono apri la pagina **Releases** di questo repository.
2. Scarica l'ultimo file `SimulatoreBollette-x.y.z.apk` e aprilo.
3. La prima volta Android chiede di consentire l'installazione da questa fonte (Chrome / File): conferma.

Gli aggiornamenti si installano sopra la versione precedente: i dati restano.

## Come funziona
- **Consumi**: kWh e Smc annui, potenza, residenza, canone RAI; opzionale il dettaglio mese per mese.
- **Offerte**: allega una o più CTE (PDF). L'app legge la Scheda Sintetica sul telefono e mostra ogni
  valore trovato con la frase di origine, da confermare. Si possono inserire offerte anche a mano.
- **Confronto**: classifica sul costo di 12 mesi; per le offerte variabili scenario basso / centrale / alto.
- **PDF**: confronto e 12 bollette dettagliate di un'offerta, con ogni valore marcato REALE o SIMULATO.

## Dati di mercato (`data/dati.json`)
Tariffe ARERA (rete, oneri, accise, IVA), PUN e PSV mensili, dispacciamento CDISPD e metodo di
simulazione. L'app scarica questo file quando c'è rete; senza rete usa l'ultima copia salvata.

Per aggiornarlo ogni mese: modifica `data/dati.json` su GitHub (matita ✏️), aggiungi il mese chiuso in
`indici.pun.mesi`, `indici.psv.mesi`, `indici.cdispd.mesi`, aggiorna `aggiornato_al` e salva.
L'azione *Controlla dati* verifica il file e rilancia i test sulle bollette reali.

## Sviluppo
```
npm ci
npm test          # motore verificato su bollette reali Hera (luce) ed Estra (gas)
npm run build     # crea www/app.js
npx cap sync android
```
Ogni push su `main` compila l'APK con GitHub Actions e lo pubblica in Releases.

La chiave di firma `android/app/firma-app.keystore` è nel repository per poter compilare in automatico:
va bene per un'app personale distribuita a mano, non per la pubblicazione sul Play Store.
