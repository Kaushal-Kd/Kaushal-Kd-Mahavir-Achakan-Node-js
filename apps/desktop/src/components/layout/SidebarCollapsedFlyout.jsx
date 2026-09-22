import { clsx } from 'clsx';
import PropTypes from 'prop-types';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';

import { flyoutStyle } from './sidebarFlyoutPosition.js';

const SidebarCollapsedFlyout = ({
  open,
  anchorRect = null,
  title,
  items,
  onMouseEnter,
  onMouseLeave,
  onNavigate,
}) => {
  if (!open || !anchorRect || typeof document === 'undefined') return null;

  const style = flyoutStyle(anchorRect);

  return createPortal(
    <div
      role="menu"
      tabIndex={-1}
      aria-label={title}
      className="fixed z-[80] w-52 overflow-y-auto rounded-md border border-gray-200 bg-surface py-1.5 shadow-pop [scrollbar-color:#D1D5DB_#FFFFFF] [scrollbar-width:thin]"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="px-3 pb-1.5 pt-1 text-sm font-bold text-gray-900">{title}</div>
      <div className="mx-2 mb-1 border-t border-gray-200" />
      {items.map((item) => {
        if (item.heading) {
          return (
            <div
              key={item.id}
              className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400"
            >
              {item.label}
            </div>
          );
        }
        return (
          <NavLink
            key={item.id}
            to={item.to}
            role="menuitem"
            onClick={onNavigate}
            className={clsx(
              'flex items-center gap-2 px-3 py-1.5 text-sm font-bold transition-colors',
              item.active
                ? 'bg-brand-light text-brand'
                : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
            )}
          >
            <span className="truncate">{item.label}</span>
            {item.badge > 0 ? (
              <span className="ml-auto shrink-0 min-w-[1.15rem] px-1 h-[1.15rem] rounded-full bg-red-500 text-white text-[10px] leading-[1.15rem] text-center font-semibold">
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            ) : null}
          </NavLink>
        );
      })}
    </div>,
    document.body
  );
};

SidebarCollapsedFlyout.propTypes = {
  open: PropTypes.bool.isRequired,
  anchorRect: PropTypes.shape({
    top: PropTypes.number.isRequired,
    right: PropTypes.number.isRequired,
  }),
  title: PropTypes.string.isRequired,
  items: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    to: PropTypes.string,
    heading: PropTypes.bool,
    active: PropTypes.bool,
    badge: PropTypes.number,
  })).isRequired,
  onMouseEnter: PropTypes.func.isRequired,
  onMouseLeave: PropTypes.func.isRequired,
  onNavigate: PropTypes.func.isRequired,
};

export default SidebarCollapsedFlyout;
