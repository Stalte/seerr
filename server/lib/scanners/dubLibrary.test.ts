import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import {
  MediaRequest,
  NoSeasonsAvailableError,
} from '@server/entity/MediaRequest';
import type Season from '@server/entity/Season';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import type { AnimeAudio } from '@server/lib/animeAudio';
import type { ProcessableSeason } from '@server/lib/scanners/baseScanner';
import BaseScanner from '@server/lib/scanners/baseScanner';
import type { SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';

const ANIME_TMDB_ID = 71000;

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
      keywords: { results: [{ id: ANIME_KEYWORD_ID, name: 'anime' }] },
      seasons: [1, 2].map((season_number) => ({
        season_number,
        episode_count: 10,
      })),
    };
  }
);

mock.method(MediaRequest, 'sendNotification', async () => undefined);

setupTestDb();

class TestScanner extends BaseScanner<unknown> {
  constructor() {
    super('Test Scan');
  }

  public dub(seasons: ProcessableSeason[]) {
    return this.processDubShow(ANIME_TMDB_ID, ANIME_TMDB_ID + 1, seasons);
  }

  public sub(seasons: ProcessableSeason[]) {
    return this.processShow(ANIME_TMDB_ID, ANIME_TMDB_ID + 1, seasons);
  }
}

const season = (seasonNumber: number, episodes: number): ProcessableSeason => ({
  seasonNumber,
  episodes,
  episodes4k: 0,
  totalEpisodes: 10,
});

const loadMedia = () =>
  getRepository(Media).findOneOrFail({
    where: { tmdbId: ANIME_TMDB_ID, mediaType: MediaType.TV },
  });

const setDubLibrary = (enabled: boolean) => {
  getSettings().plex.libraries = [
    {
      id: '1',
      name: 'Anime English',
      enabled,
      type: 'show',
      animeAudio: 'dub',
    },
  ];
};

// An approved request whose Sonarr step is a no-op (no servers configured)
const approvedRequest = async (animeAudio: AnimeAudio, seasons: number[]) => {
  const media = await loadMedia().catch(() =>
    getRepository(Media).save(
      new Media({ tmdbId: ANIME_TMDB_ID, mediaType: MediaType.TV })
    )
  );
  const admin = await getRepository(User).findOneOrFail({
    where: { email: 'admin@seerr.dev' },
  });

  return getRepository(MediaRequest).save(
    new MediaRequest({
      type: MediaType.TV,
      media,
      requestedBy: admin,
      status: MediaRequestStatus.APPROVED,
      is4k: false,
      animeAudio,
      seasons: seasons.map(
        (seasonNumber) =>
          new SeasonRequest({
            seasonNumber,
            status: MediaRequestStatus.APPROVED,
          })
      ),
    })
  );
};

const requestStatus = async (id: number) =>
  (await getRepository(MediaRequest).findOneOrFail({ where: { id } })).status;

beforeEach(() => {
  getSettings().sonarr = [] as SonarrSettings[];
  setDubLibrary(true);
});

describe('dubbed Plex library scan', () => {
  it('records only dub availability for a new series', async () => {
    await new TestScanner().dub([season(1, 10), season(2, 4)]);

    const media = await loadMedia();
    const byNumber = (n: number) =>
      media.seasons.find((s) => s.seasonNumber === n) as Season;

    assert.strictEqual(media.status, MediaStatus.UNKNOWN);
    assert.strictEqual(media.statusDub, MediaStatus.PARTIALLY_AVAILABLE);
    assert.strictEqual(byNumber(1).statusDub, MediaStatus.AVAILABLE);
    assert.strictEqual(byNumber(1).status, MediaStatus.UNKNOWN);
    assert.strictEqual(byNumber(2).statusDub, MediaStatus.PARTIALLY_AVAILABLE);
  });

  it('leaves the original-language status of an existing series alone', async () => {
    const scanner = new TestScanner();
    await scanner.sub([season(1, 10), season(2, 10)]);
    await scanner.dub([season(1, 10), season(2, 10)]);

    const media = await loadMedia();
    assert.strictEqual(media.status, MediaStatus.AVAILABLE);
    assert.strictEqual(media.statusDub, MediaStatus.AVAILABLE);

    // A later subbed scan does not reset the dub
    await scanner.sub([season(1, 10), season(2, 10)]);
    assert.strictEqual((await loadMedia()).statusDub, MediaStatus.AVAILABLE);
  });
});

describe('completing requests from dub availability', () => {
  it('completes a dub request when the dub arrives, not the sub', async () => {
    const request = await approvedRequest('dub', [1]);
    const scanner = new TestScanner();

    await scanner.sub([season(1, 10), season(2, 0)]);
    assert.strictEqual(
      await requestStatus(request.id),
      MediaRequestStatus.APPROVED
    );

    await scanner.dub([season(1, 10), season(2, 0)]);
    assert.strictEqual(
      await requestStatus(request.id),
      MediaRequestStatus.COMPLETED
    );
  });

  it('completes a both request only once each version is there', async () => {
    const request = await approvedRequest('both', [1]);
    const scanner = new TestScanner();

    await scanner.dub([season(1, 10), season(2, 0)]);
    assert.strictEqual(
      await requestStatus(request.id),
      MediaRequestStatus.APPROVED
    );

    await scanner.sub([season(1, 10), season(2, 0)]);
    assert.strictEqual(
      await requestStatus(request.id),
      MediaRequestStatus.COMPLETED
    );
  });

  it('falls back to the original-language status with no dubbed library', async () => {
    setDubLibrary(false);
    const request = await approvedRequest('dub', [1]);

    await new TestScanner().sub([season(1, 10), season(2, 0)]);
    assert.strictEqual(
      await requestStatus(request.id),
      MediaRequestStatus.COMPLETED
    );
  });
});

describe('requesting a dub that Plex already has', () => {
  it('drops seasons whose dub is available', async () => {
    const user = await getRepository(User).findOneOrFail({
      where: { email: 'demo@seerr.dev' },
    });
    getSettings().sonarr = [
      { id: 0, isDefault: true, is4k: false },
      { id: 1, isAnimeDub: true, is4k: false },
    ] as SonarrSettings[];
    await new TestScanner().dub([season(1, 10), season(2, 0)]);

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
      NoSeasonsAvailableError
    );

    const sub = await MediaRequest.request(
      {
        mediaId: ANIME_TMDB_ID,
        mediaType: MediaType.TV,
        seasons: [1],
        animeAudio: 'sub',
      },
      user
    );
    assert.deepStrictEqual(
      sub.seasons.map((s) => s.seasonNumber),
      [1]
    );
  });
});
