import PropTypes from 'prop-types';

import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';
import {
  WHATSAPP_TEMPLATE_PROMPT_TITLES,
  whatsappTemplateLabel,
} from '../../lib/whatsappOutbound.js';

const WhatsAppSendPromptModal = ({
  isOpen,
  onClose,
  onSend,
  onSkip,
  templateKey = '',
  phone = '',
  loading = false,
}) => {
  const title = WHATSAPP_TEMPLATE_PROMPT_TITLES[templateKey] || 'Send WhatsApp message?';

  const templateName = templateKey ? whatsappTemplateLabel(templateKey) : 'message';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      layerClass="z-[60]"
      footer={
        <>
          <Button variant="ghost" onClick={onSkip} disabled={loading}>
            Skip
          </Button>
          <Button variant="primary" onClick={onSend} loading={loading}>
            Send message
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-700">
        Send <span className="font-medium">{templateName}</span> to the customer&apos;s WhatsApp
        {phone ? (
          <>
            {' '}
            (<span className="font-mono">{phone}</span>)?
          </>
        ) : (
          '?'
        )}
      </p>
      <p className="text-xs text-gray-500 mt-2">
        The message uses your saved template and order details. Choose Skip to continue without sending.
      </p>
    </Modal>
  );
};

WhatsAppSendPromptModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSend: PropTypes.func.isRequired,
  onSkip: PropTypes.func.isRequired,
  templateKey: PropTypes.string,
  phone: PropTypes.string,
  loading: PropTypes.bool,
};

export default WhatsAppSendPromptModal;
