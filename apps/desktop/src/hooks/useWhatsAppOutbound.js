import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buildAppSettingsMap,
  getAppSettingValue,
  parseYesNo,
} from '@wrs/shared/utils/appSettings.js';
import {
  messageIncludesBillPdfToken,
} from '@wrs/shared/utils/whatsappMessages.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { configurationsApi } from '../lib/api/configurations.js';
import { ordersApi } from '../lib/api/orders.js';
import { whatsappApi } from '../lib/api/whatsapp.js';
import { resolveOrderWhatsappPhone } from '../lib/whatsappOutbound.js';
import { createWhatsAppPromptController, createWhatsAppSendScopeGuard, sendOrderWhatsApp } from '../lib/whatsappOutboundControl.js';
import { useAuthStore } from '../stores/authStore.js';
import { useShopStore } from '../stores/shopStore.js';
import { toast } from '../stores/uiStore.js';

import { useAppSettings } from './useAppSettings.js';

/** App Settings key — must match `WHATSAPP_AUTO_SEND_KEY` in @wrs/shared. */
const WHATSAPP_AUTO_SEND_SETTING = 'whatsapp.auto_send';

function currentOutboundScope() {
  const user = useAuthStore.getState().user;
  return {
    userId: String(user?.id || ''),
    shopId: String(useShopStore.getState().selectedShopId || user?.shop_id || ''),
  };
}

/**
 * WhatsApp outbound: auto-send or prompt, then POST /whatsapp/messages/send.
 */
export function useWhatsAppOutbound() {
  const queryClient = useQueryClient();
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptMeta, setPromptMeta] = useState({ templateKey: '', phone: '', actionLabel: '' });
  const [promptLoading, setPromptLoading] = useState(false);
  const promptControllerRef = useRef(null);
  if (!promptControllerRef.current) {
    promptControllerRef.current = createWhatsAppPromptController({
      onOpen: (meta) => { setPromptMeta(meta); setPromptOpen(true); },
      onClose: () => { setPromptOpen(false); setPromptLoading(false); },
    });
  }
  useEffect(() => {
    const controller = promptControllerRef.current;
    controller.activate();
    return () => controller.dispose();
  }, []);

  const [waPrefetch, setWaPrefetch] = useState(false);
  const appSettings = useAppSettings({ enabled: waPrefetch });
  const configQuery = useQuery({
    queryKey: ['whatsapp-messages'],
    queryFn: () => configurationsApi.getWhatsAppMessages(),
    staleTime: 60_000,
    enabled: waPrefetch,
  });

  const connectionQuery = useQuery({
    queryKey: ['whatsapp-connection'],
    queryFn: () => whatsappApi.getConnection(),
    staleTime: 15_000,
    enabled: waPrefetch,
  });

  const ensureWaPrefetch = useCallback(() => {
    setWaPrefetch(true);
  }, []);

  const ensureReady = useCallback(async () => {
    ensureWaPrefetch();
    const [settingsResponse, messagesResponse, connectionResponse] = await Promise.all([
      queryClient.fetchQuery({
        queryKey: ['app-settings'],
        queryFn: () => configurationsApi.getAppSettings(),
        staleTime: 60_000,
      }),
      queryClient.fetchQuery({
        queryKey: ['whatsapp-messages'],
        queryFn: () => configurationsApi.getWhatsAppMessages(),
        staleTime: 60_000,
      }),
      queryClient.fetchQuery({
        queryKey: ['whatsapp-connection'],
        queryFn: () => whatsappApi.getConnection(),
        staleTime: 15_000,
      }),
    ]);

    const settingsMap = buildAppSettingsMap(settingsResponse?.data?.items || []);
    const runtimeTemplates = messagesResponse?.data?.templates || [];
    return {
      autoSend: parseYesNo(
        getAppSettingValue(settingsMap, WHATSAPP_AUTO_SEND_SETTING),
        'No'
      ),
      canSend: Boolean(connectionResponse?.data?.can_send),
      templates: runtimeTemplates,
      templateByKey: Object.fromEntries(runtimeTemplates.map((template) => [template.key, template])),
    };
  }, [ensureWaPrefetch, queryClient]);

  const autoSend = appSettings.isYes(WHATSAPP_AUTO_SEND_SETTING, 'No');
  const templates = useMemo(() => configQuery.data?.data?.templates || [], [configQuery.data]);
  const canSend = !!connectionQuery.data?.data?.can_send;

  const templateByKey = useMemo(
    () => Object.fromEntries(templates.map((t) => [t.key, t])),
    [templates]
  );

  const isTemplateActive = useCallback(
    (templateKey) => {
      if (configQuery.isLoading || !configQuery.isFetched) return true;
      return !!templateByKey[templateKey]?.is_active;
    },
    [templateByKey, configQuery.isLoading, configQuery.isFetched]
  );

  const askManualSend = useCallback(
    (meta) => promptControllerRef.current.ask(meta),
    []
  );

  const finishPrompt = useCallback((choice) => {
    promptControllerRef.current.finish(choice);
  }, []);

  const promptSkip = useCallback(() => finishPrompt('skip'), [finishPrompt]);
  const promptClose = useCallback(() => finishPrompt('skip'), [finishPrompt]);

  const sendForOrder = useCallback(
    ({ templateKey, orderId, phone, order, template,
      assertCanSend = createWhatsAppSendScopeGuard(currentOutboundScope, order) }) => sendOrderWhatsApp({
      templateKey, orderId, phone, order, template: template || templateByKey[templateKey],
      loadOrder: (id) => ordersApi.get(id).then((r) => r.data),
      buildBillPdf: async (fullOrder) => {
        const { buildBillPdfBase64 } = await import('../utils/printBill.js');
        return buildBillPdfBase64(fullOrder);
      },
      beforeSend: () => {
        if (!promptControllerRef.current.isActive()) throw new Error('WhatsApp action was cancelled');
        assertCanSend();
      },
      sendMessage: (payload) => whatsappApi.sendMessage(payload),
    }),
    [templateByKey]
  );

  /**
   * Send a template message with an arbitrary PDF document (e.g. laundry slip).
   *
   * @param {{ templateKey: string, phone: string, orderId?: string, context?: Record<string, string>, document: { filename: string, content_base64: string, mimetype?: string } }} opts
   */
  const sendWithDocument = useCallback(
    async ({ templateKey, phone, orderId, context = {}, document,
      assertCanSend = createWhatsAppSendScopeGuard(currentOutboundScope) }) => {
      if (!document?.content_base64) {
        throw new Error('PDF attachment is required');
      }
      assertCanSend();
      await whatsappApi.sendMessage({
        template_key: templateKey,
        phone,
        order_id: orderId,
        context,
        document: {
          filename: document.filename || 'document.pdf',
          content_base64: document.content_base64,
          mimetype: document.mimetype || 'application/pdf',
        },
      });
    },
    []
  );

  /**
   * @param {{ templateKey: string, orderId?: string, phone?: string, order?: object, customer?: object, actionLabel?: string, silentSkip?: boolean, skipPrompt?: boolean, forcePrompt?: boolean, document?: object }} opts
   * @returns {Promise<{ sent: boolean, skipped?: boolean, reason?: string }>}
   */
  const runOutbound = useCallback(
    async ({
      templateKey,
      orderId,
      phone: phoneIn,
      order,
      customer,
      actionLabel = 'Saved',
      silentSkip = false,
      skipPrompt = false,
      forcePrompt = false,
      document = null,
    }) => {
      const assertCanSend = createWhatsAppSendScopeGuard(currentOutboundScope, order);
      let outboundState;
      try {
        outboundState = await ensureReady();
        assertCanSend();
      } catch (err) {
        const msg = err?.message || 'WhatsApp settings could not be loaded';
        if (!silentSkip) toast.error(`${actionLabel}. ${msg}`);
        return { sent: false, reason: 'error', error: msg };
      }
      const phone = phoneIn || resolveOrderWhatsappPhone(order, customer);
      const label = actionLabel;
      const runtimeTemplate = outboundState.templateByKey[templateKey];

      if (!runtimeTemplate?.is_active) {
        if (!silentSkip) toast.info(`${label}. WhatsApp template is inactive.`);
        return { sent: false, reason: 'inactive' };
      }

      if (!phone) {
        if (!silentSkip) toast.warning(`${label}. Customer has no WhatsApp number.`);
        return { sent: false, reason: 'no_phone' };
      }

      if (!outboundState.canSend) {
        if (!silentSkip) toast.info(`${label}. WhatsApp is not connected.`);
        return { sent: false, reason: 'not_connected' };
      }

      let shouldSend = (outboundState.autoSend && !forcePrompt) || skipPrompt;
      if ((!outboundState.autoSend || forcePrompt) && !skipPrompt) {
        const choice = await askManualSend({ templateKey, phone, actionLabel: label });
        shouldSend = choice === 'send';
        if (!shouldSend) {
          toast.info(`${label}. WhatsApp not sent.`);
          return { sent: false, skipped: true };
        }
      }

      const tpl = runtimeTemplate;
      const pdfConfigured =
        !!tpl?.attach_bill_pdf || messageIncludesBillPdfToken(tpl?.message);
      try {
        if (!promptControllerRef.current.isActive()) return { sent: false, skipped: true };
        if (document) {
          await sendWithDocument({ templateKey, phone, orderId, document, assertCanSend });
        } else {
          await sendForOrder({ templateKey, orderId, phone, order, template: runtimeTemplate, assertCanSend });
        }
        toast.success(`WhatsApp message sent to ${phone}`);
        if (!orderId && pdfConfigured && !document) {
          toast.warning(`${label}. Bill PDF requires a booking; only text was sent.`);
        }
        return { sent: true };
      } catch (err) {
        const msg = err?.message || 'Send failed';
        toast.error(`${label}. WhatsApp failed: ${msg}`);
        return { sent: false, reason: 'error', error: msg };
      }
    },
    [askManualSend, ensureReady, sendForOrder, sendWithDocument]
  );

  const promptSend = useCallback(async () => {
    setPromptLoading(true);
    finishPrompt('send');
  }, [finishPrompt]);

  /**
   * Manual mode: ask before parent action (e.g. create booking submit).
   * @returns {Promise<'send'|'skip'|'inactive'|'no_phone'|'not_connected'>}
   */
  const confirmBeforeAction = useCallback(
    async ({ templateKey, phone, order, customer, actionLabel = 'Save booking' }) => {
      let outboundState;
      try {
        outboundState = await ensureReady();
      } catch {
        return 'not_connected';
      }
      const resolvedPhone = phone || resolveOrderWhatsappPhone(order, customer);
      if (!outboundState.templateByKey[templateKey]?.is_active) return 'inactive';
      if (!resolvedPhone) return 'no_phone';
      if (!outboundState.canSend) return 'not_connected';
      if (outboundState.autoSend) return 'send';
      const choice = await askManualSend({
        templateKey,
        phone: resolvedPhone,
        actionLabel,
      });
      return choice === 'send' ? 'send' : 'skip';
    },
    [askManualSend, ensureReady]
  );

  return {
    autoSend,
    canSend,
    templates,
    isTemplateActive,
    ensureReady,
    configQuery,
    connectionQuery,
    runOutbound,
    confirmBeforeAction,
    sendForOrder,
    sendWithDocument,
    promptOpen,
    promptMeta,
    promptLoading,
    setPromptLoading,
    promptSend,
    promptSkip,
    promptClose,
  };
}

export default useWhatsAppOutbound;
