import PropTypes from 'prop-types';

export default function Checkbox({ checked, onChange, label, disabled = false }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input
        className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-label={label}
      />
      <span>{label}</span>
    </label>
  );
}
Checkbox.propTypes = {
  checked: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
  label: PropTypes.string.isRequired,
  disabled: PropTypes.bool,
};
