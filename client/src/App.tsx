import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import { useApp } from './context/AppContext';
import { DashboardPage } from './pages/DashboardPage';

export default function App() {
  const { session, loading } = useApp();

  if (loading || !session) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Stack spacing={2} alignItems="center">
          <CircularProgress />
          <Typography color="text.secondary">
            {loading ? 'Registering this device…' : 'Waiting for the server…'}
          </Typography>
        </Stack>
      </Box>
    );
  }

  return <DashboardPage session={session} />;
}
