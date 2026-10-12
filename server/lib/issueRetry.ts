import PlexAPI from '@server/api/plexapi';
import type { HistoryRecord } from '@server/api/servarr/base';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { getRepository } from '@server/datasource';
import Issue from '@server/entity/Issue';
import type Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { findAnimeDubSonarr } from '@server/lib/animeAudio';
import notificationManager, { Notification } from '@server/lib/notifications';
import type { DVRSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { In } from 'typeorm';

/**
 * Progress of "Delete media and retry", in the order the reporting user sees
 * it. `deleted` means the files are gone but the new search has not started
 * yet; the tracker keeps trying to start it.
 */
export type IssueRetryStatus =
  | 'deleted'
  | 'searching'
  | 'downloading'
  | 'added'
  | 'failed';

/**
 * Which copy to replace: the regular one, the 4K one, or the English dub
 * kept by the dubs-only Sonarr.
 */
export type IssueRetryTarget = 'standard' | '4k' | 'dub';

export const ISSUE_RETRY_TARGETS: readonly IssueRetryTarget[] = [
  'standard',
  '4k',
  'dub',
];

export interface IssueRetryData {
  target: IssueRetryTarget;
  serviceId: number;
  // Radarr movie id or Sonarr series id
  externalId: number;
  seasonNumber?: number;
  // Episodes that have to come back before the media counts as added
  episodeIds?: number[];
  error?: string;
  updatedAt: string;
}

const ACTIVE_STATUSES: IssueRetryStatus[] = [
  'deleted',
  'searching',
  'downloading',
];

const IMPORT_EVENTS = [
  'downloadFolderImported',
  'movieFolderImported',
  'seriesFolderImported',
];

export const isIssueRetryTarget = (value: unknown): value is IssueRetryTarget =>
  typeof value === 'string' &&
  (ISSUE_RETRY_TARGETS as readonly string[]).includes(value);

/**
 * The grab records of the releases that are on disk now, so they can be
 * marked as failed. For each movie or episode the newest import names the
 * current file; its download id leads back to the grab. Files imported by
 * hand have no download id and are skipped, since there is no release to
 * blocklist.
 */
export const findReleasesToBlocklist = (
  history: HistoryRecord[],
  episodeIds?: number[]
): number[] => {
  const newestFirst = [...history].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const keyOf = (record: HistoryRecord) =>
    episodeIds ? record.episodeId : 'movie';

  const latestImports = new Map<unknown, HistoryRecord>();
  for (const record of newestFirst) {
    if (!IMPORT_EVENTS.includes(record.eventType)) {
      continue;
    }
    if (
      episodeIds &&
      (record.episodeId == null || !episodeIds.includes(record.episodeId))
    ) {
      continue;
    }
    if (!latestImports.has(keyOf(record))) {
      latestImports.set(keyOf(record), record);
    }
  }

  const downloadIds = new Set(
    [...latestImports.values()]
      .map((record) => record.downloadId)
      .filter((downloadId): downloadId is string => !!downloadId)
  );

  const grabIds: number[] = [];
  for (const downloadId of downloadIds) {
    const grab = newestFirst.find(
      (record) =>
        record.eventType === 'grabbed' && record.downloadId === downloadId
    );
    if (grab) {
      grabIds.push(grab.id);
    }
  }

  return grabIds;
};

const findServer = (
  media: Media,
  target: IssueRetryTarget
): DVRSettings | undefined => {
  const settings = getSettings();
  const isMovie = media.mediaType === MediaType.MOVIE;

  if (target === 'dub') {
    return isMovie ? undefined : findAnimeDubSonarr(settings.sonarr, false);
  }

  const is4k = target === '4k';
  const servers: DVRSettings[] = isMovie
    ? settings.radarr
    : settings.sonarr.filter((server) => !server.isAnimeDub);
  const serviceId = is4k ? media.serviceId4k : media.serviceId;

  return (
    servers.find((server) => server.id === serviceId) ??
    servers.find((server) => server.isDefault && server.is4k === is4k)
  );
};

const getTvdbId = async (media: Media): Promise<number> => {
  if (media.tvdbId) {
    return media.tvdbId;
  }

  const tmdb = new TheMovieDb();
  const series = await tmdb.getTvShow({ tvId: media.tmdbId });
  const tvdbId = series.external_ids.tvdb_id;

  if (!tvdbId) {
    throw new Error('TVDB ID not found');
  }

  return tvdbId;
};

const radarrFor = (server: DVRSettings) =>
  new RadarrAPI({
    apiKey: server.apiKey,
    url: RadarrAPI.buildUrl(server, '/api/v3'),
  });

const sonarrFor = (server: DVRSettings) =>
  new SonarrAPI({
    apiKey: server.apiKey,
    url: SonarrAPI.buildUrl(server, '/api/v3'),
  });

/**
 * The copies of this media that can be deleted and fetched again: those
 * whose server is configured and has the movie or series.
 */
export const getRetryTargets = async (
  media: Media
): Promise<IssueRetryTarget[]> => {
  const isMovie = media.mediaType === MediaType.MOVIE;
  const candidates = ISSUE_RETRY_TARGETS.map((target) => ({
    target,
    server: findServer(media, target),
  })).filter(
    (
      candidate
    ): candidate is { target: IssueRetryTarget; server: DVRSettings } =>
      !!candidate.server
  );

  const found = await Promise.all(
    candidates.map(async ({ target, server }) => {
      try {
        if (isMovie) {
          const movies = await radarrFor(server).getLibraryMoviesByTmdbId(
            media.tmdbId
          );
          return movies.length > 0 ? target : undefined;
        }

        const series = await sonarrFor(server).getLibrarySeriesByTvdbId(
          await getTvdbId(media)
        );
        return series.length > 0 ? target : undefined;
      } catch (e) {
        logger.debug('Could not check a server for delete and retry', {
          label: 'Issue Retry',
          mediaId: media.id,
          server: server.name,
          errorMessage: e.message,
        });
        return undefined;
      }
    })
  );

  return found.filter((target): target is IssueRetryTarget => !!target);
};

const saveRetry = async (
  issue: Issue,
  status: IssueRetryStatus,
  data: Omit<IssueRetryData, 'updatedAt'>
): Promise<void> => {
  issue.retryStatus = status;
  issue.retryData = { ...data, updatedAt: new Date().toISOString() };

  await getRepository(Issue).update(issue.id, {
    retryStatus: issue.retryStatus,
    retryData: issue.retryData,
  });
};

const markFailed = async (
  service: RadarrAPI | SonarrAPI,
  historyIds: number[],
  issue: Issue
) => {
  for (const historyId of historyIds) {
    try {
      await service.markHistoryFailed(historyId);
    } catch (e) {
      // The file is already gone, so carry on and search anyway
      logger.warn('Could not blocklist the deleted release', {
        label: 'Issue Retry',
        issueId: issue.id,
        historyId,
        errorMessage: e.message,
      });
    }
  }
};

const retryMovie = async (
  issue: Issue,
  target: IssueRetryTarget,
  server: DVRSettings
) => {
  const radarr = radarrFor(server);
  const [movie] = await radarr.getLibraryMoviesByTmdbId(issue.media.tmdbId);

  if (!movie) {
    throw new Error(`The movie is not in ${server.name}`);
  }

  const history = movie.hasFile ? await radarr.getMovieHistory(movie.id) : [];
  const releases = findReleasesToBlocklist(history);
  const data = { target, serviceId: server.id, externalId: movie.id };

  if (movie.movieFile) {
    await radarr.deleteMovieFile(movie.movieFile.id);
  }
  await saveRetry(issue, 'deleted', data);

  if (!movie.monitored) {
    await radarr.setMovieMonitored(movie);
  }
  await markFailed(radarr, releases, issue);
  await radarr.startMovieSearch(movie.id);
  await saveRetry(issue, 'searching', data);
};

const retrySeries = async (
  issue: Issue,
  target: IssueRetryTarget,
  server: DVRSettings
) => {
  const sonarr = sonarrFor(server);
  const [series] = await sonarr.getLibrarySeriesByTvdbId(
    await getTvdbId(issue.media)
  );

  if (!series?.id) {
    throw new Error(`The series is not in ${server.name}`);
  }

  const episode = (await sonarr.getEpisodes(series.id)).find(
    (episode) =>
      episode.seasonNumber === issue.problemSeason &&
      episode.episodeNumber === issue.problemEpisode
  );

  if (!episode) {
    throw new Error(`The episode is not in ${server.name}`);
  }

  const hasFile = episode.hasFile && episode.episodeFileId > 0;
  const history = hasFile ? await sonarr.getSeriesHistory(series.id) : [];
  const releases = findReleasesToBlocklist(history, [episode.id]);
  const data = {
    target,
    serviceId: server.id,
    externalId: series.id,
    seasonNumber: episode.seasonNumber,
    episodeIds: [episode.id],
  };

  if (hasFile) {
    await sonarr.deleteEpisodeFile(episode.episodeFileId);
  }
  await saveRetry(issue, 'deleted', data);

  // Sonarr can unmonitor deleted episodes, and an unmonitored series or
  // season would not pick up a new release later
  if (
    !series.monitored ||
    series.seasons.some(
      (season) =>
        season.seasonNumber === episode.seasonNumber && !season.monitored
    )
  ) {
    await sonarr.monitorSeries(series, [episode.seasonNumber]);
  }
  await sonarr.monitorEpisodes([episode.id]);

  await markFailed(sonarr, releases, issue);
  await sonarr.searchEpisodes([episode.id]);
  await saveRetry(issue, 'searching', data);
};

/**
 * Only one movie or one episode can be deleted, never a whole season or
 * series.
 */
export const isSingleItem = (
  issue: Pick<Issue, 'problemSeason' | 'problemEpisode'> & {
    media: Pick<Media, 'mediaType'>;
  }
): boolean =>
  issue.media.mediaType === MediaType.MOVIE ||
  (issue.problemSeason > 0 && issue.problemEpisode > 0);

const sendRetryNotification = async (
  issue: Issue,
  user: User,
  target: IssueRetryTarget
) => {
  try {
    const tmdb = new TheMovieDb();
    let subject: string;
    let posterPath: string | undefined;
    const extra: { name: string; value: string }[] = [];

    if (issue.media.mediaType === MediaType.MOVIE) {
      const movie = await tmdb.getMovie({ movieId: issue.media.tmdbId });
      subject = `${movie.title}${
        movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ''
      }`;
      posterPath = movie.poster_path;
    } else {
      const tvshow = await tmdb.getTvShow({ tvId: issue.media.tmdbId });
      subject = `${tvshow.name}${
        tvshow.first_air_date ? ` (${tvshow.first_air_date.slice(0, 4)})` : ''
      }`;
      posterPath = tvshow.poster_path;
      extra.push(
        { name: 'Affected Season', value: issue.problemSeason.toString() },
        { name: 'Affected Episode', value: issue.problemEpisode.toString() }
      );
    }

    if (target !== 'standard') {
      extra.push({
        name: 'Version',
        value: target === 'dub' ? 'English dub' : '4K',
      });
    }

    notificationManager.sendNotification(Notification.ISSUE_MEDIA_RETRIED, {
      event: 'Media Deleted and Retried',
      subject,
      message: `${user.displayName} deleted the ${
        issue.media.mediaType === MediaType.MOVIE ? 'movie' : 'episode'
      }, blocked the release and started a new search.`,
      issue,
      media: issue.media,
      image: posterPath
        ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${posterPath}`
        : undefined,
      extra,
      notifyAdmin: true,
      notifySystem: true,
    });
  } catch (e) {
    logger.error('Failed to send the delete and retry notification', {
      label: 'Notifications',
      issueId: issue.id,
      errorMessage: e.message,
    });
  }
};

/**
 * Deletes the media an issue is about from Radarr or Sonarr, blocklists the
 * release that was on disk and starts a new search. The issue's retry
 * status is kept up to date as it goes.
 */
export const retryIssueMedia = async (
  issue: Issue,
  target: IssueRetryTarget,
  user: User
): Promise<void> => {
  if (!isSingleItem(issue)) {
    throw new Error('Only a movie or a single episode can be deleted');
  }

  const server = findServer(issue.media, target);

  if (!server) {
    throw new Error('No server is configured for this media');
  }

  logger.info('Deleting media and searching again', {
    label: 'Issue Retry',
    issueId: issue.id,
    mediaId: issue.media.id,
    target,
    server: server.name,
  });

  // A new attempt starts over
  issue.retryStatus = null;

  try {
    if (issue.media.mediaType === MediaType.MOVIE) {
      await retryMovie(issue, target, server);
    } else {
      await retrySeries(issue, target, server);
    }
  } catch (e) {
    // The files are gone even though the search did not start
    if (issue.retryStatus === 'deleted') {
      await sendRetryNotification(issue, user, target);
    }

    logger.error('Delete and retry failed', {
      label: 'Issue Retry',
      issueId: issue.id,
      errorMessage: e.message,
    });

    // Once the files are gone the tracker keeps trying the search
    if (issue.retryStatus !== 'deleted') {
      await saveRetry(issue, 'failed', {
        target,
        serviceId: server.id,
        externalId: issue.retryData?.externalId ?? 0,
        error: e.message,
      });
    }

    throw e;
  }

  await sendRetryNotification(issue, user, target);
};

/**
 * Asks the main Plex server to scan the libraries that hold this media, so
 * the new file shows up without waiting for the next scheduled scan. A dub
 * goes to the libraries marked as dubbed, anything else to the others.
 */
const refreshPlexLibraries = async (issue: Issue, target: IssueRetryTarget) => {
  const settings = getSettings();

  if (settings.main.mediaServerType !== MediaServerType.PLEX) {
    return;
  }

  const type = issue.media.mediaType === MediaType.MOVIE ? 'movie' : 'show';
  const libraries = settings.plex.libraries.filter(
    (library) =>
      library.enabled &&
      library.type === type &&
      (target === 'dub') === (library.animeAudio === 'dub')
  );

  if (libraries.length === 0) {
    return;
  }

  const admin = await getRepository(User).findOne({
    select: { id: true, plexToken: true },
    where: { id: 1 },
  });

  if (!admin?.plexToken) {
    return;
  }

  const plex = new PlexAPI({ plexToken: admin.plexToken });

  for (const library of libraries) {
    try {
      await plex.refreshLibrary(library.id);
      logger.info('Asked Plex to scan a library after delete and retry', {
        label: 'Issue Retry',
        issueId: issue.id,
        library: library.name,
      });
    } catch (e) {
      logger.warn('Could not ask Plex to scan a library', {
        label: 'Issue Retry',
        issueId: issue.id,
        library: library.name,
        errorMessage: e.message,
      });
    }
  }
};

const checkIssue = async (issue: Issue): Promise<void> => {
  const data = issue.retryData;
  if (!data) {
    return;
  }

  const settings = getSettings();
  const isMovie = issue.media.mediaType === MediaType.MOVIE;
  const server = (isMovie ? settings.radarr : settings.sonarr).find(
    (server) => server.id === data.serviceId
  );

  if (!server) {
    await saveRetry(issue, 'failed', {
      ...data,
      error: 'The server is no longer configured',
    });
    return;
  }

  let status: IssueRetryStatus;

  if (isMovie) {
    const radarr = radarrFor(server);

    if (issue.retryStatus === 'deleted') {
      await radarr.startMovieSearch(data.externalId);
      status = 'searching';
    } else if ((await radarr.getMovie({ id: data.externalId })).hasFile) {
      status = 'added';
    } else {
      const queue = await radarr.getMovieQueue(data.externalId);
      status = queue.length > 0 ? 'downloading' : 'searching';
    }
  } else {
    const sonarr = sonarrFor(server);
    const episodeIds = data.episodeIds ?? [];

    if (issue.retryStatus === 'deleted') {
      await sonarr.searchEpisodes(episodeIds);
      status = 'searching';
    } else {
      const episodes = (await sonarr.getEpisodes(data.externalId)).filter(
        (episode) => episodeIds.includes(episode.id)
      );

      if (episodes.length > 0 && episodes.every((episode) => episode.hasFile)) {
        status = 'added';
      } else {
        const queue = await sonarr.getSeriesQueue(data.externalId);
        status = queue.some(
          (item) =>
            item.episodeId != null && episodeIds.includes(item.episodeId)
        )
          ? 'downloading'
          : 'searching';
      }
    }
  }

  if (status !== issue.retryStatus) {
    await saveRetry(issue, status, data);

    if (status === 'added') {
      await refreshPlexLibraries(issue, data.target);
    }
  }
};

class IssueRetryTracker {
  private running = false;

  /**
   * Moves each running delete and retry along: searching, downloading, then
   * added once Radarr or Sonarr has the files again.
   */
  public async update(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    try {
      const issues = await getRepository(Issue).find({
        where: { retryStatus: In(ACTIVE_STATUSES) },
      });

      for (const issue of issues) {
        try {
          await checkIssue(issue);
        } catch (e) {
          logger.debug('Could not check delete and retry progress', {
            label: 'Issue Retry',
            issueId: issue.id,
            errorMessage: e.message,
          });
        }
      }
    } catch (e) {
      logger.error('Failed to update delete and retry progress', {
        label: 'Issue Retry',
        errorMessage: e.message,
      });
    } finally {
      this.running = false;
    }
  }
}

export const issueRetryTracker = new IssueRetryTracker();
