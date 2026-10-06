import defineMessages from '@app/utils/defineMessages';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/solid';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Settings.LibraryItem', {
  animeAudio: 'Anime',
  notAnime: 'Not Anime',
  animeSub: 'Anime (Subbed)',
  animeDub: 'Anime (Dubbed)',
});

type LibraryAnimeAudio = 'sub' | 'dub';

interface LibraryItemProps {
  isEnabled?: boolean;
  name: string;
  onToggle: () => void;
  animeAudio?: LibraryAnimeAudio;
  // Shown only when given, for Plex show libraries
  onAnimeAudioChange?: (animeAudio: LibraryAnimeAudio | null) => void;
}

const LibraryItem = ({
  isEnabled,
  name,
  onToggle,
  animeAudio,
  onAnimeAudioChange,
}: LibraryItemProps) => {
  const intl = useIntl();

  return (
    <li className="col-span-1 flex rounded-md shadow-sm">
      <div className="flex flex-1 items-center justify-between truncate rounded-md border-b border-r border-t border-gray-700 bg-gray-600">
        <div
          className={`flex-1 cursor-default truncate px-4 text-sm leading-5 ${
            onAnimeAudioChange ? 'py-3' : 'py-6'
          }`}
        >
          {name}
          {onAnimeAudioChange && (
            <select
              aria-label={intl.formatMessage(messages.animeAudio)}
              className="mt-2 block w-full py-1 text-xs"
              value={animeAudio ?? ''}
              onChange={(e) =>
                onAnimeAudioChange(
                  e.target.value === ''
                    ? null
                    : (e.target.value as LibraryAnimeAudio)
                )
              }
            >
              <option value="">{intl.formatMessage(messages.notAnime)}</option>
              <option value="sub">
                {intl.formatMessage(messages.animeSub)}
              </option>
              <option value="dub">
                {intl.formatMessage(messages.animeDub)}
              </option>
            </select>
          )}
        </div>
        <div className="flex-shrink-0 pr-2">
          <span
            role="checkbox"
            tabIndex={0}
            aria-checked={isEnabled}
            onClick={() => onToggle()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onToggle();
              }
            }}
            className={`${
              isEnabled ? 'bg-indigo-600' : 'bg-gray-700'
            } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring`}
          >
            <span
              aria-hidden="true"
              className={`${
                isEnabled ? 'translate-x-5' : 'translate-x-0'
              } relative inline-block h-5 w-5 rounded-full bg-white shadow transition duration-200 ease-in-out`}
            >
              <span
                className={`${
                  isEnabled
                    ? 'opacity-0 duration-100 ease-out'
                    : 'opacity-100 duration-200 ease-in'
                } absolute inset-0 flex h-full w-full items-center justify-center transition-opacity`}
              >
                <XMarkIcon className="h-3 w-3 text-gray-400" />
              </span>
              <span
                className={`${
                  isEnabled
                    ? 'opacity-100 duration-200 ease-in'
                    : 'opacity-0 duration-100 ease-out'
                } absolute inset-0 flex h-full w-full items-center justify-center transition-opacity`}
              >
                <CheckIcon className="h-3 w-3 text-indigo-600" />
              </span>
            </span>
          </span>
        </div>
      </div>
    </li>
  );
};

export default LibraryItem;
