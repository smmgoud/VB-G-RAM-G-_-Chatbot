# VB-G RAM G Chatbot — Final Workbook Version

This build preserves the existing search and Work Abstract workflow and includes the Excel workbook export with these worksheets:

1. Work Abstract
2. Muster Roll Summary
3. Data Quality Checks
4. Summary Dashboard
5. Reconciliation

The Reconciliation worksheet shows the calculated Muster Roll cash-payment and man-days totals. It only reports a MATCH/MISMATCH when a comparable official total is explicitly supplied in the export request (`officialTotals.cashPayment` and/or `officialTotals.mandays`). It does not treat total expenditure as equivalent to Muster Roll cash payments. If official comparable totals are unavailable, it clearly flags manual review instead of claiming independent verification.

## Run

```bat
npm.cmd install
npx.cmd playwright install chromium
npm.cmd start
```

Open `http://localhost:8080`.

## Important

The workbook totals use successfully extracted numeric values; missing or invalid values are excluded and should be reviewed in Data Quality Checks. Automated format checks do not independently verify records against the live official portal. Confirm the exported figures against the official portal before using them for official reporting.
