import {
  Box,
  Button,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import SendIcon from '@mui/icons-material/Send';
import DataObjectIcon from '@mui/icons-material/DataObject';
import { useState } from 'react';
import { DeviceDTO, JsonMessage, TextMessage } from '@shared/protocol';
import { ChatMessage, PeerConnectionState } from '../p2p/types';
import { DropZone } from './DropZone';

interface Props {
  device: DeviceDTO;
  state: PeerConnectionState;
  signalingUp: boolean;
  trusted: boolean;
  messages: ChatMessage[];
  onConnect(): void;
  onDisconnect(): void;
  onUntrust(): void;
  onSendFiles(files: File[]): void;
  onSendText(text: string): void;
  onSendJson(json: unknown): void;
}

function renderBody(message: TextMessage | JsonMessage): string {
  return message.type === 'text' ? message.body : JSON.stringify(message.payload);
}

export function PeerPanel({
  device,
  state,
  signalingUp,
  trusted,
  messages,
  onConnect,
  onDisconnect,
  onUntrust,
  onSendFiles,
  onSendText,
  onSendJson,
}: Props) {
  const [draft, setDraft] = useState('');
  const connected = state === 'connected';

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    // Heuristic: content that parses as JSON object/array is sent as JSON.
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === 'object') {
        onSendJson(parsed);
        setDraft('');
        return;
      }
    } catch {
      /* plain text */
    }
    onSendText(text);
    setDraft('');
  };

  return (
    <Stack spacing={2} sx={{ height: '100%' }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          {device.name}
        </Typography>
        {trusted && (
          <Tooltip title="Forget this device: auto-connect stops and its next connection request will need your approval again">
            <Button startIcon={<PersonRemoveIcon />} color="error" size="small" onClick={onUntrust}>
              Forget
            </Button>
          </Tooltip>
        )}
        {connected ? (
          <Button startIcon={<LinkOffIcon />} color="warning" onClick={onDisconnect}>
            Disconnect
          </Button>
        ) : (
          <Button
            startIcon={<LinkIcon />}
            variant="contained"
            onClick={onConnect}
            disabled={!signalingUp || state === 'requesting' || state === 'connecting'}
          >
            {!signalingUp
              ? 'Waiting for server…'
              : state === 'requesting'
                ? 'Waiting…'
                : state === 'connecting'
                  ? 'Connecting…'
                  : 'Connect'}
          </Button>
        )}
      </Stack>

      <DropZone disabled={!connected} onFiles={onSendFiles} />

      <Divider>
        <Typography variant="caption" color="text.secondary">
          Direct messages (P2P)
        </Typography>
      </Divider>

      <Paper variant="outlined" sx={{ flex: 1, minHeight: 120, maxHeight: 240, overflowY: 'auto', p: 1 }}>
        {messages.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
            Messages travel over the encrypted data channel — never through the server.
          </Typography>
        ) : (
          messages.map((m) => (
            <Box
              key={m.message.id}
              sx={{
                display: 'flex',
                justifyContent: m.direction === 'out' ? 'flex-end' : 'flex-start',
                mb: 0.5,
              }}
            >
              <Paper
                sx={{
                  px: 1.5,
                  py: 0.5,
                  maxWidth: '75%',
                  bgcolor: m.direction === 'out' ? 'primary.dark' : 'background.default',
                }}
              >
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {m.message.type === 'json' && <DataObjectIcon sx={{ fontSize: 14 }} />}
                  <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                    {renderBody(m.message)}
                  </Typography>
                </Stack>
              </Paper>
            </Box>
          ))
        )}
      </Paper>

      <Stack direction="row" spacing={1}>
        <TextField
          fullWidth
          size="small"
          placeholder={connected ? 'Text or JSON…' : 'Connect first'}
          disabled={!connected}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Tooltip title="Send">
          <span>
            <IconButton color="primary" disabled={!connected || !draft.trim()} onClick={send}>
              <SendIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Stack>
  );
}
