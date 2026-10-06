import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BILL_ONE_PAGE_ROW_MAX,
  BILL_ONE_PAGE_ROW_MIN,
  BILL_ONE_PAGE_COMPACT_AT,
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
    assert.match(html, /padding-bottom: calc\(6mm \+ 0\.5in\)/);
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
    assert.match(html, /padding-bottom: calc\(6mm \+ 0\.15in\)/);
  });

  it('prints bold product names and a separate item-code column', () => {
    const html = renderBillHtml({ order: SAMPLE_ORDER, shop });
    assert.match(html, /<th class="col-item">Item<\/th><th class="col-code">Item Code<\/th>/);
    assert.match(html, /class="item-name"/);
    assert.match(html, /class="item-code"/);
    assert.match(html, /\.item-code \{[^}]*white-space: nowrap/);
    assert.match(html, /th\.col-qty[^}]*width: 1%/);
    assert.match(html, /table\.items td \{[^}]*border-right: 1px solid #d1d5db/);
    assert.match(html, /table\.items th \{[^}]*border-right: 1px solid/);
    assert.match(html, /class="item-acc"/);
    assert.match(html, /table\.items \.item-acc td:first-child \{[^}]*padding-left: 36px/);
    assert.match(html, /tbody tr\.item-acc td \{[^}]*background: #fff/);
    assert.match(html, /class="acc-indent"/);
  });

  it('prints both distinct customer mobile numbers from this booking', () => {
    const html = renderBillHtml({
      order: {
        ...SAMPLE_ORDER,
        contact_phone1: '9000000001',
        pickup_number: '9000000002',
        customer_phone: '9000000001',
        customer_phone2: '9999999999',
        customer: { phone1: '9000000001', phone2: '9999999999' },
      },
      shop,
    });
    assert.match(html, /9000000001/);
    assert.match(html, /9000000002/);
    assert.doesNotMatch(html, /9999999999/);
  });

  it('prints contact no. 2 name in brackets after the second number', () => {
    const html = renderBillHtml({
      order: {
        ...SAMPLE_ORDER,
        contact_phone1: '9825497629',
        pickup_number: '9512997629',
        pickup_name: 'POTE',
        customer_phone: '9825497629',
        customer_phone2: '9000000000',
        customer: { phone1: '9825497629', phone2: '9000000000', phone2_name: 'MASTER' },
      },
      shop,
    });
    assert.match(html, /9825497629/);
    assert.match(html, /9512997629 \(POTE\)/);
    assert.doesNotMatch(html, /9825497629 \(POTE\)/);
    assert.doesNotMatch(html, /9000000000/);
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

  it('keeps booking date in the A4 meta box and pickup/return as two rows on the left', () => {
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
    assert.doesNotMatch(html, /Pickup · Return/);
    assert.equal(html.match(/class="meta-box"/g)?.length, 1);
    const boxStart = html.indexOf('class="meta-box"');
    const invoiceIdx = html.indexOf('Invoice no.');
    const bookingIdx = html.indexOf('Booking date');
    const pickupIdx = html.indexOf('Pickup:');
    const returnIdx = html.indexOf('Return:');
    const boxWrapIdx = html.indexOf('class="pickup-return-box"');
    assert.ok(
      boxStart >= 0 &&
        invoiceIdx > boxStart &&
        bookingIdx > invoiceIdx
    );
    assert.ok(boxWrapIdx >= 0 && pickupIdx > boxWrapIdx && returnIdx > pickupIdx && pickupIdx < boxStart);
    assert.match(html, /\.pickup-return-box \{[^}]*width: max-content/);
    assert.doesNotMatch(html, /Bill to/);
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

  it('labels name, address then phone and keeps reference and remarks at the bottom', () => {
    const html = renderBillHtml({ order: SAMPLE_ORDER, shop });
    const nameIdx = html.indexOf('>Name:</span>');
    const addressIdx = html.indexOf('>Address:</span>');
    const phoneIdx = html.indexOf('>Phone no:</span>');
    const itemsIdx = html.indexOf('table class="items"');
    const bottomIdx = html.indexOf('class="bill-bottom"');
    const refIdx = html.indexOf('>Reference<');
    const remarksIdx = html.indexOf('>Remarks<');
    const securityIdx = html.indexOf('>Security<');
    const grandIdx = html.indexOf('Grand total');
    assert.doesNotMatch(html, /Bill to/);
    assert.ok(nameIdx >= 0 && addressIdx > nameIdx && phoneIdx > addressIdx && itemsIdx > phoneIdx);
    assert.match(html, /Rahul Sharma/);
    assert.match(html, /12 MG Road, Ahmedabad, Gujarat/);
    assert.match(html, /class="pickup-return-box"/);
    assert.ok(bottomIdx > itemsIdx);
    assert.ok(remarksIdx > bottomIdx && refIdx > remarksIdx);
    assert.ok(securityIdx > refIdx && grandIdx > securityIdx);
    assert.ok(refIdx > itemsIdx && remarksIdx > itemsIdx);
    assert.match(html, /class="notes-box remarks-highlight"/);
    assert.match(html, /notes-block-remarks/);
    assert.match(html, /notes-block-inline notes-block-reference/);
    assert.match(html, /notes-block-inline notes-block-security/);
    assert.match(html, /\.remarks-highlight \{[^}]*background: #fef9c3/);
    assert.match(html, /\.notes-block-reference \{[^}]*border-left: 3px solid/);
    assert.match(html, /\.notes-block-security \{[^}]*border-left: 3px solid #111827/);
    assert.doesNotMatch(html.slice(nameIdx, itemsIdx), />Reference</);
    assert.doesNotMatch(html.slice(nameIdx, itemsIdx), />Remarks</);
    assert.doesNotMatch(html.slice(html.indexOf('class="totals"'), grandIdx), />Security</);
    assert.match(html, /class="notes-card"/);
    assert.match(html, />Payable amount</);
    assert.match(html, /Security \+ balance due/);
    assert.match(html, /₹4,350/);
    assert.match(html, /Priya Sharma/);
    assert.match(html, /Handle embroidery with care/);
    assert.match(html, /₹1,000/);
  });

  it('prints live booking deposit_amount as security below remarks', () => {
    const html = renderBillHtml({
      order: {
        ...SAMPLE_ORDER,
        security_deposit: 0,
        deposit_amount: 2000,
      },
      shop,
    });
    const remarksIdx = html.indexOf('>Remarks<');
    const refIdx = html.indexOf('>Reference<');
    const securityIdx = html.indexOf('>Security<');
    const grandIdx = html.indexOf('Grand total');
    assert.ok(remarksIdx >= 0 && refIdx > remarksIdx && securityIdx > refIdx && grandIdx > securityIdx);
    assert.match(html, /₹2,000/);
    assert.doesNotMatch(html.slice(html.indexOf('class="totals"'), grandIdx), />Security</);
  });

  it('prints payable as unpaid security plus bill balance and skips paid security', () => {
    const unpaidHtml = renderBillHtml({
      order: {
        ...SAMPLE_ORDER,
        security_deposit: 0,
        deposit_amount: 5000,
        paid_security_amt: false,
        balance: 9150,
      },
      shop,
    });
    assert.match(unpaidHtml, /class="notes-card"/);
    assert.match(unpaidHtml, />Payable amount</);
    assert.match(unpaidHtml, /Security \+ balance due/);
    assert.match(unpaidHtml, /₹14,150/);
    assert.match(unpaidHtml, /table\.totals tr\.payable \{[^}]*page-break-before: avoid/);
    const paidHtml = renderBillHtml({
      order: {
        ...SAMPLE_ORDER,
        security_deposit: 0,
        deposit_amount: 5000,
        paid_security_amt: true,
        balance: 9150,
      },
      shop,
    });
    assert.match(paidHtml, />Security</);
    assert.match(paidHtml, /₹5,000/);
    assert.match(paidHtml, /₹9,150/);
    assert.doesNotMatch(paidHtml, /₹14,150/);
  });

  it('leaves money cells blank when the amount is zero', () => {
    const html = renderBillHtml({
      order: {
        ...SAMPLE_ORDER,
        items: [
          {
            id: 'item-1',
            name_snapshot: 'Free sherwani',
            code_snapshot: 'SH-0',
            qty: 1,
            price: 0,
            discount: 0,
            tax: 0,
            total: 0,
          },
          {
            id: 'item-2',
            name_snapshot: 'Paid sherwani',
            code_snapshot: 'SH-1',
            qty: 1,
            price: 11000,
            discount: 0,
            tax: 0,
            total: 11000,
          },
        ],
        accessories: [],
        subtotal: 11000,
        discount_amount: 0,
        tax_amount: 0,
        security_deposit: 0,
        total_amount: 11000,
        paid_amount: 0,
        balance: 11000,
      },
      shop,
    });
    assert.doesNotMatch(html, /₹0(?![\d,])/);
    assert.match(html, /₹11,000/);
    assert.match(html, /Free sherwani/);
  });

  it('prints live booking discount_total above grand total', () => {
    const html = renderBillHtml({
      order: {
        ...SAMPLE_ORDER,
        discount_amount: 0,
        discount_total: 500,
        tax_amount: 0,
        tax_total: 0,
        security_deposit: 0,
        deposit_amount: 0,
        subtotal: 12150,
        total_amount: 11650,
      },
      shop,
    });
    const discountIdx = html.indexOf('>Discount<');
    const grandIdx = html.indexOf('Grand total');
    assert.ok(discountIdx >= 0 && grandIdx > discountIdx);
    assert.match(html, /₹500/);
    assert.match(html, /₹12,150/);
    assert.match(html, /₹11,650/);
  });

  it('prints rent and sale subtotal quantities in the qty column', () => {
    const html = renderBillHtml({
      order: {
        ...SAMPLE_ORDER,
        items: [
          {
            id: 'r1',
            name_snapshot: 'Sherwani',
            code_snapshot: 'S-1',
            qty: 1,
            price: 11000,
            total: 11000,
          },
          {
            id: 's1',
            name_snapshot: 'Sold sherwani',
            code_snapshot: 'X-1',
            qty: 2,
            price: 500,
            total: 1000,
            type: 'sell',
          },
        ],
        accessories: [
          {
            order_item_id: 'r1',
            name_snapshot: 'Safa',
            qty: 1,
            price: 400,
            total: 400,
          },
          {
            order_item_id: 's1',
            name_snapshot: 'Mojdi',
            qty: 1,
            price: 350,
            total: 350,
            type: 'sell',
          },
        ],
      },
      shop,
    });
    assert.match(html, />Rent subtotal<\/td><td class="right col-qty subtotal-qty">2<\/td>/);
    assert.match(html, />Sale subtotal<\/td><td class="right col-qty subtotal-qty">3<\/td>/);
  });

  it('prints with live CSS fit hooks instead of a frozen row-count font', () => {
    const shortTpl = applyBillPrintDensity(mergeTemplate({}), orderWithLineCount(6));
    assert.equal(shortTpl.item_density.compact, false);
    assert.equal(shortTpl.typography.product_size, null);
    const longTpl = applyBillPrintDensity(mergeTemplate({}), orderWithLineCount(35));
    assert.equal(longTpl.item_density.compact, false);
    assert.equal(longTpl.typography.product_size, null);
    const shortHtml = renderBillHtml({ order: orderWithLineCount(12), shop });
    assert.match(shortHtml, /--bill-product-size: 12px;/);
    assert.match(shortHtml, /--bill-pad-y: 7px;/);
    assert.match(shortHtml, /data-bill-fit="page"/);
    const longHtml = renderBillHtml({ order: orderWithLineCount(32), shop });
    assert.match(longHtml, /--bill-product-size: 12px;/);
    assert.match(longHtml, /data-bill-fit="page"/);
    assert.equal(countBillPrintRows(orderWithLineCount(25)), 25);
    assert.ok(BILL_ONE_PAGE_ROW_MIN < BILL_ONE_PAGE_COMPACT_AT);
    assert.ok(BILL_ONE_PAGE_COMPACT_AT <= BILL_ONE_PAGE_ROW_MAX);
  });
});
