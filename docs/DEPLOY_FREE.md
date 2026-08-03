# Free Global Deployment (Render + Vercel)

Total cost: **$0**. Both platforms give real HTTPS automatically, so disk-streaming
(unlimited file size) works everywhere, and WebRTC is happy.

```
Browser A ──┐                          ┌── Browser B
            │  https (signaling only)  │
            └──► Render: M1 server ◄───┘
            files: A ═══ direct WebRTC ═══ B
            (TURN relay only if both NATs are strict — still encrypted)
```

## Step 1 — Push to GitHub

The repo is already committed locally. Create an empty repo on github.com, then:

```bash
git remote add origin https://github.com/<you>/p2p-data-transfer.git
git push -u origin main
```

## Step 2 — Server on Render (free)

1. Sign up at https://render.com with your GitHub account.
2. **New → Blueprint** → select your repo. Render reads `render.yaml` and creates
   the service automatically (JWT secret is auto-generated).
3. Wait for the deploy, then note your URL, e.g. `https://p2p-transfer-server.onrender.com`.
4. Check it works: open `https://<your-server>.onrender.com/api/health` → `{"status":"ok"}`.

> Free-tier note: the server sleeps after ~15 min of inactivity; the first visit
> after that takes ~50 s to wake. Transfers already in progress are unaffected
> (they don't go through the server).

## Step 3 — Client on Vercel (free)

1. Sign up at https://vercel.com with GitHub.
2. **Add New → Project** → import the repo. `vercel.json` already sets the build.
3. Before deploying, add an **Environment Variable**:
   - `VITE_SERVER_URL` = `https://<your-server>.onrender.com`
4. Deploy → you get `https://<your-app>.vercel.app`.

## Step 4 — Point the server at the client

1. In Render → your service → **Environment** → set
   `CORS_ORIGIN` = `https://<your-app>.vercel.app` (exact URL, no trailing slash).
2. Save — Render redeploys automatically.

## Done

Open `https://<your-app>.vercel.app` on any two devices anywhere in the world —
they appear in each other's device list and transfer directly. The TURN relay
(Open Relay, free) kicks in automatically only when a direct path is impossible.

## Alternatives (also free)

- **Client:** Netlify / Cloudflare Pages / GitHub Pages (same build: `client/dist`).
- **Server:** Koyeb free, or an always-free Oracle Cloud VM with `docker compose up`
  (no sleep, needs a domain + Caddy for HTTPS).
- **TURN:** metered.ca free plan (500 MB/mo relayed) or Cloudflare TURN if Open
  Relay is slow — set the three `TURN_*` env vars on Render.
