import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getTakenSeasons } from '@server/lib/animeAudio';

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
