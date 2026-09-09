import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Smartphone } from 'lucide-react';
import PropTypes from 'prop-types';

import { formatDateTime } from '@wrs/shared';
import Button from '../../../components/ui/Button.jsx';
import { whatsappApi } from '../../../lib/api/whatsapp.js';
import { toast } from '../../../stores/uiStore.js';

function formatWhen(iso) {
  if (!iso) return '—';
  return formatDateTime(iso) || String(iso);
}

const SCAN_STEPS = [
  'Open WhatsApp on your phone',
  'Tap Menu or Settings and select Linked Devices',
  'Tap Link a Device',
  'Point your phone at this screen to capture the QR code',
];

const POLL_STATUSES = new Set(['qr_pending', 'reconnecting']);

const WhatsAppConnectionPanel = () => {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['whatsapp-connection'],
    queryFn: () => whatsappApi.getConnection(),
    refetchInterval: (query) => {
      const s = query.state.data?.data?.status;
      return POLL_STATUSES.has(s) ? 2000 : false;
    },
  });

  const conn = data?.data || {};
  const status = conn.status || 'disconnected';

  const startMutation = useMutation({
    mutationFn: () => whatsappApi.startConnection(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-connection'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-connection-logs'] });
      toast.success('QR code generated — scan with WhatsApp');
    },
    onError: (err) => toast.error(err?.message || 'Failed to start connection'),
  });

  const logoutMutation = useMutation({
    mutationFn: () => whatsappApi.logout(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-connection'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-connection-logs'] });
      toast.success('WhatsApp disconnected');
    },
    onError: (err) => toast.error(err?.message || 'Logout failed'),
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      await whatsappApi.logout();
      return whatsappApi.startConnection();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-connection'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-connection-logs'] });
      toast.success('Connection reset — scan the new QR code');
    },
    onError: (err) => toast.error(err?.message || 'Reset failed'),
  });

  const resetBusy = logoutMutation.isPending || resetMutation.isPending || startMutation.isPending;

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">
        Loading connection…
      </div>
    );
  }

  if (status === 'connected') {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">
            <Phone size={20} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-gray-900">WhatsApp Connected</h3>
            <p className="text-sm text-gray-600 mt-1">
              {conn.display_name ? `${conn.display_name} · ` : ''}
              {conn.phone_number || conn.wa_jid || 'Linked account'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Connected since {formatWhen(conn.connected_at)}
              {conn.last_login_user ? ` · Last login: ${conn.last_login_user}` : ''}
            </p>
          </div>
        </div>
        <div className="rounded-md bg-brand-light px-3 py-2 text-sm text-brand">
          Status: Connected successfully
        </div>
        {conn.last_error ? (
          <p className="text-xs text-red-600">Last error: {conn.last_error}</p>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => logoutMutation.mutate()}
          loading={logoutMutation.isPending}
          disabled={isFetching}
        >
          Logout WhatsApp
        </Button>
      </div>
    );
  }

  if (status === 'reconnecting') {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Finishing connection…</h3>
        <p className="text-sm text-gray-600">
          WhatsApp is restarting the session after scan. This usually takes a few seconds.
        </p>
        <div className="rounded-md bg-brand-light px-3 py-2 text-sm text-brand">
          Status: Reconnecting
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => resetMutation.mutate()}
          loading={resetBusy}
          disabled={isFetching}
        >
          Reset &amp; scan again
        </Button>
      </div>
    );
  }

  if (status === 'qr_pending') {
    const qrSrc = conn.qr_data_url;
    const interrupted = !qrSrc;

    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">
          {interrupted ? 'Connection interrupted' : 'Scan QR Code to Connect WhatsApp'}
        </h3>
        {interrupted ? (
          <p className="text-sm text-gray-600">
            The pairing session ended before a QR was available. Regenerate the code or reset and
            scan again.
          </p>
        ) : null}
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="flex h-[280px] w-[280px] items-center justify-center rounded-lg border border-gray-200 bg-white p-2">
            {qrSrc ? (
              <img src={qrSrc} alt="WhatsApp QR code" className="h-full w-full object-contain" />
            ) : (
              <p className="text-sm text-gray-500 px-4 text-center">
                {isFetching ? 'Generating QR…' : 'No QR available'}
              </p>
            )}
          </div>
          {!interrupted ? (
            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700 flex-1">
              {SCAN_STEPS.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => startMutation.mutate()}
            loading={startMutation.isPending}
          >
            Regenerate QR Code
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => resetMutation.mutate()}
            loading={resetBusy}
          >
            Reset &amp; scan again
          </Button>
        </div>
        {conn.last_error && !interrupted ? (
          <p className="text-xs text-gray-500">{conn.last_error}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">
          <Smartphone size={28} aria-hidden />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-gray-900">Connect Your WhatsApp</h3>
          <p className="text-sm text-gray-600 mt-2 max-w-lg">
            Link this shop&apos;s WhatsApp number to send bill and booking messages from the app.
            One number per shop — shared by all staff.
          </p>
          <div className="mt-4 flex flex-wrap justify-center sm:justify-start gap-2">
            <Button
              variant="primary"
              onClick={() => startMutation.mutate()}
              loading={startMutation.isPending}
            >
              Generate QR Code
            </Button>
            {conn.needs_reconnect || conn.last_error ? (
              <Button
                variant="ghost"
                onClick={() => resetMutation.mutate()}
                loading={resetBusy}
              >
                Reset &amp; scan again
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {conn.last_error ? (
        <p className="mt-4 text-xs text-red-600 text-center sm:text-left">{conn.last_error}</p>
      ) : null}
    </div>
  );
};

WhatsAppConnectionPanel.propTypes = {};

export default WhatsAppConnectionPanel;
