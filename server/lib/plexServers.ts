import type { PlexSharedUser } from '@server/api/plextv';
import PlexTvAPI from '@server/api/plextv';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * The secondary Plex server only counts once its owner has signed in and a
 * server has been picked.
 */
export const isSecondaryPlexServerConfigured = (): boolean => {
  const { machineId, ownerToken } = getSettings().plexSecondary;
  return !!machineId && !!ownerToken;
};

/**
 * Whether a Plex account may sign in through the secondary server: either it
 * owns that server or the owner has shared that server with it.
 */
export const hasSecondaryPlexServerAccess = async (
  plexId: number
): Promise<boolean> => {
  if (!isSecondaryPlexServerConfigured()) {
    return false;
  }

  const { machineId, ownerPlexId, ownerToken } = getSettings().plexSecondary;

  if (plexId === ownerPlexId) {
    return true;
  }

  const secondaryPlexTv = new PlexTvAPI(ownerToken ?? '');
  return secondaryPlexTv.checkUserAccess(plexId, machineId);
};

/**
 * Lists users from the main server owner's shared list and, when configured,
 * the secondary server owner's shared list. A user appearing on both is
 * returned once, with access if either server grants it.
 */
export const getPlexSharedUsers = async (
  mainPlexToken: string
): Promise<{ user: PlexSharedUser; hasAccess: boolean }[]> => {
  const settings = getSettings();
  const mainPlexTv = new PlexTvAPI(mainPlexToken);
  const users = await mainPlexTv.getUsersWithAccess(settings.plex.machineId);

  if (isSecondaryPlexServerConfigured()) {
    const { machineId, ownerToken } = settings.plexSecondary;
    const secondaryPlexTv = new PlexTvAPI(ownerToken ?? '');
    let secondaryUsers: Awaited<ReturnType<PlexTvAPI['getUsersWithAccess']>> =
      [];

    try {
      secondaryUsers = await secondaryPlexTv.getUsersWithAccess(machineId);
    } catch (e) {
      // Keep the main server's users usable if the secondary owner's token
      // has expired or plex.tv is unreachable.
      logger.error('Unable to list users of the secondary Plex server', {
        label: 'Plex',
        errorMessage: e.message,
      });
    }

    for (const secondaryUser of secondaryUsers) {
      const existing = users.find((u) => u.user.id === secondaryUser.user.id);

      if (existing) {
        existing.hasAccess ||= secondaryUser.hasAccess;
      } else {
        users.push(secondaryUser);
      }
    }
  }

  return users;
};
