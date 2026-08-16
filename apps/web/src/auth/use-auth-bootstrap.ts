import { startTransition, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiClientError, type AuthActiveSession, type AuthAnonymousSession, type AuthSession } from '@dongtian/contracts';

import { apiClient } from '../lib/api.js';

export const AUTH_SESSION_QUERY_KEY = ['auth', 'session'] as const;

export interface AuthBootstrapState {
  readonly status: 'loading' | 'authenticated' | 'signed-out' | 'locked' | 'maintenance' | 'error';
  readonly session: AuthActiveSession | null;
  readonly anonymousSession: AuthAnonymousSession | null;
  readonly isBootstrapping: boolean;
  readonly lastError: string | null;
  readonly retry: () => void;
  readonly createAnonymousSession: () => void;
  readonly logout: () => void;
}

function isMaintenanceError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 503;
}

function isKnownError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

export function useAuthBootstrap(): AuthBootstrapState {
  const queryClient = useQueryClient();
  const [bootMode, setBootMode] = useState<'booting' | 'signed-out'>('booting');

  const sessionQuery = useQuery<AuthSession>({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: () => apiClient.getSession(),
  });

  const anonymousMutation = useMutation({
    mutationFn: () => apiClient.anonymousSession(),
    onSuccess: (session) => {
      apiClient.setCsrfToken(session.csrf_token);
      startTransition(() => {
        queryClient.setQueryData<AuthSession>(AUTH_SESSION_QUERY_KEY, () => ({
          authenticated: true,
          account_id: session.account_id,
          character_id: session.character_id,
          account_type: session.account_type,
          account_status: 'ACTIVE',
          csrf_token: session.csrf_token,
          session_expires_at: session.session_expires_at,
        }));
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiClient.logout(),
    onSuccess: () => {
      apiClient.setCsrfToken(null);
      queryClient.setQueryData<AuthSession>(AUTH_SESSION_QUERY_KEY, () => ({ authenticated: false }));
      setBootMode('signed-out');
    },
  });

  useEffect(() => {
    if (sessionQuery.data?.authenticated) {
      apiClient.setCsrfToken(sessionQuery.data.csrf_token);
      return;
    }

    if (sessionQuery.data && !sessionQuery.data.authenticated && bootMode === 'booting' && !anonymousMutation.isPending) {
      anonymousMutation.mutate();
    }
  }, [anonymousMutation, bootMode, sessionQuery.data]);

  const sessionData = sessionQuery.data;
  const sessionError = sessionQuery.error;
  const anonymousError = anonymousMutation.error;

  if (sessionQuery.isPending || (bootMode === 'booting' && anonymousMutation.isPending)) {
    return {
      status: 'loading',
      session: null,
      anonymousSession: null,
      isBootstrapping: true,
      lastError: null,
      retry: () => {
        sessionQuery.refetch();
      },
      createAnonymousSession: () => {
        anonymousMutation.mutate();
      },
      logout: () => {
        logoutMutation.mutate();
      },
    };
  }

  if (isMaintenanceError(sessionError) || isMaintenanceError(anonymousError)) {
    return {
      status: 'maintenance',
      session: null,
      anonymousSession: null,
      isBootstrapping: false,
      lastError: (sessionError ?? anonymousError)?.message ?? null,
      retry: () => {
        sessionQuery.refetch();
      },
      createAnonymousSession: () => {
        setBootMode('booting');
        anonymousMutation.mutate();
      },
      logout: () => {
        logoutMutation.mutate();
      },
    };
  }

  if (isKnownError(sessionError) || isKnownError(anonymousError)) {
    return {
      status: 'error',
      session: null,
      anonymousSession: null,
      isBootstrapping: false,
      lastError: (sessionError ?? anonymousError)?.message ?? null,
      retry: () => {
        sessionQuery.refetch();
      },
      createAnonymousSession: () => {
        setBootMode('booting');
        anonymousMutation.mutate();
      },
      logout: () => {
        logoutMutation.mutate();
      },
    };
  }

  if (sessionData?.authenticated) {
    if (sessionData.account_status !== 'ACTIVE') {
      return {
        status: 'locked',
        session: sessionData,
        anonymousSession: null,
        isBootstrapping: false,
        lastError: null,
        retry: () => {
          sessionQuery.refetch();
        },
        createAnonymousSession: () => {
          anonymousMutation.mutate();
        },
        logout: () => {
          logoutMutation.mutate();
        },
      };
    }

    return {
      status: 'authenticated',
      session: sessionData,
      anonymousSession: null,
      isBootstrapping: false,
      lastError: null,
      retry: () => {
        sessionQuery.refetch();
      },
      createAnonymousSession: () => {
        anonymousMutation.mutate();
      },
      logout: () => {
        logoutMutation.mutate();
      },
    };
  }

  if (sessionData && !sessionData.authenticated) {
    return {
      status: bootMode === 'booting' ? 'loading' : 'signed-out',
      session: null,
      anonymousSession: null,
      isBootstrapping: bootMode === 'booting',
      lastError: null,
      retry: () => {
        sessionQuery.refetch();
      },
      createAnonymousSession: () => {
        setBootMode('booting');
        anonymousMutation.mutate();
      },
      logout: () => {
        logoutMutation.mutate();
      },
    };
  }

  if (bootMode === 'signed-out') {
    return {
      status: 'signed-out',
      session: null,
      anonymousSession: null,
      isBootstrapping: false,
      lastError: null,
      retry: () => {
        sessionQuery.refetch();
      },
      createAnonymousSession: () => {
        setBootMode('booting');
        anonymousMutation.mutate();
      },
      logout: () => {
        logoutMutation.mutate();
      },
    };
  }

  return {
    status: 'loading',
    session: null,
    anonymousSession: null,
    isBootstrapping: true,
    lastError: null,
    retry: () => {
      sessionQuery.refetch();
    },
    createAnonymousSession: () => {
      anonymousMutation.mutate();
    },
    logout: () => {
      logoutMutation.mutate();
    },
  };
}
