import {
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CancelIcon from '@mui/icons-material/Cancel';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReplayIcon from '@mui/icons-material/Replay';
import { TransferState } from '../p2p/types';
import { formatBytes, formatEta, formatSpeed } from '../utils/format';

const statusColors: Record<
  TransferState['status'],
  'default' | 'info' | 'warning' | 'success' | 'error'
> = {
  pending: 'warning',
  transferring: 'info',
  paused: 'warning',
  completed: 'success',
  cancelled: 'default',
  failed: 'error',
};

interface Props {
  transfers: TransferState[];
  onPause(id: string): void;
  onResume(id: string): void;
  onCancel(id: string): void;
  onRetry(id: string): void;
  onCancelAll(): void;
}

export function TransferList({ transfers, onPause, onResume, onCancel, onRetry, onCancelAll }: Props) {
  if (transfers.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ p: 2 }}>
        No transfers yet.
      </Typography>
    );
  }

  const cancellable = transfers.filter(
    (t) => t.status === 'pending' || t.status === 'transferring' || t.status === 'paused'
  ).length;

  return (
    <Stack spacing={1}>
      {cancellable > 0 && (
        <Stack direction="row" justifyContent="flex-end">
          <Button
            size="small"
            color="error"
            variant="outlined"
            startIcon={<CancelIcon />}
            onClick={onCancelAll}
          >
            Cancel all ({cancellable})
          </Button>
        </Stack>
      )}
      {transfers.map((t) => {
        const percent = t.fileSize > 0 ? (t.bytesTransferred / t.fileSize) * 100 : 0;
        const active = t.status === 'transferring' || t.status === 'paused';
        return (
          <Paper key={t.id} variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              {t.direction === 'send' ? (
                <ArrowUpwardIcon fontSize="small" color="primary" />
              ) : (
                <ArrowDownwardIcon fontSize="small" color="secondary" />
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap fontWeight={600}>
                  {t.fileName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t.direction === 'send' ? 'To' : 'From'} {t.peerDeviceName} ·{' '}
                  {formatBytes(t.bytesTransferred)} / {formatBytes(t.fileSize)}
                  {t.status === 'transferring' &&
                    ` · ${formatSpeed(t.speedBps)} · ${formatEta(t.etaSeconds)} left`}
                  {t.error && ` · ${t.error}`}
                </Typography>
              </Box>
              <Chip size="small" label={t.status} color={statusColors[t.status]} />
              {active && t.status !== 'paused' && (
                <Tooltip title="Pause">
                  <IconButton size="small" onClick={() => onPause(t.id)}>
                    <PauseIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {t.status === 'paused' && (
                <Tooltip title="Resume">
                  <IconButton size="small" onClick={() => onResume(t.id)}>
                    <PlayArrowIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {(active || t.status === 'pending') && (
                <Tooltip title="Cancel">
                  <IconButton size="small" onClick={() => onCancel(t.id)}>
                    <CancelIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {(t.status === 'failed' || t.status === 'cancelled') && t.canRetry && (
                <Tooltip title="Retry">
                  <IconButton size="small" onClick={() => onRetry(t.id)}>
                    <ReplayIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, percent)}
              color={t.status === 'failed' ? 'error' : t.status === 'completed' ? 'success' : 'primary'}
              sx={{ mt: 1, height: 6, borderRadius: 3 }}
            />
          </Paper>
        );
      })}
    </Stack>
  );
}
