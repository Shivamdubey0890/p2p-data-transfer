# API Reference

Base URL: `http://<server>:4000/api`. All bodies are JSON. Errors return
`{ "error": string }` with an appropriate HTTP status.

Access is **anonymous**: opening the app registers the browser as a device via
`POST /register-device` (no account needed). The returned **device token**
(`Authorization: Bearer <token>`) is required for the Socket.IO handshake and all
peer-related endpoints. `POST /signup` / `POST /login` still exist (user tokens) for
deployments that want to re-enable accounts, but the UI does not use them.

## REST endpoints

### `GET /health`
Liveness probe. → `200 { status: "ok", uptime }`

### `POST /signup`
`{ username, password }` → `201 { user }`
Username 3–32 chars (`[a-zA-Z0-9_.-]`), password ≥ 8 chars. `409` if taken.

### `POST /login`
`{ username, password }` → `200 { token, user }` · `401` on bad credentials.

### `POST /register-device`
`{ name, platform }` → `201 { device, deviceToken }`
Anonymous. Registers this browser/machine as a device and returns its device-scoped JWT.

### `GET /devices` 🔒 device token
→ `200 { devices: DeviceDTO[] }` — all currently online devices.

### `POST /connect` 🔒 device token
`{ toDeviceId }` → `200 { ok: true, iceServers: RTCIceServer[] }`
Permission gate before opening a peer connection. Validates both devices are online and
allowed to pair, then returns the ICE configuration (STUN + TURN if configured).
`403/404` when not permitted / target offline.

### `POST /disconnect` 🔒 device token
`{ toDeviceId }` → `200 { ok: true }` — notifies the peer via `peer-disconnected`.

### `POST /history` 🔒 device token
Transfer **metadata** report (sender-side, never file content):
`{ fromDeviceId, fromDeviceName, toDeviceId, toDeviceName, fileName, fileSize, status, startedAt }`
→ `201 { id }`. `403` unless the reporting device is a participant.

### `GET /history` 🔒 device token
→ `200 { history: TransferHistoryDTO[] }` — records involving this device, newest first.

## Socket.IO events

Handshake: `io(SERVER_URL, { auth: { token: <deviceToken> } })` — rejected without a valid
device JWT. Messages are capped at 64 KB.

### Server → client

| Event | Payload | Meaning |
|---|---|---|
| `device-list` | `{ devices }` | Full online list, sent on connect |
| `device-online` | `DeviceDTO` | A device came online |
| `device-offline` | `{ deviceId }` | A device went offline |
| `signaling-error` | `{ code, message, targetDeviceId? }` | Forwarding rejected (`TARGET_OFFLINE`, `INVALID_PAYLOAD`, …) |

### Forwarded peer-to-peer (via M1)

All carry `fromDeviceId` + `toDeviceId`; the server verifies `fromDeviceId` matches the
authenticated socket and re-checks connect permission before forwarding.

| Event | Extra payload | Direction of use |
|---|---|---|
| `connect-request` | `fromDeviceName` | Initiator asks responder for consent |
| `connect-response` | `accepted, reason?` | Responder's decision |
| `offer` / `answer` | `sdp` | WebRTC session negotiation |
| `ice-candidate` | `candidate` | ICE trickle |
| `peer-connected` / `peer-disconnected` | — | Lifecycle notifications |

## DataChannel protocol (peer ↔ peer, never via M1)

One reliable/ordered channel `data` carries JSON strings (control) and binary frames (chunks).

Control messages (`shared/protocol.ts` → `ChannelMessage`):

| Type | Fields | Purpose |
|---|---|---|
| `file-offer` | `transferId, key, fileName, fileSize, mimeType, chunkSize, totalChunks` | Propose a transfer |
| `file-accept` | `transferId, resumeFrom` | Accept (resumeFrom > 0 ⇒ resume) |
| `file-reject` | `transferId, reason` | Decline |
| `pause` / `resume` / `cancel` | `transferId` | Flow control, either side |
| `cancel-all` | — | Kills every active + queued transfer on the session, both sides |
| `chunk-ack` | `transferId, receivedBytes` | Receiver progress (every 32 chunks) |
| `file-complete` | `transferId` | Receiver confirms all bytes persisted |
| `text` | `id, body, sentAt` | Direct text message |
| `json` | `id, payload, sentAt` | Arbitrary structured data |

Binary frame layout (little-endian):

```
byte 0..3   uint32 transferKey   (from file-offer)
byte 4..7   uint32 chunkIndex
byte 8..    chunk payload (≤ chunkSize)
```
