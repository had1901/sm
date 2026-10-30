const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ESD_HTKT_VENDOR_SITE_PROBE.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

/** Simulate a read-only SM cursor and capture the actual ordered helper requests. */
function harness(rows = [], responder = () => ({ success: true, data: [] }), settings = {}) {
  const state = { requests: [], files: [], logs: [], writes: 0 };
  class SCFile {
    constructor(table, mode) {
      assert.ok(['esdHTKTvendor', 'esdHTKTvendorSite'].includes(table)); assert.equal(mode, 1);
      this.dataRows = table === 'esdHTKTvendor' ? rows : settings.sites || [];
      this.index = -1; this.closed = false; state.files.push(this);
      return new Proxy(this, { get(target, key) { return key in target ? target[key] : (target.dataRows[target.index] || {})[key]; } });
    }
    setFields(fields) { assert.ok(fields.includes('id')); }
    doSelect(query) { assert.equal(query, 'true'); this.index = 0; return settings.selectFailure ? 99 : this.dataRows.length ? 0 : 9; }
    getNext() { this.index++; return settings.cursorFailure ? 99 : this.index < this.dataRows.length ? 0 : 9; }
    doClose() { this.closed = true; }
    doUpdate() { state.writes++; throw new Error('Probe must not update records'); }
    doAction() { state.writes++; throw new Error('Probe must not change records'); }
  }
  const context = vm.createContext({ SCFile, SCFILE_READONLY: 1, RC_SUCCESS: 0, RC_NO_MORE: 9,
    print(value) { state.logs.push(String(value)); },
    lib: { ESD_HTKT_INVOICE_OGL_INTEGRATION: {
      getVendorSiteInfo(request) {
        assert.ok(state.files.every(file => file.closed), 'DB cursor must close before the HTTP calls');
        state.requests.push(copy(request));
        return responder(copy(request), state.requests.length);
      },
      createVendorSiteInfo() { throw new Error('Probe must never create a site'); },
    } },
  });
  vm.runInContext(source, context); context.lib.ESD_HTKT_VENDOR_SITE_PROBE = context;
  return { state, context, run: options => context.runVendorSiteProbe(options) };
}

test('calls every unique vendor sequentially with 100 then 106, preserving text and local sync state', () => {
  const h = harness([
    { id: '3', 'vendor.number': 'NCC_101234544', 'supplier.id': 'S2', 'ogl.sync.status': true },
    { id: '1', 'vendor.number': '0311368188', 'ogl.sync.status': false },
    { id: '2', 'vendor.number': ' 0311368188 ' },
    { id: '4', 'vendor.number': '' },
  ]);
  const result = h.run();
  assert.equal(result.completed, true); assert.equal(result.readCount, 4); assert.equal(result.emptyNumberCount, 1);
  assert.equal(result.uniqueVendorCount, 2); assert.equal(result.requestCount, 4);
  assert.deepEqual(h.state.requests, [
    { vendorNumber: '0311368188', entity: '100' }, { vendorNumber: '0311368188', entity: '106' },
    { vendorNumber: 'NCC_101234544', entity: '100' }, { vendorNumber: 'NCC_101234544', entity: '106' },
  ]);
  assert.deepEqual(copy(result.requests[0].vendorIds), ['1', '2']);
  assert.equal(result.requests[2].sourceRecords[0].supplierId, 'S2');
  assert.equal(result.requests[2].sourceRecords[0].oglSyncStatus, 'true');
  assert.equal(h.state.writes, 0);
});

test('28 vendors produce 56 requests and detect the repeated false HOANG223 response without accepting it', () => {
  const response = { success: false, data: [{ vendorName: 'HOANG223', vendorNumber: '1302225', sites: [
    { entity: '106', vendorSiteCode: '126150610', debitAccount: 'DR', creditAccount: 'CR' },
  ] }] };
  const rows = Array.from({ length: 28 }, (_, i) => ({ id: String(i), 'vendor.number': 'NCC_' + i }));
  const h = harness(rows, () => response); const result = h.run();
  assert.equal(result.completed, true); assert.equal(result.requestCount, 56);
  assert.equal(result.distinctResponseCount, 1); assert.equal(result.allResponsesIdentical, true);
  assert.equal(result.outcomes.BUSINESS_ERROR, 56); assert.equal(result.responseGroups[0].count, 56);
  assert.ok(result.requests.every(row => !row.analysis.vendorMatch && !row.analysis.entitySiteMatch));
  assert.ok(result.requests.every(row => row.response.success === false));
  assert.equal(h.state.writes, 0);
});

test('empty successful arrays differ from null, missing and business-error data', () => {
  const h = harness([{ id: '1', 'vendor.number': '001' }, { id: '2', 'vendor.number': '002' }], (_, n) => [
    { success: true, data: [] }, { success: true, data: null },
    { success: false, data: [] }, { success: true },
  ][n - 1]);
  const result = h.run();
  assert.deepEqual(copy(result.requests.map(row => row.analysis.outcome)), ['EMPTY_SUCCESS', 'NON_ARRAY_DATA', 'BUSINESS_ERROR', 'NON_ARRAY_DATA']);
  assert.deepEqual(copy(result.requests.map(row => row.analysis.dataShape)), ['array', 'null', 'array', 'missing']);
  assert.equal(result.requests[0].analysis.responseHttpStatus, null, 'Do not invent HTTP 200 from a parsed body');
});

test('matches MST and entity together and observes XDCB site without creating it', () => {
  const h = harness([{ id: '1', 'vendor.number': '001' }], request => ({ success: true, data: [{
    vendorNumber: request.vendorNumber, sites: [{ entity: request.entity, vendorSiteCode: '126150640' }],
  }] }));
  const result = h.run();
  assert.equal(result.outcomes.MATCHED_VENDOR_AND_ENTITY, 2);
  assert.ok(result.requests.every(row => row.analysis.vendorMatch && row.analysis.entitySiteMatch && row.analysis.xdcbSiteMatch));
  assert.equal(result.distinctResponseCount, 2); assert.equal(result.allResponsesIdentical, false);
});

test('one helper exception does not prevent probing the next branch', () => {
  const h = harness([{ id: '1', 'vendor.number': '001' }], (_, n) => {
    if (n === 1) throw new Error('Return Code: 401');
    return { success: false, httpStatus: 401, message: 'Unauthorized' };
  });
  const result = h.run();
  assert.equal(result.completed, true); assert.equal(result.requestCount, 2);
  assert.equal(result.outcomes.EXCEPTION, 1); assert.equal(result.outcomes.BUSINESS_ERROR, 1);
  assert.equal(result.requests[1].analysis.responseHttpStatus, 401);
});

test('offset/limit select stable string order and still call both branches', () => {
  const h = harness(['003', '001', '002'].map(number => ({ id: number, 'vendor.number': number })));
  const result = h.run({ offset: 1, limit: 1 });
  assert.equal(result.selectedVendorCount, 1); assert.equal(result.expectedRequests, 2);
  assert.ok(h.state.requests.every(request => request.vendorNumber === '002'));
});

for (const failure of ['selectFailure', 'cursorFailure']) {
  test('incomplete DB read stops all HTTP requests: ' + failure, () => {
    const h = harness([{ id: '1', 'vendor.number': '001' }], undefined, { [failure]: true });
    const result = h.run(); assert.equal(result.completed, false); assert.match(result.error, /Không đọc đầy đủ/);
    assert.equal(h.state.requests.length, 0); assert.ok(h.state.files.every(file => file.closed));
  });
}

test('empty inventory and invalid batch options cause zero HTTP requests', () => {
  const h = harness(); const result = h.run();
  assert.equal(result.completed, true); assert.equal(result.requestCount, 0); assert.equal(result.allResponsesIdentical, false);
  assert.equal(h.run({ limit: -1 }).completed, false); assert.equal(h.state.requests.length, 0);
});

test('the standalone DO calls only the new probe entrypoint', () => {
  const h = harness([{ id: '1', 'vendor.number': '001' }]);
  vm.runInContext(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.ogl_site_probe.display_option.js'), 'utf8'), h.context);
  assert.equal(h.state.requests.length, 2); assert.equal(h.state.writes, 0);
});

test('local join matches site.vendor.id to vendor.id and reports blank entity without changing it', () => {
  const h = harness([
    { id: '0000000036', 'vendor.number': 'NCC_101234538', 'vendor.name': 'NCC S2' },
    { id: '0000000017', 'vendor.number': '0311368188', 'vendor.name': 'NCC S4' },
  ], undefined, { sites: [{ id: '0000000088', 'vendor.id': '0000000036', 'ogl.entity': '',
    'ogl.site.code': '126150610', active: true, 'ogl.sync.status': true }] });
  const report = h.context.inspectLocalVendorSites();
  assert.equal(report.completed, true); assert.equal(report.vendorCount, 2); assert.equal(report.siteCount, 1);
  assert.equal(report.rows[0].vendor['vendor.number'], 'NCC_101234538');
  assert.equal(report.rows[0].site['ogl.site.code'], '126150610');
  assert.equal(report.emptyEntityCount, 1); assert.equal(report.branchCounts['(empty)'], 1);
  assert.equal(report.vendorsWithoutSites[0]['vendor.number'], '0311368188');
  assert.equal(h.state.requests.length, 0); assert.equal(h.state.writes, 0);
  assert.ok(h.state.files.every(file => file.closed));
});

test('local join identifies sites with no matching master and makes zero API calls', () => {
  const h = harness([], undefined, { sites: [{ id: 'SITE', 'vendor.id': 'MISSING', 'ogl.entity': '100', 'ogl.site.code': '126150640' }] });
  const report = h.context.inspectLocalVendorSites();
  assert.equal(report.completed, true); assert.equal(report.missingMasterCount, 1); assert.equal(report.rows[0].vendor, null);
  assert.equal(report.siteCodeCounts['126150640'], 1); assert.equal(report.branchCounts['100'], 1);
  assert.equal(h.state.requests.length, 0); assert.equal(h.state.writes, 0);
});
