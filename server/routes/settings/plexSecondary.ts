import PlexTvAPI from '@server/api/plextv';
import type { PlexSecondarySettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';
import { z } from 'zod';

const plexSecondaryRoutes = Router();

const ownerSchema = z.object({ authToken: z.string().min(1) });
const serverSchema = z.object({ machineId: z.string().min(1) });

// Never send the owner's Plex token back to the browser
const publicSettings = (secondary: PlexSecondarySettings) => ({
  name: secondary.name,
  machineId: secondary.machineId,
  ownerUsername: secondary.ownerUsername,
  ownerConnected: !!secondary.ownerToken,
});

const getOwnedServers = async (ownerToken: string) => {
  const plexTv = new PlexTvAPI(ownerToken);
  const devices = (await plexTv.getDevices()) ?? [];

  return devices
    .filter((device) => device.provides.includes('server') && device.owned)
    .map((device) => ({
      name: device.name,
      machineId: device.clientIdentifier,
    }));
};

plexSecondaryRoutes.get('/', (_req, res) => {
  const settings = getSettings();

  return res.status(200).json(publicSettings(settings.plexSecondary));
});

plexSecondaryRoutes.post('/owner', async (req, res, next) => {
  const settings = getSettings();
  const bodyResult = ownerSchema.safeParse(req.body);

  if (!bodyResult.success) {
    return next({ status: 400, message: 'Authentication token required.' });
  }

  try {
    const plexTv = new PlexTvAPI(bodyResult.data.authToken);
    const account = await plexTv.getUser();
    const previous = settings.plexSecondary;

    settings.plexSecondary = {
      // Keep the chosen server only if the same owner signed in again
      name: previous.ownerPlexId === account.id ? previous.name : '',
      machineId:
        previous.ownerPlexId === account.id ? previous.machineId : undefined,
      ownerPlexId: account.id,
      ownerUsername: account.username,
      ownerToken: bodyResult.data.authToken,
    };
    await settings.save();
  } catch (e) {
    logger.error('Unable to connect the secondary Plex server owner', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({ status: 500, message: 'Unable to sign in to Plex.' });
  }

  return res.status(200).json(publicSettings(settings.plexSecondary));
});

plexSecondaryRoutes.get('/servers', async (_req, res, next) => {
  const { ownerToken } = getSettings().plexSecondary;

  if (!ownerToken) {
    return next({
      status: 400,
      message: 'Sign in as the secondary server owner first.',
    });
  }

  try {
    return res.status(200).json(await getOwnedServers(ownerToken));
  } catch (e) {
    logger.error('Unable to list servers of the secondary Plex owner', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({ status: 500, message: 'Unable to retrieve Plex servers.' });
  }
});

plexSecondaryRoutes.post('/', async (req, res, next) => {
  const settings = getSettings();
  const bodyResult = serverSchema.safeParse(req.body);

  if (!bodyResult.success) {
    return next({ status: 400, message: 'Invalid request body.' });
  }

  const { ownerToken } = settings.plexSecondary;

  if (!ownerToken) {
    return next({
      status: 400,
      message: 'Sign in as the secondary server owner first.',
    });
  }

  try {
    const server = (await getOwnedServers(ownerToken)).find(
      (s) => s.machineId === bodyResult.data.machineId
    );

    if (!server) {
      return next({
        status: 404,
        message: 'Server is not owned by the secondary Plex account.',
      });
    }

    if (server.machineId === settings.plex.machineId) {
      return next({
        status: 400,
        message: 'This server is already the main Plex server.',
      });
    }

    settings.plexSecondary = {
      ...settings.plexSecondary,
      name: server.name,
      machineId: server.machineId,
    };
    await settings.save();
  } catch (e) {
    logger.error('Unable to save the secondary Plex server', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({ status: 500, message: 'Unable to save Plex server.' });
  }

  return res.status(200).json(publicSettings(settings.plexSecondary));
});

plexSecondaryRoutes.delete('/', async (_req, res) => {
  const settings = getSettings();

  settings.plexSecondary = { name: '' };
  await settings.save();

  return res.status(200).json(publicSettings(settings.plexSecondary));
});

export default plexSecondaryRoutes;
