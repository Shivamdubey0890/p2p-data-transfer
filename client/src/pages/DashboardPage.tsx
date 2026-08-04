import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Toolbar,
  Typography,
} from '@mui/material';
import DevicesIcon from '@mui/icons-material/Devices';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DeviceDTO, TransferHistoryDTO } from '@shared/protocol';
import { HistoryTable } from '../components/HistoryTable';
import { DeviceList } from '../components/DeviceList';
import { PeerPanel } from '../components/PeerPanel';
import { TransferList } from '../components/TransferList';
import { ActiveSession, useApp } from '../context/AppContext';
import {
  useConnectRequests,
  useDevices,
  useFileOffers,
  useMessages,
  useP2PErrors,
  usePeerStates,
  useSignalingStatus,
  useTransfers,
  useTrustedPeers,
} from '../hooks/useP2P';
import { api } from '../services/api';
import { formatBytes } from '../utils/format';

export function DashboardPage({ session }: { session: ActiveSession }) {
  const { resetIdentity } = useApp();
  const { manager, device, deviceToken } = session;

  const signaling = useSignalingStatus(manager);
  const trustedPeers = useTrustedPeers(manager);
  const devices = useDevices(manager);
  const transfers = useTransfers(manager);
  const peerStates = usePeerStates(manager);
  const messages = useMessages(manager);
  const { request, clear: clearRequest } = useConnectRequests(manager);
  const { offers, remove: removeOffers } = useFileOffers(manager);
  const { error, clear: clearError } = useP2PErrors(manager);

  const [selected, setSelected] = useState<DeviceDTO | null>(null);
  const [tab, setTab] = useState(0);
  const [history, setHistory] = useState<TransferHistoryDTO[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  // Keep the selected device object fresh as presence updates arrive.
  useEffect(() => {
    if (selected && !devices.some((d) => d.id === selected.id)) setSelected(null);
  }, [devices, selected]);

  const refreshHistory = useCallback(() => {
    api
      .listHistory(deviceToken)
      .then((r) => setHistory(r.history))
      .catch(() => {});
  }, [deviceToken]);

  useEffect(() => {
    if (tab === 1) refreshHistory();
  }, [tab, refreshHistory]);

  const guard = useCallback((fn: () => unknown) => {
    void (async () => {
      try {
        await fn();
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'Operation failed');
      }
    })();
  }, []);

  const selectedMessages = useMemo(
    () => messages.filter((m) => m.peerDeviceId === selected?.id),
    [messages, selected]
  );

  const activeCount = transfers.filter(
    (t) => t.status === 'transferring' || t.status === 'paused'
  ).length;

  const totalOfferBytes = offers.reduce((sum, o) => sum + o.offer.fileSize, 0);

  const rejectAllOffers = () => {
    const current = [...offers];
    removeOffers(current.map((o) => o.offer.transferId));
    current.forEach((o) => manager.rejectFileOffer(o.peerDeviceId, o.offer.transferId));
  };

  const acceptAllOffers = () => {
    const current = [...offers];
    removeOffers(current.map((o) => o.offer.transferId));
    guard(async () => {
      // Single file → per-file save dialog. Many files → pick ONE folder,
      // everything lands there without further prompts.
      if (current.length === 1) {
        await manager.acceptFileOffer(current[0].peerDeviceId, current[0].offer.transferId);
        return;
      }
      let dir: FileSystemDirectoryHandle | undefined;
      if (window.showDirectoryPicker) {
        try {
          dir = await window.showDirectoryPicker({ mode: 'readwrite' });
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            current.forEach((o) =>
              manager.rejectFileOffer(o.peerDeviceId, o.offer.transferId, 'Folder choice cancelled')
            );
            return;
          }
        }
      }
      for (const o of current) {
        await manager.acceptFileOffer(o.peerDeviceId, o.offer.transferId, dir);
      }
    });
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static" elevation={0} color="transparent" sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar>
          <SwapHorizIcon color="primary" sx={{ mr: 1 }} />
          <Typography variant="h6" sx={{ flex: 1 }}>
            P2P Transfer
          </Typography>
          <Chip
            size="small"
            label={
              signaling === 'connected'
                ? 'Server: connected'
                : signaling === 'connecting'
                  ? 'Server: connecting…'
                  : 'Server: reconnecting…'
            }
            color={signaling === 'connected' ? 'success' : 'warning'}
            sx={{ mr: 2 }}
          />
          <Chip icon={<DevicesIcon />} label={device.name} sx={{ mr: 2 }} />
          <Button startIcon={<RestartAltIcon />} onClick={resetIdentity} color="inherit">
            New identity
          </Button>
        </Toolbar>
      </AppBar>

      <Grid container spacing={2} sx={{ p: 2, flex: 1 }}>
        <Grid item xs={12} md={4} lg={3}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Online devices ({devices.length})
            </Typography>
            <DeviceList
              devices={devices}
              peerStates={peerStates}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
            />
          </Paper>
        </Grid>

        <Grid item xs={12} md={8} lg={5}>
          <Paper sx={{ p: 2, height: '100%' }}>
            {selected ? (
              <PeerPanel
                device={selected}
                state={peerStates.get(selected.id) ?? 'idle'}
                signalingUp={signaling === 'connected'}
                trusted={trustedPeers.includes(selected.id)}
                messages={selectedMessages}
                onConnect={() => guard(() => manager.requestConnection(selected.id))}
                onDisconnect={() => manager.disconnectPeer(selected.id)}
                onUntrust={() => manager.untrustPeer(selected.id)}
                onSendFiles={(files) =>
                  files.forEach((f) => guard(() => manager.sendFile(selected.id, f)))
                }
                onSendText={(text) => guard(() => manager.sendText(selected.id, text))}
                onSendJson={(json) => guard(() => manager.sendJson(selected.id, json))}
              />
            ) : (
              <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', minHeight: 200 }}>
                <Typography color="text.secondary">
                  Select a device to connect and start sending.
                </Typography>
              </Stack>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Tabs value={tab} onChange={(_, v: number) => setTab(v)} sx={{ mb: 1 }}>
              <Tab label={`Transfers${activeCount ? ` (${activeCount})` : ''}`} />
              <Tab label="History" />
            </Tabs>
            {tab === 0 ? (
              <TransferList
                transfers={transfers}
                onPause={(id) => manager.pauseTransfer(id)}
                onResume={(id) => manager.resumeTransfer(id)}
                onCancel={(id) => manager.cancelTransfer(id)}
                onRetry={(id) => guard(() => manager.retryTransfer(id))}
                onCancelAll={() => manager.cancelAllTransfers()}
              />
            ) : (
              <HistoryTable history={history} />
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Incoming connection request */}
      <Dialog open={!!request} onClose={() => {}}>
        <DialogTitle>Incoming connection</DialogTitle>
        <DialogContent>
          <Typography>
            <b>{request?.fromDeviceName}</b> wants to connect to this device for direct transfers.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (request) manager.rejectConnection(request.fromDeviceId);
              clearRequest();
            }}
          >
            Reject
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              if (request) guard(() => manager.acceptConnection(request.fromDeviceId));
              clearRequest();
            }}
          >
            Accept
          </Button>
        </DialogActions>
      </Dialog>

      {/* Incoming file offers (batched — one dialog for a multi-file drop) */}
      <Dialog open={offers.length > 0} onClose={() => {}} maxWidth="sm" fullWidth>
        <DialogTitle>
          Incoming {offers.length === 1 ? 'file' : `${offers.length} files`} (
          {formatBytes(totalOfferBytes)})
        </DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            <b>{offers[0]?.peerDeviceName}</b> wants to send you:
          </Typography>
          <Paper variant="outlined" sx={{ maxHeight: 220, overflowY: 'auto', p: 1 }}>
            {offers.map((o) => (
              <Typography key={o.offer.transferId} variant="body2" noWrap>
                {o.offer.fileName} — {formatBytes(o.offer.fileSize)}
              </Typography>
            ))}
          </Paper>
          <Typography variant="caption" color="text.secondary">
            {offers.length > 1
              ? 'You will pick one folder; all files are saved there.'
              : 'Files arrive directly from the sender over an encrypted channel.'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={rejectAllOffers}>Reject all</Button>
          <Button variant="contained" onClick={acceptAllOffers}>
            {offers.length === 1 ? 'Accept & choose location' : 'Accept all → choose folder'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!(error || localError)}
        autoHideDuration={5000}
        onClose={() => {
          clearError();
          setLocalError(null);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" variant="filled">
          {error ?? localError}
        </Alert>
      </Snackbar>
    </Box>
  );
}
