import {
  Chip,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import ComputerIcon from '@mui/icons-material/Computer';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import { DeviceDTO } from '@shared/protocol';
import { PeerConnectionState } from '../p2p/types';

const stateColors: Record<PeerConnectionState, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  idle: 'default',
  requesting: 'warning',
  connecting: 'info',
  connected: 'success',
  disconnected: 'default',
};

interface Props {
  devices: DeviceDTO[];
  peerStates: Map<string, PeerConnectionState>;
  selectedId: string | null;
  onSelect(device: DeviceDTO): void;
}

export function DeviceList({ devices, peerStates, selectedId, onSelect }: Props) {
  if (devices.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ p: 2 }}>
        No other devices online. Sign in from another device or browser tab.
      </Typography>
    );
  }

  return (
    <List dense disablePadding>
      {devices.map((device) => {
        const state = peerStates.get(device.id) ?? 'idle';
        const mobile = /android|ios/i.test(device.platform);
        return (
          <ListItemButton
            key={device.id}
            selected={device.id === selectedId}
            onClick={() => onSelect(device)}
            sx={{ borderRadius: 2, mb: 0.5 }}
          >
            <ListItemIcon>{mobile ? <PhoneAndroidIcon /> : <ComputerIcon />}</ListItemIcon>
            <ListItemText
              primary={device.name}
              secondary={
                <Stack component="span" direction="row" spacing={1} alignItems="center">
                  <span>{device.platform}</span>
                  {device.ip && <span>· {device.ip}</span>}
                </Stack>
              }
            />
            <Chip
              size="small"
              label={state === 'idle' ? device.status : state}
              color={stateColors[state]}
              variant={state === 'connected' ? 'filled' : 'outlined'}
            />
          </ListItemButton>
        );
      })}
    </List>
  );
}
