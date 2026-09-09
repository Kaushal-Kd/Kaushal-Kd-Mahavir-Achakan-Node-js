import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { productCodeDigitsKey } from '@wrs/shared';
import Knex from 'knex';

import { applyProductSearchFilter } from './productSearch.js';

// Offline query builder — .toString() renders SQL without a DB connection.
const db = Knex({ client: 'mysql2' });

function searchSql(term) {
  const qb = db('products as p').where('p.shop_id', 'shop1');
  applyProductSearchFilter(qb, term, 'p');
  return qb.select('p.id').toString();
}

describe('applyProductSearchFilter', () => {
  it('matches a padded code by series prefix and alternate padding', () => {
    const sql = searchSql('A-0795');
    assert.match(sql, /LOWER\(p\.code\) LIKE 'a-0795%'/);
    assert.match(sql, /LOWER\(p\.code\) LIKE 'a-795%'/);
    assert.match(sql, /SUBSTRING_INDEX\(p\.code, '\['/);
    assert.doesNotMatch(sql, /'%5%'/);
    assert.doesNotMatch(sql, /'%795%'/);
  });

  it('matches FA-05 by series prefix only, not every code containing digit 5', () => {
    const sql = searchSql('FA-05');
    assert.match(sql, /LOWER\(p\.code\) LIKE 'fa-05%'/);
    assert.doesNotMatch(sql, /'%5%'/);
    assert.doesNotMatch(sql, /'%05%'/);
    assert.doesNotMatch(sql, /LOWER\(p\.name\)/);
  });

  it('matches a full code that already includes the size suffix', () => {
    const sql = searchSql('A-0795[40]');
    assert.match(sql, /LOWER\(p\.code\) LIKE 'a-0795\[40\]%'/);
  });

  it('matches by name for text input without narrowing to digits', () => {
    const sql = searchSql('ACHAKAN');
    assert.match(sql, /LOWER\(p\.name\) LIKE LOWER\('%ACHAKAN%'\)/);
    // No numeric segment, so no digit LIKE clauses are added.
    assert.doesNotMatch(sql, /%\d+%/);
  });

  it('matches product design details stored in notes', () => {
    const sql = searchSql('gold thread collar');
    assert.match(sql, /LOWER\(COALESCE\(p\.notes, ''\)\) LIKE LOWER\('%gold thread collar%'\)/);
  });

  it('matches numeric-only input against code digit segments', () => {
    const sql = searchSql('0795');
    assert.match(sql, /'%0795%'/);
    assert.match(sql, /'%795%'/);
  });

  it('builds a balanced OR group with a false anchor', () => {
    const sql = searchSql('A-0795');
    assert.match(sql, /\(1 = 0 or /);
    const opens = (sql.match(/\(/g) || []).length;
    const closes = (sql.match(/\)/g) || []).length;
    assert.equal(opens, closes);
  });
});

describe('productCodeDigitsKey', () => {
  it('normalizes padding and size suffix to the same key', () => {
    assert.equal(productCodeDigitsKey('A-0795[40]'), productCodeDigitsKey('A-795'));
  });

  it('trims leading zeros for numeric-only codes', () => {
    assert.equal(productCodeDigitsKey('0795'), '795');
  });
});
