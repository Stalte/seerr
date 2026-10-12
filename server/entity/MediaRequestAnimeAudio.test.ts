import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import type { AddSeriesOptions } from '@server/api/servarr/sonarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import {
  InvalidAnimeAudioError,
  MediaRequest,
  NoSeasonsAvailableError,
} from '@server/entity/MediaRequest';
import Season from '@server/entity/Season';
import { User } from '@server/entity/User';
import type { SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';

const ANIME_TMDB_ID = 70000;
const NON_ANIME_TMDB_ID = 70001;

mock.method(
  ExternalAPI.prototype as unknown as {
    get: (endpoint: string) => Promise<unknown>;
  },
  'get',
  async (endpoint: string) => {
    const tmdbId = Number(endpoint.replace(/^\/tv\//, ''));

    if (!tmdbId) {
      throw new Error(`Unstubbed external endpoint: ${endpoint}`);
    }

    return {
      id: tmdbId,
      name: `Show ${tmdbId}`,
      external_ids: { tvdb_id: tmdbId + 1 },
      keywords: {
        results:
          tmdbId === ANIME_TMDB_ID
            ? [{ id: ANIME_KEYWORD_ID, name: 'anime' }]
            : [],
      },
      seasons: [1, 2, 3].map((season_number) => ({
        season_number,
        episode_count: 10,
      })),
    };
  }
);

// Each call records which Sonarr server it was sent to
const addSeriesCalls: { url: string; options: AddSeriesOptions }[] = [];
mock.method(
  SonarrAPI.prototype,
  'addSeries',
  async function (
    this: { axios: { defaults: { baseURL?: string } } },
    options: AddSeriesOptions
  ) {
    addSeriesCalls.push({ url: this.axios.defaults.baseURL ?? '', options });
    return { id: 1, titleSlug: 'show' };
  }
);

mock.method(MediaRequest, 'sendNotification', async () => undefined);

setupTestDb();

function configureSonarr(servers: Partial<SonarrSettings>[]): void {
  getSettings().sonarr = servers.map((o, i) => ({
    id: i,
    name: `Sonarr ${i}`,
    hostname: `sonarr${i}`,
    port: 8989,
    apiKey: 'test-key',
    baseUrl: '',
    useSsl: false,
    activeProfileId: 1,
    activeProfileName: 'Any',
    activeDirectory: '/tv',
    activeAnimeDirectory: `/anime${i}`,
    activeAnimeProfileId: 2,
    animeTags: [],
    tags: [],
    is4k: false,
    isDefault: false,
    enableSeasonFolders: true,
    syncEnabled: false,
    preventSearch: false,
    tagRequests: false,
    seriesType: 'standard',
    animeSeriesType: 'anime',
    monitorNewItems: 'all',
    overrideRule: [],
    ...o,
  })) as SonarrSettings[];
}

const getUser = (email: string) =>
  getRepository(User).findOneOrFail({ where: { email } });

const seasonsOf = (request: MediaRequest) =>
  request.seasons.map((season) => season.seasonNumber).sort();

// addSeries runs detached from the request, so give it a moment to land
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  addSeriesCalls.length = 0;
  configureSonarr([{ isDefault: true }, { name: 'Dubs', isAnimeDub: true }]);
});

describe('anime sub and dub requests', () => {
  it('lets a dub request take seasons that a sub request already holds', async () => {
    const user = await getUser('demo@seerr.dev');

    const sub = await MediaRequest.request(
      {
        mediaId: ANIME_TMDB_ID,
        mediaType: MediaType.TV,
        seasons: [1, 2],
        animeAudio: 'sub',
      },
      user
    );
    const dub = await MediaRequest.request(
      {
        mediaId: ANIME_TMDB_ID,
        mediaType: MediaType.TV,
        seasons: [1, 2, 3],
        animeAudio: 'dub',
      },
      user
    );

    assert.deepStrictEqual(seasonsOf(sub), [1, 2]);
    assert.deepStrictEqual(seasonsOf(dub), [1, 2, 3]);
    assert.strictEqual(dub.animeAudio, 'dub');
  });

  it('still drops seasons already requested for the same version', async () => {
    const user = await getUser('demo@seerr.dev');

    await MediaRequest.request(
      {
        mediaId: ANIME_TMDB_ID,
        mediaType: MediaType.TV,
        seasons: [1],
        animeAudio: 'dub',
      },
      user
    );
    const both = await MediaRequest.request(
      {
        mediaId: ANIME_TMDB_ID,
        mediaType: MediaType.TV,
        seasons: [1, 2],
        animeAudio: 'both',
      },
      user
    );

    // Season 1 still needs the original-language version
    assert.deepStrictEqual(seasonsOf(both), [1, 2]);

    await assert.rejects(
      MediaRequest.request(
        {
          mediaId: ANIME_TMDB_ID,
          mediaType: MediaType.TV,
          seasons: [1, 2],
          animeAudio: 'dub',
        },
        user
      ),
      NoSeasonsAvailableError
    );
  });

  it('does not treat available seasons as available in the dub', async () => {
    const user = await getUser('demo@seerr.dev');
    await getRepository(Media).save(
      new Media({
        tmdbId: ANIME_TMDB_ID,
        mediaType: MediaType.TV,
        status: MediaStatus.AVAILABLE,
        seasons: [1, 2, 3].map(
          (seasonNumber) =>
            new Season({ seasonNumber, status: MediaStatus.AVAILABLE })
        ),
      })
    );

    await assert.rejects(
      MediaRequest.request(
        {
          mediaId: ANIME_TMDB_ID,
          mediaType: MediaType.TV,
          seasons: [1],
          animeAudio: 'sub',
        },
        user
      ),
      NoSeasonsAvailableError
    );

    const dub = await MediaRequest.request(
      {
        mediaId: ANIME_TMDB_ID,
        mediaType: MediaType.TV,
        seasons: [1],
        animeAudio: 'dub',
      },
      user
    );
    assert.deepStrictEqual(seasonsOf(dub), [1]);
  });

  it('ignores the choice for a series that is not anime', async () => {
    const user = await getUser('demo@seerr.dev');

    const request = await MediaRequest.request(
      {
        mediaId: NON_ANIME_TMDB_ID,
        mediaType: MediaType.TV,
        seasons: [1],
        animeAudio: 'dub',
      },
      user
    );

    assert.strictEqual(request.animeAudio, null);
  });

  it('rejects a dub request when no dubs-only server is configured', async () => {
    configureSonarr([{ isDefault: true }]);
    const user = await getUser('demo@seerr.dev');

    await assert.rejects(
      MediaRequest.request(
        {
          mediaId: ANIME_TMDB_ID,
          mediaType: MediaType.TV,
          seasons: [1],
          animeAudio: 'dub',
        },
        user
      ),
      InvalidAnimeAudioError
    );
  });

  it('rejects an unknown version', async () => {
    const user = await getUser('demo@seerr.dev');

    await assert.rejects(
      MediaRequest.request(
        {
          mediaId: ANIME_TMDB_ID,
          mediaType: MediaType.TV,
          seasons: [1],
          animeAudio: 'japanese' as 'sub',
        },
        user
      ),
      InvalidAnimeAudioError
    );
  });
});

describe('sending anime requests to Sonarr', () => {
  const approvedRequest = async (animeAudio: 'sub' | 'dub' | 'both') => {
    const admin = await getUser('admin@seerr.dev');
    await MediaRequest.request(
      {
        mediaId: ANIME_TMDB_ID,
        mediaType: MediaType.TV,
        seasons: [1],
        animeAudio,
      },
      admin
    );
    await settle();
    return addSeriesCalls.map((call) => call.url).sort();
  };

  it('sends the original language to the default server only', async () => {
    assert.deepStrictEqual(await approvedRequest('sub'), [
      'http://sonarr0:8989/api/v3',
    ]);
    assert.strictEqual(addSeriesCalls[0].options.rootFolderPath, '/anime0');
  });

  it('sends the dub to the dubs-only server only', async () => {
    assert.deepStrictEqual(await approvedRequest('dub'), [
      'http://sonarr1:8989/api/v3',
    ]);
    assert.strictEqual(addSeriesCalls[0].options.rootFolderPath, '/anime1');
  });

  it('sends both versions to both servers', async () => {
    assert.deepStrictEqual(await approvedRequest('both'), [
      'http://sonarr0:8989/api/v3',
      'http://sonarr1:8989/api/v3',
    ]);
  });

  it('never picks the dubs-only server as the default', async () => {
    configureSonarr([
      { name: 'Dubs', isAnimeDub: true, isDefault: true },
      { isDefault: true },
    ]);

    const admin = await getUser('admin@seerr.dev');
    await MediaRequest.request(
      { mediaId: NON_ANIME_TMDB_ID, mediaType: MediaType.TV, seasons: [1] },
      admin
    );
    await settle();

    assert.deepStrictEqual(
      addSeriesCalls.map((call) => call.url),
      ['http://sonarr1:8989/api/v3']
    );
  });
});
