import { formatCurrency } from '@wrs/shared';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import PropTypes from 'prop-types';
import { Fragment, useEffect, useMemo, useState } from 'react';

import LineNotesCell, { LineNotesContent } from './LineNotesCell.jsx';
import { accessoryGroupNotes } from '../../lib/accessoryRemarksDisplay.js';
import ChecklistNextBookingAlert from '../../pages/booking/ChecklistNextBookingAlert.jsx';
import { checklistRowWarningClass } from '../../pages/booking/checklistNextBookingAlertUtils.js';
import LineTypeTag, { formatAccessoryGivenStatusLabel } from '../../pages/booking/LineTypeTag.jsx';
import { useIsLgUp } from '../../hooks/useBreakpoint.js';
import {
  CHECKLIST_STAGE_KEYS,
  CHECKLIST_STAGE_KEYS_ACCESSORY,
  CHECKLIST_STAGE_LABELS,
  CHECKLIST_STAGE_SHORT_LABELS,
  applyStageToggleToRowFlags,
  checklistRowKey,
  getChecklistStageKeys,
  rowIsSaleChecklistLine,
  lineBlocksReceived,
  receivedBlockedMessage,
  receivedBlockedReason,
  validateStageToggleIntent,
} from '../../lib/orderChecklistMerge.js';
import {
  checklistStageBlockedByAvailability,
  itemLineCheckboxDisabledTitle,
} from '../../lib/itemStageListTable.js';
import { toast } from '../../stores/uiStore.js';
import ItemLineCurrentStatusCell from '../reports/ItemLineCurrentStatusCell.jsx';
import NumberInput from '../ui/NumberInput.jsx';
import SmartImage from '../ui/SmartImage.jsx';
import {
  buildChecklistDisplaySections,
  checklistLineTotal,
  isGivenWithRentLockedStage,
  isSellLine,
} from '../../lib/bookingAccessoryCart.js';
import Badge from '../ui/Badge.jsx';
import TableHeaderLabel from '../ui/TableHeaderLabel.jsx';
import { parseNonNegativeNumber } from '../../lib/numberInput.js';

export const CHECKLIST_STAGES = CHECKLIST_STAGE_KEYS.map((key) => ({
  key,
  label: CHECKLIST_STAGE_LABELS[key],
}));

export const CHECKLIST_STAGES_ACCESSORY = CHECKLIST_STAGE_KEYS_ACCESSORY.map((key) => ({
  key,
  label: CHECKLIST_STAGE_LABELS[key],
}));

const STAGES = CHECKLIST_STAGES;
const CHECKLIST_COL_COUNT = 5 + STAGES.length;
const GIVEN_WITH_RENT_LOCKED_TITLE = 'Given with rent — completed at booking';

/** Desktop-only table wrapper — mobile uses cards, never these rules. */
const DESKTOP_TABLE_WRAP_CLASS = 'order-checklist-table';

/**
 * Order items checklist — desktop table (lg+) and mobile card stack.
 */
export default function OrderChecklistPanel({
  order,
  stageDraft,
  setStageDraft,
  paymentAccountOptions,
  pendingConditionRows,
  disabled,
  onStageIntentFailed,
  onConditionChange,
  onConditionDraftChange,
  conditionDraft,
  dense,
  nextBookingReturnTo,
  nextBookingReturnLabel,
  onNextBookingNavigate,
}) {
  const isLgUp = useIsLgUp();
  const sections = buildChecklistDisplaySections(order);

  const conditionDraftSafe = conditionDraft || null;
  const conditionDraftActive = Boolean(conditionDraftSafe && onConditionDraftChange);

  const mergeRowWithDraft = (row, itemType) => {
    if (!conditionDraftActive || !row) return row;
    const key = `${itemType === 'accessory' ? 'accessory' : 'item'}:${row.id}`;
    const draftRow = conditionDraftSafe[key];
    if (!draftRow) return row;
    return { ...row, ...draftRow };
  };

  const handleConditionChange = (itemType, id, patch) => {
    if (conditionDraftActive) {
      onConditionDraftChange(itemType, id, patch);
      return;
    }
    if (onConditionChange) onConditionChange(itemType, id, patch);
  };

  const handleStageChange = (itemType, rowId, stageKey, val) => {
    if (!stageDraft) return;
    if (
      stageKey === 'received' &&
      val &&
      lineBlocksReceived(order, conditionDraftSafe, itemType, rowId)
    ) {
      return;
    }
    if (itemType === 'item' && val) {
      const productRow = (order?.items || []).find((r) => String(r.id) === String(rowId));
      if (checklistStageBlockedByAvailability(itemType, stageKey, productRow, true)) {
        toast.warning(itemLineCheckboxDisabledTitle(productRow));
        return;
      }
    }
    if (itemType === 'accessory' && ['prepared', 'delivered'].includes(stageKey) && val) {
      const accessoryRow = (order?.accessories || []).find(
        (row) => String(row.id) === String(rowId)
      );
      const qty = Math.max(1, Number(accessoryRow?.qty || 1));
      if (qty > 1) {
        const action = stageKey === 'delivered' ? 'Deliver' : 'Prepare';
        const confirmed = window.confirm(
          `${action} all ${qty} units of ${accessoryRow?.name_snapshot || 'this accessory'}?`
        );
        if (!confirmed) return;
      }
    }
    const key = checklistRowKey(itemType, rowId);
    const isSale = rowIsSaleChecklistLine(order, itemType, rowId);
    const prior = stageDraft[key] || {};
    const nextRow = applyStageToggleToRowFlags(prior, itemType, stageKey, val, isSale);
    const nextDraft = { ...stageDraft, [key]: nextRow };
    const intent = validateStageToggleIntent(
      order,
      nextDraft,
      itemType,
      rowId,
      stageKey,
      val,
      conditionDraftSafe
    );
    if (!intent.ok) {
      if (intent.kind === 'warning') toast.warning(intent.message);
      else {
        toast.error(intent.message);
        onStageIntentFailed?.(intent);
      }
      return;
    }
    setStageDraft(nextDraft);
  };

  const isRowPending = (itemType, id) => pendingConditionRows?.has(`${itemType}:${id}`) || false;

  const rowVariant = isLgUp ? 'table' : 'card';
  const nextBookingLinkProps = {
    returnTo: nextBookingReturnTo,
    returnLabel: nextBookingReturnLabel,
    onNavigate: onNextBookingNavigate,
  };

  const renderItemBlock = (item, { saleHighlight, accessoriesByItem }) => {
    const lineAccessories = accessoriesByItem.get(String(item.id)) || [];
    const groupNotes = accessoryGroupNotes(lineAccessories);

    return (
      <Fragment key={item.id}>
        <ChecklistRow
          row={mergeRowWithDraft(item, 'item')}
          itemType="item"
          order={order}
          stageDraft={stageDraft}
          conditionDraft={conditionDraftSafe}
          disabled={disabled}
          dense={dense}
          paymentAccountOptions={paymentAccountOptions}
          conditionDisabled={isRowPending('item', item.id) || disabled}
          onStageChange={(stageKey, val) => handleStageChange('item', item.id, stageKey, val)}
          onConditionChange={(patch) => handleConditionChange('item', item.id, patch)}
          notes={item.tailor_notes}
          noteImage={item.tailor_note_image}
          variant={rowVariant}
          saleHighlight={saleHighlight}
          isSale={saleHighlight || isSellLine(item)}
          nextBookingLinkProps={nextBookingLinkProps}
        />
        {lineAccessories.map((accessory) => (
          <ChecklistRow
            key={accessory.id}
            row={mergeRowWithDraft(accessory, 'accessory')}
            itemType="accessory"
            order={order}
            nested
            parentItem={mergeRowWithDraft(item, 'item')}
            isSale={isSellLine(accessory)}
            stageDraft={stageDraft}
            conditionDraft={conditionDraftSafe}
            disabled={disabled}
            dense={dense}
            paymentAccountOptions={paymentAccountOptions}
            conditionDisabled={isRowPending('accessory', accessory.id) || disabled}
            onStageChange={(stageKey, val) =>
              handleStageChange('accessory', accessory.id, stageKey, val)
            }
            onConditionChange={(patch) => handleConditionChange('accessory', accessory.id, patch)}
            variant={rowVariant}
            nextBookingLinkProps={nextBookingLinkProps}
          />
        ))}
        {lineAccessories.length > 0 && groupNotes.length > 0 ? (
          <AccessoryGroupNotesBlock notes={groupNotes} variant={rowVariant} dense={dense} />
        ) : null}
      </Fragment>
    );
  };

  const renderDetachedSaleAccessory = ({ accessory, parentItem }) => (
    <ChecklistRow
      key={accessory.id}
      row={mergeRowWithDraft(accessory, 'accessory')}
      itemType="accessory"
      order={order}
      nested
      parentItem={parentItem}
      stageDraft={stageDraft}
      conditionDraft={conditionDraftSafe}
      disabled={disabled}
      dense={dense}
      paymentAccountOptions={paymentAccountOptions}
      conditionDisabled={isRowPending('accessory', accessory.id) || disabled}
      onStageChange={(stageKey, val) => handleStageChange('accessory', accessory.id, stageKey, val)}
      onConditionChange={(patch) => handleConditionChange('accessory', accessory.id, patch)}
      variant={rowVariant}
      saleHighlight
      isSale
      nextBookingLinkProps={nextBookingLinkProps}
    />
  );

  const renderStandaloneAccessory = (accessory, { saleHighlight }) => (
    <ChecklistRow
      key={accessory.id}
      row={mergeRowWithDraft(accessory, 'accessory')}
      itemType="accessory"
      order={order}
      stageDraft={stageDraft}
      conditionDraft={conditionDraftSafe}
      disabled={disabled}
      dense={dense}
      paymentAccountOptions={paymentAccountOptions}
      conditionDisabled={isRowPending('accessory', accessory.id) || disabled}
      onStageChange={(stageKey, val) => handleStageChange('accessory', accessory.id, stageKey, val)}
      onConditionChange={(patch) => handleConditionChange('accessory', accessory.id, patch)}
      notes={accessory.remarks}
      variant={rowVariant}
      saleHighlight={saleHighlight}
      isSale={saleHighlight}
      nextBookingLinkProps={nextBookingLinkProps}
    />
  );

  const renderSaleDivider = () => {
    if (!sections.showSaleDivider) return null;
    if (rowVariant === 'card') {
      return (
        <div className="rounded-md border border-gray-200 bg-gray-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-700">
          Sale items
        </div>
      );
    }
    return (
      <tr className="bg-gray-100">
        <td
          colSpan={CHECKLIST_COL_COUNT}
          className="!py-2 !px-3 text-[11px] font-semibold uppercase tracking-wide text-gray-700"
        >
          Sale items
        </td>
      </tr>
    );
  };

  const renderAllSections = () => (
    <>
      {sections.rentItems.map((item) =>
        renderItemBlock(item, {
          saleHighlight: false,
          accessoriesByItem: sections.rentAccessoriesByItem,
        })
      )}
      {sections.rentStandalone.map((accessory) =>
        renderStandaloneAccessory(accessory, { saleHighlight: false })
      )}
      {renderSaleDivider()}
      {sections.saleItems.map((item) =>
        renderItemBlock(item, {
          saleHighlight: true,
          accessoriesByItem: sections.saleAccessoriesByItem,
        })
      )}
      {sections.saleDetachedFromProducts.map((row) => renderDetachedSaleAccessory(row))}
      {sections.saleStandalone.map((accessory) =>
        renderStandaloneAccessory(accessory, { saleHighlight: true })
      )}
    </>
  );

  if (!isLgUp) {
    return <div className="space-y-2 min-w-0">{renderAllSections()}</div>;
  }

  const stageHeaderLabel = (key) =>
    dense
      ? CHECKLIST_STAGE_SHORT_LABELS[key] || CHECKLIST_STAGE_LABELS[key]
      : CHECKLIST_STAGE_LABELS[key];

  return (
    <div className={`table-wrap overflow-x-auto ${DESKTOP_TABLE_WRAP_CLASS}`}>
      <table
        className={`table table-fixed w-full ${dense ? 'min-w-[56rem] text-[11px]' : 'min-w-[60rem] text-xs'}`}
      >
        <colgroup>
          <col className={dense ? 'w-[22%]' : 'w-[24%]'} />
          <col className={dense ? 'w-[4%]' : 'w-[4%]'} />
          <col className={dense ? 'w-[8%]' : 'w-[8%]'} />
          <col className={dense ? 'w-[7%]' : 'w-[7%]'} />
          <col className={dense ? 'w-[9%]' : 'w-[9%]'} />
          <col className={dense ? 'w-[8%]' : 'w-[8%]'} />
          <col className={dense ? 'w-[7%]' : 'w-[7%]'} />
          <col className={dense ? 'w-[7%]' : 'w-[7%]'} />
          <col className={dense ? 'w-[7%]' : 'w-[7%]'} />
          <col className={dense ? 'w-[21%]' : 'w-[19%]'} />
        </colgroup>
        <thead>
          <tr>
            <th className="checklist-base-th">
              <TableHeaderLabel>Item</TableHeaderLabel>
            </th>
            <th className="checklist-base-th text-right">
              <TableHeaderLabel align="right">Qty</TableHeaderLabel>
            </th>
            <th className="checklist-base-th">
              <TableHeaderLabel>Notes</TableHeaderLabel>
            </th>
            <th className="checklist-base-th text-right">
              <TableHeaderLabel align="right">Price</TableHeaderLabel>
            </th>
            <th className="checklist-base-th">
              <TableHeaderLabel>Salesman</TableHeaderLabel>
            </th>
            {STAGES.map((s) => (
              <th key={s.key} className="checklist-stage-th" title={CHECKLIST_STAGE_LABELS[s.key]}>
                <TableHeaderLabel align="center">{stageHeaderLabel(s.key)}</TableHeaderLabel>
              </th>
            ))}
            <th className="checklist-base-th text-center">
              <TableHeaderLabel align="center">Condition</TableHeaderLabel>
            </th>
          </tr>
        </thead>
        <tbody>{renderAllSections()}</tbody>
      </table>
    </div>
  );
}

function ChecklistPriceCell({ row, isSale, dense }) {
  const qty = Math.max(1, Number(row?.qty) || 1);
  const discount = Number(row?.discount) || 0;
  const showLineTotal = qty > 1 || discount > 0;

  if (!isSale) {
    return <span className="tabular-nums">{formatCurrency(row.price)}</span>;
  }

  return (
    <div className="text-right">
      <span
        className={`block font-semibold uppercase tracking-wide text-gray-500 ${
          dense ? 'text-[9px]' : 'text-[10px]'
        }`}
      >
        Sale price
      </span>
      <span className={`tabular-nums font-medium text-yellow-700 ${dense ? 'text-[11px]' : ''}`}>
        {formatCurrency(row.price)}
      </span>
      {showLineTotal ? (
        <span
          className={`block tabular-nums text-gray-600 ${dense ? 'text-[10px]' : 'text-[11px]'}`}
        >
          Line {formatCurrency(checklistLineTotal(row))}
        </span>
      ) : null}
    </div>
  );
}

ChecklistPriceCell.propTypes = {
  row: PropTypes.object.isRequired,
  isSale: PropTypes.bool,
  dense: PropTypes.bool,
};

ChecklistPriceCell.defaultProps = {
  isSale: false,
  dense: false,
};

function resolveLineSalesPersonName(row, itemType, order) {
  if (itemType !== 'item') return '';
  const lineName = String(row.sales_person_name || '').trim();
  if (lineName) return lineName;
  if (!row.sales_person_id && order?.sales_person_name) {
    return String(order.sales_person_name).trim();
  }
  return '';
}

function resolveAccessoryCategoryName(row) {
  return String(row?.category_name || '').trim();
}

function buildAccessoryChecklistMeta(row) {
  return {
    categoryName: resolveAccessoryCategoryName(row),
  };
}

function AccessoryCategoryLead({ label, dense }) {
  if (!label) return null;
  return (
    <>
      <span className={`shrink-0 text-gray-400 ${dense ? 'text-[10px]' : 'text-[11px]'}`}>
        -&gt;
      </span>
      <span
        className={`inline-flex items-center rounded-full border border-gray-200 bg-white font-semibold text-gray-700 break-words leading-none ${
          dense ? 'px-1 py-px text-[9px]' : 'px-1.5 py-0.5 text-[10px]'
        }`}
      >
        {label}
      </span>
    </>
  );
}

AccessoryCategoryLead.propTypes = {
  label: PropTypes.string,
  dense: PropTypes.bool,
};

function ChecklistRow({
  row,
  itemType,
  order,
  nested,
  parentItem,
  stageDraft,
  conditionDraft,
  disabled,
  dense,
  paymentAccountOptions,
  conditionDisabled,
  onStageChange,
  onConditionChange,
  notes,
  noteImage,
  variant,
  saleHighlight,
  isSale,
  nextBookingLinkProps,
}) {
  const rowKey = checklistRowKey(itemType, row.id);
  const saleRow = isSale || saleHighlight;
  const salesPersonName = resolveLineSalesPersonName(row, itemType, order);
  const rowStageKeys = getChecklistStageKeys(itemType, { isSale: saleRow });
  const rowStageDefs = rowStageKeys.map((key) => ({
    key,
    label: CHECKLIST_STAGE_LABELS[key],
  }));
  const stages = rowStageDefs.map((s) => ({
    ...s,
    checked: !!stageDraft?.[rowKey]?.[s.key],
  }));
  const warningClass = checklistRowWarningClass(row.next_booking_alert);
  const imgSize = dense ? (nested ? 'w-5 h-5' : 'w-6 h-6') : nested ? 'w-7 h-7' : 'w-8 h-8';
  const billingSubtitle = itemType === 'accessory' ? formatAccessoryGivenStatusLabel(row) : null;
  const accessoryMeta = itemType === 'accessory' ? buildAccessoryChecklistMeta(row) : null;
  const showAccessoryRentTag =
    itemType === 'accessory' && String(row.type || 'rent').toLowerCase() === 'sell';

  const itemInfo = (
    <div className={`flex items-start gap-1 min-w-0 leading-tight ${nested ? 'pl-2' : ''}`}>
      <SmartImage
        src={row.main_image || row.image || row.image_url || row.photo || ''}
        alt={row.name_snapshot}
        className={`${imgSize} rounded border border-gray-200 bg-white object-contain shrink-0`}
      />
      <div className="min-w-0 flex-1">
        {itemType === 'accessory' ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0">
              {accessoryMeta?.categoryName ? (
                <AccessoryCategoryLead label={accessoryMeta.categoryName} dense={dense} />
              ) : nested ? (
                <span className={`shrink-0 text-gray-400 ${dense ? 'text-[10px]' : 'text-[11px]'}`}>
                  -&gt;
                </span>
              ) : null}
              <span className={`font-medium break-words ${dense ? 'text-[11px]' : 'text-sm'}`}>
                {row.name_snapshot}
              </span>
              {saleHighlight ? (
                <Badge tone="green" className="shrink-0 text-[10px]">
                  Sale
                </Badge>
              ) : null}
              {showAccessoryRentTag ? <LineTypeTag type={row.type} compact={dense} /> : null}
              {Number(row.qty || 0) > 1 ? (
                <Badge tone="yellow" className="shrink-0 text-[10px]">
                  Prepare all {Number(row.qty)}
                </Badge>
              ) : null}
            </div>
            {billingSubtitle ? (
              <div className={dense ? 'text-[10px]' : 'text-[11px]'}>
                <span className="font-medium text-brand break-words">{billingSubtitle}</span>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1 min-w-0">
              <span className={`font-medium break-words ${dense ? 'text-[11px]' : 'text-sm'}`}>
                {row.name_snapshot}
              </span>
              {saleHighlight ? (
                <Badge tone="green" className="shrink-0 text-[10px]">
                  Sale
                </Badge>
              ) : null}
            </div>
            <ChecklistNextBookingAlert
              alert={row.next_booking_alert}
              returnTo={nextBookingLinkProps?.returnTo}
              returnLabel={nextBookingLinkProps?.returnLabel}
              onNavigate={nextBookingLinkProps?.onNavigate}
            />
            {!saleRow ? (
              <div className={`text-gray-500 break-words ${dense ? 'text-[10px]' : 'text-xs'}`}>
                {row.code_snapshot || '—'}
              </div>
            ) : null}
            {!saleRow ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span
                  className={`font-semibold uppercase tracking-wide text-gray-400 ${
                    dense ? 'text-[9px]' : 'text-[10px]'
                  }`}
                >
                  Status
                </span>
                <ItemLineCurrentStatusCell row={row} />
              </div>
            ) : null}
            {variant === 'card' && salesPersonName ? (
              <div className={`text-gray-600 break-words ${dense ? 'text-[10px]' : 'text-xs'}`}>
                Salesman: <span className="font-medium text-gray-800">{salesPersonName}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  const blocksReceived = lineBlocksReceived(order, conditionDraft, itemType, row.id);
  const receivedBlockReason = receivedBlockedReason(order, conditionDraft, itemType, row.id);
  const receivedBlockedTitle = receivedBlockedMessage(order, conditionDraft, itemType, row.id);
  const lineSelfMissing = receivedBlockReason === 'self';
  const stageDisabled = disabled || !stageDraft;
  const availabilityTitle = itemLineCheckboxDisabledTitle(row);
  const stageToggles = (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stages.map((s) => {
        const receivedBlocked = s.key === 'received' && blocksReceived;
        const receivedChecked = s.key === 'received' && !!s.checked;
        const blockReceivedOn = receivedBlocked && !receivedChecked;
        const stageLocked = isGivenWithRentLockedStage(row, s.key);
        const availabilityBlocked =
          !s.checked && checklistStageBlockedByAvailability(itemType, s.key, row, true);
        const cellTitle = stageLocked
          ? GIVEN_WITH_RENT_LOCKED_TITLE
          : availabilityBlocked
            ? availabilityTitle
            : receivedBlocked
              ? receivedBlockedTitle
              : undefined;
        const stageCellDisabled =
          stageDisabled || blockReceivedOn || stageLocked || availabilityBlocked;
        return (
          <div
            key={s.key}
            className={`flex flex-col gap-0.5 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-medium text-gray-700 ${
              stageCellDisabled ? 'cursor-not-allowed opacity-60' : ''
            }`}
            title={cellTitle}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate" title={cellTitle}>
                {s.label}
              </span>
              <StageCheckbox
                checked={s.checked}
                disabled={stageCellDisabled}
                dense={dense}
                ariaLabel={`Mark ${s.label} for ${row.name_snapshot}`}
                onChange={(val) => {
                  if (stageLocked || (receivedBlocked && val) || (availabilityBlocked && val))
                    return;
                  onStageChange(s.key, val);
                }}
              />
            </div>
            {availabilityBlocked ? (
              <span className="text-[10px] text-red-700 leading-tight" title={availabilityTitle}>
                Not available
              </span>
            ) : null}
            {receivedBlocked && s.key === 'received' ? (
              <span
                className="text-[10px] text-yellow-700 leading-tight"
                title={receivedBlockedTitle}
              >
                Received off
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  const conditionBlock = saleRow ? null : (
    <ChecklistConditionBlock
      row={row}
      itemType={itemType}
      receivedOff={lineSelfMissing}
      receivedOffTitle={receivedBlockedTitle}
      disabled={conditionDisabled}
      onChange={onConditionChange}
      dense={dense}
      layout={variant === 'table' ? 'inline' : 'stacked'}
    />
  );

  if (variant === 'card') {
    return (
      <div
        className={`rounded-lg border border-gray-200 bg-surface p-3 shadow-card space-y-3 ${warningClass} ${
          nested ? 'ml-3 border-l-4 border-l-brand/30' : ''
        } ${saleRow ? 'bg-brand-light/20' : saleHighlight && !nested ? 'bg-brand-light/30' : ''}`}
      >
        {itemInfo}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
          <span>
            Qty <strong className="text-gray-900">{row.qty}</strong>
          </span>
          <span className="flex flex-col items-start">
            <span className="text-gray-500">Price</span>
            <ChecklistPriceCell row={row} isSale={saleRow} dense={dense} />
          </span>
          {salesPersonName ? (
            <span>
              Salesman <strong className="text-gray-900">{salesPersonName}</strong>
            </span>
          ) : null}
        </div>
        {LineNotesContent.hasContent({ notes, noteImage }) ? (
          <div className="rounded border border-gray-100 bg-gray-50/80 p-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
              Notes
            </div>
            <LineNotesContent notes={notes} noteImage={noteImage} compact={dense} />
          </div>
        ) : null}
        {!saleRow && rowStageKeys.length > 0 ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
              Stages
            </div>
            {stageToggles}
          </div>
        ) : null}
        {conditionBlock ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
              Condition
            </div>
            {conditionBlock}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <tr
      className={`${warningClass} ${nested ? 'checklist-accessory-row bg-gray-50/60' : ''} ${
        saleRow ? 'bg-brand-light/20' : saleHighlight && !nested ? 'bg-brand-light/30' : ''
      }`}
    >
      <td className="checklist-item-cell align-top whitespace-normal">{itemInfo}</td>
      <td className={`text-right tabular-nums align-middle ${dense ? 'text-[11px]' : ''}`}>
        {row.qty}
      </td>
      <LineNotesCell
        notes={notes}
        noteImage={noteImage}
        compact={dense}
        showDashWhenEmpty={itemType !== 'accessory'}
        className="checklist-notes-cell align-middle whitespace-normal"
      />
      <td className={`text-right align-middle whitespace-normal ${dense ? 'text-[11px]' : ''}`}>
        <ChecklistPriceCell row={row} isSale={saleRow} dense={dense} />
      </td>
      <td
        className={`checklist-salesman-cell align-middle whitespace-normal ${dense ? 'text-[11px]' : 'text-xs'}`}
      >
        {salesPersonName ? (
          <span className="font-medium text-gray-800 break-words">{salesPersonName}</span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      {STAGES.map((s) => {
        const receivedBlocked = s.key === 'received' && blocksReceived;
        const receivedChecked = s.key === 'received' && !!stageDraft?.[rowKey]?.[s.key];
        const blockReceivedOn = receivedBlocked && !receivedChecked;
        const stageLocked = rowStageKeys.includes(s.key) && isGivenWithRentLockedStage(row, s.key);
        const stageChecked = !!stageDraft?.[rowKey]?.[s.key];
        const availabilityBlocked =
          rowStageKeys.includes(s.key) &&
          !stageChecked &&
          checklistStageBlockedByAvailability(itemType, s.key, row, true);
        const cellTitle = stageLocked
          ? GIVEN_WITH_RENT_LOCKED_TITLE
          : availabilityBlocked
            ? availabilityTitle
            : receivedBlocked
              ? receivedBlockedTitle
              : undefined;
        const stageCellDisabled =
          stageDisabled || blockReceivedOn || stageLocked || availabilityBlocked;
        return (
          <td key={s.key} className="checklist-stage-cell text-center align-middle">
            {!rowStageKeys.includes(s.key) ? (
              <span className="text-gray-400 text-[11px]" aria-hidden>
                —
              </span>
            ) : (
              <div
                className={`flex flex-col items-center justify-center gap-0.5 min-h-[2.25rem] px-2 py-1 ${
                  stageCellDisabled ? 'opacity-60 cursor-not-allowed' : ''
                }`}
                title={cellTitle}
              >
                <StageCheckbox
                  checked={stageChecked}
                  disabled={stageCellDisabled}
                  dense={dense}
                  ariaLabel={`Mark ${s.label} for ${row.name_snapshot}`}
                  onChange={(val) => {
                    if (stageLocked || (receivedBlocked && val) || (availabilityBlocked && val))
                      return;
                    onStageChange(s.key, val);
                  }}
                />
                {availabilityBlocked ? (
                  <span
                    className={`text-red-700 leading-tight ${dense ? 'text-[9px]' : 'text-[10px]'}`}
                    title={availabilityTitle}
                  >
                    N/A
                  </span>
                ) : null}
                {receivedBlocked && s.key === 'received' ? (
                  <span
                    className={`text-yellow-700 leading-tight ${dense ? 'text-[9px]' : 'text-[10px]'}`}
                    title={receivedBlockedTitle}
                  >
                    Received off
                  </span>
                ) : null}
              </div>
            )}
          </td>
        );
      })}
      <td className="checklist-condition-cell text-center align-middle whitespace-normal">
        {conditionBlock ?? (
          <span className="text-gray-400 text-[11px]" aria-hidden>
            —
          </span>
        )}
      </td>
    </tr>
  );
}

function AccessoryGroupNotesBlock({ notes, variant, dense }) {
  const labelClass = dense
    ? 'text-[11px] font-bold uppercase tracking-wide text-gray-600'
    : 'text-xs font-bold uppercase tracking-wide text-gray-600';
  const textClass = dense
    ? 'text-xs font-bold leading-snug text-brand whitespace-pre-wrap break-words'
    : 'text-sm font-bold leading-snug text-brand whitespace-pre-wrap break-words';

  const body =
    notes.length === 1 ? (
      <p className={textClass}>{notes[0]}</p>
    ) : (
      <ul className={`${textClass} list-disc pl-4 space-y-1`}>
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    );

  if (variant === 'card') {
    return (
      <div className="ml-3 rounded-lg border border-brand/20 border-l-4 border-l-brand/40 bg-brand-light/20 px-3 py-2.5">
        <div className={`${labelClass} mb-1`}>Accessory notes</div>
        {body}
      </div>
    );
  }

  return (
    <tr className="checklist-accessory-notes-row bg-brand-light/15">
      <td colSpan={CHECKLIST_COL_COUNT} className="!py-2.5 !px-3">
        <div className="pl-6 border-l-2 border-brand/35 min-w-0">
          <div className={`${labelClass} mb-1`}>Accessory notes</div>
          {body}
        </div>
      </td>
    </tr>
  );
}

AccessoryGroupNotesBlock.propTypes = {
  notes: PropTypes.arrayOf(PropTypes.string).isRequired,
  variant: PropTypes.oneOf(['table', 'card']).isRequired,
  dense: PropTypes.bool,
};

AccessoryGroupNotesBlock.defaultProps = {
  dense: false,
};

/** Simple pressed button (no checkbox UI). */
const StageCheckbox = ({ checked, onChange, disabled, dense, ariaLabel }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => onChange(!checked)}
    aria-label={ariaLabel}
    aria-pressed={!!checked}
    className={`${dense ? 'w-5 h-5' : 'w-6 h-6'} rounded inline-flex shrink-0 items-center justify-center border ${
      checked ? 'bg-brand border-brand text-white' : 'border-gray-300 text-gray-300'
    } disabled:opacity-50`}
  >
    <CheckCircle2 size={dense ? 12 : 14} className={checked ? 'opacity-100' : 'opacity-0'} />
  </button>
);

const ChecklistConditionBlock = ({
  row,
  itemType,
  receivedOff,
  receivedOffTitle,
  onChange,
  disabled,
  dense,
  layout,
}) => {
  const isDamaged = !!row.damaged;
  const isMissing = !!row.missing;
  const totalQty = Math.max(1, Number(row.qty || 1));
  const conditionQty = Math.min(
    totalQty,
    Math.max(
      1,
      Number(
        row.condition_qty || (isMissing ? row.missing_qty : isDamaged ? row.damaged_qty : 0) || 1
      )
    )
  );
  const [chargeDraft, setChargeDraft] = useState(String(row.damage_charge ?? 0));
  const [editingCharge, setEditingCharge] = useState(Number(row.damage_charge || 0) <= 0);
  const draftChargeNum = Number(chargeDraft);
  const safeDraftCharge = Number.isNaN(draftChargeNum) ? 0 : draftChargeNum;
  const currentCharge = Number(row.damage_charge || 0);
  const hasChargeChanges = safeDraftCharge !== currentCharge;

  useEffect(() => {
    setChargeDraft(String(row.damage_charge ?? 0));
    setEditingCharge(Number(row.damage_charge || 0) <= 0);
  }, [row.damage_charge]);

  const saveCharge = () => {
    const chargeNum = Number(chargeDraft);
    if (Number.isNaN(chargeNum) || chargeNum < 0) {
      toast.error('Damage charge must be 0 or more');
      return;
    }
    onChange({ damage_charge: chargeNum });
    setEditingCharge(false);
    if (chargeNum > 0) {
      toast.success('Charge added to draft — save checklist to apply.');
    }
  };

  const btnSize = dense ? 'w-5 h-5' : 'w-6 h-6';
  const textSize = dense ? 'text-[10px]' : 'text-[11px]';
  const inputH = dense ? 'h-6' : 'h-7';

  const flagButtons = (
    <>
      <button
        type="button"
        title="Mark damaged"
        disabled={disabled}
        onClick={() =>
          onChange({
            damaged: !isDamaged,
            condition_qty: !isDamaged ? (itemType === 'accessory' ? conditionQty : totalQty) : 0,
          })
        }
        className={`${btnSize} shrink-0 rounded inline-flex items-center justify-center border ${
          isDamaged ? 'bg-red-50 border-red-400 text-red-600' : 'border-gray-300 text-gray-400'
        } disabled:opacity-50`}
        aria-pressed={isDamaged}
      >
        <AlertTriangle size={dense ? 11 : 13} />
      </button>
      <div className="flex flex-col items-center gap-0.5 shrink-0">
        <button
          type="button"
          title="Mark missing"
          disabled={disabled}
          onClick={() =>
            onChange({
              missing: !isMissing,
              condition_qty: !isMissing ? (itemType === 'accessory' ? conditionQty : totalQty) : 0,
            })
          }
          className={`px-1.5 ${inputH} rounded inline-flex items-center justify-center border ${textSize} ${
            isMissing
              ? 'bg-yellow-50 border-yellow-400 text-yellow-700'
              : 'border-gray-300 text-gray-400'
          } disabled:opacity-50`}
        >
          Missing
        </button>
        {receivedOff ? (
          <span
            className={`${textSize} text-yellow-700 leading-tight`}
            title={receivedOffTitle || 'Received is disabled'}
          >
            Received off
          </span>
        ) : null}
      </div>
    </>
  );

  const affectedQuantityControl =
    itemType === 'accessory' && totalQty > 1 && (isDamaged || isMissing) ? (
      <label className={`inline-flex items-center gap-1 ${textSize} text-gray-600`}>
        Affected qty
        <NumberInput
          min={1}
          max={totalQty}
          value={conditionQty}
          onChange={(event) =>
            onChange({
              condition_qty: Math.min(
                totalQty,
                Math.max(1, Math.floor(Number(event.target.value) || 1))
              ),
            })
          }
          className={`w-14 ${inputH} border border-gray-300 rounded px-1.5 ${textSize} text-center`}
          aria-label={`Affected quantity out of ${totalQty}`}
        />
        <span className="text-gray-400">/ {totalQty}</span>
      </label>
    ) : null;

  if (layout === 'inline') {
    return (
      <div className="inline-flex flex-nowrap items-center gap-1 max-w-full">
        {flagButtons}
        {affectedQuantityControl}
        {editingCharge ? (
          <>
            <NumberInput
              min={0}
              step="0.01"
              allowEmpty
              disabled={disabled}
              value={chargeDraft}
              onChange={(e) =>
                setChargeDraft(String(parseNonNegativeNumber(e.target.value, { empty: '' })))
              }
              className={`w-[4.5rem] shrink-0 ${inputH} border border-gray-300 rounded px-1.5 ${textSize} tabular-nums`}
              title="Missing/damage charge amount"
              placeholder="0"
            />
            {hasChargeChanges ? (
              <button
                type="button"
                disabled={disabled}
                onClick={saveCharge}
                className={`shrink-0 ${inputH} px-2 rounded border border-brand text-brand ${textSize} hover:bg-brand-light/50 disabled:opacity-50`}
              >
                Save
              </button>
            ) : null}
          </>
        ) : (
          <>
            <span
              className={`${textSize} text-gray-700 shrink-0 max-w-[10rem] truncate tabular-nums`}
            >
              {Number(row.damage_charge || 0) > 0 ? formatCurrency(row.damage_charge) : 'No charge'}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setEditingCharge(true)}
              className={`shrink-0 ${inputH} px-1.5 rounded border border-gray-300 text-gray-700 ${textSize} hover:bg-gray-50 disabled:opacity-50`}
            >
              Edit
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 w-full min-w-0">
      <div className="flex flex-wrap items-center gap-2">{flagButtons}</div>
      {affectedQuantityControl}
      {editingCharge ? (
        <div className="flex flex-col gap-2 w-full">
          <div className="flex flex-wrap gap-1 items-center w-full">
            <NumberInput
              min={0}
              step="0.01"
              allowEmpty
              disabled={disabled}
              value={chargeDraft}
              onChange={(e) =>
                setChargeDraft(String(parseNonNegativeNumber(e.target.value, { empty: '' })))
              }
              className={`min-w-0 flex-1 ${inputH} border border-gray-300 rounded px-2 ${textSize}`}
              title="Missing/damage charge amount"
              placeholder="0"
            />
          </div>
          {hasChargeChanges ? (
            <button
              type="button"
              disabled={disabled}
              onClick={saveCharge}
              className={`h-8 px-3 rounded border border-brand text-brand ${textSize} hover:bg-brand-light/50 disabled:opacity-50 self-start`}
            >
              Save charge
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 w-full">
          <div className={`${textSize} text-gray-700 min-w-0 flex-1 break-words`}>
            {Number(row.damage_charge || 0) > 0 ? (
              <span className="font-medium tabular-nums">{formatCurrency(row.damage_charge)}</span>
            ) : (
              'No charge'
            )}
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditingCharge(true)}
            className={`h-8 px-3 rounded border border-gray-300 text-gray-700 ${textSize} hover:bg-gray-50 disabled:opacity-50 shrink-0`}
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
};

ChecklistConditionBlock.propTypes = {
  row: PropTypes.object.isRequired,
  itemType: PropTypes.oneOf(['item', 'accessory']).isRequired,
  receivedOff: PropTypes.bool,
  receivedOffTitle: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  dense: PropTypes.bool,
  layout: PropTypes.oneOf(['inline', 'stacked']).isRequired,
};

ChecklistConditionBlock.defaultProps = {
  receivedOff: false,
  receivedOffTitle: undefined,
  disabled: false,
  dense: false,
};

OrderChecklistPanel.propTypes = {
  order: PropTypes.object.isRequired,
  stageDraft: PropTypes.object,
  setStageDraft: PropTypes.func.isRequired,
  paymentAccountOptions: PropTypes.array,
  pendingConditionRows: PropTypes.instanceOf(Set),
  disabled: PropTypes.bool,
  onStageIntentFailed: PropTypes.func,
  onConditionChange: PropTypes.func,
  onConditionDraftChange: PropTypes.func,
  conditionDraft: PropTypes.object,
  dense: PropTypes.bool,
  nextBookingReturnTo: PropTypes.string,
  nextBookingReturnLabel: PropTypes.string,
  onNextBookingNavigate: PropTypes.func,
};

OrderChecklistPanel.defaultProps = {
  stageDraft: null,
  paymentAccountOptions: [],
  pendingConditionRows: new Set(),
  disabled: false,
  onStageIntentFailed: null,
  onConditionChange: null,
  onConditionDraftChange: null,
  conditionDraft: null,
  dense: false,
  nextBookingReturnTo: null,
  nextBookingReturnLabel: null,
  onNextBookingNavigate: null,
};

ChecklistRow.propTypes = {
  row: PropTypes.object.isRequired,
  itemType: PropTypes.oneOf(['item', 'accessory']).isRequired,
  order: PropTypes.object,
  nested: PropTypes.bool,
  stageDraft: PropTypes.object,
  conditionDraft: PropTypes.object,
  disabled: PropTypes.bool,
  dense: PropTypes.bool,
  paymentAccountOptions: PropTypes.array,
  conditionDisabled: PropTypes.bool,
  onStageChange: PropTypes.func.isRequired,
  onConditionChange: PropTypes.func.isRequired,
  notes: PropTypes.string,
  noteImage: PropTypes.string,
  variant: PropTypes.oneOf(['table', 'card']).isRequired,
  saleHighlight: PropTypes.bool,
  isSale: PropTypes.bool,
  parentItem: PropTypes.object,
  nextBookingLinkProps: PropTypes.shape({
    returnTo: PropTypes.string,
    returnLabel: PropTypes.string,
    onNavigate: PropTypes.func,
  }),
};

ChecklistRow.defaultProps = {
  nested: false,
  parentItem: null,
  stageDraft: null,
  disabled: false,
  dense: false,
  paymentAccountOptions: [],
  conditionDisabled: false,
  notes: '',
  noteImage: '',
  saleHighlight: false,
  isSale: false,
  nextBookingLinkProps: null,
};

StageCheckbox.propTypes = {
  id: PropTypes.string.isRequired,
  checked: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  dense: PropTypes.bool,
  ariaLabel: PropTypes.string,
};

ChecklistConditionBlock.propTypes = {
  row: PropTypes.object.isRequired,
  receivedOff: PropTypes.bool,
  receivedOffTitle: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  dense: PropTypes.bool,
  layout: PropTypes.oneOf(['inline', 'stacked']),
};

ChecklistConditionBlock.defaultProps = {
  receivedOff: false,
  receivedOffTitle: undefined,
  layout: 'stacked',
};
