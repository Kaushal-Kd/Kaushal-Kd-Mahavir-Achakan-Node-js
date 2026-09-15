import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_MANUAL_BILL_CONTENT,
  LETTER_PAD_PAGE_SETTINGS,
  SAMPLE_ORDER,
  mergeTemplate,
  renderBillHtml,
} from './billTemplates.js';

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
    assert.match(html, /<th>Item Code<\/th><th>Item<\/th>/);
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
});
