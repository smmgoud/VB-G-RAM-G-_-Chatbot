# Portal HTTP 401 troubleshooting

This build makes the portal scraper establish a normal session by visiting the portal landing page before opening the search form, sends a desktop browser user-agent/language header, retries the same URL without adding a synthetic query parameter, and reports HTTP 401 clearly in diagnostics.

## Important limitation
A successful health check confirms only that the chatbot server is running. It does not confirm that the external government portal accepts requests from the cloud host. If the portal continues returning HTTP 401 after redeployment, the portal or its hosting/security layer may be refusing cloud-hosted traffic or may require a session/authorization that cannot be created automatically. Do not attempt to bypass access controls. Verify the portal's terms and ask the portal administrator for an approved API or access method if necessary.

## Redeploy
1. Replace the files in the same GitHub repository with the contents of this ZIP (upload/commit the updated files, including `scraper.js`).
2. Ensure `Dockerfile`, `server.js`, `scraper.js`, `package.json`, and `public/` are at repository root.
3. In Render, open the existing service and choose **Manual Deploy > Deploy latest commit** (or wait for Auto Deploy).
4. After deployment, open the chatbot and retry one search.
5. If the search still fails, open Render > your service > Logs and copy the `Portal search form ... HTTP status ...` error. The message helps distinguish HTTP 401 from a changed page structure.
