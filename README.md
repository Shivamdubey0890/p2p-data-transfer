# P2P Data Transfer

A production-ready web application for **direct device-to-device data transfer**. The central
server (M1) handles login, device registry, and WebRTC signaling — and *nothing else*. Files,
messages, and JSON payloads travel **directly between browsers** over encrypted WebRTC
DataChannels, exactly like AnyDesk / LocalSend.

```
                         Internet
                            │
                       ┌────┴────┐
                       │   M1    │   Express + Socket.IO
                       │ server  │   auth · presence · signaling
                       └─┬──┬──┬─┘   (SDP/ICE only, ≤64 KB messages)
              signaling  │  │  │  signaling
            ┌────────────┘  │  └────────────┐
            │               │               │
        ┌───┴───┐       ┌───┴───┐       ┌───┴───┐
        │  D1   │       │  D2   │       │  D3   │
        └───┬───┘       └───┬───┘       └───────┘
            │               │
            └═══════════════┘
             WebRTC DataChannel (DTLS-encrypted)
             files · text · JSON — never touches M1
```

## Why M1 physically cannot relay files

- Socket.IO messages are capped at **64 KB** (`maxHttpBufferSize`) — enough for SDP, useless for payloads.
- The REST body limit is **64 KB** (`express.json({ limit: '64kb' })`).
- There is no upload endpoint, no file storage, no buffering code path on the server at all.
- If direct NAT traversal fails, an optional **TURN** relay forwards *encrypted* DTLS packets
  without ever terminating the encryption — it can't read or store the data either.

## Feature checklist

- ✅ Zero-friction access: anonymous device registration with device-scoped JWTs (optional signup/login endpoints remain for account-based deployments)
- ✅ Live device discovery (online/offline presence via Socket.IO)
- ✅ Connection permission flow: server-side validation **and** receiver consent dialog
- ✅ Direct messaging over the DataChannel: text, JSON, binary
- ✅ File transfer with drag & drop, progress, speed, ETA, **pause / resume / cancel / retry**
- ✅ 10 GB+ files: configurable chunking (256 KiB default), `bufferedAmount` backpressure,
  streaming disk writes via the File System Access API (Chromium) with in-memory Blob fallback
- ✅ Reconnection: Socket.IO auto-reconnect + ICE restart on peer connection drops
- ✅ Transfer history (metadata only) on the dashboard
- ✅ Every device is both sender and receiver — no fixed roles
- ✅ Docker + docker-compose production deployment, pluggable TURN

## Repository layout

```
/shared            Wire protocol shared by client & server (single source of truth)
  protocol.ts      REST DTOs · Socket.IO events · DataChannel messages · chunk framing
/server            M1 — Node.js + Express + Socket.IO (TypeScript)
  src/config       Env parsing, ICE server config (STUN/TURN)
  src/domain       Entities
  src/repositories Repository interfaces + in-memory impls (swap for Postgres)
  src/services     AuthService · DeviceService · HistoryService
  src/http         REST routes, JWT middleware, error handling
  src/socket       SignalingGateway (presence + SDP/ICE forwarding)
  src/container.ts Composition root (DI)
/client            React 18 + TypeScript + Material UI + Vite
  src/p2p          The P2P engine: P2PManager · PeerSession · FileSender · FileReceiver
  src/services     REST client
  src/hooks        React bindings for the P2P engine
  src/context      Auth/session provider
  src/components   DeviceList · DropZone · TransferList · PeerPanel · HistoryTable
  src/pages        Login · Dashboard
/docs              Architecture, sequence diagrams, API reference, DB schema
```

## Quick start (development)

```bash
npm run install:all        # installs server + client deps

# terminal 1 — signaling server on :4000
npm run dev:server

# terminal 2 — client on :5173
npm run dev:client
```

Open http://localhost:5173 in **two browser windows** (or two machines on the LAN pointing at
your dev host). No login — each tab auto-registers as a device with a generated name. Then:
select the other device → **Connect** → accept on the other side → drag a file in.

> Chromium-based browsers stream received files straight to disk (you pick the location when
> accepting). Firefox/Safari fall back to an in-memory download — fine for anything that fits in RAM.

## Production deployment (Docker)

```bash
cp .env.example .env       # set JWT_SECRET, CORS_ORIGIN, PUBLIC_SERVER_URL
docker compose up -d --build
```

- Client: http://localhost:8080 · Server: http://localhost:4000
- Put both behind a TLS reverse proxy (Caddy/Traefik/nginx). **HTTPS is required** for
  WebRTC + the File System Access API on non-localhost origins.
- Set `CORS_ORIGIN` to the exact public client origin and `PUBLIC_SERVER_URL` to the public
  server URL (it is baked into the client build).

### Enabling TURN fallback

1. Uncomment the `coturn` service in `docker-compose.yml` (or use a managed TURN provider).
2. Set `TURN_URL=turn:<public-ip>:3478`, `TURN_USERNAME`, `TURN_PASSWORD` in `.env`.
3. Restart. M1 hands the TURN server to clients in `POST /api/connect`; browsers use it
   automatically when direct ICE fails. Relayed traffic stays DTLS-encrypted end-to-end.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — components, sequence diagrams, transfer protocol, future features
- [docs/API.md](docs/API.md) — REST + Socket.IO + DataChannel reference
- [docs/DATABASE.md](docs/DATABASE.md) — schema (SQL) and the repository swap path

## Security model

| Layer | Mechanism |
|---|---|
| REST API | JWT (user tokens), bcrypt-hashed passwords, helmet, CORS allow-list |
| Socket handshake | Device-scoped JWT verified before any signaling |
| Signaling | Sender identity enforced server-side (spoofed `fromDeviceId` rejected), permission check per message |
| Peer connection | Receiver must explicitly accept; per-file consent dialog |
| Data in transit | WebRTC mandatory DTLS 1.2+ / SCTP over DTLS (AES) — browser-native |
