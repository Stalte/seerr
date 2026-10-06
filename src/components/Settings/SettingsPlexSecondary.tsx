import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import usePlexLogin from '@app/hooks/usePlexLogin';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownOnSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import { ArrowPathIcon } from '@heroicons/react/24/solid';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Settings.SettingsPlexSecondary', {
  secondaryserver: 'Secondary Plex Server',
  secondaryserverDescription:
    'Let users of a second Plex server, owned by a different Plex account, sign in and request media. Only the main server is scanned, so both servers must share the same media.',
  owner: 'Server Owner',
  ownerNotConnected: 'Not connected',
  connectOwner: 'Sign in as Owner',
  reconnectOwner: 'Sign in Again',
  server: 'Server',
  selectServer: 'Select a server',
  noServers: 'This Plex account does not own any servers.',
  remove: 'Remove',
  activeServer:
    'Users shared to <strong>{name}</strong> can now sign in and be imported.',
  toastOwnerConnected: 'Secondary server owner connected.',
  toastOwnerFailure: 'Failed to sign in as the secondary server owner.',
  toastServerSaved: 'Secondary Plex server saved.',
  toastServerFailure: 'Failed to save the secondary Plex server.',
  toastRemoved: 'Secondary Plex server removed.',
});

interface PlexSecondaryResponse {
  name: string;
  machineId?: string;
  ownerUsername?: string;
  ownerConnected: boolean;
}

interface PlexSecondaryServer {
  name: string;
  machineId: string;
}

const SettingsPlexSecondary = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [selectedServer, setSelectedServer] = useState('');
  const [isSaving, setSaving] = useState(false);
  const { data, mutate } = useSWR<PlexSecondaryResponse>(
    '/api/v1/settings/plex/secondary'
  );
  const {
    data: servers,
    isValidating: isLoadingServers,
    mutate: refreshServers,
  } = useSWR<PlexSecondaryServer[]>(
    data?.ownerConnected ? '/api/v1/settings/plex/secondary/servers' : null
  );

  useEffect(() => {
    setSelectedServer(data?.machineId ?? '');
  }, [data?.machineId]);

  const { loading: isSigningIn, login } = usePlexLogin({
    onAuthToken: async (authToken) => {
      try {
        const response = await axios.post<PlexSecondaryResponse>(
          '/api/v1/settings/plex/secondary/owner',
          { authToken }
        );
        mutate(response.data);
        refreshServers();
        addToast(intl.formatMessage(messages.toastOwnerConnected), {
          autoDismiss: true,
          appearance: 'success',
        });
      } catch {
        addToast(intl.formatMessage(messages.toastOwnerFailure), {
          autoDismiss: true,
          appearance: 'error',
        });
      }
    },
    onError: () =>
      addToast(intl.formatMessage(messages.toastOwnerFailure), {
        autoDismiss: true,
        appearance: 'error',
      }),
  });

  const saveServer = async () => {
    setSaving(true);
    try {
      const response = await axios.post<PlexSecondaryResponse>(
        '/api/v1/settings/plex/secondary',
        { machineId: selectedServer }
      );
      mutate(response.data);
      addToast(intl.formatMessage(messages.toastServerSaved), {
        autoDismiss: true,
        appearance: 'success',
      });
    } catch {
      addToast(intl.formatMessage(messages.toastServerFailure), {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const removeServer = async () => {
    setSaving(true);
    try {
      const response = await axios.delete<PlexSecondaryResponse>(
        '/api/v1/settings/plex/secondary'
      );
      mutate(response.data);
      addToast(intl.formatMessage(messages.toastRemoved), {
        autoDismiss: true,
        appearance: 'success',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="mb-6 mt-10">
        <h3 className="heading">
          {intl.formatMessage(messages.secondaryserver)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.secondaryserverDescription)}
        </p>
      </div>
      <div className="section">
        {data?.machineId && data.name && (
          <Alert
            type="info"
            title={intl.formatMessage(messages.activeServer, {
              name: data.name,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          />
        )}
        <div className="form-row">
          <span className="text-label">
            {intl.formatMessage(messages.owner)}
          </span>
          <div className="form-input-area">
            <div className="flex items-center gap-4">
              <span>
                {data?.ownerConnected
                  ? data.ownerUsername
                  : intl.formatMessage(messages.ownerNotConnected)}
              </span>
              <Button
                type="button"
                buttonType="warning"
                onClick={login}
                disabled={isSigningIn}
              >
                {intl.formatMessage(
                  data?.ownerConnected
                    ? messages.reconnectOwner
                    : messages.connectOwner
                )}
              </Button>
            </div>
          </div>
        </div>
        {data?.ownerConnected && (
          <div className="form-row">
            <label htmlFor="secondaryServer" className="text-label">
              {intl.formatMessage(messages.server)}
            </label>
            <div className="form-input-area">
              <div className="form-input-field">
                <select
                  id="secondaryServer"
                  name="secondaryServer"
                  className="rounded-l-only"
                  value={selectedServer}
                  disabled={isLoadingServers}
                  onChange={(e) => setSelectedServer(e.target.value)}
                >
                  <option value="">
                    {intl.formatMessage(messages.selectServer)}
                  </option>
                  {servers?.map((server) => (
                    <option key={server.machineId} value={server.machineId}>
                      {server.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => refreshServers()}
                  className="input-action"
                >
                  <ArrowPathIcon
                    className={isLoadingServers ? 'animate-spin' : ''}
                    style={{ animationDirection: 'reverse' }}
                  />
                </button>
              </div>
              {servers && servers.length === 0 && (
                <div className="error">
                  {intl.formatMessage(messages.noServers)}
                </div>
              )}
            </div>
          </div>
        )}
        <div className="actions">
          <div className="flex justify-end">
            {data?.ownerConnected && (
              <span className="ml-3 inline-flex rounded-md shadow-sm">
                <Button
                  buttonType="danger"
                  onClick={removeServer}
                  disabled={isSaving}
                >
                  <TrashIcon />
                  <span>{intl.formatMessage(messages.remove)}</span>
                </Button>
              </span>
            )}
            <span className="ml-3 inline-flex rounded-md shadow-sm">
              <Button
                buttonType="primary"
                onClick={saveServer}
                disabled={
                  isSaving ||
                  !selectedServer ||
                  selectedServer === data?.machineId
                }
              >
                <ArrowDownOnSquareIcon />
                <span>
                  {isSaving
                    ? intl.formatMessage(globalMessages.saving)
                    : intl.formatMessage(globalMessages.save)}
                </span>
              </Button>
            </span>
          </div>
        </div>
      </div>
    </>
  );
};

export default SettingsPlexSecondary;
