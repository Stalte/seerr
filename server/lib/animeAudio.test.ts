import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaStatus } from '@server/constants/media';
import {
  getRequestSeasonStatus,
  getTakenSeasons,
} from '@server/lib/animeAudio';

const request = (
  animeAudio: 'sub' | 'dub' | 'both' | null,
  seasons: number[]
) => ({
  animeAudio,
  seasons: seasons.map((seasonNumber) => ({ seasonNumber })),
});

describe('getTakenSeasons', () => {
  const requests = [
    request(null, [1]),
    request('sub', [2]),
    request('dub', [3]),
    request('both', [4]),
  ];

  it('counts legacy, sub and both requests plus availability for the original language', () => {
    assert.deepStrictEqual(
      getTakenSeasons(requests, [5], 'sub').sort(),
      [1, 2, 4, 5]
    );
    assert.deepStrictEqual(
      getTakenSeasons(requests, [5], undefined).sort(),
      [1, 2, 4, 5]
    );
  });

  it('counts only dub and both requests for the dub', () => {
    assert.deepStrictEqual(
      getTakenSeasons(requests, [5], 'dub').sort(),
      [3, 4]
    );
  });

  it('needs both versions covered for both', () => {
    assert.deepStrictEqual(
      getTakenSeasons(
        [...requests, request('dub', [1, 5])],
        [5],
        'both'
      ).sort(),
      [1, 4, 5]
    );
  });
});

describe('getTakenSeasons with dub availability', () => {
  it('blocks a dub season that Plex already has in the dub', () => {
    assert.deepStrictEqual(getTakenSeasons([], [1], 'dub', [2]), [2]);
    assert.deepStrictEqual(getTakenSeasons([], [1, 2], 'both', [2]), [2]);
    assert.deepStrictEqual(getTakenSeasons([], [1], 'sub', [2]), [1]);
  });
});

describe('getRequestSeasonStatus', () => {
  const season = (status: MediaStatus, statusDub: MediaStatus) => ({
    status,
    status4k: MediaStatus.UNKNOWN,
    statusDub,
  });
  const { AVAILABLE, UNKNOWN } = MediaStatus;

  it('follows the dub status for a dub request when the dub is tracked', () => {
    const request = { is4k: false, animeAudio: 'dub' as const };
    assert.strictEqual(
      getRequestSeasonStatus(season(AVAILABLE, UNKNOWN), request, true),
      UNKNOWN
    );
    assert.strictEqual(
      getRequestSeasonStatus(season(AVAILABLE, UNKNOWN), request, false),
      AVAILABLE
    );
  });

  it('needs both versions for a both request', () => {
    const request = { is4k: false, animeAudio: 'both' as const };
    assert.strictEqual(
      getRequestSeasonStatus(season(AVAILABLE, UNKNOWN), request, true),
      UNKNOWN
    );
    assert.strictEqual(
      getRequestSeasonStatus(season(AVAILABLE, AVAILABLE), request, true),
      AVAILABLE
    );
  });
});
