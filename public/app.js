const categories = [
  ["Work","Work"],["Workername","Workername"],["MusterRoll","Muster Roll"],
  ["SkilledSemiskilledMusterRoll","Skilled/Semi-Skilled Muster Roll"],["WageList","Wage List"],
  ["SkilledSemiskilledWageList","Skilled/Semi-Skilled Wage List"],["MaterialList","Material List"],
  ["AdminList","Admin List"],["FTO","FTO – Fund Transfer Order"],["JobCardNo","Job Card Number"]
];
const blocks = ["AMARCHINTA","ATMAKUR","MADANAPUR","REVALLY","SRIRANGAPUR"];
const messages = document.getElementById("messages"), choices = document.getElementById("choices");
const form = document.getElementById("composer"), input = document.getElementById("messageInput");
let state = {step:"category", category:null, keyword:null, year:"current", results:[], selected:null, selectedIndex:null, lastQuery:null};

function addMessage(text, who="bot", html=false) {
  const row=document.createElement("div"); row.className="message "+(who==="user"?"user":"bot");
  const avatar=document.createElement("div"); avatar.className="avatar"; avatar.textContent=who==="user"?"You":"VB";
  const bubble=document.createElement("div"); bubble.className="bubble";
  if(html) bubble.innerHTML=text; else bubble.textContent=text;
  row.append(avatar,bubble); messages.append(row); messages.scrollTop=messages.scrollHeight; return bubble;
}
function showChoices(items) {
  choices.replaceChildren();
  items.forEach(item=>{const b=document.createElement("button");b.type="button";b.className="choice";b.textContent=item.label;b.addEventListener("click",()=>handle(item.value,item.label));choices.append(b);});
}
function promptCategory() {
  state.step="category";
  addMessage("Welcome to VB-G RAM G > Wanaparthy District\n\nWhat type of query do you have? Please choose a number or tap an option:");
  showChoices(categories.map(([value,label],i)=>({value,label:`${i+1}. ${label}`})));
}
function askKeyword() {
  state.step="keyword";
  addMessage(`You selected ${categories.find(c=>c[0]===state.category)?.[1] || state.category}.\nPlease enter the ${state.category==="MusterRoll"?"Muster Roll Number":state.category==="Workername"?"Worker Name":state.category==="JobCardNo"?"Job Card Number":"search value"} in full where possible.`);
  showChoices([]);
  input.placeholder="Enter search value…"; input.focus();
}
function askYear() {
  state.step="year";
  addMessage("Select the Financial Year:");
  showChoices([{value:"current",label:"1. Current FY (2026–2027)"},{value:"previous",label:"2. Previous FY (2025–2026)"}]);
}
function safe(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function search() {
  state.step="searching";
  const loader=addMessage("Searching the official VB-G RAM G portal for Telangana → Wanaparthy…");
  loader.innerHTML='<span class="loading">Connecting to official portal <span></span><span></span><span></span></span>';
  showChoices([]);
  try {
    let response, data;
    // A transient localhost/API disconnect should not be reported as a portal parsing error.
    // Check the local service first and retry the search once for brief connection resets.
    let lastNetworkError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const health = await fetch("/api/health", { cache: "no-store" });
        if (!health.ok) throw new Error(`Local chatbot service health check returned HTTP ${health.status}`);
        response = await fetch("/api/search", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: state.category, keyword: state.keyword, financialYear: state.year }),
          cache: "no-store"
        });
        data = await response.json();
        lastNetworkError = null;
        break;
      } catch (networkError) {
        lastNetworkError = networkError;
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 900));
      }
    }
    if (lastNetworkError) {
      const e = new Error("Cannot reach the local chatbot API. Keep the Command Prompt window running and check whether `npm.cmd start` is still active.");
      e.detail = lastNetworkError.message || String(lastNetworkError);
      throw e;
    }
    if(!response.ok) { const error = new Error(data.error||"Search failed"); error.detail = data.detail || ""; throw error; }
    state.results=data.results||[];
    if(!state.results.length) {
      addMessage(data.message||"No results were found.");
      if(data.portalText) addMessage("Portal response:\n"+data.portalText.slice(0,1200));
      state.step="retry"; showChoices([{value:"retry",label:"Try another search"},{value:"menu",label:"Main menu"}]); return;
    }
    addMessage(`Found ${data.count} result(s) for ${state.category} “${state.keyword}” in ${data.financialYear||"the selected financial year"}.`);
    renderResults(state.results);
    addMessage("Which block would you like to know more information about? Select a block below.");
    state.step="block";
    showChoices(state.results.map((r,i)=>({
      value:`block:${i}`,
      label:`${i+1}. ${r.block || r.identifier || r.work || "Open result"}`
    })));
  } catch(err) {
    addMessage("I could not retrieve live data. "+err.message+(err.detail?"\n\nTechnical detail: "+err.detail:"")+"\n\nThe portal may be responding differently than expected; this diagnostic detail can help fix the integration.");
    state.step="retry"; showChoices([{value:"retry",label:"Retry search"},{value:"menu",label:"Main menu"}]);
  }
}
function renderResults(rows) {
  const dynamic = rows.some(r => Array.isArray(r.headers) && r.headers.length && Array.isArray(r.cells));
  let html;
  if(dynamic) {
    const first = rows.find(r => r.headers?.length);
    const headers = first.headers;
    const normalizedHeaders = headers.map(h => String(h).replace(/\s+/g, " ").trim().toLowerCase());
    const isWorkAbstract = state.category === "Work" && (
      (normalizedHeaders.some(h => /block name/.test(h)) && normalizedHeaders.some(h => /panchayat name/.test(h))) ||
      (normalizedHeaders.some(h => /estimated cost/.test(h)) && normalizedHeaders.some(h => /persondays/.test(h))) ||
      normalizedHeaders.some(h => /measurement book detail/.test(h))
    );
    const tableClass = isWorkAbstract ? "result-table abstract-work-table" : "result-table";
    // Keep the abstract heading for every Work result grid, even if the portal
    // changes a column label slightly; style the wide orange grid when detected.
    const title = state.category === "Work" ? '<div class="abstract-work-title">Abstract Details of the Search Work Code</div>' : '';
    html=`${title}<div class="result-table-wrap ${isWorkAbstract ? 'abstract-work-wrap' : ''}"><table class="${tableClass}"><thead><tr>${headers.map(h=>`<th>${safe(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>{
      const cells = r.cells || [];
      return `<tr>${headers.map((h,i)=>{
        const value=cells[i] || "";
        const links=r.links||[];
        const link=links.find(l=>l.text===value) || links.find(l=>value && l.text && (value.includes(l.text) || l.text.includes(value))) || ((/muster|wage.?list|measurement|work code|work name|number|no\.|worker|job.?card|dpr/i.test(h)) ? links.find(l=>l.href===r.href) : null);
        const content=link && /^https?:\/\//i.test(link.href) && /vbgramgrep\.dord\.gov\.in/i.test(link.href)
          ? `<a href="${safe(link.href)}" target="_blank" rel="noreferrer">${safe(value || link.text || "Open record")} ↗</a>`
          : safe(value);
        return `<td>${content}</td>`;
      }).join("")}</tr>`;
    }).join("")}</tbody></table></div>`;
  } else {
    html=`<div class="result-table-wrap"><table class="result-table"><thead><tr><th>#</th><th>Block</th><th>Work Code / Work Name</th><th>Number</th><th>Status</th><th>Date From</th><th>Date To</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${safe(r.sno||i+1)}</td><td>${safe(r.block)}</td><td>${safe(r.work)}</td><td>${r.href&&/^https?:\/\//i.test(r.href)&&/vbgramgrep\.dord\.gov\.in/i.test(r.href)?`<a href="${safe(r.href)}" target="_blank" rel="noreferrer">${safe(r.identifier)} ↗</a>`:safe(r.identifier)}</td><td>${safe(r.status)}</td><td>${safe(r.dateFrom)}</td><td>${safe(r.dateTo)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  addMessage(html,"bot",true);
  const links = rows.flatMap(r=>r.links||[]).filter(l=>/^https?:\/\//i.test(l.href)&&/vbgramgrep\.dord\.gov\.in/i.test(l.href));
  const unique = [...new Map(links.map(l=>[l.href,l])).values()];
  if(unique.length && state.category !== "Work") {
    addMessage("Official record links are available directly in the result table. Select a result to inspect its details.");
  }
}
function showResultChoices() {
  const items = state.results.map((r,i)=>({
    value:`block:${i}`,
    label:`${i+1}. ${r.block || r.identifier || r.work || "Open result"}`
  }));
  items.push({value:"menu",label:"Start a new query"});
  showChoices(items);
}
async function detail(index) {
  const row=state.results[index]; if(!row) return;
  state.selected=row; state.step="detail";
  addMessage(`OK, you have selected “${row.block || row.identifier || row.work || "result"}”. I will open its result hyperlink and inspect the information and actions available on that official page.`);
  if(!row.href) {addMessage("The result did not include a usable detail link. Please open the official portal to inspect this record.");showChoices([{value:"menu",label:"Main menu"}]);return;}
  const loader=addMessage("Opening the selected block’s linked record…");
  loader.innerHTML='<span class="loading">Loading record <span></span><span></span><span></span></span>';showChoices([]);
  try {
    const response=await fetch("/api/detail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({href:row.href})});
    const data=await response.json(); if(!response.ok) throw new Error(data.error||"Could not load details");
    const summary=[`Result: ${row.block || row.identifier || row.work || "Selected official record"}`,`Search category: ${categories.find(c=>c[0]===state.category)?.[1] || state.category}`,`Search value: ${state.keyword}`,`Financial year: ${state.year==="previous"?"Previous FY":"Current FY"}`,row.block?`Block: ${row.block}`:"",row.work?`Work / description: ${row.work}`:"",row.status?`Status: ${row.status}`:"",row.dateFrom?`Date From: ${row.dateFrom}`:"",row.dateTo?`Date To: ${row.dateTo}`:""].filter(Boolean).join("\n");
    addMessage("Selected result summary:\n"+summary);
    // Show the Job Card banner fields that appear outside the portal's extracted tables.
    if(data.jobCardNumber || data.jobCardStatus) {
      let cardHtml = '<section class="jobcard-highlight">';
      if(data.jobCardNumber) cardHtml += `<div class="jobcard-label">GRAMIN ROZGAR GUARANTEE CARD NUMBER</div><div class="jobcard-number">${safe(data.jobCardNumber)}</div>`;
      if(data.jobCardStatus === "Deleted") {
        cardHtml += `<div class="jobcard-deleted"><div class="jobcard-status">JOB CARD DELETED</div>${data.jobCardDeletedDate ? `<div class="jobcard-date">Deleted on ${safe(data.jobCardDeletedDate)}</div>` : '<div class="jobcard-date">Deletion status shown on the official portal</div>'}</div>`;
      }
      cardHtml += '</section>';
      addMessage(cardHtml,"bot",true);
    }
    if(data.tables?.length) {
      data.tables.slice(0,10).forEach((table)=>{
        const rows = table.slice(0,100);
        const colCount = Math.max(1, ...rows.map(r => r.reduce((sum, cell) => sum + Math.max(1, Number(cell.colSpan) || 1), 0)));
        const keyValue = colCount <= 2;
        // The portal stores these section labels in sibling/nested layout tables;
        // they may be omitted from the extracted data table. Restore only the
        // heading immediately above its matching data table.
        const tableText = rows.flat().map(cell => String(cell.text || '')).join(' ').replace(/\s+/g, ' ').trim();
        const sectionTitle = /\b(?:person.?days|pesrondays|persondays)\b/i.test(tableText) && /Total\s*No\.?\s*of\s*Persons\s*Given\s*Work/i.test(tableText)
          ? 'Employment Generated'
          : /\bUnskilled\b/i.test(tableText) && /\bSemi[- ]Skilled\b/i.test(tableText) && /\bContingency\b/i.test(tableText) && /\bMaterial\b/i.test(tableText) && /\bTotal\b/i.test(tableText)
            ? 'Expenditure Incurred (in Rs.)' : '';
        const sectionTitleHtml = sectionTitle ? `<div class="detail-table-section-title">${safe(sectionTitle)}</div>` : '';
        const tabHtml=`${sectionTitleHtml}<div class="result-table-wrap ${keyValue ? 'detail-kv-wrap' : 'detail-grid-wrap'}"><table class="result-table detail-table ${keyValue ? 'key-value-table' : 'structured-table'}"><tbody>${rows.map((r)=>{
          const nonEmpty = r.filter(cell => String(cell.text || '').trim());
          const sectionHeading = nonEmpty.length === 1 && /^(Work Status|Scope of Work|Expenditure Incurred\s*\(in Rs\.\)|Employment Generated)$/i.test(String(nonEmpty[0].text || '').trim());
          if (sectionHeading) return `<tr class="detail-section-heading"><th colspan="${Math.min(20, colCount)}">${safe(nonEmpty[0].text)}</th></tr>`;
          // A few official Work Details pages place the Work Status value
          // (for example, "On Going") in a two-cell row while the label is
          // lost inside a nested layout table. Restore only that missing label.
          if (r.length === 2 && !String(r[0].text || '').trim() && /^(On Going|Ongoing|Completed|Complete|Closed|In Progress|Not Started|Stopped|Suspended)$/i.test(String(r[1].text || '').trim())) {
            return `<tr><th>Work Status</th><td>${safe(r[1].text || '')}</td></tr>`;
          }
          return `<tr>${r.map(cell=>{
            const tag = cell.tag === 'th' ? 'th' : 'td';
            const span = `${cell.colSpan > 1 ? ` colspan="${Math.min(20, cell.colSpan)}"` : ''}${cell.rowSpan > 1 ? ` rowspan="${Math.min(50, cell.rowSpan)}"` : ''}`;
            return `<${tag}${span}>${safe(cell.text || '')}</${tag}>`;
          }).join("")}</tr>`;
        }).join("")}</tbody></table></div>`;
        addMessage(tabHtml,"bot",true);
      });
    } else if(data.pageText) addMessage("Record details:\n"+data.pageText.slice(0,6000));
    // Work records may contain several numbered Muster Roll hyperlinks. Their
    // official detail tables are fetched by the scraper and displayed inline,
    // rather than exposing a generic "Available hyperlinks" list.
    if(data.musterRollDetails?.length) {
      addMessage(`Found ${data.musterRollDetails.length} linked Muster Roll record(s).`);
      data.musterRollDetails.forEach((roll)=>{
        addMessage(`<h3 class="roll-heading">Muster Roll No. ${safe(roll.number)}</h3>`,"bot",true);
        if(roll.error) {
          addMessage(`Could not extract Muster Roll No. ${safe(roll.number)} automatically. <a href="${safe(roll.url)}" target="_blank" rel="noreferrer">Open this official Muster Roll ↗</a>`,"bot",true);
          return;
        }
        if(roll.tables?.length) {
          roll.tables.slice(0,10).forEach(table=>{
            const rows=table.slice(0,150);
            const colCount=Math.max(1,...rows.map(r=>r.reduce((sum,cell)=>sum+Math.max(1,Number(cell.colSpan)||1),0)));
            const keyValue=colCount<=2;
            const tableHtml=`<div class="result-table-wrap muster-roll-table-wrap"><table class="result-table detail-table ${keyValue?'key-value-table':'structured-table muster-roll-grid'}"><tbody>${rows.map(r=>`<tr>${r.map(cell=>{
              const tag=cell.tag==='th'?'th':'td';
              const span=`${cell.colSpan>1?` colspan="${Math.min(30,cell.colSpan)}"`:''}${cell.rowSpan>1?` rowspan="${Math.min(50,cell.rowSpan)}"`:''}`;
              return `<${tag}${span}>${safe(cell.text||'')}</${tag}>`;
            }).join('')}</tr>`).join('')}</tbody></table></div>`;
            addMessage(tableHtml,"bot",true);
          });
        } else {
          addMessage(`No structured table was detected for Muster Roll No. ${safe(roll.number)}. <a href="${safe(roll.url)}" target="_blank" rel="noreferrer">Open the official record ↗</a>`,"bot",true);
        }
      });
      // Final consolidated summary: one row per linked Muster Roll.
      const summaryRows = data.musterRollDetails.map(roll => ({ number: roll.number, wagelist: roll.wagelistNumber || "—", mandays: roll.totalManDays || "", cash: roll.cashPayment || "", url: roll.url || "" }));
      const amounts = summaryRows.map(r => {
        if (!r.cash) return null;
        const normalized = String(r.cash).replace(/,/g, "").replace(/₹|Rs\.?/gi, "").trim();
        return /^-?\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : null;
      });
      const total = amounts.some(v => v !== null) ? amounts.reduce((sum, v) => sum + (v === null ? 0 : v), 0) : null;
      const totalText = total === null ? "Not available" : total.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      const totalManDays = summaryRows.reduce((sum, r) => sum + (Number(String(r.mandays).replace(/,/g, "")) || 0), 0);
      const hasManDays = summaryRows.some(r => r.mandays !== "");
      const verifiedCount = data.musterRollDetails.filter(r => r.liveVerification?.status === "FIELDS_FOUND").length;
      const workCode = String(row.identifier || "").split(/\s+\(/)[0].trim();
      const summaryHtml = `<h3 class="roll-heading">Summary — Total Cash Payment by Muster Roll</h3>
        <div class="result-table-wrap"><table class="result-table detail-table structured-table cash-summary-table">
          <colgroup><col class="col-work-code"><col class="col-muster-roll"><col class="col-wagelist"><col class="col-mandays"><col class="col-cash"><col class="col-source"></colgroup>
          <thead><tr><th>Work Code</th><th>Muster Roll No.</th><th>Wagelist No.</th><th>Total man days</th><th>Total Cash Payment (In Rs.)</th><th>Source</th></tr></thead>
          <tbody>${data.musterRollDetails.map(roll=>{const r={workCode,number:roll.number,wagelist:roll.wagelistNumber||"—",mandays:roll.totalManDays||"",cash:roll.cashPayment||"",url:roll.url||""};return `<tr><td>${safe(r.workCode)}</td><td>${safe(r.number)}</td><td>${safe(r.wagelist)}</td><td>${safe(r.mandays||"Not found")}</td><td>${safe(r.cash||"Not found on the extracted page")}</td><td>${r.url?`<a href="${safe(r.url)}" target="_blank" rel="noreferrer">Official record ↗</a>`:"—"}</td></tr>`}).join("")}
          <tr class="cash-summary-total"><th colspan="3">Total</th><th>${hasManDays ? safe(String(totalManDays)) : "Not available"}</th><th>${safe(totalText)}</th><td>Sum of extracted values; missing values are excluded.</td></tr></tbody>
        </table></div>`;
      const summaryBubble = addMessage(summaryHtml,"bot",true);
      // Data-quality checks help staff identify incomplete extraction before relying on totals.
      const rollNumbers = summaryRows.map(r => String(r.number || "").trim()).filter(Boolean);
      const duplicateRolls = [...new Set(rollNumbers.filter((n, i) => rollNumbers.indexOf(n) !== i))];
      const missingWagelist = summaryRows.filter(r => !r.wagelist || r.wagelist === "—" || !/\bWL\d+\b/i.test(String(r.wagelist))).length;
      const missingCash = summaryRows.filter((r, i) => amounts[i] === null).length;
      const missingMandays = summaryRows.filter(r => !String(r.mandays || "").trim() || !/^\d+(?:\.\d+)?$/.test(String(r.mandays).replace(/,/g, "").trim())).length;
      const qualityIssues = [];
      if (missingWagelist) qualityIssues.push(`${missingWagelist} Muster Roll record(s) have a missing or unrecognized Wagelist Number.`);
      if (missingCash) qualityIssues.push(`${missingCash} Muster Roll record(s) have no usable Total Cash Payment value; these are excluded from the cash total.`);
      if (missingMandays) qualityIssues.push(`${missingMandays} Muster Roll record(s) have missing or non-numeric man-days; these are excluded from the man-days total.`);
      if (duplicateRolls.length) qualityIssues.push(`Duplicate Muster Roll Number(s) detected: ${duplicateRolls.join(", ")}. Check the official records before using the total.`);
      if (!qualityIssues.length) qualityIssues.push("No missing summary fields or duplicate Muster Roll Numbers were detected by these basic checks. This does not independently confirm the figures against the official portal.");
      const qualityPanel = document.createElement("section");
      qualityPanel.className = `data-quality-panel ${qualityIssues.some(x => !x.startsWith("No missing")) ? "has-quality-issues" : "quality-check-ok"}`;
      qualityPanel.innerHTML = `<h4>Data Quality Checks</h4><ul>${qualityIssues.map(item => `<li>${safe(item)}</li>`).join("")}</ul><p>Cash total: ${safe(totalText)}. Man-days total: ${safe(hasManDays ? String(totalManDays) : "Not available")}. Missing values are excluded from totals.</p>`;
      summaryBubble.appendChild(qualityPanel);
      const exportButton = document.createElement("button");
      exportButton.type = "button"; exportButton.className = "export-excel-button";
      exportButton.textContent = "Download Work Abstract Excel Workbook (.xlsx)";
      exportButton.addEventListener("click", async () => {
        exportButton.disabled = true;
        const oldLabel = exportButton.textContent;
        exportButton.textContent = "Preparing Excel workbook…";
        try {
          const payload = {
            rows: summaryRows,
            detailTables: data.tables || [],
            work: row.work || row.identifier || row.block || "Selected Work Code",
            workCode,
            block: row.block || "",
            financialYear: state.year === "previous" ? "2025-2026" : "2026-2027",
            totalCash: totalText,
            totalManDays: hasManDays ? String(totalManDays) : "Not available",
            quality: { missingWagelist, missingCash, missingMandays, duplicateRolls, issues: qualityIssues }
          };
          const response = await fetch("/api/export/workbook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || `Export failed (${response.status})`); }
          const blob = await response.blob();
          const downloadUrl = URL.createObjectURL(blob);
          const link = document.createElement("a"); link.href = downloadUrl;
          link.download = `VBGRAMG_Work_Abstract_${(workCode || "Selected_Work").replace(/[^a-z0-9_-]/gi, "_")}_${new Date().toISOString().slice(0,10)}.xlsx`;
          document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(downloadUrl);
          exportButton.textContent = "Excel Workbook Downloaded";
        } catch (err) {
          addMessage(`Could not create the Excel workbook: ${err.message}. Please check that the chatbot server is running and restart it after installing dependencies.`);
          exportButton.textContent = oldLabel;
        } finally { exportButton.disabled = false; }
      });
      summaryBubble.appendChild(exportButton);
      const printButton = document.createElement("button");
      printButton.type = "button"; printButton.className = "export-excel-button print-report-button";
      printButton.textContent = "Print Work Abstract Report";
      printButton.addEventListener("click", () => printWorkAbstractReport({
        rows: summaryRows,
        detailTables: data.tables || [],
        work: row.work || row.identifier || row.block || "Selected Work Code",
        workCode: row.identifier || "",
        block: row.block || "",
        financialYear: state.year === "previous" ? "2025-2026" : "2026-2027",
        totalCash: totalText,
        totalManDays: hasManDays ? String(totalManDays) : "Not available",
        verification: data.musterRollDetails.map(r => r.liveVerification?.status === "FIELDS_FOUND" ? "Fields found" : "Review required")
      }));
      summaryBubble.appendChild(printButton);
    }
    if(/muster/i.test(state.category)) addMessage("From this Muster Roll detail page, I can summarize the muster-roll number, work code/name, block, dates, sanction details, measurement-book reference, attendance rows and wage/payment columns when the portal exposes them. Your working example also shows a Musteroll Report link and a Measurement Book Detail section.");
    else addMessage("From this result page, I can extract the fields and tables the portal provides, summarize matching records, follow each record hyperlink, show the official detail page's available links/actions, and report fields such as block, work/record number, status and dates when present.");
    addMessage("You can select another result or start a new query.");
    showChoices([{value:"menu",label:"Main menu"},{value:"retry",label:"Search another value"}]);
  } catch(err) {
    addMessage("The selected result was found, but its detail page could not be extracted. "+err.message+"\n\nOpen the linked official result directly to verify the details.");
    addMessage(`<a href="${safe(row.href)}" target="_blank" rel="noreferrer">Open selected record on official portal ↗</a>`,"bot",true);
    showChoices([{value:"menu",label:"Main menu"},{value:"retry",label:"Search another value"}]);
  }
}
function downloadWorkAbstractCsv(report) {
  const esc = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [["VB-G RAM G — Work Abstract Summary"],["Work / Description",report.work],["Work Code / Identifier",report.workCode],["Block",report.block],["Financial Year",report.financialYear],[],["Abstract Details of the Search Work Code"],...[...(report.detailTables || []).flatMap((table,ti)=>[[`Details Table ${ti+1}`],...table.map(row=>row.map(cell=>cell.text || ""))]),[]],["Summary — Total Cash Payment by Muster Roll"],["Work Code","Muster Roll No.","Wagelist No.","Total man days","Total Cash Payment (In Rs.)","Official Source URL"],...report.rows.map(r=>[report.workCode,r.number,r.wagelist,r.mandays,r.cash,r.url]),["Total","","",report.totalManDays,report.totalCash,"Missing values are excluded from totals"]];
  const blob = new Blob(["\uFEFF" + lines.map(line => line.map(esc).join(",")).join("\r\n")], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href=url;
  a.download=`VBGRAMG_Work_Abstract_${(report.workCode || "Selected_Work").replace(/[^a-z0-9_-]/gi,"_")}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function printWorkAbstractReport(report) {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[ch]));
  const renderDetailTable = (table, index) => {
    const rows = (table || []).map(r => `<tr>${r.map(cell => {
      const tag = cell.tag === "th" ? "th" : "td";
      const colspan = Number(cell.colSpan) > 1 ? ` colspan="${Math.min(20, Number(cell.colSpan))}"` : "";
      const rowspan = Number(cell.rowSpan) > 1 ? ` rowspan="${Math.min(50, Number(cell.rowSpan))}"` : "";
      return `<${tag}${colspan}${rowspan}>${esc(cell.text || "")}</${tag}>`;
    }).join("")}</tr>`).join("");
    const flat = (table || []).flat().map(c => c.text || "").join(" ");
    const title = /person.?days|pesrondays|persondays/i.test(flat) && /Total\s*No\.?\s*of\s*Persons\s*Given\s*Work/i.test(flat) ? "Employment Generated" : /Unskilled/i.test(flat) && /Semi[- ]Skilled/i.test(flat) && /Contingency/i.test(flat) && /Material/i.test(flat) ? "Expenditure Incurred (in Rs.)" : `Work Details Table ${index + 1}`;
    return `<h3>${esc(title)}</h3><table class="detail-table">${rows}</table>`;
  };
  const rows = report.rows.map(r => `<tr><td class="work-code-cell">${esc(String(report.workCode || "").split(/\s+\(/)[0].trim())}</td><td>${esc(r.number)}</td><td class="wagelist-cell">${esc(r.wagelist)}</td><td>${esc(r.mandays || "Not found")}</td><td class="numeric">${esc(r.cash || "Not found")}</td></tr>`).join("");
  const details = (report.detailTables || []).map(renderDetailTable).join("");
  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) { addMessage("The print window was blocked by your browser. Allow pop-ups for localhost:8080 and try again."); return; }
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>VB-G RAM G Work Abstract</title><style>
    @page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;color:#172b3b;font-size:10px}h1{font-size:19px;text-align:center;margin:0 0 4px;color:#123f73}h2{font-size:14px;text-align:center;margin:0 0 16px}h3{font-size:12px;margin:16px 0 4px;color:#123f73}table{width:100%;border-collapse:collapse;margin:6px 0 14px;page-break-inside:avoid}td,th{border:1px solid #7d8b99;padding:5px;text-align:left;overflow-wrap:anywhere}th{background:#dff1fb}.meta{width:100%;margin:12px 0}.meta td{width:50%}.numeric{text-align:right}.total{font-weight:bold;background:#edf3f8}.note{margin-top:12px;font-size:9px;color:#45596b}.source{font-size:8px;max-width:200px}button{margin:12px 0;padding:8px 14px}@media print{button{display:none}}
    </style></head><body><h1>VB-G RAM G</h1><h2>Work Abstract Report</h2>
    <h3>Abstract Details of the Search Work Code</h3>
    <table class="meta"><tr><th>Work Code</th><td>${esc(report.workCode)}</td><th>Financial Year</th><td>${esc(report.financialYear)}</td></tr><tr><th>Work / Description</th><td colspan="3">${esc(report.work)}</td></tr><tr><th>Block</th><td colspan="3">${esc(report.block)}</td></tr></table>
    ${details}
    <h3>Summary — Total Cash Payment by Muster Roll</h3>
    <table class="print-summary-table"><colgroup><col style="width:28%"><col style="width:15%"><col style="width:22%"><col style="width:12%"><col style="width:23%"></colgroup><thead><tr><th>Work Code</th><th>Muster Roll No.</th><th>Wagelist No.</th><th>Total man days</th><th>Total Cash Payment (In Rs.)</th></tr></thead><tbody>${rows}<tr class="total"><th colspan="3">Total</th><th>${esc(report.totalManDays)}</th><th class="numeric">${esc(report.totalCash)}</th></tr></tbody></table>
    <p class="note">Prepared from data extracted by the VB-G RAM G chatbot. Verify all figures against the official portal before using this report as an official record.</p><button onclick="window.print()">Print / Save as PDF</button><script>window.onload=()=>setTimeout(()=>window.print(),300);</script></body></html>`);
  win.document.close();
}

function handle(value,label=value) {
  if(value.startsWith("block:")) {
    addMessage(label,"user");
    const index=Number(value.split(":")[1]);
    if(state.category === "Work") {
      state.selectedIndex=index;
      state.selected=state.results[index] || null;
      state.step="workAbstractConfirm";
      addMessage("Would you like to prepare an abstract for the selected Work Code?");
      showChoices([{value:"abstractYes",label:"1. Yes"},{value:"abstractNo",label:"2. No"}]);
      return;
    }
    detail(index);return;
  }
  addMessage(label,"user");
  if(value==="menu"||value==="restart"){state={step:"category",category:null,keyword:null,year:"current",results:[],selected:null,lastQuery:null};promptCategory();return;}
  if(value==="retry"){if(state.category){askKeyword();}else promptCategory();return;}
  if(state.step==="workAbstractConfirm") {
    if(value==="1" || value==="abstractYes" || /^yes$/i.test(value)) {
      detail(state.selectedIndex); return;
    }
    if(value==="2" || value==="abstractNo" || /^no$/i.test(value)) {
      addMessage("You can select another result or start a new query.");
      state.step="block";
      showResultChoices();
      return;
    }
    addMessage("Please select 1. Yes or 2. No.");
    showChoices([{value:"abstractYes",label:"1. Yes"},{value:"abstractNo",label:"2. No"}]);
    return;
  }
  if(state.step==="category") {
    const idx=Number(value)-1;
    const normalized=String(value).toLowerCase().replace(/[^a-z0-9]/g,"");
    const found=categories.find(c=>c[0]===value)
      || categories[idx]
      || categories.find(c=>c[1].toLowerCase().replace(/[^a-z0-9]/g,"")===normalized)
      || categories.find(c=>c[0].toLowerCase().replace(/[^a-z0-9]/g,"")===normalized)
      || categories.find(c=>normalized && (c[1].toLowerCase().replace(/[^a-z0-9]/g,"").includes(normalized) || c[0].toLowerCase().replace(/[^a-z0-9]/g,"").includes(normalized)));
    if(!found){addMessage("Please select one of the available query types.");showChoices(categories.map(([v,l],i)=>({value:v,label:`${i+1}. ${l}`})));return;}
    state.category=found[0];askKeyword();return;
  }
  if(state.step==="keyword") {
    if(!String(value).trim()){addMessage("Please enter a search value.");return;}
    state.keyword=String(value).trim();
    askYear();
    return;
  }
  if(state.step==="year") {state.year=value==="2"?"previous":value==="previous"?"previous":"current";search();return;}
  if(state.step==="retry") {if(value==="retry")askKeyword();else promptCategory();return;}
  addMessage("Choose a displayed option or start a new query.");
}
form.addEventListener("submit",e=>{e.preventDefault();const value=input.value.trim();if(!value)return;input.value="";handle(value,value);});
document.getElementById("restart").addEventListener("click",()=>handle("menu","Start a new query"));
promptCategory();