import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { HistoryRecord } from '@server/api/servarr/base';
import { MediaType } from '@server/constants/media';
import { findReleasesToBlocklist, isSingleItem } from '@server/lib/issueRetry';

const record = (
  id: number,
  eventType: string,
  date: string,
  extra: Partial<HistoryRecord> = {}
): HistoryRecord => ({ id, eventType, date, ...extra });

describe('findReleasesToBlocklist', () => {
  it('picks the grab of the release that was imported last for a movie', () => {
    const history = [
      record(1, 'grabbed', '2026-01-01', { downloadId: 'old' }),
      record(2, 'downloadFolderImported', '2026-01-02', { downloadId: 'old' }),
      record(3, 'grabbed', '2026-02-01', { downloadId: 'new' }),
      record(4, 'downloadFolderImported', '2026-02-02', { downloadId: 'new' }),
    ];

    assert.deepEqual(findReleasesToBlocklist(history), [3]);
  });

  it('skips a file imported by hand', () => {
    const history = [
      record(1, 'grabbed', '2026-01-01', { downloadId: 'a' }),
      record(2, 'downloadFolderImported', '2026-01-02', { downloadId: 'a' }),
      record(3, 'movieFolderImported', '2026-03-01'),
    ];

    assert.deepEqual(findReleasesToBlocklist(history), []);
  });

  it('blocklists a season pack once and only for the given episodes', () => {
    const history = [
      record(1, 'grabbed', '2026-01-01', { downloadId: 'pack', episodeId: 10 }),
      record(2, 'grabbed', '2026-01-01', { downloadId: 'pack', episodeId: 11 }),
      record(3, 'downloadFolderImported', '2026-01-02', {
        downloadId: 'pack',
        episodeId: 10,
      }),
      record(4, 'downloadFolderImported', '2026-01-02', {
        downloadId: 'pack',
        episodeId: 11,
      }),
      record(5, 'grabbed', '2026-01-03', {
        downloadId: 'other',
        episodeId: 20,
      }),
      record(6, 'downloadFolderImported', '2026-01-04', {
        downloadId: 'other',
        episodeId: 20,
      }),
    ];

    const result = findReleasesToBlocklist(history, [10, 11]);
    assert.equal(result.length, 1);
    assert.ok([1, 2].includes(result[0]));
    assert.deepEqual(findReleasesToBlocklist(history, [20]), [5]);
  });

  it('ignores a grab that was never imported', () => {
    const history = [
      record(1, 'grabbed', '2026-01-01', { downloadId: 'a', episodeId: 10 }),
      record(2, 'downloadFolderImported', '2026-01-02', {
        downloadId: 'a',
        episodeId: 10,
      }),
      record(3, 'grabbed', '2026-02-01', { downloadId: 'b', episodeId: 10 }),
    ];

    assert.deepEqual(findReleasesToBlocklist(history, [10]), [1]);
  });
});

describe('isSingleItem', () => {
  const issue = (
    mediaType: MediaType,
    problemSeason: number,
    problemEpisode: number
  ) => ({ media: { mediaType }, problemSeason, problemEpisode });

  it('allows a movie and a single episode', () => {
    assert.equal(isSingleItem(issue(MediaType.MOVIE, 0, 0)), true);
    assert.equal(isSingleItem(issue(MediaType.TV, 2, 5)), true);
  });

  it('refuses a whole season or series', () => {
    assert.equal(isSingleItem(issue(MediaType.TV, 2, 0)), false);
    assert.equal(isSingleItem(issue(MediaType.TV, 0, 0)), false);
  });
});
