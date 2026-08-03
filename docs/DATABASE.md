# Database Schema

The server ships with in-memory repositories (single-node signaling needs no persistence —
device presence is inherently ephemeral). For durable users/history, implement the
repository interfaces in `server/src/repositories/interfaces.ts` against this schema and
swap them in `server/src/container.ts`. Nothing else changes.

```sql
CREATE TABLE users (
    id            UUID PRIMARY KEY,
    username      VARCHAR(32) NOT NULL UNIQUE,
    password_hash VARCHAR(72) NOT NULL,          -- bcrypt
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
    id           UUID PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         VARCHAR(64) NOT NULL,
    platform     VARCHAR(32) NOT NULL,
    status       VARCHAR(10) NOT NULL DEFAULT 'offline'
                 CHECK (status IN ('online', 'busy', 'offline')),
    ip           INET,                            -- observed at socket handshake (optional)
    socket_id    VARCHAR(40),                     -- current Socket.IO connection
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_devices_user   ON devices(user_id);
CREATE INDEX idx_devices_status ON devices(status);

-- Metadata only. File content NEVER reaches the server.
CREATE TABLE transfer_history (
    id               UUID PRIMARY KEY,
    from_device_id   UUID NOT NULL,
    from_device_name VARCHAR(64) NOT NULL,        -- denormalized: survives device deletion
    to_device_id     UUID NOT NULL,
    to_device_name   VARCHAR(64) NOT NULL,
    file_name        VARCHAR(255) NOT NULL,
    file_size        BIGINT NOT NULL,
    status           VARCHAR(10) NOT NULL
                     CHECK (status IN ('completed', 'cancelled', 'failed')),
    started_at       TIMESTAMPTZ NOT NULL,
    finished_at      TIMESTAMPTZ
);
CREATE INDEX idx_history_from ON transfer_history(from_device_id, started_at DESC);
CREATE INDEX idx_history_to   ON transfer_history(to_device_id, started_at DESC);
```

Scaling note: to run multiple M1 replicas, move presence (`devices.status`, `socket_id`)
to Redis and add the Socket.IO Redis adapter so signaling messages route across nodes.
