import PlexTvAPI from '@server/api/plextv';
import {
  getPlexSharedUsers,
  hasSecondaryPlexServerAccess,
} from '@server/lib/plexServers';
import { getSettings } from '@server/lib/settings';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const MAIN_TOKEN = 'main-owner-token';
const SECONDARY_TOKEN = 'secondary-owner-token';
const MAIN_MACHINE_ID = 'main-machine';
const SECONDARY_MACHINE_ID = 'secondary-machine';

const sharedUser = (id: string, machineIds: string[]) => ({
  $: {
    id,
    title: `user${id}`,
    username: `user${id}`,
    email: `user${id}@example.com`,
    thumb: '',
  },
  Server: machineIds.map((machineIdentifier) => ({
    $: {
      id: '1',
      serverId: '1',
      machineIdentifier,
      name: machineIdentifier,
      lastSeenAt: '0',
      numLibraries: '1',
      owned: '0',
    },
  })),
});

// Shared lists keyed by the owner token that requests them
let sharedLists: Record<string, ReturnType<typeof sharedUser>[] | Error> = {};

Object.defineProperty(PlexTvAPI.prototype, 'getUsers', {
  value: async function (this: { authToken: string }) {
    const list = sharedLists[this.authToken];
    if (list instanceof Error) {
      throw list;
    }
    return { MediaContainer: { User: list ?? [] } };
  },
  configurable: true,
  writable: true,
});

describe('secondary Plex server access', () => {
  beforeEach(() => {
    const settings = getSettings();
    settings.plex.machineId = MAIN_MACHINE_ID;
    settings.plexSecondary = {
      name: 'Second',
      machineId: SECONDARY_MACHINE_ID,
      ownerPlexId: 900,
      ownerUsername: 'secondowner',
      ownerToken: SECONDARY_TOKEN,
    };
    sharedLists = {
      [MAIN_TOKEN]: [sharedUser('1', [MAIN_MACHINE_ID]), sharedUser('3', [])],
      [SECONDARY_TOKEN]: [
        sharedUser('2', [SECONDARY_MACHINE_ID]),
        sharedUser('3', [SECONDARY_MACHINE_ID]),
        sharedUser('4', ['some-other-server']),
      ],
    };
  });

  afterEach(() => {
    getSettings().plexSecondary = { name: '' };
  });

  it('lets the secondary owner and their shared users sign in', async () => {
    assert.equal(await hasSecondaryPlexServerAccess(900), true);
    assert.equal(await hasSecondaryPlexServerAccess(2), true);
    assert.equal(await hasSecondaryPlexServerAccess(4), false);
    assert.equal(await hasSecondaryPlexServerAccess(1), false);
  });

  it('denies everyone when no secondary server is configured', async () => {
    getSettings().plexSecondary = { name: '' };

    assert.equal(await hasSecondaryPlexServerAccess(900), false);
    assert.equal(await hasSecondaryPlexServerAccess(2), false);
  });

  it('merges both shared lists and keeps access from either server', async () => {
    const users = await getPlexSharedUsers(MAIN_TOKEN);
    const access = Object.fromEntries(
      users.map(({ user, hasAccess }) => [user.id, hasAccess])
    );

    assert.deepEqual(access, { '1': true, '2': true, '3': true, '4': false });
  });

  it('still returns main server users when the secondary owner fails', async () => {
    sharedLists[SECONDARY_TOKEN] = new Error('401 Unauthorized');

    const users = await getPlexSharedUsers(MAIN_TOKEN);

    assert.deepEqual(
      users.map(({ user, hasAccess }) => [user.id, hasAccess]),
      [
        ['1', true],
        ['3', false],
      ]
    );
  });
});
