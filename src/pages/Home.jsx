import React from 'react';
import {
  Api,
  Key,
  Security,
  Settings,
  Storage,
  Terminal
} from '@mui/icons-material';
import {
  Box,
  ButtonBase,
  Chip,
  Stack,
  Typography
} from '@mui/material';
import packageJson from '../../package.json';
import { PRODUCT_NAME } from '../productConfig';

const TAB_MAPPING = {
  api: 1
};

function requestTabChange(tabKey) {
  const newValue = TAB_MAPPING[tabKey];
  if (newValue === undefined) return;

  window.dispatchEvent(new CustomEvent('requestTabChange', {
    detail: {
      oldValue: 0,
      newValue
    }
  }));
}

function openApiSettings() {
  window.electronAPI?.openSettings?.();
}

const tools = [
  {
    key: 'api',
    title: 'API Client',
    description: 'Postman-compatible API client with collections, environments, request history, and response export.',
    icon: Api,
    accent: '#42a5f5',
    onClick: () => requestTabChange('api')
  },
  {
    key: 'settings',
    title: 'API Settings',
    description: 'Manage credential sets and profiles used by AWS SigV4 requests.',
    icon: Settings,
    accent: '#66bb6a',
    onClick: openApiSettings
  }
];

const stats = [
  { label: '5 auth methods', icon: Security },
  { label: 'Postman collections', icon: Storage },
  { label: 'Local execution', icon: Terminal }
];

function ToolCard({ tool }) {
  const Icon = tool.icon;

  return (
    <ButtonBase
      aria-label={tool.title}
      onClick={tool.onClick}
      sx={{
        display: 'block',
        width: '100%',
        height: '100%',
        textAlign: 'left',
        borderRadius: '8px',
        overflow: 'hidden',
        '&:focus-visible': {
          outline: `2px solid ${tool.accent}`,
          outlineOffset: '2px'
        }
      }}
    >
      <Box
        sx={{
          height: '100%',
          minHeight: 156,
          p: 2,
          borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.1)',
          backgroundColor: '#1f2428',
          transition: 'border-color 160ms ease, background-color 160ms ease, transform 160ms ease',
          '&:hover': {
            borderColor: tool.accent,
            backgroundColor: '#252b30',
            transform: 'translateY(-1px)'
          }
        }}
      >
        <Stack spacing={2} sx={{ height: '100%' }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '8px',
              display: 'grid',
              placeItems: 'center',
              backgroundColor: `${tool.accent}22`,
              color: tool.accent
            }}
          >
            <Icon fontSize="small" />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ color: '#fff', fontWeight: 700, fontSize: '1rem' }}>
              {tool.title}
            </Typography>
            <Typography variant="body2" sx={{ color: '#aeb8c2', mt: 0.75, lineHeight: 1.55 }}>
              {tool.description}
            </Typography>
          </Box>
        </Stack>
      </Box>
    </ButtonBase>
  );
}

function Home() {
  return (
    <Box
      sx={{
        height: '100%',
        overflow: 'auto',
        p: { xs: 2, md: 3 },
        backgroundColor: '#14181c',
        color: '#fff'
      }}
    >
      <Stack spacing={3} sx={{ maxWidth: 1180, mx: 'auto' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: { xs: 'flex-start', sm: 'center' },
            justifyContent: 'space-between',
            gap: 2,
            pb: 2,
            borderBottom: '1px solid rgba(255,255,255,0.1)'
          }}
        >
          <Box>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1 }}>
              <Key sx={{ color: '#8ab4f8' }} />
              <Typography variant="h4" sx={{ fontWeight: 800, fontSize: { xs: '1.7rem', md: '2.1rem' } }}>
                {PRODUCT_NAME}
              </Typography>
            </Stack>
            <Typography variant="body1" sx={{ color: '#b8c4ce', maxWidth: 760, lineHeight: 1.65 }}>
              Postman-compatible API client for QA workflows with AWS SigV4 support.
            </Typography>
          </Box>
          <Chip
            label={`v${packageJson.version}`}
            size="small"
            sx={{
              color: '#dbe7f3',
              backgroundColor: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.14)'
            }}
          />
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
            gap: 2
          }}
        >
          {tools.map((tool) => (
            <ToolCard key={tool.key} tool={tool} />
          ))}
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
            gap: 1.5,
            p: 1.5,
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            backgroundColor: '#1b2025'
          }}
        >
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Stack
                key={stat.label}
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{
                  px: 1.25,
                  py: 1,
                  borderRadius: '6px',
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  color: '#d7e1ea'
                }}
              >
                <Icon sx={{ fontSize: 18, color: '#8ab4f8' }} />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {stat.label}
                </Typography>
              </Stack>
            );
          })}
        </Box>
      </Stack>
    </Box>
  );
}

export default Home;
