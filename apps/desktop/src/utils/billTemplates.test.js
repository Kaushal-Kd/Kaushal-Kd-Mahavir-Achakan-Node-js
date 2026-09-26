import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BILL_ONE_PAGE_ROW_MAX,
  BILL_ONE_PAGE_ROW_MIN,
  DEFAULT_MANUAL_BILL_CONTENT,
  LETTER_PAD_PAGE_SETTINGS,
  SAMPLE_ORDER,
  applyBillPrintDensity,
  countBillPrintRows,
  mergeTemplate,
  renderBillHtml,
} from './billTemplates.js';

function orderWithLineCount(count) {
  const items = [];
  const accessories = [];
  for (let i = 0; i < count; i += 1) {
    const id = `item-${i + 1}`;
    if (i % 3 === 2) {
      accessories.push({
        order_item_id: items[items.length - 1]?.id || id,
        name_snapshot: `Accessory ${i + 1}`,
        qty: 1,
        price: 100,
        total: 100,
      });
    } else {
      items.push({
        id,
        name_snapshot: `Product ${i + 1}`,
        code_snapshot: `P-${i + 1}`,
        qty: 1,
        price: 1000,
        total: 1000,
      });
    }
  }
  return { ...SAMPLE_ORDER, items, accessories };
}

const shop = { name: 'Demo Shop', address: 'Main Road', phone: '9876543210' };

describe('bill template blank-paper controls', () => {
  it('merges safe defaults for templates saved before blank-paper settings existed', () => {
    const template = mergeTemplate({ paper_size: 'A5' });
    assert.equal(template.page_settings.vertical_offset_in, 0);
    assert.equal(template.page_settings.letterhead_top_in, 0);
    assert.equal(template.page_settings.letterhead_bottom_in, 0);
    assert.equal(template.custom_content.enabled, false);
    assert.equal(template.custom_content.text, DEFAULT_MANUAL_BILL_CONTENT);
  });

  it('reserves preprinted letterhead space without moving thermal layouts', () => {
    const html = renderBillHtml({
      order: SAMPLE_ORDER,
      shop,
      template: { page_settings: { letterhead_top_in: 1.5, letterhead_bottom_in: 0.5 } },
    });
    assert.match(html, /padding-top: calc\(14mm \+ 1\.5in\)/);
    assert.match(html, /padding-bottom: calc\(16mm \+ 0\.5in\)/);
  });

  it('uses Mahavir Achakan letter-pad clearance on the A4 preset', () => {
    assert.equal(LETTER_PAD_PAGE_SETTINGS.letterhead_top_in, 0.75);
    assert.equal(LETTER_PAD_PAGE_SETTINGS.letterhead_bottom_in, 0.15);
    const html = renderBillHtml({
      order: SAMPLE_ORDER,
      shop,
      template: { page_settings: LETTER_PAD_PAGE_SETTINGS },
    });
    assert.match(html, /padding-top: calc\(14mm \+ 0\.75in\)/);
    assert.match(html, /padding-bottom: calc\(16mm \+ 0\.15in\)/);
  });

  it('prints bold product names and a separate item-code column', () => {
    const html = renderBillHtml({ order: SAMPLE_ORDER, shop });
    assert.match(html, /<th>Item<\/th><th>Item Code<\/th>/);
    assert.match(html, /class="item-name"/);
    assert.match(html, /class="item-code"/);
  });

  it('prints both distinct customer mobile numbers', () => {
    const html = renderBillHtml({
      order: {
        ...SAMPLE_ORDER,
        pickup_number: '9000000001',
        customer_phone: '9000000001',
        customer_phone2: '9000000002',
      },
      shop,
    });
    assert.match(html, /9000000001/);
    assert.match(html, /9000000002/);
  });

  it('prints the configured vertical offset in inches', () => {
    const html = renderBillHtml({
      order: SAMPLE_ORDER,
      shop,
      template: { page_settings: { vertical_offset_in: 1.25 } },
    });
    assert.match(html, /top: 1\.25in/);
  });

  it('clamps unsafe placement values to the supported print range', () => {
    const html = renderBillHtml({
      order: SAMPLE_ORDER,
      shop,
      template: { page_settings: { vertical_offset_in: 99 } },
    });
    assert.match(html, /top: 4in/);
  });

  it('renders manual blocks and escapes manually entered markup', () => {
    const html = renderBillHtml({
      order: SAMPLE_ORDER,
      shop,
      template: {
        custom_content: {
          enabled: true,
          text: '<script>alert(1)</script> {{bill_number}}\n{{items}}',
        },
      },
    });
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /INV-0001/);
    assert.match(html, /<table class="items">/);
  });

  it('keeps booking date with pickup and return in one A4 meta box', () => {
    const html = renderBillHtml({
      order: SAMPLE_ORDER,
      shop,
      billNotesHtml: '<p>Shop-wide notes must not print</p>',
    });
    assert.doesNotMatch(html, /<div class="shop-name">/);
    assert.doesNotMatch(html, /class="bill-header"/);
    assert.doesNotMatch(html, /Main Road/);
    assert.doesNotMatch(html, /Ph: /);
    assert.doesNotMatch(html, /Date: /);
    assert.doesNotMatch(html, /<section class="bill-notes-card">/);
    assert.doesNotMatch(html, /Shop-wide notes must not print/);
    assert.equal(html.match(/class="meta-box"/g)?.length, 1);
    const boxStart = html.indexOf('class="meta-box"');
    const invoiceIdx = html.indexOf('Invoice no.');
    const bookingIdx = html.indexOf('Booking date');
    const pickupIdx = html.indexOf('Pickup · Return');
    assert.ok(
      boxStart >= 0 &&
        invoiceIdx > boxStart &&
        bookingIdx > invoiceIdx &&
        pickupIdx > bookingIdx
    );
    assert.match(html, /INV-0001/);
    assert.doesNotMatch(html, /data-bill-code=/);
  });

  it('prints a bill barcode in the invoice box only when the template enables it', () => {
    const off = renderBillHtml({ order: SAMPLE_ORDER, shop });
    assert.doesNotMatch(off, /data-bill-code=/);
    const html = renderBillHtml({
      order: SAMPLE_ORDER,
      shop,
      template: { header_config: { show_barcode: true } },
    });
    assert.match(html, /class="bill-barcode"/);
    assert.match(html, /data-bill-code="BILL:INV-0001"/);
    const boxStart = html.indexOf('class="meta-box"');
    const barcodeIdx = html.indexOf('data-bill-code="BILL:INV-0001"');
    const invoiceIdx = html.indexOf('Invoice no.');
    assert.ok(boxStart >= 0 && barcodeIdx > boxStart && invoiceIdx > barcodeIdx);
    assert.doesNotMatch(html, /class="bill-header"/);
  });

  it('keeps the default item font for short bills and for more than 30 rows', () => {
    const shortTpl = applyBillPrintDensity(mergeTemplate({}), orderWithLineCount(12));
    assert.equal(shortTpl.item_density.compact, false);
    assert.equal(shortTpl.typography.product_size, null);
    const longTpl = applyBillPrintDensity(
      mergeTemplate({}),
      orderWithLineCount(BILL_ONE_PAGE_ROW_MAX + 4)
    );
    assert.equal(longTpl.item_density.compact, false);
    assert.equal(longTpl.typography.product_size, null);
    const shortHtml = renderBillHtml({ order: orderWithLineCount(12), shop });
    assert.match(shortHtml, /font-size: 12px;/);
    assert.match(shortHtml, /padding: 7px 10px;/);
  });

  it('shrinks item type only when printed rows are between 21 and 30', () => {
    const midCount = 25;
    assert.ok(midCount >= BILL_ONE_PAGE_ROW_MIN && midCount <= BILL_ONE_PAGE_ROW_MAX);
    assert.equal(countBillPrintRows(orderWithLineCount(midCount)), midCount);
    const midTpl = applyBillPrintDensity(mergeTemplate({}), orderWithLineCount(midCount));
    assert.equal(midTpl.item_density.compact, true);
    assert.ok(midTpl.typography.product_size < 12);
    assert.ok(midTpl.typography.accessory_size < 11);
    const midHtml = renderBillHtml({ order: orderWithLineCount(midCount), shop });
    assert.match(midHtml, new RegExp(`font-size: ${midTpl.typography.product_size}px;`));
    assert.doesNotMatch(midHtml, /padding: 7px 10px;/);
    const denser = applyBillPrintDensity(mergeTemplate({}), orderWithLineCount(30));
    assert.ok(denser.typography.product_size < midTpl.typography.product_size);
  });
});
