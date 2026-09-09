import { APP_LOGO_LETTER, APP_NAME } from '@wrs/shared/constants';
import { clsx } from 'clsx';
import { PanelLeftOpen } from 'lucide-react';
import PropTypes from 'prop-types';
import { NavLink } from 'react-router-dom';

import Button from '../ui/Button.jsx';

const iconClasses = (active) => clsx(
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
  active ? 'bg-brand-light text-brand' : 'text-gray-700 hover:bg-gray-100 hover:text-brand'
);

const SidebarIconRail = ({ links, sections, onExpand, onSectionSelect }) => (
  <aside
    aria-label="Collapsed sidebar"
    className="relative flex w-16 shrink-0 flex-col border-r border-gray-200 bg-surface"
  >
    <div className="flex h-[69px] shrink-0 items-center justify-center border-b border-gray-200">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand font-bold text-white" title={APP_NAME}>
        {APP_LOGO_LETTER}
      </div>
    </div>
    <nav aria-label="Main navigation" className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto py-3">
      {links.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          title={label}
          aria-label={label}
          className={({ isActive }) => iconClasses(isActive)}
        >
          <Icon size={18} aria-hidden="true" />
        </NavLink>
      ))}
      {sections.length > 0 ? <div className="my-1 w-8 shrink-0 border-t border-gray-200" /> : null}
      {sections.map(({ id, label, icon: Icon, active }) => (
        <Button
          key={id}
          type="button"
          variant="ghost"
          iconOnly
          title={label}
          aria-label={`Expand ${label} menu`}
          aria-expanded={false}
          className={iconClasses(active)}
          onClick={() => onSectionSelect(id)}
        >
          <Icon size={18} aria-hidden="true" />
        </Button>
      ))}
    </nav>
    <div className="flex shrink-0 justify-center border-t border-gray-200 py-2">
      <Button
        type="button"
        variant="ghost"
        iconOnly
        title="Show side menu (Ctrl+B)"
        aria-label="Show side menu"
        className={iconClasses(false)}
        onClick={onExpand}
      >
        <PanelLeftOpen size={18} aria-hidden="true" />
      </Button>
    </div>
  </aside>
);

SidebarIconRail.propTypes = {
  links: PropTypes.arrayOf(PropTypes.shape({
    to: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    icon: PropTypes.elementType.isRequired,
    end: PropTypes.bool,
  })).isRequired,
  sections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    icon: PropTypes.elementType.isRequired,
    active: PropTypes.bool,
  })).isRequired,
  onExpand: PropTypes.func.isRequired,
  onSectionSelect: PropTypes.func.isRequired,
};

export default SidebarIconRail;
