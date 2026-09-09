import { X } from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { armModalCloseGuard } from '../../lib/modalCloseGuard.js';
import Button from './Button.jsx';

const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size,
  footer,
  layerClass,
  bodyClassName,
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  draggable = true,
}) => {
  const bodyRef = useRef(null);
  const dialogRef = useRef(null);
  const dragRef = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const requestClose = useCallback(
    (e) => {
      e?.stopPropagation?.();
      e?.preventDefault?.();
      armModalCloseGuard();
      window.setTimeout(() => onClose?.(), 0);
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') requestClose(e);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, closeOnEscape, requestClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    setOffset({ x: 0, y: 0 });
    const prev = document.activeElement;
    const id = window.requestAnimationFrame(() => {
      const root = bodyRef.current;
      if (!root) return;
      const focusable = root.querySelector(
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
      );
      if (focusable && typeof focusable.focus === 'function') {
        focusable.focus();
      }
    });
    return () => {
      window.cancelAnimationFrame(id);
      window.setTimeout(() => {
        if (prev && typeof prev.focus === 'function') {
          try {
            prev.focus({ preventScroll: true });
          } catch {
            /* ignore */
          }
        }
      }, 0);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !draggable) return undefined;

    const onPointerMove = (event) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const rawX = drag.startOffsetX + event.clientX - drag.startX;
      const rawY = drag.startOffsetY + event.clientY - drag.startY;
      setOffset({
        x: Math.min(drag.maxX, Math.max(drag.minX, rawX)),
        y: Math.min(drag.maxY, Math.max(drag.minY, rawY)),
      });
    };
    const onPointerUp = (event) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [isOpen, draggable]);

  if (!isOpen) return null;

  const widthClass = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
    '2xl': 'max-w-6xl',
    '3xl': 'max-w-7xl',
    full: 'max-w-[95vw]',
  }[size || 'md'];

  const startDrag = (event) => {
    if (!draggable || event.button !== 0 || !window.matchMedia('(min-width: 640px)').matches) {
      return;
    }
    if (event.target.closest('button, a, input, select, textarea')) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    const baseLeft = rect.left - offset.x;
    const baseTop = rect.top - offset.y;
    const gutter = 8;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: offset.x,
      startOffsetY: offset.y,
      minX: gutter - baseLeft,
      maxX: window.innerWidth - gutter - baseLeft - rect.width,
      minY: gutter - baseTop,
      maxY: window.innerHeight - gutter - baseTop - rect.height,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  return createPortal(
    <div
      className={`fixed inset-0 ${layerClass || 'z-50'} flex items-center justify-center p-2 sm:p-4`}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={closeOnBackdrop ? 'Close dialog' : 'Dialog backdrop'}
        disabled={!closeOnBackdrop}
        className="absolute inset-0 cursor-default bg-gray-900/50 disabled:cursor-default"
        onMouseDown={(event) => event.preventDefault()}
        onClick={closeOnBackdrop ? requestClose : undefined}
      />
      <div
        ref={dialogRef}
        className={`relative w-full ${widthClass || 'max-w-xl'} max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100vh-2rem)] flex flex-col rounded-lg sm:rounded-lg bg-surface shadow-pop border border-gray-200 max-sm:max-h-[100dvh] max-sm:rounded-none max-sm:border-0`}
        style={offset.x || offset.y ? { transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` } : undefined}
        role="dialog"
        aria-modal="true"
      >
        {title ? (
          <div
            className={`flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0 ${draggable ? 'sm:cursor-move sm:select-none' : ''}`}
            onPointerDown={startDrag}
          >
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            {showCloseButton ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={requestClose}
                icon={X}
                iconOnly
                aria-label="Close"
              />
            ) : null}
          </div>
        ) : null}
        <div
          ref={bodyRef}
          className={
            bodyClassName || 'px-3 sm:px-5 py-4 overflow-y-auto flex-1 min-h-0'
          }
        >
          {children}
        </div>
        {footer ? (
          <div className="px-3 sm:px-5 py-3 border-t border-gray-200 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 shrink-0">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
};

Modal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func,
  title: PropTypes.node,
  children: PropTypes.node,
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full']),
  footer: PropTypes.node,
  layerClass: PropTypes.string,
  bodyClassName: PropTypes.string,
  closeOnBackdrop: PropTypes.bool,
  closeOnEscape: PropTypes.bool,
  showCloseButton: PropTypes.bool,
  draggable: PropTypes.bool,
};

export default Modal;
