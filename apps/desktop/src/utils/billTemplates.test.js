import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_MANUAL_BILL_CONTENT,
  SAMPLE_ORDER,
  mergeTemplate,
  renderBillHtml,
} from './billTemplates.js';

const shop = { name: 'Demo Shop', address: 'Main Road', phone: '9876543210' };

describe('bill template blank-paper controls', () => {
  it('merges safe defaults for templates saved before blank-paper settings existed', () => {
    const template = mergeTemplate({ paper_size: 'A5' });
    assert.equal(template.page_settings.vertical_offset_in, 0);
    assert.equal(template.custom_content.enabled, false);
    assert.equal(template.custom_content.text, DEFAULT_MANUAL_BILL_CONTENT);
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
