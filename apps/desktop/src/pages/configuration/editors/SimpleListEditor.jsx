import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  Check,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import Button from '../../../components/ui/Button.jsx';
import ConfirmDialog from '../../../components/ui/ConfirmDialog.jsx';
import Input from '../../../components/ui/Input.jsx';
import { configurationsApi } from '../../../lib/api/configurations.js';
import { guardedMutate } from '../../../lib/guardedMutate.js';
import { toast } from '../../../stores/uiStore.js';
import { Section } from '../../settings/tabs/_Tab.jsx';

import IconBtn from './IconBtn.jsx';

const SimpleListEditor = ({ type, def }) => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['config-list', type],
    queryFn: () => configurationsApi.get(type),
  });

  const serverItems = data?.data?.items || [];
  const isCustom = !!data?.data?.is_custom;

  const [items, setItems] = useState([]);
  const [newValue, setNewValue] = useState('');
  const [editingIdx, setEditingIdx] = useState(-1);
  const [editingValue, setEditingValue] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const allowClearAll = type !== 'colors' && type !== 'sizes';

  useEffect(() => {
    setItems(serverItems);
    setEditingIdx(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, data?.data?.items?.join('|')]);

  const isDirty = useMemo(
    () => JSON.stringify(items) !== JSON.stringify(serverItems),
    [items, serverItems]
  );

  const addItem = () => {
    const v = newValue.trim();
    if (!v) return;
    if (items.some((x) => x.toLowerCase() === v.toLowerCase())) {
      toast.error(`${v} already exists`);
      return;
    }
    setItems((arr) => {
      // Alphabetical lists (colours) keep themselves sorted as they grow, so
      // the admin never has to press Sort A–Z after adding. Lists with a
      // deliberate order (sizes: S, M, L) append instead.
      if (!def.autoSort) return [...arr, v];
      // Positional insert is only meaningful while the list is still in A–Z
      // order. Once the admin has rearranged it with the arrows, respect that
      // and append — re-sorting here would silently undo their ordering.
      const stillSorted = arr.every(
        (x, i) => i === 0 || String(arr[i - 1]).localeCompare(String(x)) <= 0
      );
      if (!stillSorted) return [...arr, v];
      const next = [...arr];
      const at = next.findIndex((x) => String(x).localeCompare(v) > 0);
      if (at === -1) next.push(v);
      else next.splice(at, 0, v);
      return next;
    });
    setNewValue('');
  };

  const removeIdx = (idx) => setItems((arr) => arr.filter((_, i) => i !== idx));

  // One-shot alphabetical sort of the working list. Deliberately not applied
  // on every render — that would make the ↑↓ arrows useless. Sort once, then
  // nudge individual entries by hand, then Save.
  const sortedAZ = useMemo(
    () => [...items].sort((a, b) => String(a).localeCompare(String(b))),
    [items]
  );
  const alreadySortedAZ = useMemo(
    () => JSON.stringify(items) === JSON.stringify(sortedAZ),
    [items, sortedAZ]
  );

  const moveIdx = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    setItems((arr) => {
      const next = [...arr];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const startEdit = (idx) => {
    setEditingIdx(idx);
    setEditingValue(items[idx]);
  };

  const commitEdit = () => {
    const v = editingValue.trim();
    if (!v) return;
    if (items.some((x, i) => i !== editingIdx && x.toLowerCase() === v.toLowerCase())) {
      toast.error(`${v} already exists`);
      return;
    }
    setItems((arr) => arr.map((x, i) => (i === editingIdx ? v : x)));
    setEditingIdx(-1);
    setEditingValue('');
  };

  const saveMut = useMutation({
    mutationFn: () => configurationsApi.update(type, items),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config-list', type] });
      qc.invalidateQueries({ queryKey: ['configurations'] });
      toast.success(`${def.label} saved`);
    },
    onError: (e) => toast.error(e.response?.data?.error?.message || 'Save failed'),
  });

  const resetMut = useMutation({
    mutationFn: () => configurationsApi.reset(type),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config-list', type] });
      qc.invalidateQueries({ queryKey: ['configurations'] });
      setResetOpen(false);
      toast.success(`${def.label} cleared`);
    },
  });

  return (
    <Section
      title={def.label}
      description={`${items.length} item${items.length === 1 ? '' : 's'} configured`}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={ArrowDownAZ}
            onClick={() => {
              setItems(sortedAZ);
              setEditingIdx(-1);
            }}
            disabled={items.length < 2 || alreadySortedAZ}
            title={
              alreadySortedAZ
                ? 'Already in A–Z order'
                : 'Reorder alphabetically — you can still adjust with the arrows afterwards'
            }
          >
            Sort A–Z
          </Button>
          {allowClearAll ? (
            <Button
              variant="ghost"
              size="sm"
              icon={RotateCcw}
              onClick={() => setResetOpen(true)}
              disabled={!isCustom && items.length === 0}
            >
              Clear all
            </Button>
          ) : null}
          <Button
            icon={Save}
            size="sm"
            onClick={() => guardedMutate(saveMut)}
            loading={saveMut.isPending}
            disabled={!isDirty}
          >
            Save changes
          </Button>
        </div>
      }
    >
      {/* Add row */}
      <div className="flex items-end gap-2 mb-4">
        <div className="flex-1">
          <Input
            label={`Add ${def.label.toLowerCase()}`}
            placeholder="Enter a value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addItem();
              }
            }}
          />
        </div>
        <Button icon={Plus} onClick={addItem} disabled={!newValue.trim()}>
          Add
        </Button>
      </div>

      {/* Dirty banner */}
      {isDirty ? (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            You have unsaved changes.
          </span>
          <button
            type="button"
            className="font-medium underline"
            onClick={() => setItems(serverItems)}
          >
            Discard
          </button>
        </div>
      ) : null}

      {/* List */}
      {isLoading ? (
        <div className="text-sm text-gray-400 py-4 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-500 py-8 text-center">
          No values yet. Add one above to get started.
        </div>
      ) : (
        <div className="rounded-md border border-gray-200 divide-y divide-gray-100">
          {items.map((val, idx) => {
            const editing = editingIdx === idx;
            return (
              <div
                key={`${val}-${idx}`}
                className={clsx(
                  'flex items-center gap-2 px-3 py-2',
                  editing ? 'bg-brand-light/40' : 'hover:bg-gray-50'
                )}
              >
                <span className="font-mono text-xs text-gray-400 w-6 text-right">{idx + 1}</span>
                {editing ? (
                  <input
                    className="input h-8 flex-1"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit();
                      if (e.key === 'Escape') setEditingIdx(-1);
                    }}
                  />
                ) : (
                  <span className="flex-1 text-sm text-gray-800">{val}</span>
                )}
                <div className="flex items-center gap-1">
                  {editing ? (
                    <>
                      <IconBtn title="Save" onClick={commitEdit} className="text-brand">
                        <Check size={14} />
                      </IconBtn>
                      <IconBtn title="Cancel" onClick={() => setEditingIdx(-1)}>
                        <X size={14} />
                      </IconBtn>
                    </>
                  ) : (
                    <>
                      <IconBtn
                        title="Move up"
                        onClick={() => moveIdx(idx, -1)}
                        disabled={idx === 0}
                      >
                        <ArrowUp size={14} />
                      </IconBtn>
                      <IconBtn
                        title="Move down"
                        onClick={() => moveIdx(idx, 1)}
                        disabled={idx === items.length - 1}
                      >
                        <ArrowDown size={14} />
                      </IconBtn>
                      <IconBtn title="Edit" onClick={() => startEdit(idx)}>
                        <Pencil size={14} />
                      </IconBtn>
                      <IconBtn
                        title="Remove"
                        onClick={() => removeIdx(idx)}
                        className="text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </IconBtn>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {allowClearAll ? (
        <ConfirmDialog
          isOpen={resetOpen}
          onClose={() => setResetOpen(false)}
          onConfirm={() => resetMut.mutate()}
          title={`Clear ${def.label.toLowerCase()}`}
          message={<>Remove all configured values for this list? This cannot be undone.</>}
          confirmLabel="Clear all"
          danger
          loading={resetMut.isPending}
        />
      ) : null}
    </Section>
  );
};

SimpleListEditor.propTypes = {
  type: PropTypes.string.isRequired,
  def: PropTypes.shape({
    id: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    description: PropTypes.string,
    /** Keep the list alphabetical as values are added (colours). */
    autoSort: PropTypes.bool,
  }).isRequired,
};

export default SimpleListEditor;
