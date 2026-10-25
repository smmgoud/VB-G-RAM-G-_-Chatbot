const { chromium } = require("playwright");

const SEARCH_URL = "https://vbgramgrep.dord.gov.in/vbgramg/nregasearch1.aspx";
const PORTAL_HOST = "vbgramgrep.dord.gov.in";

const CATEGORIES = {
  Work: "Work",
  Workername: "Workername",
  MusterRoll: "MusterRoll",
  SkilledSemiskilledMusterRoll: "SkilledSemiskilledMusterRoll",
  WageList: "WageList",
  SkilledSemiskilledWageList: "SkilledSemiskilledWageList",
  MaterialList: "MaterialList",
  AdminList: "AdminList",
  FTO: "FTO",
  JobCardNo: "JobCardNo"
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withPage(fn) {
  // Use a normal desktop Chromium profile and browser-like headers. Some ASP.NET
  // portals issue a session cookie on the landing page before accepting the search
  // form. Do not disable portal security or attempt to reuse another user's cookies.
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
  });
  const context = await browser.newContext({
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    extraHTTPHeaders: { "Accept-Language": "en-IN,en;q=0.9" }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.__portalDialogs = [];
  page.__portalErrors = [];
  page.on("dialog", async d => {
    page.__portalDialogs.push({ type: d.type(), message: d.message() });
    await d.accept().catch(() => d.dismiss().catch(() => {}));
  });
  page.on("pageerror", e => page.__portalErrors.push(e.message));
  try {
    return await fn(page);
  } finally {
    await context.close();
    await browser.close();
  }
}

// Open the ASP.NET search form resiliently. The government portal sometimes responds
// slowly or serves an intermediate page to automated Chromium; retry navigation before
// declaring the search form unavailable. Keep the form in the main frame because all
// subsequent selectors and postback handling are scoped to page.locator().
async function openSearch(page) {
  let lastError;
  let lastStatus = null;
  const landingUrl = "https://" + PORTAL_HOST + "/vbgramg/";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Establish the portal's own session/cookies before opening its WebForms search.
      if (attempt === 1) {
        const landingResponse = await page.goto(landingUrl, {
          waitUntil: "domcontentloaded", timeout: 60000
        }).catch(() => null);
        lastStatus = landingResponse ? landingResponse.status() : lastStatus;
      }
      const response = attempt === 1
        ? await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
        : await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      if (response) lastStatus = response.status();

      const responseText = await page.locator("body").innerText().catch(() => "");
      if (lastStatus === 401 || /401\s+Unauthorized|Unauthorized/i.test(responseText.slice(0, 300))) {
        throw new Error(`Official portal returned HTTP 401 Unauthorized (status ${lastStatus}). The portal may be rejecting cloud-hosted requests or require an authorized session.`);
      }
      await page.locator("#ddl_search").waitFor({ state: "attached", timeout: 20000 });
      await page.locator("#ddl_search").waitFor({ state: "visible", timeout: 20000 });
      return;
    } catch (err) {
      lastError = err;
      if (attempt < 3) await sleep(1200 * attempt);
    }
  }
  const diagnostic = await page.evaluate(() => ({
    url: location.href,
    title: document.title || "",
    body: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 700),
    frames: Array.from(document.querySelectorAll("iframe")).map(f => f.src).slice(0, 5)
  })).catch(() => ({ url: page.url(), title: "", body: "Unable to inspect response", frames: [] }));
  throw new Error(`Portal search form #ddl_search did not load after 3 attempts. HTTP status: ${lastStatus ?? "unknown"}. URL: ${diagnostic.url}; title: ${diagnostic.title}; page text: ${diagnostic.body || "(empty)"}; iframe URLs: ${diagnostic.frames.join(" | ") || "none"}. Last error: ${lastError?.message || "unknown error"}`);
}

async function armAspNetAjax(page) {
  await page.waitForFunction(() =>
    !!(window.Sys && window.Sys.WebForms && window.Sys.WebForms.PageRequestManager),
    null, { timeout: 20000 }
  );
  await page.evaluate(() => {
    if (window.__vbPostbackTrackerInstalled) return;
    const prm = window.Sys.WebForms.PageRequestManager.getInstance();
    window.__vbPostbackState = { started: 0, ended: 0, error: "" };
    prm.add_beginRequest(() => { window.__vbPostbackState.started += 1; });
    prm.add_endRequest((_sender, args) => {
      window.__vbPostbackState.ended += 1;
      const err = args && args.get_error && args.get_error();
      if (err) window.__vbPostbackState.error = err.message || String(err);
    });
    window.__vbPostbackTrackerInstalled = true;
  });
}

async function selectAndWaitForPostback(page, selector, value) {
  // The search form uses UpdatePanel async postbacks. Wait for endRequest rather than
  // guessing with a sleep or waiting only for a full-page navigation.
  await armAspNetAjax(page);
  const before = await page.evaluate(() => ({
    started: window.__vbPostbackState.started,
    ended: window.__vbPostbackState.ended
  }));
  const nav = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 18000 }).catch(() => null);
  await page.locator(selector).selectOption(String(value));
  await Promise.race([
    page.waitForFunction(n => {
      const s = window.__vbPostbackState;
      return !!s && s.ended > n;
    }, before.ended, { timeout: 22000 }).catch(() => null),
    nav
  ]);
  // If the event was a full navigation, the new document needs a fresh tracker.
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await armAspNetAjax(page).catch(() => {});
  await page.waitForFunction(({ selector, value }) => {
    const el = document.querySelector(selector);
    return !!el && el.value === String(value);
  }, { selector, value: String(value) }, { timeout: 15000 }).catch(async () => {
    throw new Error(`Portal did not retain ${selector}=${value} after its postback. Current URL: ${page.url()}`);
  });
  const state = await page.evaluate(() => window.__vbPostbackState || null).catch(() => null);
  if (state?.error) throw new Error("Portal ASP.NET postback error: " + state.error);
}

async function selectStateAndWait(page) {
  await selectAndWaitForPostback(page, "#ddl_state", "36");
  await page.waitForFunction(() => {
    const d = document.querySelector("#ddl_district");
    return !!d && [...d.options].some(o => /wanaparthy/i.test(o.textContent || ""));
  }, null, { timeout: 25000 });
}

async function selectCategoryAndWait(page, category) {
  await selectAndWaitForPostback(page, "#ddl_search", CATEGORIES[category] || category);
}

async function readResultRows(page) {
  const parse = () => {
    const clean = el => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
    const tables = [...document.querySelectorAll("table")];
    const directCells = tr => [...tr.children].filter(cell => /^(TH|TD)$/i.test(cell.tagName));
    const headerScore = cells => {
      const text = cells.map(clean).join(" | ").toLowerCase();
      const patterns = [/block name/, /panchayat name/, /work code/, /dpr/, /estimated cost/, /persondays/, /muster roll/, /wage list/, /category amount/, /persons given work/, /measurement book/];
      return patterns.filter(re => re.test(text)).length;
    };
    const candidates = tables.map(table => {
      // Use only cells directly owned by each row/table; nested table rows must not
      // contaminate the header or shift the data columns.
      const trs = [...table.querySelectorAll("tr")].filter(tr => tr.closest("table") === table);
      const rows = trs.map(tr => directCells(tr));
      const headerIndex = rows.reduce((best, cells, i) => {
        const score = headerScore(cells);
        return score > (best.score ?? -1) ? { i, cells, score } : best;
      }, { score: -1 });
      const headerCells = headerIndex.score >= 2 ? headerIndex.cells : null;
      const headerRow = headerCells ? trs[headerIndex.i] : null;
      const payloadRows = trs.filter(tr => [...tr.querySelectorAll("a[href]")].some(a =>
        /payload=|master_search|musternew|wage|fto|jobcard/i.test(a.getAttribute("href") || "")
      ));
      const anyLinkedRows = trs.filter(tr => tr.querySelector("a[href]"));
      const workAbstractScore = rows.reduce((best, cells) => Math.max(best, headerScore(cells)), 0);
      return { table, trs, rows, headerCells, headerRow, payloadRows, anyLinkedRows, workAbstractScore };
    }).filter(x => x.payloadRows.length || (x.headerCells && x.anyLinkedRows.length));

    candidates.sort((a,b) => (b.workAbstractScore * 100) + (b.payloadRows.length * 10) + b.anyLinkedRows.length - ((a.workAbstractScore * 100) + (a.payloadRows.length * 10) + a.anyLinkedRows.length));
    const candidate = candidates[0];
    if (!candidate) return null;
    const headers = (candidate.headerCells || []).map(clean);
    const headerRow = candidate.headerRow;
    const dataTrs = candidate.payloadRows.length ? candidate.payloadRows :
      candidate.anyLinkedRows.filter(tr => tr !== headerRow);
    return dataTrs.map((tr, i) => {
      const cells = [...tr.querySelectorAll("th,td")];
      const values = cells.map(clean);
      const links = [...tr.querySelectorAll("a[href]")].map(a => ({
        text: clean(a),
        href: a.href,
        rawHref: a.getAttribute("href") || ""
      })).filter(l => l.href);
      const get = regex => {
        const ix = headers.findIndex(h => regex.test(h));
        return ix >= 0 ? (values[ix] || "") : "";
      };
      const firstLink = links.find(l => /payload=|musternew|master_search|wage|fto|jobcard/i.test(l.href)) || links[0];
      const block = get(/block/i) || "";
      const work = get(/work code|work name|work details/i) || "";
      const identifier = get(/muster|worker|job.?card|wage.?list|material|fto|number|no\./i) || firstLink?.text || "";
      const status = get(/status/i);
      const dateFrom = get(/date from|start date|from date/i);
      const dateTo = get(/date to|end date|to date/i);
      return {
        sno: get(/s\.?\s*no|serial/i) || values[0] || String(i+1),
        block, work, identifier, status, dateFrom, dateTo,
        headers, cells: values, links, href: firstLink?.href || ""
      };
    }).filter(r => r.cells.some(Boolean) && (r.href || r.block || r.work || r.identifier));
  };
  let rows = await page.evaluate(parse).catch(() => null);
  if (rows?.length) return rows;
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    rows = await frame.evaluate(parse).catch(() => null);
    if (rows?.length) return rows;
  }
  return [];
}

async function searchPortal({ category, keyword, financialYear = "current" }) {
  if (!CATEGORIES[category]) throw new Error("Unsupported search category: " + category);
  const searchValue = String(keyword || "").trim();
  if (!searchValue) throw new Error("Search value is required.");

  return withPage(async page => {
    await openSearch(page);
    await selectCategoryAndWait(page, category);
    await selectStateAndWait(page);

    const districtSelect = page.locator("#ddl_district");
    const districtValue = await districtSelect.locator("option").evaluateAll(opts =>
      opts.find(o => /wanaparthy/i.test(o.textContent || ""))?.value || ""
    );
    if (!districtValue) throw new Error("Portal did not populate Wanaparthy after selecting Telangana.");
    await selectAndWaitForPostback(page, "#ddl_district", districtValue);

    await page.locator("#txt_keyword2").fill(searchValue);

    // These hidden fields are read by the portal's own validate() and server-side search logic.
    await page.evaluate(({ category }) => {
      const selectedText = id => document.querySelector(`#${id} option:checked`)?.textContent?.trim() || "";
      const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
      };
      set("searchname", category);
      set("hhshortname", "TS");
      set("districtname", selectedText("ddl_district"));
      set("statename", selectedText("ddl_state"));
    }, { category });

    const formValues = await page.evaluate(() => ({
      category: document.querySelector("#ddl_search")?.value || "",
      state: document.querySelector("#ddl_state")?.value || "",
      district: document.querySelector("#ddl_district")?.value || "",
      keyword: document.querySelector("#txt_keyword2")?.value || "",
      searchname: document.querySelector("#searchname")?.value || "",
      shortName: document.querySelector("#hhshortname")?.value || "",
      stateName: document.querySelector("#statename")?.value || "",
      districtName: document.querySelector("#districtname")?.value || ""
    }));
    if (formValues.state !== "36" || !formValues.district || !formValues.keyword || !formValues.searchname) {
      throw new Error("Search form was not ready to submit: " + JSON.stringify(formValues));
    }

    // ASP.NET's button onclick invokes validate() and WebForm_DoPostBackWithOptions.
    // A real click is required so the portal receives its normal form fields and viewstate.
    const beforeSubmitUrl = page.url();
    const popupPromise = page.waitForEvent("popup", { timeout: 12000 }).catch(() => null);
    const nav = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
    const beforeAjax = await page.evaluate(() => window.__vbPostbackState?.ended || 0).catch(() => 0);
    await page.locator("#btn_go").click();
    const popupOrNav = await Promise.race([
      popupPromise,
      nav.then(() => null),
      sleep(9000).then(() => null)
    ]);
    const resultPage = popupOrNav && typeof popupOrNav.url === "function" ? popupOrNav : page;
    if (resultPage === page) {
      await Promise.race([
        page.waitForFunction(n => {
          const st = window.__vbPostbackState;
          return !!st && st.ended > n;
        }, beforeAjax, { timeout: 25000 }).catch(() => null),
        sleep(7000)
      ]);
    }
    await resultPage.waitForLoadState("domcontentloaded").catch(() => {});
    await resultPage.waitForTimeout(900);

    // Some portal responses navigate the current tab, some open the result in a new tab,
    // and some render within an UpdatePanel. Inspect all pages in the same authenticated context.
    const pagesToInspect = [...new Set([resultPage, page, ...page.context().pages()])];
    let rows = [];
    let dataPage = resultPage;
    for (const candidate of pagesToInspect) {
      rows = await readResultRows(candidate);
      if (rows.length) { dataPage = candidate; break; }
    }
    const bodyText = await dataPage.locator("body").innerText().catch(() => "");
    if (!rows.length) {
      return {
        category, keyword: searchValue, financialYear, count: 0, results: [],
        message: "The portal search was submitted, but the expected results table was not found.",
        diagnostics: {
          url: dataPage.url(),
          beforeSubmitUrl,
          openPages: await Promise.all(pagesToInspect.map(async p => ({
            url: p.url(), title: await p.title().catch(() => "")
          }))),
          title: await dataPage.title().catch(() => ""),
          submitted: formValues,
          hiddenPayloadFields: await page.locator("input[type=hidden]").evaluateAll(els => els.map(e => ({ name: e.name, id: e.id, length: (e.value || "").length }))).catch(() => []),
          dialogs: page.__portalDialogs,
          pageErrors: page.__portalErrors,
          pageText: bodyText.slice(0, 2500)
        }
      };
    }

    // The portal result page offers a financial-year selector. Select the requested prior FY if present.
    if (financialYear && financialYear !== "current") {
      const yearSelect = dataPage.locator("#ddl_yr");
      if (await yearSelect.count()) {
        const values = await yearSelect.locator("option").evaluateAll(opts => opts.map(o => o.value));
        const currentValue = await yearSelect.inputValue().catch(() => "");
        const currentStart = Number((currentValue.match(/\d{4}/) || ["0"])[0]);
        const desired = values.find(v => /^\d{4}-\d{4}$/.test(v) && Number(v.slice(0, 4)) === currentStart - 1);
        if (desired) {
          await yearSelect.selectOption(desired);
          await dataPage.waitForFunction(() => {
            const prm = window.Sys?.WebForms?.PageRequestManager?.getInstance?.();
            return !prm || !prm.get_isInAsyncPostBack();
          }, null, { timeout: 15000 }).catch(() => {});
          await dataPage.waitForTimeout(500);
          rows = await readResultRows(dataPage);
        }
      }
    }

    return {
      category, keyword: searchValue,
      financialYear: await dataPage.locator("#ddl_yr").inputValue().catch(() => financialYear),
      count: rows.length, results: rows,
      message: `Found ${rows.length} result(s) in the official portal.`
    };
  });
}

async function getDetail(href) {
  const url = new URL(href, SEARCH_URL);
  if (url.hostname !== PORTAL_HOST || !url.pathname.toLowerCase().startsWith("/vbgramg/")) {
    throw new Error("Rejected a result link outside the official VB-G RAM G portal.");
  }
  return withPage(async page => {
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(900);
    const detail = await page.evaluate(() => {
      const clean = el => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
      // Extract each table independently. A table's querySelectorAll("tr") also
      // returns rows belonging to nested tables, which corrupts the column count.
      // Keep only rows owned by this table, and remove nested tables from a cell's
      // text because those nested tables are emitted as their own structured tables.
      const tables = [...document.querySelectorAll("table")].map(table => {
        const rows = [...table.querySelectorAll("tr")]
          .filter(tr => tr.closest("table") === table)
          .map(tr => [...tr.children]
            .filter(cell => /^(TH|TD)$/i.test(cell.tagName))
            .map(cell => {
              const clone = cell.cloneNode(true);
              // A nested table is extracted as its own table. Keeping its text in
              // the parent cell duplicates labels and breaks the parent columns.
              clone.querySelectorAll("table").forEach(nested => nested.remove());
              // Some portal labels (notably Work Status and section headings) are
              // nested inside a small table. Preserve those labels when removing
              // nested tables leaves the outer cell empty. Do NOT flatten a nested
              // data table (e.g. Expenditure Incurred) into one long text cell;
              // its own table is extracted separately below with proper columns.
              const ownText = clean(clone);
              const nestedText = clean(cell);
              const isNestedLabel = /^(Work Status|Scope of Work|Expenditure Incurred\s*\(in Rs\.\)|Employment Generated)$/i.test(nestedText);
              return {
                text: ownText || (cell.querySelector('table') && !isNestedLabel ? '' : nestedText),
                colSpan: Math.max(1, Number(cell.colSpan) || 1),
                rowSpan: Math.max(1, Number(cell.rowSpan) || 1),
                tag: cell.tagName.toLowerCase()
              };
            }))
          .filter(row => {
            if (!row.some(cell => cell.text)) return false;
            const rowText = row.map(cell => cell.text).join(" ").replace(/\s+/g, " ").trim();
            if (/NOTE:\s*Rows Highlighted By Yellow Color indicates attendance has been taken from Mobile Devices/i.test(rowText)) return false;
            if (/^Mustroll Detail$/i.test(rowText)) return false;
            return true;
          });
        if (!rows.length) return null;
        const directText = rows.flat().map(cell => cell.text).join(" ").replace(/\s+/g, " ").trim();
        // Do not render the portal's decorative masthead/date/navigation tables
        // as chatbot data tables. The useful record content starts at the State,
        // District, Block/Panchayat or Work Name sections.
        if (/Govt\.? of India/i.test(directText) && /Ministry of Rural Development/i.test(directText)) return null;
        if (/Viksit Bharat\s*[–—-]\s*Guarantee for Rozgar/i.test(directText) && rows.length <= 3) return null;
        if (/^Back\s*$/i.test(directText) || (/\bBack\b/i.test(directText) && rows.length === 1 && rows.flat().length <= 2)) return null;
        if (/Tuesday,\s*October\s+\d{1,2},\s+\d{4}/i.test(directText) && rows.length <= 3) return null;
        // Discard tiny layout-only tables with no meaningful record fields.
        const meaningful = /State\s*:\s*TELANGANA|District\s*:|Block\s*:|Panchayat\s*:|Work Name|Work Status|Expenditure Incurred|Employment Generated|Unskilled|Semi[- ]Skilled|Persondays|Total No\. of Persons Given Work|Contingency|Muster Roll|Job Card|Head of Household|Registration No/i.test(directText);
        if (!meaningful && rows.length <= 3 && directText.length < 180) return null;
        return rows;
      }).filter(Boolean);
      const headings = [...document.querySelectorAll("h1,h2,h3,h4,caption")].map(e => clean(e)).filter(Boolean);
      const links = [...document.querySelectorAll("a[href]")].map(a => ({
        text: clean(a) || "Open portal link",
        href: a.href,
        rawHref: a.getAttribute("href") || "",
        kind: /^https?:/i.test(a.href) ? "link" : "postback"
      })).filter(l => l.text && l.href);
      // On Work details, muster-roll numbers are hyperlinks inside the row
      // labelled "Distinct Number of Muster Rolls used (Amount)". Keep these
      // separate from decorative/header/navigation links.
      const musterRollLinks = [...document.querySelectorAll("tr")]
        .filter(tr => /Distinct Number of Muster Rolls used/i.test(clean(tr)))
        .flatMap(tr => [...tr.querySelectorAll("a[href]")].map(a => ({
          text: clean(a), href: a.href
        })))
        .filter(l => /^\d+$/.test(l.text) && /^https?:/i.test(l.href) && /vbgramgrep\.dord\.gov\.in/i.test(l.href));
      const actions = [...document.querySelectorAll("input[type=button],input[type=submit],button")].map(el => ({
        text: clean(el) || el.value || "Portal action",
        action: el.getAttribute("onclick") || "",
        name: el.name || "",
        id: el.id || "",
        kind: "button"
      })).filter(a => a.text);
      const bodyText = clean(document.body);
      // Job card details are rendered in a banner above the household table, not as table cells.
      // Extract them separately so the chatbot doesn't omit important deleted-card warnings.
      const cardMatch = bodyText.match(/GRAMIN\s+ROZGAR\s+GUARANTEE\s+CARD\s+NUMBER\s*[:：-]?\s*([A-Z]{2}-[A-Z0-9-]+\/[A-Z0-9-]+)/i)
        || bodyText.match(/([A-Z]{2}-\d{2}-\d{3}-\d{3}-\d{3}\/\d+)/i);
      const deletedMatch = bodyText.match(/Deleted\s+on\s+Date\s*[:：-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i);
      const deletedFlag = /\bdeleted\b/i.test(bodyText) && /job card|gramin rozgar guarantee card/i.test(bodyText);
      return {
        title: document.title || "VB-G RAM G Detail",
        headings, tables, links, musterRollLinks, actions,
        jobCardNumber: cardMatch ? cardMatch[1] : "",
        jobCardStatus: deletedMatch || deletedFlag ? "Deleted" : "",
        jobCardDeletedDate: deletedMatch ? deletedMatch[1] : "",
        pageText: bodyText.slice(0, 12000),
        url: location.href
      };
    });

    // Automatically follow each Muster Roll number from a Work detail page and
    // extract its official attendance/payment table in this same browser context.
    // Keeping one context matters because the portal may rely on session payloads.
    detail.musterRollDetails = [];
    for (const rollLink of (detail.musterRollLinks || []).slice(0, 25)) {
      try {
        await page.goto(rollLink.href, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(350);
        const rollData = await page.evaluate(() => {
          const clean = el => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
          const headings = [...document.querySelectorAll("h1,h2,h3,h4,caption")].map(clean).filter(Boolean);
          const title = document.title || "Muster Roll Detail";
          const extracted = [...document.querySelectorAll("table")].map(table => {
            const rows = [...table.querySelectorAll("tr")]
              .filter(tr => tr.closest("table") === table)
              .map(tr => [...tr.children].filter(cell => /^(TH|TD)$/i.test(cell.tagName)).map(cell => {
                const clone = cell.cloneNode(true);
                clone.querySelectorAll("table").forEach(nested => nested.remove());
                return { text: clean(clone), colSpan: Math.max(1, Number(cell.colSpan)||1), rowSpan: Math.max(1, Number(cell.rowSpan)||1), tag: cell.tagName.toLowerCase() };
              })).filter(row => {
                if (!row.some(cell => cell.text)) return false;
                const rowText = row.map(cell => cell.text).join(" ").replace(/\s+/g, " ").trim();
                if (/NOTE:\s*Rows Highlighted By Yellow Color indicates attendance has been taken from Mobile Devices/i.test(rowText)) return false;
                if (/^Mustroll Detail$/i.test(rowText)) return false;
                return true;
              });
            const text = rows.flat().map(c => c.text).join(" ");
            if (!rows.length || rows.length < 2 || text.length < 40) return null;
            if (/Govt\.? of India/i.test(text) && /Ministry of Rural Development/i.test(text)) return null;
            if (/^Back\s*$/i.test(text)) return null;
            return rows;
          }).filter(Boolean);
          // Capture the official "Total Cash payment (In Rs.)" section.
          const cashPaymentRows = [];
          for (const table of [...document.querySelectorAll("table")]) {
            const ownedRows = [...table.querySelectorAll("tr")].filter(tr => tr.closest("table") === table);
            for (let i = 0; i < ownedRows.length; i++) {
              const cells = [...ownedRows[i].children].filter(cell => /^(TH|TD)$/i.test(cell.tagName));
              const row = cells.map(cell => clean(cell));
              const joined = row.join(" | ");
              if (/total\s*cash\s*payment\s*\(?\s*in\s*rs\.?\s*\)?/i.test(joined)) {
                const following = ownedRows[i + 1]
                  ? [...ownedRows[i + 1].children].filter(cell => /^(TH|TD)$/i.test(cell.tagName)).map(cell => clean(cell))
                  : [];
                cashPaymentRows.push({ labelRow: row, valueRow: following });
              }
            }
          }
          let cashPayment = "";
          for (const item of cashPaymentRows) {
            const combined = [...item.labelRow, ...item.valueRow].filter(Boolean);
            const cashIndex = combined.findIndex(v => /^cash$/i.test(v));
            if (cashIndex >= 0 && combined[cashIndex + 1] && /[0-9]/.test(combined[cashIndex + 1])) {
              cashPayment = combined[cashIndex + 1]; break;
            }
            const amountCandidate = [...item.valueRow, ...item.labelRow].reverse().find(v => /^(?:₹|Rs\.?\s*)?[\d,]+(?:\.\d{1,2})?$/.test(v.trim()));
            if (amountCandidate) { cashPayment = amountCandidate; break; }
          }
          const pageBodyText = clean(document.body);
          let wagelistNumber = "";
          const isRealWagelist = value => {
            const v = String(value || "").replace(/^[:#-]\s*/, "").trim();
            return !!v && !/^(status|wage\s*list\s*no\.?|wagelist\s*no\.?|no\.?|—|-|n\/a|na)$/i.test(v)
              && /^\d{7,}[A-Z]{0,4}\d*$/i.test(v) && v.length < 100;
          };
          // On the official Muster Roll grid, Wagelist No. is a column header;
          // the actual value (e.g. 3643003WL019569) is in the worker's row.
          // Find the column by its header and read values from that same column.
          for (const table of [...document.querySelectorAll("table")]) {
            const trs = [...table.querySelectorAll("tr")].filter(tr => tr.closest("table") === table);
            for (let i = 0; i < trs.length; i++) {
              const cells = [...trs[i].children].filter(cell => /^(TH|TD)$/i.test(cell.tagName));
              const headers = cells.map(clean);
              const wageIndex = headers.findIndex(v => /^(?:wage\s*list|wagelist)\s*no\.?$/i.test(v));
              if (wageIndex < 0) continue;
              for (let j = i + 1; j < trs.length; j++) {
                const dataCells = [...trs[j].children].filter(cell => /^(TH|TD)$/i.test(cell.tagName));
                if (dataCells[wageIndex]) {
                  const linked = [...dataCells[wageIndex].querySelectorAll("a[href]")].map(a => clean(a));
                  const candidates = [...linked, clean(dataCells[wageIndex])];
                  const found = candidates.find(isRealWagelist);
                  if (found) { wagelistNumber = found; break; }
                }
              }
              if (wagelistNumber) break;
            }
            if (wagelistNumber) break;
          }
          // Fallback for markup where the header/value column is represented as label/value rows.
          if (!wagelistNumber) {
            for (const table of [...document.querySelectorAll("table")]) {
              const trs = [...table.querySelectorAll("tr")].filter(tr => tr.closest("table") === table);
              for (let i = 0; i < trs.length; i++) {
                const cells = [...trs[i].children].filter(cell => /^(TH|TD)$/i.test(cell.tagName));
                if (!cells.some(cell => /^(?:wage\s*list|wagelist)\s*no\.?$/i.test(clean(cell)))) continue;
                for (const tr of trs.slice(i + 1, i + 3)) {
                  const vals = [...tr.querySelectorAll("a[href]")].map(a => clean(a));
                  const found = vals.find(isRealWagelist);
                  if (found) { wagelistNumber = found; break; }
                }
                if (wagelistNumber) break;
              }
              if (wagelistNumber) break;
            }
          }
          const mandaysMatch = pageBodyText.match(/Total\s*man\s*days\s*[:：]?\s*([\d,]+(?:\.\d+)?)/i);
          const totalManDays = mandaysMatch ? mandaysMatch[1].replace(/,/g, "") : "";
          return { title, headings, tables: extracted, cashPaymentRows, cashPayment, wagelistNumber, totalManDays,
            pageText: pageBodyText.slice(0, 8000), url: location.href };
        });
        // Live-source verification: validate the extracted fields against the official
        // Muster Roll page response itself. Missing values are flagged, never guessed.
        const cashNumeric = String(rollData.cashPayment || "").replace(/,/g, "").replace(/₹|Rs\.?/gi, "").trim();
        const cashValid = /^\d+(?:\.\d{1,2})?$/.test(cashNumeric);
        const wageValid = /^\d{7,}[A-Z]{0,4}\d*$/i.test(String(rollData.wagelistNumber || "").trim());
        const daysValid = /^\d+(?:\.\d+)?$/.test(String(rollData.totalManDays || "").trim());
        rollData.liveVerification = {
          checkedAt: new Date().toISOString(),
          source: rollData.url || rollLink.href,
          wagelist: { value: rollData.wagelistNumber || "", status: wageValid ? "FOUND_ON_OFFICIAL_PAGE" : "NOT_FOUND_OR_INVALID" },
          cashPayment: { value: rollData.cashPayment || "", status: cashValid ? "FOUND_ON_OFFICIAL_PAGE" : "NOT_FOUND_OR_INVALID" },
          totalManDays: { value: rollData.totalManDays || "", status: daysValid ? "FOUND_ON_OFFICIAL_PAGE" : "NOT_FOUND_OR_INVALID" },
          status: wageValid && cashValid && daysValid ? "FIELDS_FOUND" : "REVIEW_REQUIRED"
        };
        detail.musterRollDetails.push({ number: rollLink.text, ...rollData });
      } catch (error) {
        detail.musterRollDetails.push({ number: rollLink.text, title: "Muster Roll Detail", tables: [], error: error.message, url: rollLink.href });
      }
    }
    return detail;
  });
}

module.exports = { searchPortal, getDetail };
