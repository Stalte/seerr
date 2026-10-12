import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import { issueOptions } from '@app/components/IssueModal/constants';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Label, Radio, RadioGroup } from '@headlessui/react';
import { ArrowRightCircleIcon } from '@heroicons/react/24/solid';
import { MediaStatus } from '@server/constants/media';
import type Issue from '@server/entity/Issue';
import type { IssueRetryTarget } from '@server/lib/issueRetry';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import { Field, Formik } from 'formik';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';
import * as Yup from 'yup';

const messages = defineMessages('components.IssueModal.CreateIssueModal', {
  validationMessageRequired: 'You must provide a description',
  whatswrong: "What's wrong?",
  providedetail:
    'Please provide a detailed explanation of the issue you encountered.',
  extras: 'Extras',
  season: 'Season {seasonNumber}',
  episode: 'Episode {episodeNumber}',
  allseasons: 'All Seasons',
  allepisodes: 'All Episodes',
  problemseason: 'Affected Season',
  problemepisode: 'Affected Episode',
  toastSuccessCreate:
    'Issue report for <strong>{title}</strong> submitted successfully!',
  toastFailedCreate: 'Something went wrong while submitting the issue.',
  toastviewissue: 'View Issue',
  reportissue: 'Report an Issue',
  submitissue: 'Submit Issue',
  deleteandretry: 'Delete and download again',
  deleteandretryDescription:
    'Delete this {mediaType}, block the release that was downloaded and search for a new one.',
  retryMovie: 'movie',
  retryEpisode: 'episode',
  whichversion: 'Version',
  standard: 'Standard',
  original: 'Original with subtitles',
  fourk: '4K',
  dub: 'English dub',
  toastRetryStarted: 'Media deleted. Searching again.',
  toastRetryFailed:
    'The issue was reported, but something went wrong while deleting the media.',
});

const isMovie = (movie: MovieDetails | TvDetails): movie is MovieDetails => {
  return (movie as MovieDetails).title !== undefined;
};

const classNames = (...classes: string[]) => {
  return classes.filter(Boolean).join(' ');
};

interface CreateIssueModalProps {
  mediaType: 'movie' | 'tv';
  tmdbId?: number;
  onCancel?: () => void;
}

const CreateIssueModal = ({
  onCancel,
  mediaType,
  tmdbId,
}: CreateIssueModalProps) => {
  const intl = useIntl();
  const settings = useSettings();
  const { hasPermission } = useUser();
  const { addToast } = useToasts();
  const { data, error } = useSWR<MovieDetails | TvDetails>(
    tmdbId ? `/api/v1/${mediaType}/${tmdbId}` : null
  );
  const canRetry = hasPermission(
    [Permission.MANAGE_ISSUES, Permission.RETRY_ISSUE_MEDIA],
    { type: 'or' }
  );
  const { data: retryData } = useSWR<{ targets: IssueRetryTarget[] }>(
    canRetry && data?.mediaInfo?.id
      ? `/api/v1/issue/retry-targets?mediaId=${data.mediaInfo.id}`
      : null
  );
  const retryTargets = retryData?.targets ?? [];

  const targetLabel = (target: IssueRetryTarget) => {
    switch (target) {
      case 'dub':
        return intl.formatMessage(messages.dub);
      case '4k':
        return intl.formatMessage(messages.fourk);
      default:
        return intl.formatMessage(
          retryTargets.includes('dub') ? messages.original : messages.standard
        );
    }
  };

  if (!tmdbId) {
    return null;
  }

  const availableSeasons = (data?.mediaInfo?.seasons ?? [])
    .filter(
      (season) =>
        season.status === MediaStatus.AVAILABLE ||
        season.status === MediaStatus.PARTIALLY_AVAILABLE ||
        (settings.currentSettings.series4kEnabled &&
          hasPermission([Permission.REQUEST_4K, Permission.REQUEST_4K_TV], {
            type: 'or',
          }) &&
          (season.status4k === MediaStatus.AVAILABLE ||
            season.status4k === MediaStatus.PARTIALLY_AVAILABLE))
    )
    .map((season) => season.seasonNumber);

  const CreateIssueModalSchema = Yup.object().shape({
    message: Yup.string().required(
      intl.formatMessage(messages.validationMessageRequired)
    ),
  });

  return (
    <Formik
      initialValues={{
        selectedIssue: issueOptions[0],
        message: '',
        problemSeason: availableSeasons.length === 1 ? availableSeasons[0] : 0,
        problemEpisode: 0,
        deleteAndRetry: false,
        retryTarget: '',
      }}
      validationSchema={CreateIssueModalSchema}
      onSubmit={async (values) => {
        try {
          const newIssue = await axios.post<Issue>('/api/v1/issue', {
            issueType: values.selectedIssue.issueType,
            message: values.message,
            mediaId: data?.mediaInfo?.id,
            problemSeason: values.problemSeason,
            problemEpisode:
              values.problemSeason > 0 ? values.problemEpisode : 0,
          });

          // Only a movie or a single episode can be deleted
          const isSingleItem =
            mediaType === 'movie' ||
            (Number(values.problemSeason) > 0 &&
              Number(values.problemEpisode) > 0);

          if (
            values.deleteAndRetry &&
            isSingleItem &&
            retryTargets.length > 0
          ) {
            try {
              await axios.post(`/api/v1/issue/${newIssue.data.id}/retry`, {
                target: values.retryTarget || retryTargets[0],
              });
              addToast(intl.formatMessage(messages.toastRetryStarted), {
                appearance: 'success',
                autoDismiss: true,
              });
            } catch {
              addToast(intl.formatMessage(messages.toastRetryFailed), {
                appearance: 'error',
                autoDismiss: true,
              });
            }
          }

          if (data) {
            addToast(
              <>
                <div>
                  {intl.formatMessage(messages.toastSuccessCreate, {
                    title: isMovie(data) ? data.title : data.name,
                    strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
                  })}
                </div>
                <Link href={`/issues/${newIssue.data.id}`} legacyBehavior>
                  <Button as="a" className="mt-4">
                    <span>{intl.formatMessage(messages.toastviewissue)}</span>
                    <ArrowRightCircleIcon />
                  </Button>
                </Link>
              </>,
              {
                appearance: 'success',
                autoDismiss: true,
              }
            );

            mutate('/api/v1/issue/count');
          }

          if (onCancel) {
            onCancel();
          }
        } catch {
          addToast(intl.formatMessage(messages.toastFailedCreate), {
            appearance: 'error',
            autoDismiss: true,
          });
        }
      }}
    >
      {({ handleSubmit, values, setFieldValue, errors, touched }) => {
        return (
          <Modal
            backgroundClickable
            onCancel={onCancel}
            title={intl.formatMessage(messages.reportissue)}
            subTitle={data && isMovie(data) ? data?.title : data?.name}
            cancelText={intl.formatMessage(globalMessages.close)}
            onOk={() => handleSubmit()}
            okText={intl.formatMessage(messages.submitissue)}
            loading={!data && !error}
            backdrop={`https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${data?.backdropPath}`}
          >
            {mediaType === 'tv' && data && !isMovie(data) && (
              <>
                <div className="form-row">
                  <label htmlFor="problemSeason" className="text-label">
                    {intl.formatMessage(messages.problemseason)}
                    <span className="label-required">*</span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="problemSeason"
                        name="problemSeason"
                        disabled={availableSeasons.length === 1}
                      >
                        {availableSeasons.length > 1 && (
                          <option value={0}>
                            {intl.formatMessage(messages.allseasons)}
                          </option>
                        )}
                        {availableSeasons.map((season) => (
                          <option
                            value={season}
                            key={`problem-season-${season}`}
                          >
                            {season === 0
                              ? intl.formatMessage(messages.extras)
                              : intl.formatMessage(messages.season, {
                                  seasonNumber: season,
                                })}
                          </option>
                        ))}
                      </Field>
                    </div>
                  </div>
                </div>
                {values.problemSeason > 0 && (
                  <div className="form-row mb-2">
                    <label htmlFor="problemEpisode" className="text-label">
                      {intl.formatMessage(messages.problemepisode)}
                      <span className="label-required">*</span>
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <Field
                          as="select"
                          id="problemEpisode"
                          name="problemEpisode"
                        >
                          <option value={0}>
                            {intl.formatMessage(messages.allepisodes)}
                          </option>
                          {[
                            ...Array(
                              data.seasons.find(
                                (season) =>
                                  Number(values.problemSeason) ===
                                  season.seasonNumber
                              )?.episodeCount ?? 0
                            ),
                          ].map((i, index) => (
                            <option
                              value={index + 1}
                              key={`problem-episode-${index + 1}`}
                            >
                              {intl.formatMessage(messages.episode, {
                                episodeNumber: index + 1,
                              })}
                            </option>
                          ))}
                        </Field>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            <RadioGroup
              value={values.selectedIssue}
              onChange={(issue) => setFieldValue('selectedIssue', issue)}
              className="mt-4"
            >
              <Label className="sr-only">Select an Issue</Label>
              <div className="-space-y-px overflow-hidden rounded-md bg-gray-800/30">
                {issueOptions.map((setting, index) => (
                  <Radio
                    key={`issue-type-${setting.issueType}`}
                    as="div"
                    value={setting}
                    className={({ checked }) =>
                      classNames(
                        index === 0 ? 'rounded-tl-md rounded-tr-md' : '',
                        index === issueOptions.length - 1
                          ? 'rounded-bl-md rounded-br-md'
                          : '',
                        checked
                          ? 'z-10 border border-indigo-500 bg-indigo-400/20'
                          : 'border-gray-500',
                        'relative flex cursor-pointer border p-4 focus:outline-none'
                      )
                    }
                  >
                    {({ focus, checked }) => (
                      <>
                        <span
                          className={`${
                            checked
                              ? 'border-transparent bg-indigo-600'
                              : 'border-gray-300 bg-white'
                          } ${
                            focus ? 'ring-2 ring-indigo-300 ring-offset-2' : ''
                          } mt-0.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border`}
                          aria-hidden="true"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        </span>
                        <div className="ml-3 flex flex-col">
                          <Label
                            as="span"
                            className={`block text-sm font-medium ${
                              checked ? 'text-indigo-100' : 'text-gray-100'
                            }`}
                          >
                            {intl.formatMessage(setting.name)}
                          </Label>
                        </div>
                      </>
                    )}
                  </Radio>
                ))}
              </div>
            </RadioGroup>
            <div className="mt-4 flex-col space-y-2">
              <label htmlFor="message">
                {intl.formatMessage(messages.whatswrong)}
                <span className="label-required">*</span>
              </label>
              <Field
                as="textarea"
                name="message"
                id="message"
                className="h-28"
                placeholder={intl.formatMessage(messages.providedetail)}
              />
              {errors.message &&
                touched.message &&
                typeof errors.message === 'string' && (
                  <div className="error">{errors.message}</div>
                )}
            </div>
            {retryTargets.length > 0 &&
              (mediaType === 'movie' ||
                (Number(values.problemSeason) > 0 &&
                  Number(values.problemEpisode) > 0)) && (
                <div className="mt-4 rounded-md border border-gray-700 bg-gray-800/30 p-4">
                  <label
                    htmlFor="deleteAndRetry"
                    className="flex items-start space-x-3"
                  >
                    <Field
                      type="checkbox"
                      id="deleteAndRetry"
                      name="deleteAndRetry"
                      className="mt-1"
                    />
                    <span className="flex flex-col">
                      <span className="font-medium text-gray-100">
                        {intl.formatMessage(messages.deleteandretry)}
                      </span>
                      <span className="text-sm text-gray-400">
                        {intl.formatMessage(
                          messages.deleteandretryDescription,
                          {
                            mediaType: intl.formatMessage(
                              mediaType === 'movie'
                                ? messages.retryMovie
                                : messages.retryEpisode
                            ),
                          }
                        )}
                      </span>
                    </span>
                  </label>
                  {values.deleteAndRetry && retryTargets.length > 1 && (
                    <div className="mt-3 flex items-center space-x-3">
                      <label htmlFor="retryTarget" className="text-sm">
                        {intl.formatMessage(messages.whichversion)}
                      </label>
                      <Field as="select" id="retryTarget" name="retryTarget">
                        {retryTargets.map((target) => (
                          <option value={target} key={`retry-${target}`}>
                            {targetLabel(target)}
                          </option>
                        ))}
                      </Field>
                    </div>
                  )}
                </div>
              )}
          </Modal>
        );
      }}
    </Formik>
  );
};

export default CreateIssueModal;
