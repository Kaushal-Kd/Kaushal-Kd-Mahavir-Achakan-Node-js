import PropTypes from 'prop-types';
import { createContext, useContext } from 'react';

import WhatsAppSendPromptModal from '../components/whatsapp/WhatsAppSendPromptModal.jsx';
import { useWhatsAppOutbound as useWhatsAppOutboundImpl } from '../hooks/useWhatsAppOutbound.js';

const WhatsAppOutboundContext = createContext(null);

export function WhatsAppOutboundProvider({ children }) {
  const wa = useWhatsAppOutboundImpl();

  return (
    <WhatsAppOutboundContext.Provider value={wa}>
      {children}
      <WhatsAppSendPromptModal
        isOpen={wa.promptOpen}
        onClose={wa.promptClose}
        onSend={wa.promptSend}
        onSkip={wa.promptSkip}
        templateKey={wa.promptMeta.templateKey}
        phone={wa.promptMeta.phone}
        loading={wa.promptLoading}
      />
    </WhatsAppOutboundContext.Provider>
  );
}

WhatsAppOutboundProvider.propTypes = {
  children: PropTypes.node,
};

/** @returns {ReturnType<useWhatsAppOutboundImpl>} */
export function useWhatsAppOutbound() {
  const ctx = useContext(WhatsAppOutboundContext);
  if (!ctx) {
    throw new Error('useWhatsAppOutbound must be used within WhatsAppOutboundProvider');
  }
  return ctx;
}

export default WhatsAppOutboundProvider;
