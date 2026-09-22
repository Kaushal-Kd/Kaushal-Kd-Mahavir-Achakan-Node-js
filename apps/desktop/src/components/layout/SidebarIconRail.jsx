import { APP_LOGO_LETTER, APP_NAME } from '@wrs/shared/constants';
import { clsx } from 'clsx';
import { PanelLeftOpen } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';

import Button from '../ui/Button.jsx';

import SidebarCollapsedFlyout from './SidebarCollapsedFlyout.jsx';
import { FLYOUT_GAP } from './sidebarFlyoutPosition.js';

const CLOSE_DELAY_MS = 160;

const iconClasses = (active) => clsx(
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
  active ? 'bg-brand-light text-brand' : 'text-gray-700 hover:bg-gray-100 hover:text-brand'
);

const SidebarIconRail = ({ links, sections, onExpand }) => {
  const [openId, setOpenId] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const closeTimerRef = useRef(null);
  const itemRefs = useRef(new Map());

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const updateAnchor = (id) => {
    const node = itemRefs.current.get(id);
    if (!node) return;
    setAnchorRect(node.getBoundingClientRect());
  };

  const openMenu = (id) => {
    clearCloseTimer();
    setOpenId(id);
    updateAnchor(id);
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setOpenId(null);
      setAnchorRect(null);
    }, CLOSE_DELAY_MS);
  };

  useEffect(() => () => clearCloseTimer(), []);

  useEffect(() => {
    if (!openId) return undefined;
    const onReposition = () => updateAnchor(openId);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpenId(null);
        setAnchorRect(null);
      }
    };
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openId]);

  const openSection = sections.find((section) => section.id === openId);
  const openLink = links.find((link) => `link:${link.to}` === openId);

  return (
    <aside
      aria-label="Collapsed sidebar"
      className="relative z-20 flex w-16 shrink-0 flex-col border-r border-gray-200 bg-surface"
    >
      <div className="flex h-[69px] shrink-0 items-center justify-center border-b border-gray-200">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand font-bold text-white" title={APP_NAME}>
          {APP_LOGO_LETTER}
        </div>
      </div>
      <nav aria-label="Main navigation" className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto py-3">
        {links.map(({ to, label, icon: Icon, end }) => {
          const id = `link:${to}`;
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              aria-label={label}
              ref={(node) => {
                if (node) itemRefs.current.set(id, node);
                else itemRefs.current.delete(id);
              }}
              className={({ isActive }) => iconClasses(isActive)}
              onMouseEnter={() => openMenu(id)}
              onMouseLeave={scheduleClose}
              onFocus={() => openMenu(id)}
              onBlur={scheduleClose}
            >
              <Icon size={18} aria-hidden="true" />
            </NavLink>
          );
        })}
        {sections.length > 0 ? <div className="my-1 w-8 shrink-0 border-t border-gray-200" /> : null}
        {sections.map(({ id, label, icon: Icon, active }) => (
          <div
            key={id}
            ref={(node) => {
              if (node) itemRefs.current.set(id, node);
              else itemRefs.current.delete(id);
            }}
            onMouseEnter={() => openMenu(id)}
            onMouseLeave={scheduleClose}
          >
            <Button
              type="button"
              variant="ghost"
              iconOnly
              title={label}
              aria-label={`${label} menu`}
              aria-haspopup="menu"
              aria-expanded={openId === id}
              className={iconClasses(active)}
              onFocus={() => openMenu(id)}
              onBlur={scheduleClose}
              onClick={() => (openId === id ? scheduleClose() : openMenu(id))}
            >
              <Icon size={18} aria-hidden="true" />
            </Button>
          </div>
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

      {openLink && typeof document !== 'undefined'
        ? createPortal(
          <div
            className="pointer-events-none fixed z-[80] rounded-md border border-gray-200 bg-surface px-3 py-1.5 text-sm font-bold text-gray-900 shadow-pop"
            style={{
              top: (anchorRect?.top ?? 0) + ((anchorRect?.height ?? 0) - 32) / 2,
              left: (anchorRect?.right ?? 0) + FLYOUT_GAP,
            }}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClose}
          >
            {openLink.label}
          </div>,
          document.body
        )
        : null}

      <SidebarCollapsedFlyout
        open={Boolean(openSection)}
        anchorRect={anchorRect}
        title={openSection?.label || ''}
        items={openSection?.items || []}
        onMouseEnter={clearCloseTimer}
        onMouseLeave={scheduleClose}
        onNavigate={() => {
          setOpenId(null);
          setAnchorRect(null);
        }}
      />
    </aside>
  );
};

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
    items: PropTypes.arrayOf(PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      to: PropTypes.string,
      heading: PropTypes.bool,
      active: PropTypes.bool,
      badge: PropTypes.number,
    })),
  })).isRequired,
  onExpand: PropTypes.func.isRequired,
};

export default SidebarIconRail;
