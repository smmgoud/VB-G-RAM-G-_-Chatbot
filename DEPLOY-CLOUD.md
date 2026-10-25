# Deploy VB-G RAM G Chatbot to a public HTTPS URL

This project uses Node.js, Express, Playwright, and Chromium. Use a Docker-capable web host; do not deploy it as a static site.

## Option A: Render (Docker)

1. Extract this ZIP. The `Dockerfile`, `package.json`, `server.js`, `scraper.js`, `render.yaml`, and `public/` folder are at the ZIP root. Create a **private GitHub repository** and upload these root contents directly (do not put them inside another nested folder). Do not upload secrets or official records.
2. In Render, choose **New > Blueprint** and connect the repository, or create a **Web Service** using the Docker runtime.
3. Use the root directory containing `Dockerfile`. Render reads `render.yaml` for the service name and health-check path when using a Blueprint.
4. Start deployment. The Docker image installs Node dependencies and Chromium with its system dependencies.
5. Wait for `/api/health` to report healthy. Render assigns an HTTPS URL such as `https://<your-service>.onrender.com`.
6. Open the URL and test several Work Codes, the Excel workbook export, print report, and a slow/failed portal request before sharing the URL.

## Public access setting

The application currently has no login requirement. Anyone who knows the public URL can access the interface and API. A URL is not a security boundary. Before sharing widely, consider adding authentication and rate limiting; this is particularly important because requests can launch browser automation against an external government portal.

## Operational notes

- Use a plan with enough RAM and CPU for Chromium. Browser automation may be slow on low-resource instances.
- Cloud providers may restart or sleep instances depending on plan; first requests after a restart can be slower.
- The portal may rate-limit, block, or change its HTML. Hosting does not guarantee portal availability or correct extraction.
- Do not promise live verification unless the source values are actually reconciled against the official pages.
- Check provider logs when the portal request fails. Avoid logging personal or sensitive information.
- The service uses the host-provided `PORT` environment variable.

## Local Docker test

From this folder:

```bash
docker build -t vbgramg-chatbot .
docker run --rm -p 8080:8080 -e PORT=8080 vbgramg-chatbot
```

Then open `http://localhost:8080` and check `http://localhost:8080/api/health`.
