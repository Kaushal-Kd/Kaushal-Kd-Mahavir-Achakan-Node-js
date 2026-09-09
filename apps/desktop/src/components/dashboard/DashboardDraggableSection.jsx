import clsx from 'clsx';
import { GripVertical } from 'lucide-react';
import PropTypes from 'prop-types';
import { useState } from 'react';

export default function DashboardDraggableSection({
  id,
  title,
  children,
  onReorder,
}) {
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    setDragging(true);
  };

  const handleDragEnd = () => {
    setDragging(false);
    setDropTarget(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(true);
  };

  const handleDragLeave = () => {
    setDropTarget(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDropTarget(false);
    setDragging(false);
    const dragId = e.dataTransfer.getData('text/plain');
    if (dragId && dragId !== id) {
      onReorder(dragId, id);
    }
  };

  return (
    <section
      className={clsx(
        'mb-6 rounded-lg transition-opacity',
        dragging && 'opacity-50',
        dropTarget && 'ring-2 ring-brand ring-offset-2'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex items-center gap-2 mb-2 px-1">
        <button
          type="button"
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          className="inline-flex items-center justify-center w-8 h-8 rounded border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700 cursor-grab active:cursor-grabbing shrink-0"
          aria-label={`Drag to reorder ${title}`}
          title={`Drag ${title}`}
        >
          <GripVertical size={16} aria-hidden />
        </button>
        <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
          {title}
        </span>
      </div>
      {children}
    </section>
  );
}

DashboardDraggableSection.propTypes = {
  id: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
  onReorder: PropTypes.func.isRequired,
};
