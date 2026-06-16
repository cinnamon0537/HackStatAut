# Identifikation relevante STATcube‑Datenbanken über Prompt

Dieser Abschnitt beschreibt, wie ein natürlicher Prompt des Users genutzt wird, um auf Basis von Metaden relevante STATcube‑Datenbanken zu identifizieren

Doku zu OeNB-Chatbot: https://pbitbucket.w.oenb.co.at:8443/projects/CHAT/repos/oenb-chatbot-utils/browse/api_usecases/api_usecases.ipynb

---

## 1. Prompt entgegennehmen

Der User formuliert eine Anfrage wie:

> „Zeige mir die Arbeitslosenquote in Wien nach Geschlecht seit 2010.“

Der Prompt wird unverändert an das Modul übergeben und dient als Grundlage für die folgenden Schritte.

---

## 2. Relevante Metadaten aus STATcube extrahieren

### 2.1 Iterative Suche im Katalog

- Durchsuche den STATcube‑Katalog (in Wissensdatenbank im OeNBChatbot hinterlegt) iterativ.
- Nutze semantische Analyse oder LLM‑gestützte Relevanzbewertung mittels OeNB-Chatbot aller Metadaten in Wissensdatenbank (Name: Hackaton_Metadaten)
- Struktur der Metadaten folgt der folgender Hierachie:
    - Datenbank oder Tabelle
    - Wertefelder ("measures")
    - Felder ("fields") mit Ausprägungen ("value" in "valueset")
    - Bsp.:
    {
    "id": ["str:database:deaccess"],
    "label": ["Anzahl Tabellierungen EXTERN Stand: 16.06.2026, 03:00:06"],
    "location": ["http://statcubeapi.statistik.at/statistik.at/ext/statcube/rest/v1/schema/str:database:deaccess"],
    "type": ["DATABASE"],
    "measures": {
      "str:measure:deaccess:F-DATA:F-SYSUSER": {
        "id": ["str:statfn:deaccess:F-DATA:F-SYSUSER:SUM"],
        "label": ["Anzahl Tabellierungen"],
        "location": ["http://statcubeapi.statistik.at/statistik.at/ext/statcube/rest/v1/schema/str:statfn:deaccess:F-DATA:F-SYSUSER:SUM"],
        "type": ["STAT_FUNCTION"]
      },
      "str:measure:deaccess:F-DATA:F-SYSQUEUETIME": {
        "id": ["str:statfn:deaccess:F-DATA:F-SYSQUEUETIME:SUM"],
        "label": ["Verarbeitungszeit in Sekunden"],
        "location": ["http://statcubeapi.statistik.at/statistik.at/ext/statcube/rest/v1/schema/str:statfn:deaccess:F-DATA:F-SYSQUEUETIME:SUM"],
        "type": ["STAT_FUNCTION"]
      }
    },
    "fields": {
      "str:field:deaccess:F-DATA:C-SYSYEAR-0": {
        "Jahr": {
          "id": ["str:valueset:deaccess:F-DATA:C-SYSYEAR-0:C-SYSYEAR-0"],
          "label": ["Jahr"],
          "location": ["http://statcubeapi.statistik.at/statistik.at/ext/statcube/rest/v1/schema/str:valueset:deaccess:F-DATA:C-SYSYEAR-0:C-SYSYEAR-0"],
          "type": ["VALUESET"],
          "fields": {
            "2015": {
              "id": ["str:value:deaccess:F-DATA:C-SYSYEAR-0:C-SYSYEAR-0:2015"],
              "label": ["2015"],
              "location": ["http://statcubeapi.statistik.at/statistik.at/ext/statcube/rest/v1/schema/str:value:deaccess:F-DATA:C-SYSYEAR-0:C-SYSYEAR-0:2015"],
              "type": ["VALUE"]
            }
- Erstelle eine Liste potenziell relevanter Datenbanken mit Relevanz-Score.

### 2.2 Relevanzbewertung durch Chatbot

- Der OeNB-Chatbot bewertet die Treffer nach Prompt‑Relevanz in Abstimmung mit den STATcube-Metadaten.
- Die Top‑5 Vorschläge werden dem User präsentiert woraus keine, eine oder mehrere welche auswählt.

### 2.3 Interaktive Validierung

Der Prozess ist **iterativ** und **iteraktiv**:

1. **Vorschläge anzeigen**
   Beispiel:
   - Arbeitsmarktstatistik – AMS
   - Bevölkerungsstatistik – Statistik Austria
   - Arbeitskräfteerhebung (AKE)

2. **User‑Feedback einholen**
   - Der User bestätigt (Mehrfachauswahl möglich) oder lehnt ab.

3. **Bei Ablehnung weiter iterieren**
   - Entferne abgelehnte Treffer.
   - Suche erneut im Katalog und berücksichtige abgelehnte Datenbanken.
   - Wiederhole den Prozess, bis der User mindestens eine Datenbank bestätigt oder keine Datenbank mehr gefunden wurde.

### 2.4 Schema der finalen Datenbank abrufen

Sobald alle vorgeschlagenen Datenbanken bestätigt wurden

- Lade das vollständige Schema (Dimensionen, Codes, Hierarchien).
- Extrahiere alle Metdaten, die für die spätere API‑Abfrage benötigt werden.

---
