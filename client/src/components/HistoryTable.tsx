import {
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { TransferHistoryDTO } from '@shared/protocol';
import { formatBytes, formatTime } from '../utils/format';

export function HistoryTable({ history }: { history: TransferHistoryDTO[] }) {
  if (history.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ p: 2 }}>
        No transfer history yet.
      </Typography>
    );
  }

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>File</TableCell>
          <TableCell>From</TableCell>
          <TableCell>To</TableCell>
          <TableCell align="right">Size</TableCell>
          <TableCell>Status</TableCell>
          <TableCell>When</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {history.map((h) => (
          <TableRow key={h.id} hover>
            <TableCell sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {h.fileName}
            </TableCell>
            <TableCell>{h.fromDeviceName}</TableCell>
            <TableCell>{h.toDeviceName}</TableCell>
            <TableCell align="right">{formatBytes(h.fileSize)}</TableCell>
            <TableCell>
              <Chip
                size="small"
                label={h.status}
                color={h.status === 'completed' ? 'success' : h.status === 'failed' ? 'error' : 'default'}
              />
            </TableCell>
            <TableCell>{formatTime(h.startedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
