import { MediaStatus } from '@server/constants/media';
import type { SonarrSettings } from '@server/lib/settings';

/**
 * Which version of an anime series a request asks for: the original
 * language with subtitles, the English dub, or both. Requests made before
 * this choice existed have no value and are treated as 'sub'.
 */
export type AnimeAudio = 'sub' | 'dub' | 'both';

export const ANIME_AUDIO_VALUES: readonly AnimeAudio[] = ['sub', 'dub', 'both'];

export const isAnimeAudio = (value: unknown): value is AnimeAudio =>
  typeof value === 'string' &&
  (ANIME_AUDIO_VALUES as readonly string[]).includes(value);

export const coversSub = (audio?: AnimeAudio | null): boolean =>
  audio !== 'dub';

export const coversDub = (audio?: AnimeAudio | null): boolean =>
  audio === 'dub' || audio === 'both';

/**
 * The dubs-only Sonarr server for the given tier, if one is configured.
 */
export const findAnimeDubSonarr = <
  T extends Pick<SonarrSettings, 'is4k' | 'isAnimeDub'>,
>(
  servers: T[],
  is4k: boolean
): T | undefined =>
  servers.find((server) => server.isAnimeDub && server.is4k === is4k);

/**
 * Seasons that can no longer be requested for the given audio.
 *
 * `requests` must already be narrowed to the active requests of the same
 * tier. `availableSeasons` describes the original-language version and
 * `availableDubSeasons` the English dub, which is only known when a Plex
 * library is marked as dubbed.
 */
export const getTakenSeasons = (
  requests: {
    animeAudio?: AnimeAudio | null;
    seasons: { seasonNumber: number }[];
  }[],
  availableSeasons: number[],
  audio?: AnimeAudio | null,
  availableDubSeasons: number[] = []
): number[] => {
  const seasonsFor = (covers: (a?: AnimeAudio | null) => boolean) =>
    requests
      .filter((request) => covers(request.animeAudio))
      .flatMap((request) =>
        request.seasons.map((season) => season.seasonNumber)
      );

  const subTaken = [...seasonsFor(coversSub), ...availableSeasons];

  if (!coversDub(audio)) {
    return subTaken;
  }

  const dubTaken = [...seasonsFor(coversDub), ...availableDubSeasons];

  if (audio === 'dub') {
    return dubTaken;
  }

  return subTaken.filter((seasonNumber) => dubTaken.includes(seasonNumber));
};

type SeasonStatuses = Record<'status' | 'status4k' | 'statusDub', MediaStatus>;

/**
 * Whether English dub availability is recorded, which needs an enabled Plex
 * library marked as dubbed.
 */
export const isDubTracked = (
  libraries: { enabled: boolean; animeAudio?: string }[]
): boolean =>
  libraries.some((library) => library.enabled && library.animeAudio === 'dub');

/**
 * The status that decides whether a request's season is done. A dub
 * request follows the dub status once a Plex library is marked as dubbed,
 * and a request for both needs both versions.
 */
export const getRequestSeasonStatus = (
  season: SeasonStatuses,
  request: { is4k: boolean; animeAudio?: AnimeAudio | null },
  dubTracked: boolean
): MediaStatus => {
  if (request.is4k) {
    return season.status4k;
  }

  if (!dubTracked || !coversDub(request.animeAudio)) {
    return season.status;
  }

  if (request.animeAudio === 'dub') {
    return season.statusDub;
  }

  // Both: done only once each version is available
  if (
    season.status === MediaStatus.AVAILABLE &&
    season.statusDub === MediaStatus.AVAILABLE
  ) {
    return MediaStatus.AVAILABLE;
  }

  return season.status === MediaStatus.DELETED
    ? MediaStatus.DELETED
    : MediaStatus.UNKNOWN;
};
