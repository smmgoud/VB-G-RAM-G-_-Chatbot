const express = require("express");
const path = require("path");
const { searchPortal, getDetail } = require("./scraper");
const XLSX = require("xlsx");

const app = express();
const PORT = Number(process.env.PORT || 8080);
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  if (req.path.startsWith("/api/")) console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "VB-G RAM G Wanaparthy Chatbot" }));


app.post("/api/export/workbook", (req, res) => {
  try {
    const data = req.body || {};
    const rows = Array.isArray(data.rows) ? data.rows.slice(0, 5000) : [];
    const detailTables = Array.isArray(data.detailTables) ? data.detailTables.slice(0, 100) : [];
    const wb = XLSX.utils.book_new();

    const abstract = [
      ["VB-G RAM G — Work Abstract"],
      ["Work Name / Description", data.work || ""],
      ["Work Code", data.workCode || ""],
      ["Block", data.block || ""],
      ["Financial Year", data.financialYear || ""],
      [],
      ["Abstract Details of the Search Work Code"]
    ];
    detailTables.forEach((table, index) => {
      abstract.push([`Details Table ${index + 1}`]);
      (Array.isArray(table) ? table : []).slice(0, 500).forEach(row => {
        abstract.push((Array.isArray(row) ? row : []).slice(0, 40).map(cell => String(cell && cell.text != null ? cell.text : "")));
      });
      abstract.push([]);
    });
    const wsAbstract = XLSX.utils.aoa_to_sheet(abstract);
    wsAbstract["!cols"] = [{wch:36},{wch:48},{wch:28},{wch:24},{wch:18},{wch:18}];
    XLSX.utils.book_append_sheet(wb, wsAbstract, "Work Abstract");

    const toNumber = value => {
      if (value === null || value === undefined || String(value).trim() === "") return null;
      const normalized = String(value).replace(/,/g, "").trim();
      return /^-?\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : null;
    };
    const summary = [["Work Code", "Muster Roll No.", "Wagelist No.", "Total man days", "Total Cash Payment (In Rs.)", "Official Record URL"]];
    rows.forEach(r => summary.push([
      String(data.workCode || ""), String(r.number || ""), String(r.wagelist || ""),
      toNumber(r.mandays), toNumber(r.cash), String(r.url || "")
    ]));
    const totalRow = summary.length + 1;
    summary.push(["Total", "", "", null, null, "Totals use numeric values only; missing values are excluded."]);
    const wsSummary = XLSX.utils.aoa_to_sheet(summary);
    wsSummary["!cols"] = [{wch:32},{wch:18},{wch:24},{wch:16},{wch:28},{wch:65}];
    wsSummary["!autofilter"] = { ref: `A1:F${Math.max(1, summary.length - 1)}` };
    // Store totals as Excel formulas so they recalculate when staff edit or correct extracted values.
    const lastDataRow = summary.length - 1;
    const mandaysValues = rows.map(r => toNumber(r.mandays)).filter(v => v !== null);
    const cashValues = rows.map(r => toNumber(r.cash)).filter(v => v !== null);
    const sumManDays = mandaysValues.reduce((a,b) => a+b, 0);
    const sumCash = cashValues.reduce((a,b) => a+b, 0);
    wsSummary[`D${totalRow}`] = { t: "n", f: `SUM(D2:D${lastDataRow})`, v: sumManDays, z: "#,##0.##" };
    wsSummary[`E${totalRow}`] = { t: "n", f: `SUM(E2:E${lastDataRow})`, v: sumCash, z: "#,##0.00" };
    for (let r = 2; r <= lastDataRow; r++) {
      if (wsSummary[`D${r}`] && wsSummary[`D${r}`].t === "n") wsSummary[`D${r}`].z = "#,##0.##";
      if (wsSummary[`E${r}`] && wsSummary[`E${r}`].t === "n") wsSummary[`E${r}`].z = "#,##0.00";
    }
    wsSummary["!ref"] = `A1:F${summary.length}`;
    XLSX.utils.book_append_sheet(wb, wsSummary, "Muster Roll Summary");

    const q = data.quality || {};
    const quality = [["Data Quality Check", "Result"], ["Muster Roll records", rows.length], ["Missing / unrecognized Wagelist Numbers", Number(q.missingWagelist || 0)], ["Missing / invalid cash payment values", Number(q.missingCash || 0)], ["Missing / invalid man-days values", Number(q.missingMandays || 0)], ["Duplicate Muster Roll Numbers", (Array.isArray(q.duplicateRolls) ? q.duplicateRolls : []).join(", ") || "None detected"], [], ["Notes"]];
    (Array.isArray(q.issues) ? q.issues : []).forEach(issue => quality.push([String(issue)]));
    quality.push(["These automated checks identify extraction gaps; they do not independently verify figures against the official portal."]);
    const wsQuality = XLSX.utils.aoa_to_sheet(quality);
    wsQuality["!cols"] = [{wch:62},{wch:50}];
    XLSX.utils.book_append_sheet(wb, wsQuality, "Data Quality Checks");

    // Compact dashboard for staff to review the selected Work Code before using the workbook.
    const missingWagelist = Number(q.missingWagelist || 0);
    const missingCash = Number(q.missingCash || 0);
    const missingMandays = Number(q.missingMandays || 0);
    const duplicateCount = Array.isArray(q.duplicateRolls) ? q.duplicateRolls.length : 0;
    const issueCount = missingWagelist + missingCash + missingMandays + duplicateCount;
    const dashboard = [
      ["VB-G RAM G — Work Abstract Dashboard"],
      ["Work Code", String(data.workCode || "")],
      ["Work Name / Description", String(data.work || "")],
      ["Block", String(data.block || "")],
      ["Financial Year", String(data.financialYear || "")],
      [],
      ["Summary Metric", "Value", "Review Note"],
      ["Muster Roll records", rows.length, "Records included in this workbook"],
      ["Total man-days", null, "Formula-linked to Muster Roll Summary"],
      ["Total Cash Payment (In Rs.)", null, "Formula-linked to Muster Roll Summary"],
      ["Missing / unrecognized Wagelist Numbers", missingWagelist, missingWagelist ? "Review required" : "No missing values reported by checks"],
      ["Missing / invalid cash payment values", missingCash, missingCash ? "Review required" : "No missing values reported by checks"],
      ["Missing / invalid man-days values", missingMandays, missingMandays ? "Review required" : "No missing values reported by checks"],
      ["Duplicate Muster Roll Numbers", duplicateCount, duplicateCount ? String(q.duplicateRolls.join(", ")) : "None detected by checks"],
      ["Overall data quality", issueCount ? "REVIEW REQUIRED" : "BASIC CHECKS PASSED", "Automated checks are not independent verification against the official portal."],
      [],
      ["Important", "Check all source records on the official portal before using these figures for official reporting."]
    ];
    const wsDashboard = XLSX.utils.aoa_to_sheet(dashboard);
    wsDashboard["!cols"] = [{wch:42},{wch:32},{wch:72}];
    wsDashboard["B9"] = { t: "n", f: `\'Muster Roll Summary\'!D${totalRow}`, v: sumManDays, z: "#,##0.##" };
    wsDashboard["B10"] = { t: "n", f: `\'Muster Roll Summary\'!E${totalRow}`, v: sumCash, z: "#,##0.00" };
    wsDashboard["!ref"] = "A1:C17";
    XLSX.utils.book_append_sheet(wb, wsDashboard, "Summary Dashboard");

    // Reconciliation worksheet: compare computed Muster Roll totals with official benchmark values
    // only when the caller provides explicit, like-for-like official totals. Never infer a benchmark
    // from unrelated expenditure or employment fields.
    const official = data.officialTotals || {};
    const officialCash = toNumber(official.cashPayment);
    const officialMandays = toNumber(official.mandays);
    const reconciliation = [
      ["Work Abstract Reconciliation"],
      ["Work Code", String(data.workCode || "")],
      [],
      ["Metric", "Calculated from Muster Rolls", "Official comparison value", "Difference", "Status"],
      ["Total Cash Payment (In Rs.)", null, officialCash, null, officialCash === null ? "Official comparable total not supplied; manual review required" : "Compare calculated and official totals"],
      ["Total man-days", null, officialMandays, null, officialMandays === null ? "Official comparable total not supplied; manual review required" : "Compare calculated and official totals"],
      [],
      ["Interpretation"],
      ["Cash payment is compared only with an official cash-payment total; it is not assumed to equal total expenditure."],
      ["Man-days are compared only with an official man-days total."],
      ["A blank official comparison value means the workbook cannot independently reconcile that metric."],
      ["Automated totals are based on successfully extracted numeric values; missing values are excluded."],
      ["Verify source records on the official portal before using figures for official reporting."]
    ];
    const wsReconciliation = XLSX.utils.aoa_to_sheet(reconciliation);
    wsReconciliation["!cols"] = [{wch:34},{wch:30},{wch:30},{wch:18},{wch:62}];
    wsReconciliation["B5"] = { t: "n", f: `\'Muster Roll Summary\'!E${totalRow}`, v: sumCash, z: "#,##0.00" };
    wsReconciliation["B6"] = { t: "n", f: `\'Muster Roll Summary\'!D${totalRow}`, v: sumManDays, z: "#,##0.##" };
    if (officialCash !== null) {
      wsReconciliation["D5"] = { t: "n", f: "B5-C5", v: sumCash - officialCash, z: "#,##0.00" };
      wsReconciliation["E5"] = { t: "s", v: Math.abs(sumCash - officialCash) < 0.005 ? "MATCH" : "MISMATCH — REVIEW" };
    }
    if (officialMandays !== null) {
      wsReconciliation["D6"] = { t: "n", f: "B6-C6", v: sumManDays - officialMandays, z: "#,##0.##" };
      wsReconciliation["E6"] = { t: "s", v: Math.abs(sumManDays - officialMandays) < 0.000001 ? "MATCH" : "MISMATCH — REVIEW" };
    }
    wsReconciliation["!ref"] = "A1:E13";
    XLSX.utils.book_append_sheet(wb, wsReconciliation, "Reconciliation");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `VBGRAMG_Work_Abstract_${String(data.workCode || "Selected_Work").replace(/[^a-z0-9_-]/gi, "_").slice(0,80)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("Excel workbook export failed:", err);
    res.status(500).json({ error: "Could not generate the Excel workbook.", detail: err.message });
  }
});

app.post("/api/search", async (req, res) => {
  try {
    const { category, keyword, financialYear = "current" } = req.body || {};
    if (!category || !keyword || !String(keyword).trim()) {
      return res.status(400).json({ error: "Search category and search value are required." });
    }
    const result = await searchPortal({ category, keyword: String(keyword).trim(), financialYear });
    res.json(result);
  } catch (err) {
    console.error("Portal search failed:", err);
    res.status(502).json({
      error: "The official portal could not be read automatically. It may be temporarily unavailable or its page structure may have changed.",
      detail: err.message
    });
  }
});

app.post("/api/detail", async (req, res) => {
  try {
    const { href } = req.body || {};
    if (!href) return res.status(400).json({ error: "A result link is required." });
    res.json(await getDetail(href));
  } catch (err) {
    console.error("Detail extraction failed:", err);
    res.status(502).json({
      error: "Could not open the selected result on the official portal.",
      detail: err.message
    });
  }
});

app.listen(PORT, () => console.log(`VB-G RAM G chatbot running at http://localhost:${PORT}`));