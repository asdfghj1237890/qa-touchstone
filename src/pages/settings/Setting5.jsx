import React from 'react';
import { Typography, Box, Paper, Stack } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';

function Setting5() {
  return (
    <Box sx={{ 
      p: 3, 
      maxWidth: { xs: '100%', sm: 1200, lg: 1400, xl: 1600 },
      mx: 'auto',
      width: '100%'
    }}>
      <Paper sx={{ p: 3, height: 'fit-content' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
          <SettingsIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            Setting 5
          </Typography>
        </Stack>
        
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
          This is Setting 5 content. This page is available for future configuration options.
        </Typography>
        
        <Typography variant="body2" color="text.secondary">
          Additional settings and configuration options can be added here as needed.
        </Typography>
      </Paper>
    </Box>
  );
}

export default Setting5;