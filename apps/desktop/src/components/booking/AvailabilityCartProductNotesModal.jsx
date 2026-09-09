import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';

import Button from '../ui/Button.jsx';
import ImageUploader from '../ui/ImageUploader.jsx';
import Modal from '../ui/Modal.jsx';

const NOTE_MAX_LEN = 500;

/**
 * Product note editor for availability cart lines (linked to Create Order tailor_notes).
 */
export default function AvailabilityCartProductNotesModal({
  isOpen,
  onClose,
  cartLine,
  onSave,
}) {
  const [noteValue, setNoteValue] = useState('');
  const [noteImageUrl, setNoteImageUrl] = useState('');

  useEffect(() => {
    if (!isOpen || !cartLine) return;
    setNoteValue(String(cartLine.tailor_notes || '').trim());
    setNoteImageUrl(String(cartLine.tailor_note_image || '').trim());
  }, [isOpen, cartLine?.id, cartLine?.tailor_notes, cartLine?.tailor_note_image]);

  const handleSave = () => {
    onSave({
      tailor_notes: String(noteValue || '').trim().slice(0, NOTE_MAX_LEN),
      tailor_note_image: String(noteImageUrl || '').trim().slice(0, NOTE_MAX_LEN) || '',
    });
  };

  const title = cartLine?.name
    ? `Product note — ${cartLine.name}`
    : 'Product note';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleSave}>
            Save note
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <ImageUploader
          value={noteImageUrl}
          onChange={setNoteImageUrl}
          folder="booking-notes"
          label="Reference image (optional)"
          hint="One image for stitching / fitting reference."
          size="md"
        />
        <div>
          <label htmlFor="availability-cart-product-note" className="label text-[11px]">
            Note (optional)
          </label>
          <textarea
            id="availability-cart-product-note"
            className="input min-h-[90px] text-xs"
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value.slice(0, NOTE_MAX_LEN))}
            placeholder="Add stitching / fitting instructions for this product..."
            rows={4}
          />
        </div>
      </div>
    </Modal>
  );
}

AvailabilityCartProductNotesModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  cartLine: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    code: PropTypes.string,
    tailor_notes: PropTypes.string,
    tailor_note_image: PropTypes.string,
  }),
};

AvailabilityCartProductNotesModal.defaultProps = {
  cartLine: null,
};
