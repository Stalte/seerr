import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import { TrashIcon } from '@heroicons/react/24/outline';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/solid';
import { MediaType } from '@server/constants/media';
import type Issue from '@server/entity/Issue';
import type {
  IssueRetryStatus,
  IssueRetryTarget,
} from '@server/lib/issueRetry';
import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.IssueDetails.IssueRetry', {
  deleteandretry: 'Delete Media and Retry',
  deleteandretryconfirm:
    'This deletes the {mediaType} from the server, blocks the release that was downloaded and searches for a new one. It will be unavailable until the new download finishes.',
  movie: 'movie',
  episode: 'episode',
  whichversion: 'Which version has the problem?',
  standard: 'Standard',
  original: 'Original with subtitles',
  fourk: '4K',
  dub: 'English dub',
  notargets:
    'This media cannot be deleted and retried because it was not found in Radarr or Sonarr.',
  retrystatus: 'Delete and Retry',
  mediadeleted: 'Media deleted',
  searchingagain: 'Searching again',
  downloading: 'Downloading',
  mediaadded: 'Media added',
  failed: 'Something went wrong. Try again, or ask an admin for help.',
  toastretrystarted: 'Media deleted. Searching again.',
  toastretryfailed: 'Something went wrong while deleting the media.',
});

const ACTIVE_STATUSES: IssueRetryStatus[] = [
  'deleted',
  'searching',
  'downloading',
];

const STEPS = [
  messages.mediadeleted,
  messages.searchingagain,
  messages.downloading,
  messages.mediaadded,
];

// Statuses in the order of the steps they finish: once the files are
// deleted the search is next, and so on
const STATUS_ORDER: IssueRetryStatus[] = [
  'deleted',
  'searching',
  'downloading',
  'added',
];

interface IssueRetryProps {
  issue: Issue;
  canRetry: boolean;
  onUpdate: () => void;
}

const IssueRetry = ({ issue, canRetry, onUpdate }: IssueRetryProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [target, setTarget] = useState<IssueRetryTarget | undefined>();
  const { data: targetData } = useSWR<{ targets: IssueRetryTarget[] }>(
    showModal ? `/api/v1/issue/${issue.id}/retry` : null
  );
  const targets = useMemo(() => targetData?.targets ?? [], [targetData]);
  const status = issue.retryStatus ?? undefined;
  const isActive = !!status && ACTIVE_STATUSES.includes(status);

  // Keep the status moving while the new copy is on its way
  useEffect(() => {
    if (!isActive) {
      return;
    }
    const interval = setInterval(onUpdate, 15000);
    return () => clearInterval(interval);
  }, [isActive, onUpdate]);

  useEffect(() => {
    if (targets.length > 0 && (!target || !targets.includes(target))) {
      setTarget(targets[0]);
    }
  }, [targets, target]);

  const targetLabel = (option: IssueRetryTarget) => {
    switch (option) {
      case 'dub':
        return intl.formatMessage(messages.dub);
      case '4k':
        return intl.formatMessage(messages.fourk);
      default:
        return intl.formatMessage(
          targets.includes('dub') ? messages.original : messages.standard
        );
    }
  };

  const mediaTypeLabel = () =>
    intl.formatMessage(
      issue.media.mediaType === MediaType.MOVIE
        ? messages.movie
        : messages.episode
    );

  const retry = async () => {
    setSubmitting(true);
    try {
      await axios.post(`/api/v1/issue/${issue.id}/retry`, { target });
      addToast(intl.formatMessage(messages.toastretrystarted), {
        appearance: 'success',
        autoDismiss: true,
      });
      setShowModal(false);
    } catch {
      addToast(intl.formatMessage(messages.toastretryfailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setSubmitting(false);
      onUpdate();
    }
  };

  const reached = status ? STATUS_ORDER.indexOf(status) : -1;
  const currentStep = status === 'added' ? STEPS.length : Math.max(reached, 1);

  return (
    <>
      <Transition
        as="div"
        enter="transition-opacity duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        show={showModal}
      >
        <Modal
          title={intl.formatMessage(messages.deleteandretry)}
          onCancel={() => setShowModal(false)}
          onOk={() => retry()}
          okText={intl.formatMessage(messages.deleteandretry)}
          okButtonType="danger"
          okDisabled={submitting || !target}
          loading={!targetData}
        >
          <p>
            {intl.formatMessage(messages.deleteandretryconfirm, {
              mediaType: mediaTypeLabel(),
            })}
          </p>
          {targetData && targets.length === 0 && (
            <p className="mt-4 text-red-400">
              {intl.formatMessage(messages.notargets)}
            </p>
          )}
          {targets.length > 1 && (
            <div className="mt-4">
              <div className="mb-2 font-semibold text-gray-100">
                {intl.formatMessage(messages.whichversion)}
              </div>
              {targets.map((option) => (
                <label
                  key={`retry-target-${option}`}
                  className="flex items-center space-x-2 py-1"
                >
                  <input
                    type="radio"
                    name="retryTarget"
                    checked={target === option}
                    onChange={() => setTarget(option)}
                  />
                  <span>{targetLabel(option)}</span>
                </label>
              ))}
            </div>
          )}
        </Modal>
      </Transition>
      {status && (
        <div className="mt-6 rounded-md border border-gray-700 bg-gray-800 p-4">
          <div className="mb-3 font-semibold text-gray-100">
            {intl.formatMessage(messages.retrystatus)}
          </div>
          {status === 'failed' ? (
            <div className="flex items-center text-red-400">
              <ExclamationTriangleIcon className="mr-2 h-5 w-5" />
              <span>{intl.formatMessage(messages.failed)}</span>
            </div>
          ) : (
            <ol className="space-y-2">
              {STEPS.map((step, index) => {
                const done = index < currentStep;
                const current = index === currentStep;

                return (
                  <li
                    key={`retry-step-${index}`}
                    className={`flex items-center ${
                      done
                        ? 'text-green-400'
                        : current
                          ? 'text-gray-100'
                          : 'text-gray-500'
                    }`}
                  >
                    {done ? (
                      <CheckCircleIcon className="mr-2 h-5 w-5" />
                    ) : current ? (
                      <ArrowPathIcon className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      <span className="mr-2 h-5 w-5" />
                    )}
                    <span>{intl.formatMessage(step)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
      {canRetry && !isActive && (
        <div className="mt-4 flex justify-end">
          <Button buttonType="danger" onClick={() => setShowModal(true)}>
            <TrashIcon />
            <span>{intl.formatMessage(messages.deleteandretry)}</span>
          </Button>
        </div>
      )}
    </>
  );
};

export default IssueRetry;
