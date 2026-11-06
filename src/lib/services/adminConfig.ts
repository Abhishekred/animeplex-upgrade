export type AnimePlexAdminConfig = {
  app?: string;
  updatedAt?: string | null;
  general?: {
    maintenanceMode?: boolean;
    minimumAppVersion?: string;
    announcementEnabled?: boolean;
    announcementTitle?: string;
    announcementMessage?: string;
  };
  features?: Record<string, boolean | undefined>;
  providers?: {
    enabled?: boolean;
    defaultProvider?: string;
    priority?: string[];
    maintenanceMessage?: string;
  };
};

const ADMIN_CONFIG_URL =
  'https://animeplex-admin-panel.vercel.app/api/config';

let cachedConfig: AnimePlexAdminConfig | null = null;
let lastFetchAt = 0;
const CACHE_TTL_MS = 60_000;

/**
 * Fetch the public, read-only configuration published by AnimePlex Control
 * Center. This endpoint intentionally contains no admin credentials.
 */
export async function fetchAnimePlexAdminConfig(
  force = false,
): Promise<AnimePlexAdminConfig | null> {
  if (!force && cachedConfig && Date.now() - lastFetchAt < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const response = await fetch(ADMIN_CONFIG_URL, {
      method: 'GET',
      headers: {Accept: 'application/json'},
    });
    if (!response.ok) {
      throw new Error(`Admin config request failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      app?: string;
      config?: AnimePlexAdminConfig;
      updatedAt?: string | null;
    };
    if (!payload.config || typeof payload.config !== 'object') {
      throw new Error('Admin config response is invalid');
    }

    cachedConfig = {
      ...payload.config,
      app: payload.app || payload.config.app || 'AnimePlex',
      updatedAt: payload.updatedAt || payload.config.updatedAt || null,
    };
    lastFetchAt = Date.now();
    return cachedConfig;
  } catch (error) {
    console.warn('[AnimePlex Admin] Remote config unavailable:', error);
    return cachedConfig;
  }
}

export function getCachedAnimePlexAdminConfig(): AnimePlexAdminConfig | null {
  return cachedConfig;
}
