import { Download, Printer } from 'lucide-react';
import PropTypes from 'prop-types';

import Button from '../ui/Button.jsx';

const ListPdfToolbarButtons = ({
  onPrint,
  onExport,
  busy = false,
  disabled = false,
  className = '',
}) => (
  <div className={`flex shrink-0 items-center gap-2 ${className}`.trim()}>
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="shrink-0"
      icon={Printer}
      onClick={onPrint}
      disabled={disabled || busy}
      loading={busy}
    >
      Print
    </Button>
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="shrink-0"
      icon={Download}
      onClick={onExport}
      disabled={disabled || busy}
      loading={busy}
    >
      Export PDF
    </Button>
  </div>
);

ListPdfToolbarButtons.propTypes = {
  onPrint: PropTypes.func.isRequired,
  onExport: PropTypes.func.isRequired,
  busy: PropTypes.bool,
  disabled: PropTypes.bool,
  className: PropTypes.string,
};

export default ListPdfToolbarButtons;
