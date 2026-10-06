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
 * tier. Media availability only describes the original-language version,
 * since the dubbed library is not scanned, so it never blocks a dub request.
 */
export const getTakenSeasons = (
  requests: {
    animeAudio?: AnimeAudio | null;
    seasons: { seasonNumber: number }[];
  }[],
  availableSeasons: number[],
  audio?: AnimeAudio | null
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

  const dubTaken = seasonsFor(coversDub);

  if (audio === 'dub') {
    return dubTaken;
  }

  return subTaken.filter((seasonNumber) => dubTaken.includes(seasonNumber));
};
