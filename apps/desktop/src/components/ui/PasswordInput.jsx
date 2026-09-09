import { Eye, EyeOff } from 'lucide-react';
import PropTypes from 'prop-types';
import { useState } from 'react';

import Input from './Input.jsx';

/**
 * Password field with a show/hide toggle.
 *
 * This reveals what is currently being *typed* — stored passwords are bcrypt
 * hashes and can never be read back, so there is nothing to reveal for an
 * existing user. Use the reset flow for that.
 */
const PasswordInput = ({ inputClassName, ...rest }) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        {...rest}
        type={visible ? 'text' : 'password'}
        inputClassName={['pr-10', inputClassName].filter(Boolean).join(' ')}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // Nudged down so the icon centres on the input, not the label above it.
        className="absolute right-2 top-[2.15rem] text-gray-400 hover:text-brand"
        title={visible ? 'Hide password' : 'Show password'}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        tabIndex={-1}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
};

PasswordInput.propTypes = {
  inputClassName: PropTypes.string,
};

export default PasswordInput;
