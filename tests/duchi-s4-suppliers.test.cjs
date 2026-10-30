const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const copy = value => JSON.parse(JSON.stringify(value));
const actor = 'KTTC';
const xdcbCode = '126150640';
const tax = '0012345678';

/** Mô phỏng DB SM, cursor, number series và OGL; không truy cập môi trường thật. */
function harness(options = {}) {
  const parent = { id: 'DC.TEST', 'transaction.type': 'Dự chi', 'original.contract.category': 'XDCB',
    'contract.category': 'HHDV', 'current.phase': 'initial_kttc', 'initial.role': 'kttc',
    'created.by': actor, 'user.checker.kttc': actor, 'unit.lv1': 'U1', 'unit.lv2': 'U2', description: 'Dự chi', ...options.parent };
  const contracts = [
    { id: 'Ctr-1', contractCode: 'HD/S4-1', constructionId: 'P1', budgetType: 'over500', tenderPackageId: 'THAU-1', currency: 'VND' },
    { id: 'Ctr-2', contractCode: 'HD/S4-2', constructionId: 'P2', budgetType: 'over500', tenderPackageId: 'THAU-2', currency: 'USD' },
  ];
  const db = {
    esdHTKTpayment: [parent],
    esdXDCBrepairProjectCtr: contracts.map(c => ({ id: c.id, 'contract.code': c.contractCode,
      'contract.name': 'HĐ ' + c.id, 'contract.amount': 500, 'tender.package.id': c.tenderPackageId, currency: c.currency,
      'repair.id': c.repairId, 'construction.id': c.constructionId, 'type.budget': c.budgetType })),
    esdjoinXDCBtenderPackageContractor: contracts.map((c, i) => ({ id: tax + 'THAU-' + (i + 1),
      'tender.package.id': c.tenderPackageId, 'tax.code': tax, name: 'NCC S4', address: 'Hà Nội' })),
    esdHTKTvendor: [], esdHTKTvendorSite: [], esdHTKTpaymentVendor: [], esdHTKTpaymentInvoice: [],
    esdHDcontractSupplier: [], esdDMSupplier: [], ...options.tables,
  };
  const calls = { lookup: [], create: [], writes: [], queries: [], sharedSync: [], numbers: [], contractQueries: [], files: [], logs: [] };
  const state = { response: { success: true, data: [] }, createResponse: { success: true }, ...options };
  // Integration SL có scope riêng; giữ mảng trả về khác realm với SL Dự chi.
  const integrationContext = vm.createContext({});
  let serial = 0;
  /** So khớp điều kiện bằng/active được resolver gửi vào SM. */
  function matches(row, query) {
    const pairs = [...query.matchAll(/([\w.]+)\s*=\s*"((?:\\.|[^"\\])*)"/g)];
    return pairs.every(([, key, value]) => String(row[key] ?? '') === value.replace(/\\([\\"])/g, '$1')) &&
      (!/active\s*=\s*true/.test(query) || row.active === true);
  }
  /** Cursor giữ snapshot riêng, vì getNext/Close không được làm mất dữ liệu đã đọc. */
  class SCFile {
    constructor(table, mode) {
      this.table = table; this.fields = {}; this.rows = []; this.index = 0;
      this.fileTrace = { table, mode: mode || 0, closed: false }; calls.files.push(this.fileTrace);
      return new Proxy(this, {
        get: (target, key) => key in target ? target[key] : target.fields[key] ?? target.fields[String(key).replace(/_/g, '.')],
        set: (target, key, value) => { if (key in target) target[key] = value; else target.fields[key] = value; return true; },
      });
    }
    setFields() {}
    doClose() { this.fileTrace.closed = true; }
    doSelect(query) {
      calls.queries.push({ table: this.table, query });
      if (state.readFailure === this.table) return 99;
      if (/^select /i.test(query) && this.table === 'esdHDcontractSupplier') {
        const id = query.match(/hs.contract.id="([^"]+)"/)[1];
        this.rows = db.esdHDcontractSupplier.filter(r => r['contract.id'] === id).flatMap(r =>
          db.esdDMSupplier.filter(s => s.id === r['supplier.id']).map(s => ({ ...r, 'supplier.name': r['supplier.name'],
            'tax.code': s['tax.code'], address: s.address })));
      } else if (/^select hdVendor\.contract\.id/i.test(query) && this.table === 'esdHTKTpayment') {
        const paymentId = query.match(/htktPayment.id\s*=\s*"([^"]+)"/)[1];
        const contractId = query.match(/hdVendor.contract.id\s*=\s*"([^"]+)"/)[1];
        this.rows = db.esdHTKTpayment.filter(p => p.id === paymentId).flatMap(payment =>
          db.esdHDcontractSupplier.filter(link => link['contract.id'] === contractId).flatMap(link =>
            db.esdDMSupplier.filter(s => s.id === link['supplier.id']).map(s => ({
              'contract.id': contractId, 'supplier.id': s.id, 'supplier.name': link['supplier.name'],
              'payment.method': link['payment.method'], 'unpaid.amount': link['unpaid.amount'],
              'tax.code': s['tax.code'], description: payment.description, address: s.address, type: s.type,
              'unit.lv1': payment['unit.lv1'] }))));
      } else if (/^select hpv\.contract\.id/i.test(query) && this.table === 'esdHTKTpaymentVendor') {
        const id = query.match(/hpv.id\s*=\s*"([^"]+)"/)[1];
        this.rows = db.esdHTKTpaymentVendor.filter(pv => pv.id === id).flatMap(pv => {
          const vendor = db.esdHTKTvendor.find(v => v.id === pv['vendor.id']) || {};
          const payment = db.esdHTKTpayment.find(p => p.id === pv['payment.id']) || {};
          const site = db.esdHTKTvendorSite.find(s => s.id === pv['vendor.site.id']) || {};
          const links = db.esdHDcontractSupplier.filter(s => s['contract.id'] === pv['contract.id']);
          return (links.length ? links : [{}]).map(link => {
            const source = db.esdDMSupplier.find(s => s.id === link['supplier.id']) || {};
            const values = { 'contract.id': pv['contract.id'], 'current.supplier.id': vendor['supplier.id'],
              'current.supplier.name': vendor['vendor.name'], 'current.tax.code': vendor['vendor.number'],
              'current.supplier.address': vendor.address, 'supplier.id': link['supplier.id'],
              'supplier.name': link['supplier.name'], 'tax.code': source['tax.code'], address: source.address, type: source.type,
              amount: pv.amount, 'ogl.sync.status': pv['ogl.sync.status'], 'ogl.site.code': site['ogl.site.code'],
              currency: pv.currency, 'unit.lv1': payment['unit.lv1'], 'unit.lv2': payment['unit.lv2'],
              description: payment.description, 'current.phase': payment['current.phase'], 'created.by': payment['created.by'],
              'initial.role': payment['initial.role'], 'user.checker.kttc': payment['user.checker.kttc'] };
            const aliases = [...query.matchAll(/[\w.]+\s+as\s+([\w.]+)/gi)].map(match => match[1]);
            return Object.fromEntries(aliases.map(alias => [alias, values[alias]]));
          });
        });
      } else if (/^select /i.test(query) && this.table === 'esdHTKTpaymentVendor') {
        this.rows = db.esdHTKTpaymentVendor.map(pv => {
          const vendor = db.esdHTKTvendor.find(v => v.id === pv['vendor.id']) || {};
          const contract = db.esdXDCBrepairProjectCtr.find(c => c.id === pv['contract.id']) || {};
          return [pv.id, pv['payment.id'], pv['contract.id'], vendor['vendor.number'], vendor['vendor.name'],
            pv.amount, pv.currency, pv['total.invoice'], pv['ogl.sync.status'], vendor['ogl.vendor.id'],
            pv['vendor.id'], pv['vendor.site.id'], contract['contract.code']];
        });
      } else this.rows = (db[this.table] || []).filter(r => matches(r, query));
      this.index = 0; this.fields = copy(this.rows[0] || {});
      return this.rows.length ? 0 : 9;
    }
    getNext() {
      if (state.nextFailure === this.table) return 99;
      this.index++; this.fields = copy(this.rows[this.index] || {});
      return this.index < this.rows.length ? 0 : 9;
    }
    doCount(query) { return db[this.table].filter(r => matches(r, query)).length; }
    doAction(action) {
      calls.writes.push({ table: this.table, action, row: copy(this.fields),
        openFiles: calls.files.filter(file => !file.closed).map(file => ({ table: file.table, mode: file.mode })) });
      if (state.writeFailure === this.table) return 99;
      if (action === 'add') db[this.table].push(copy(this.fields));
      else {
        const found = db[this.table].findIndex(r => r.id === this.fields.id);
        assert.ok(found >= 0); db[this.table][found] = copy(this.fields);
      }
      return 0;
    }
    doUpdate() { return this.doAction('update'); }
    doDelete() { db[this.table] = db[this.table].filter(r => r.id !== this.fields.id); return 0; }
    getMessages() { return 'DB failure'; }
  }
  /** Datum đủ cho quy ước getnumber của các script lưu NCC/món. */
  class SCDatum { setValue(value) { this.value = value; } getText() { return String(this.value ?? ''); } }
  const context = vm.createContext({ SCFile, SCDatum, RC_SUCCESS: 0, RC_NO_MORE: 9, SCFILE_READONLY: 1,
    print(message) { calls.logs.push(String(message)); }, vars: { $lo_operator: { 'contact.name': actor, name: actor } },
    system: { functions: { rtecall(name, rc, id, table) {
      assert.equal(name, 'getnumber'); calls.numbers.push(table);
      rc.setValue(state.numberFailure === table ? -1 : 0); id.setValue(table + '-' + (++serial));
    } } }, lib: {
      ESD_HTKT_ACCOUNTING_UTILS: {
        mapPsToEntity: () => ({ oglBranchCode: '0100', entity: 'ENTITY' }),
        getVendorDefaultSiteInfo: category => ({ siteCode: category === 'XDCB' ? xdcbCode : '126150610',
          debitAccount: category === 'XDCB' ? xdcbCode : '126150610', creditAccount: '224421300' }),
        buildAccountSegment: (account, entity) => [entity, '000000', account, '0000000', '0000000', '0000000', '0000000'].join('.'),
        getVendorSiteList: (vendorId, branch) => db.esdHTKTvendorSite.filter(s => s['vendor.id'] === vendorId && s['ogl.entity'] === branch),
        getBankDroplist: () => [],
      },
      ESD_HTKT_INVOICE_OGL_INTEGRATION: {
        getVendorSiteInfo: payload => { calls.lookup.push(copy(payload)); return vm.runInContext('(' + JSON.stringify(state.response) + ')', integrationContext); },
        createVendorSiteInfo: payload => { calls.create.push(copy(payload)); return state.createResponse; },
      },
      ESD_HTKT_PREPAYMENT_VENDOR: { syncVendorToOgl: record => {
        calls.sharedSync.push(record.id); record['ogl.sync.status'] = true; return { success: true };
      } },
      ESD_HTKT_PAYMENT_VENDOR: { getContractInfo: id => ({ id, name: 'HĐ S2' }) },
      ESD_HTKT_Utils: { addStringsManual: (a, b) => String(Number(a) + Number(b)) },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.js'), 'utf8'), context);
  context.lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER = context;
  vm.runInContext(fs.readFileSync(path.join(root, 'ESD_HTKT_EXPENSE_VENDOR.js'), 'utf8'), context);
  context.lib.ESD_HTKT_EXPENSE_VENDOR = context;
  // Dùng builder thật đang phục vụ S2, không mô phỏng cấu trúc payload OGL.
  const shared = fs.readFileSync(path.join(root, 'ESD_HTKT_PREPAYMENT_VENDOR.js'), 'utf8');
  const builder = shared.slice(shared.indexOf('function buildVendorAndSiteInfo('), shared.indexOf('/**', shared.indexOf('function buildVendorAndSiteInfo(')));
  vm.runInContext(builder, context);
  context.lib.ESD_HTKT_PREPAYMENT_VENDOR.buildVendorAndSiteInfo = context.buildVendorAndSiteInfo;
  context.lib.ESD_HTKT_EXPENSE_CONTRACT = {
    getExpenseXdcbContract: input => {
      calls.contractQueries.push(copy(input.details));
      const found = contracts.find(c => c.id === input.details.contractId && !c.denied);
      return found ? { success: true, data: copy(found) } : { success: false, message: 'HĐ ngoài phạm vi hoặc không đủ điều kiện' };
    },
    listExpenseXdcbContracts: input => {
      calls.contractQueries.push(copy(input.details));
      const found = contracts.filter(c => c.id === input.details.contractId && !c.denied);
      return { success: true, totalCount: found.length, data: found.map(copy) };
    },
  };
  context.hasExpenseVendorInvoices = record => Number(record['total.invoice'] || 0) > 0;
  /** Món mới hoặc đã lưu để kiểm tra save/sync của cùng helper. */
  const item = (overrides = {}) => ({ id: 'DC.ITEM', 'payment.id': parent.id, 'contract.id': 'Ctr-1',
    'vendor.id': 'V1', amount: 100, currency: 'VND', 'transaction.des': 'Chi phí', ...overrides });
  /** NCC S6 có thể đã liên kết S2; XDCB phải giữ supplier.id đó. */
  const vendor = (overrides = {}) => ({ id: 'V1', 'vendor.number': tax, 'vendor.name': 'NCC S6', address: 'Hà Nội',
    'supplier.id': 'S2-KEEP', 'ogl.sync.status': true, ...overrides });
  /** Site đúng/khác hạng mục để phát hiện lỗi chọn bất kỳ site local. */
  const site = (overrides = {}) => ({ id: 'SITE1', 'vendor.id': 'V1', 'ogl.entity': '100', 'ogl.site.code': xdcbCode,
    'debit.account': 'DR', 'credit.account': 'CR', active: true, 'ogl.sync.status': true, ...overrides });
  const run = code => vm.runInContext(code, context);
  return { context, db, calls, state, contracts, item, vendor, site, run };
}

/** Đưa một HĐ fixture sang nhánh sửa chữa rút gọn, đồng bộ DTO và record nguồn thực tế. */
function directContract(h, overrides = {}) {
  const contract = Object.assign(h.contracts[0], { repairId: 'REPAIR-1', constructionId: '', budgetType: 'under500',
    tenderPackageId: '', vendorName: 'NCC trên HĐ', vendorTaxCode: tax, vendorAddress: 'Địa chỉ trên HĐ' }, overrides);
  Object.assign(h.db.esdXDCBrepairProjectCtr[0], { 'repair.id': contract.repairId, 'construction.id': contract.constructionId,
    'type.budget': contract.budgetType, 'tender.package.id': contract.tenderPackageId,
    'vendor.name': contract.vendorName, 'tax.code': contract.vendorTaxCode, 'vendor.address': contract.vendorAddress });
  return contract;
}

test('S4 under500 reads one supplier directly from the contract without a package or Contractor query', () => {
  const h = harness(); directContract(h);
  const contract = h.context.getExpenseXdcbSelection('Ctr-1', actor, 'DC.TEST');
  const suppliers = h.context.getExpenseXdcbSuppliers(contract);
  assert.equal(suppliers.length, 1);
  assert.equal(suppliers[0]['supplier.id'], tax);
  assert.equal(suppliers[0]['supplier.name'], 'NCC trên HĐ');
  assert.equal(suppliers[0]['tax.code'], tax);
  assert.equal(suppliers[0].address, 'Địa chỉ trên HĐ');
  assert.equal(h.context.resolveExpenseXdcbSupplier(contract, tax, tax)['supplier.id'], tax);
  assert.ok(h.calls.queries.every(call => call.table !== 'esdjoinXDCBtenderPackageContractor'));
  assert.equal(h.calls.writes.length, 0);
});

test('S4 under500 source is decided by budget type even if an unrelated package is present', () => {
  const h = harness(); const contract = directContract(h, { tenderPackageId: 'THAU-1', contractAmount: 900000000 });
  const supplier = h.context.getExpenseXdcbSuppliers(contract)[0];
  assert.equal(supplier['supplier.id'], tax);
  assert.equal(supplier['supplier.name'], 'NCC trên HĐ');
  assert.equal(h.calls.queries.length, 0);
});

for (const variant of ['missing classification', 'unknown classification', 'neither project', 'both projects', 'missing tax', 'missing name']) {
  test('S4 direct supplier rejects invalid source without falling back to Contractor: ' + variant, () => {
    const h = harness(); const contract = directContract(h, { tenderPackageId: 'THAU-1' });
    if (variant === 'missing classification') contract.budgetType = '';
    if (variant === 'unknown classification') contract.budgetType = 'UNKNOWN';
    if (variant === 'neither project') contract.repairId = '';
    if (variant === 'both projects') contract.constructionId = 'P1';
    if (variant === 'missing tax') contract.vendorTaxCode = '';
    if (variant === 'missing name') contract.vendorName = '';
    assert.throws(() => h.context.getExpenseXdcbSuppliers(contract));
    assert.equal(h.calls.queries.length, 0);
    assert.equal(h.calls.writes.length, 0);
  });
}

test('S4 repair over500 uses package suppliers even when contract amount is below 500 million', () => {
  const h = harness(); const contract = directContract(h, { budgetType: 'over500', tenderPackageId: 'THAU-1', contractAmount: 12000000 });
  assert.equal(h.context.getExpenseXdcbSuppliers(contract)[0]['supplier.name'], 'NCC S4');
  h.db.esdjoinXDCBtenderPackageContractor = [];
  assert.throws(() => h.context.getExpenseXdcbSuppliers(contract), /chưa có NCC/);
});

test('S4 construction always uses package suppliers and never the direct contract snapshot', () => {
  const h = harness(); const contract = directContract(h, { repairId: '', constructionId: 'P1', budgetType: 'under500', tenderPackageId: 'THAU-1' });
  assert.equal(h.context.getExpenseXdcbSuppliers(contract)[0]['supplier.id'], tax + 'THAU-1');
  contract.tenderPackageId = '';
  assert.throws(() => h.context.getExpenseXdcbSuppliers(contract), /chưa có liên kết gói thầu/);
});

test('S4 direct supplier can be selected, restored after Cancel, saved and synced with the shared S6 vendor/site flow', () => {
  const h = harness(); directContract(h); h.db.esdHTKTvendor.push(h.vendor());
  const record = h.item({ 'vendor.id': '', amount: 2000, 'transaction.des': 'Nội dung đang nhập' });
  h.context.vars.$L_file = record;
  h.context.lib.ESD_HTKT_PAYMENT_WF = { canEditInCurrenPhase: () => true };
  const screen = fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view.js'), 'utf8');
  h.run(screen);
  h.context.vars.$supplierId = tax;
  h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view_fill_data.js'), 'utf8'));
  assert.equal(h.context.vars.$taxCode, tax);
  assert.equal(h.calls.writes.length, 0);
  h.context.vars['$L.expense.xdcb.supplier.draft'] = null;
  h.context.vars.$proceed = 'no'; h.context.vars['$L.exit'] = '';
  h.run(screen);
  assert.equal(h.context.vars.$supplierId, tax);
  assert.equal(h.context.vars.$supplierName, 'NCC trên HĐ');
  h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view_save_for_expense.js'), 'utf8'));
  assert.equal(h.context.vars.$G_hasError, false, h.context.vars.$G_errMsg);
  assert.equal(record['vendor.id'], 'V1');
  assert.equal(record.amount, 2000);
  assert.equal(record['transaction.des'], 'Nội dung đang nhập');
  assert.equal(h.db.esdHTKTvendor[0]['supplier.id'], 'S2-KEEP');
  assert.equal(h.db.esdHTKTvendorSite.length, 1);
  assert.equal(h.db.esdHTKTvendorSite[0]['ogl.site.code'], xdcbCode);
  assert.equal(record['ogl.sync.status'], true);
  assert.ok(h.calls.queries.every(call => call.table !== 'esdjoinXDCBtenderPackageContractor'));
});

test('S4 under500 manual item creation does not require a package', () => {
  const h = harness(); directContract(h);
  const result = h.context.createPaymentVendor({ details: JSON.stringify({ paymentId: 'DC.TEST', currentUser: actor, contracts: [{ id: 'Ctr-1' }] }) });
  assert.equal(result.success, true, result.message);
  assert.equal(h.db.esdHTKTpaymentVendor.length, 1);
  assert.equal(h.db.esdHTKTpaymentVendor[0]['contract.id'], 'Ctr-1');
  assert.equal(h.db.esdHTKTvendor.length, 0);
});

test('S4 under500 Excel import validates direct supplier tax and saves a new S6 master', () => {
  const h = harness(); directContract(h);
  const result = h.context.importExpenseVendors({ details: JSON.stringify({ paymentId: 'DC.TEST', currentUser: actor,
    rows: [{ contractCode: 'Ctr-1', vendorCode: tax, amount: 100, transactionDescription: 'Nhập rút gọn', sourceRow: 2 }] }) });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(h.db.esdHTKTvendor.length, 1);
  assert.equal(h.db.esdHTKTvendor[0]['vendor.number'], tax);
  assert.equal(h.db.esdHTKTvendor[0].address, 'Địa chỉ trên HĐ');
  assert.equal(h.db.esdHTKTvendor[0]['supplier.id'], undefined);
  assert.equal(h.db.esdHTKTpaymentVendor[0]['vendor.id'], h.db.esdHTKTvendor[0].id);
  assert.equal(h.db.esdHTKTpaymentVendor[0]['transaction.des'], 'Nhập rút gọn');
  assert.ok(h.calls.queries.every(call => call.table !== 'esdjoinXDCBtenderPackageContractor'));
});

test('S4 direct supplier rejects a wrong selection or tax before saving/syncing', () => {
  const h = harness(); const contract = directContract(h);
  assert.throws(() => h.context.resolveExpenseXdcbSupplier(contract, tax + 'THAU-1', tax), /không thuộc nguồn NCC/);
  assert.throws(() => h.context.resolveExpenseXdcbSupplier(contract, tax, 'WRONG'), /không thuộc nguồn NCC/);
  h.db.esdHTKTvendor.push(h.vendor({ 'vendor.number': 'WRONG' }));
  assert.equal(h.context.syncExpenseXdcbVendorToOgl(h.item(), '', '', actor).success, false);
  assert.equal(h.calls.lookup.length, 0); assert.equal(h.calls.create.length, 0); assert.equal(h.calls.writes.length, 0);
});

test('S4 package selection keeps tax text and permits the same NCC across contracts/items', () => {
  const h = harness();
  h.db.esdHTKTpaymentVendor.push(h.item());
  const a = h.context.getExpenseXdcbSelection('Ctr-1', actor);
  const b = h.context.getExpenseXdcbSelection('Ctr-2', actor);
  const first = h.context.resolveExpenseXdcbSupplier(a, '', tax);
  const second = h.context.resolveExpenseXdcbSupplier(b, '', tax);
  assert.notEqual(first['supplier.id'], second['supplier.id']);
  const id = h.context.ensureExpenseXdcbVendor(first, actor);
  assert.equal(h.context.ensureExpenseXdcbVendor(second, actor), id);
  assert.equal(h.db.esdHTKTvendor.length, 1);
  assert.equal(h.db.esdHTKTvendor[0]['vendor.number'], tax);
  assert.equal(h.db.esdHTKTvendor[0]['supplier.id'], undefined);
  assert.equal(h.context.loadExpenseSupplierScreen(h.item({ 'vendor.id': id })).length, 1);
  assert.equal(h.context.vars.$supplierId, first['supplier.id']);
});

test('reuse existing S6 NCC without changing its S2 supplier link or other sites', () => {
  const h = harness(); h.db.esdHTKTvendor.push(h.vendor());
  const supplier = h.context.resolveExpenseXdcbSupplier(h.contracts[0], '', tax);
  assert.equal(h.context.ensureExpenseXdcbVendor(supplier, actor), 'V1');
  assert.equal(h.db.esdHTKTvendor[0]['supplier.id'], 'S2-KEEP');
  assert.equal(h.calls.writes.length, 0);
});

for (const variant of ['missing package', 'missing supplier', 'wrong tax', 'wrong join', 'duplicate tax', 'missing name', 'query failure', 'cursor failure']) {
  test('reject source error before creating S6 NCC: ' + variant, () => {
    const h = harness(); const c = h.contracts[0]; let key = '', selectedTax = tax;
    if (variant === 'missing package') c.tenderPackageId = '';
    if (variant === 'missing supplier') h.db.esdjoinXDCBtenderPackageContractor = [];
    if (variant === 'wrong tax') selectedTax = '999';
    if (variant === 'wrong join') key = tax + 'THAU-2';
    if (variant === 'duplicate tax') h.db.esdjoinXDCBtenderPackageContractor.push(copy(h.db.esdjoinXDCBtenderPackageContractor[0]));
    if (variant === 'missing name') h.db.esdjoinXDCBtenderPackageContractor[0].name = '';
    if (variant === 'query failure') h.state.readFailure = 'esdjoinXDCBtenderPackageContractor';
    if (variant === 'cursor failure') h.state.nextFailure = 'esdjoinXDCBtenderPackageContractor';
    assert.throws(() => h.context.resolveExpenseXdcbSupplier(c, key, selectedTax));
    assert.equal(h.calls.writes.length, 0);
  });
}

for (const variant of ['duplicate master', 'query failure', 'cursor failure', 'number failure', 'write failure']) {
  test('S6 master error cannot be treated as missing/success: ' + variant, () => {
    const h = harness(); const supplier = h.context.resolveExpenseXdcbSupplier(h.contracts[0], '', tax);
    if (variant === 'duplicate master') h.db.esdHTKTvendor.push(h.vendor(), h.vendor({ id: 'V2' }));
    if (variant === 'query failure') h.state.readFailure = 'esdHTKTvendor';
    if (variant === 'cursor failure') { h.db.esdHTKTvendor.push(h.vendor()); h.state.nextFailure = 'esdHTKTvendor'; }
    if (variant === 'number failure') h.state.numberFailure = 'esdHTKTvendor';
    if (variant === 'write failure') h.state.writeFailure = 'esdHTKTvendor';
    assert.throws(() => h.context.ensureExpenseXdcbVendor(supplier, actor));
    assert.equal(h.calls.lookup.length, 0); assert.equal(h.calls.create.length, 0);
  });
}

test('reuse only the correct active XDCB site at the request branch', () => {
  const h = harness(); h.db.esdHTKTvendor.push(h.vendor()); h.db.esdHTKTvendorSite.push(h.site());
  const record = h.item(); assert.equal(h.context.syncExpenseXdcbVendorToOgl(record, 'ATTACKER', 'ATTACKER', actor).success, true);
  assert.equal(record['vendor.site.id'], 'SITE1'); assert.equal(record['ogl.sync.status'], true);
  assert.equal(h.calls.lookup.length, 0); assert.equal(h.calls.create.length, 0);
});

for (const variant of ['HHDV only', 'other branch', 'blank branch', 'inactive', 'incomplete accounts']) {
  test('must create/fetch XDCB site when local site is unsuitable: ' + variant, () => {
    const h = harness(); h.db.esdHTKTvendor.push(h.vendor());
    const old = h.site(variant === 'HHDV only' ? { 'ogl.site.code': '126150610' } : variant === 'other branch' ?
      { 'ogl.entity': '999' } : variant === 'blank branch' ? { 'ogl.entity': '' } : variant === 'inactive' ? { active: false } : { 'debit.account': '' });
    h.db.esdHTKTvendorSite.push(old);
    const record = h.item(); const result = h.context.syncExpenseXdcbVendorToOgl(record, '', '', actor);
    assert.equal(result.success, true, result.message);
    assert.equal(h.calls.create.length, 1); const payload = h.calls.create[0];
    assert.equal(payload.vendorSiteCode, xdcbCode); assert.equal(payload.drSegment3, xdcbCode);
    assert.equal(payload.crSegment3, '224421300'); assert.equal(payload.entity, '100'); assert.equal(payload.drSegment1, 'ENTITY');
    assert.equal(payload.vendorNumber, tax); assert.equal(h.db.esdHTKTvendor[0]['supplier.id'], 'S2-KEEP');
    if (variant === 'HHDV only' || variant === 'other branch' || variant === 'blank branch') assert.deepEqual(h.db.esdHTKTvendorSite[0], old);
  });
}

test('existing OGL site is saved to S6 without creating it again', () => {
  const h = harness(); h.db.esdHTKTvendor.push(h.vendor());
  h.state.response = { success: true, data: [{ vendorNumber: tax, vendorName: 'OGL NCC', sites: [
    { entity: '100', vendorSiteCode: xdcbCode, debitAccount: 'DR-OGL', creditAccount: 'CR-OGL' }] }] };
  const record = h.item(); assert.equal(h.context.syncExpenseXdcbVendorToOgl(record, '', '', actor).success, true);
  assert.equal(h.calls.create.length, 0); assert.equal(h.db.esdHTKTvendorSite[0]['debit.account'], 'DR-OGL');
});

test('OGL response from another ScriptLibrary realm remains a valid array', () => {
  const h = harness(); h.db.esdHTKTvendor.push(h.vendor());
  const response = h.context.lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.getVendorSiteInfo({ vendorNumber: tax });
  h.context.foreignOglData = response.data;
  assert.equal(h.run('foreignOglData instanceof Array'), false);
  assert.equal(h.run('Object.prototype.toString.call(foreignOglData)'), '[object Array]');
  const record = h.item();
  const result = h.context.syncExpenseXdcbVendorToOgl(record, '', '', actor);
  assert.equal(result.success, true, result.message);
  assert.equal(record['ogl.sync.status'], true); assert.ok(record['vendor.site.id']);
  assert.equal(h.calls.create.length, 1);
});

for (const response of [{ success: true, data: null }, { success: true }]) {
  test('successful lookup with absent site data follows S2 default creation: ' + JSON.stringify(response), () => {
    const h = harness(); h.db.esdHTKTvendor.push(h.vendor()); h.state.response = response;
    const record = h.item();
    const result = h.context.syncExpenseXdcbVendorToOgl(record, '', '', actor);
    assert.equal(result.success, true, result.message); assert.equal(h.calls.create.length, 1);
    assert.equal(h.calls.create[0].vendorNumber, tax); assert.equal(h.calls.create[0].vendorSiteCode, xdcbCode);
    assert.equal(h.db.esdHTKTvendorSite.length, 1); assert.equal(record['ogl.sync.status'], true);
  });
}

for (const variant of ['malformed data', 'wrong MST', 'create failure', 'site write failure', 'master update failure']) {
  test('OGL bad path keeps item pending: ' + variant, () => {
    const h = harness(); h.db.esdHTKTvendor.push(h.vendor());
    if (variant === 'malformed data') h.state.response = { success: true, data: {} };
    if (variant === 'wrong MST') h.state.response = { success: true, data: [{ vendorNumber: 'WRONG', sites: [] }] };
    if (variant === 'create failure') h.state.createResponse = { success: false, message: 'Reject' };
    if (variant === 'site write failure') h.state.writeFailure = 'esdHTKTvendorSite';
    if (variant === 'master update failure') h.state.writeFailure = 'esdHTKTvendor';
    const record = h.item({ 'ogl.sync.status': true });
    assert.equal(h.context.syncExpenseXdcbVendorToOgl(record, '', '', actor).success, false);
    assert.equal(record['ogl.sync.status'], false);
    if (['malformed data', 'wrong MST'].includes(variant)) assert.equal(h.calls.create.length, 0);
  });
}

for (const lookup of [null, { success: false, message: '503' }, { success: false, httpStatus: 401, message: 'Lookup rejected' },
  { success: false, data: [{ vendorNumber: '1302225', vendorName: 'OTHER NCC', sites: [{ entity: '106', vendorSiteCode: '126150610' }] }] }]) {
  for (const entrypoint of ['save', 'button']) {
    test('XDCB ' + entrypoint + ' creates the default site like S2 after failed lookup ' + JSON.stringify(lookup), () => {
      const h = harness(); h.db.esdHTKTvendor.push(h.vendor());
      const record = h.item({ 'ogl.sync.status': false }); h.state.response = lookup;
      let result;
      if (entrypoint === 'save') {
        Object.assign(h.context.vars, { $L_file: record, $supplierId: tax + 'THAU-1', $taxCode: tax });
        h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view_save_for_expense.js'), 'utf8'));
        assert.equal(h.context.vars.$G_hasError, false, h.context.vars.$G_errMsg);
      } else {
        h.db.esdHTKTpaymentVendor.push(record);
        result = h.context.runExpenseVendorOglSync({ paymentId: 'DC.TEST', currentUser: actor }, null);
        assert.equal(result.success, true, result.message); assert.equal(result.data.synced, 1);
        assert.equal(result.data.failed, 0);
      }
      assert.equal(h.calls.lookup.length, 1); assert.equal(h.calls.create.length, 1);
      assert.equal(h.calls.lookup[0].vendorNumber, tax, 'Query the selected master, never a hardcoded test NCC');
      const payload = h.calls.create[0];
      assert.equal(payload.vendorNumber, tax); assert.equal(payload.vendorName, 'NCC S6');
      assert.equal(payload.vendorSiteCode, xdcbCode); assert.equal(payload.entity, '100');
      assert.equal(payload.drSegment1, 'ENTITY'); assert.equal(payload.crSegment1, 'ENTITY');
      assert.equal(payload.drSegment3, xdcbCode); assert.equal(payload.crSegment3, '224421300');
      assert.equal(h.db.esdHTKTvendor.length, 1); assert.equal(h.db.esdHTKTvendor[0]['supplier.id'], 'S2-KEEP');
      assert.equal(h.db.esdHTKTvendorSite.length, 1);
      assert.equal(h.db.esdHTKTvendorSite[0]['vendor.id'], 'V1');
      assert.equal(h.db.esdHTKTvendorSite[0]['ogl.site.code'], xdcbCode);
      assert.equal(h.db.esdHTKTvendorSite[0]['ogl.entity'], '100');
      const saved = entrypoint === 'save' ? record : h.db.esdHTKTpaymentVendor[0];
      assert.equal(saved['vendor.id'], 'V1'); assert.equal(saved['ogl.sync.status'], true); assert.ok(saved['vendor.site.id']);
    });
  }
}

test('failed lookup followed by failed create keeps S6 NCC and reports the create error', () => {
  const h = harness(); h.db.esdHTKTvendor.push(h.vendor());
  h.state.response = { success: false, httpStatus: 401, message: 'Lookup rejected' };
  h.state.createResponse = { success: false, httpStatus: 401, message: 'Create rejected' };
  const record = h.item({ 'ogl.sync.status': true, 'vendor.site.id': '' });
  const result = h.context.syncExpenseXdcbVendorToOgl(record, '', '', actor);
  assert.equal(result.success, false); assert.match(result.message, /Create rejected/);
  assert.equal(h.calls.lookup.length, 1); assert.equal(h.calls.create.length, 1);
  assert.equal(record['vendor.id'], 'V1'); assert.equal(record['vendor.site.id'], ''); assert.equal(record['ogl.sync.status'], false);
  assert.equal(h.db.esdHTKTvendor.length, 1); assert.equal(h.db.esdHTKTvendorSite.length, 0);
});

test('failed lookup followed by null create response never creates a local site or marks the item synced', () => {
  const h = harness(); h.db.esdHTKTvendor.push(h.vendor());
  h.state.response = { success: false, data: [{ vendorNumber: '1302225', vendorName: 'HOANG223', sites: [] }] };
  h.state.createResponse = null;
  const record = h.item();
  const result = h.context.syncExpenseXdcbVendorToOgl(record, '', '', actor);
  assert.equal(result.success, false); assert.equal(h.calls.create.length, 1);
  assert.equal(h.db.esdHTKTvendorSite.length, 0); assert.equal(record['ogl.sync.status'], false);
  assert.ok(!record['vendor.site.id']); assert.equal(h.calls.create[0].vendorNumber, tax);
});

test('new S4 NCC remains in S6 after failed create and retry persists only one default XDCB site', () => {
  const h = harness(); const record = h.item({ 'vendor.id': '', amount: 20000 });
  Object.assign(h.context.vars, { $supplierId: tax + 'THAU-1', $taxCode: tax });
  h.state.response = { success: false, httpStatus: 401, message: 'Unauthorized' };
  h.state.createResponse = { success: false, message: 'Create rejected' };
  const failed = h.context.saveExpenseXdcbDetails(record);
  assert.equal(failed.success, false); assert.match(failed.message, /Create rejected/);
  assert.equal(h.db.esdHTKTvendor.length, 1); assert.equal(h.db.esdHTKTvendor[0]['vendor.number'], tax);
  const vendorId = record['vendor.id']; assert.ok(vendorId);
  assert.equal(record.amount, 20000); assert.equal(record['ogl.sync.status'], false);
  assert.equal(h.calls.create.length, 1); assert.equal(h.db.esdHTKTvendorSite.length, 0);
  h.state.response = { success: true, data: [] };
  h.state.createResponse = { success: true };
  const retried = h.context.syncExpenseXdcbVendorToOgl(record, '', '', actor);
  assert.equal(retried.success, true, retried.message); assert.equal(record['vendor.id'], vendorId);
  assert.equal(h.db.esdHTKTvendor.length, 1); assert.equal(h.calls.create.length, 2);
  assert.equal(h.db.esdHTKTvendorSite.length, 1);
  assert.equal(h.calls.create[0].vendorSiteCode, xdcbCode); assert.equal(h.calls.create[0].drSegment3, xdcbCode);
  assert.equal(record['ogl.sync.status'], true); assert.ok(record['vendor.site.id']);
});

test('manual Save rereads S4 name/address and persists S6 vendor + category site', () => {
  const h = harness(); const record = h.item({ 'vendor.id': '', amount: '1,234.5' });
  Object.assign(h.context.vars, { $L_file: record, $supplierId: tax + 'THAU-1', $taxCode: tax,
    $supplierName: 'TAMPERED', $supplierAddress: 'TAMPERED', $amount: 0, $currency: 'FAKE' });
  h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view_save_for_expense.js'), 'utf8'));
  assert.equal(h.context.vars.$G_hasError, false);
  assert.equal(h.db.esdHTKTvendor[0]['vendor.name'], 'NCC S4'); assert.equal(h.db.esdHTKTvendor[0].address, 'Hà Nội');
  assert.equal(record.currency, 'VND'); assert.equal(record.amount, 1234.5);
  assert.equal(record['vendor.id'], h.db.esdHTKTvendor[0].id); assert.ok(record['vendor.site.id']);
});

for (const staleAmount of [0, undefined, 999999]) {
  test('XDCB Save uses record.amount=2000 when the unbound $amount is ' + String(staleAmount), () => {
    const h = harness();
    const record = h.item({ id: 'DC.00557', 'vendor.id': '', amount: 2000, 'transaction.des': 'oke' });
    Object.assign(h.context.vars, { $L_file: record, $supplierId: tax + 'THAU-1', $taxCode: tax, $amount: staleAmount });
    h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view_save_for_expense.js'), 'utf8'));
    assert.equal(h.context.vars.$G_hasError, false, h.context.vars.$G_errMsg);
    assert.equal(record.amount, 2000); assert.equal(h.context.vars.$amount, staleAmount);
    assert.equal(record['vendor.id'], h.db.esdHTKTvendor[0].id); assert.ok(record['vendor.site.id']);
    assert.equal(record['ogl.sync.status'], true);
  });
}

for (const invalidAmount of [0, -1, '', null, undefined, 'abc', Infinity, 9007199254740992]) {
  test('XDCB Save rejects invalid record.amount=' + String(invalidAmount) + ' even when $amount is positive', () => {
    const h = harness(); const record = h.item({ 'vendor.id': '', amount: invalidAmount });
    Object.assign(h.context.vars, { $supplierId: tax + 'THAU-1', $taxCode: tax, $amount: 2000 });
    assert.throws(() => h.context.saveExpenseXdcbDetails(record), /Số tiền dự chi phải lớn hơn 0 hợp lệ/);
    assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.lookup.length, 0); assert.equal(h.calls.create.length, 0);
  });
}

for (const variant of ['wrong supplier', 'wrong tax', 'outside phase', 'other user', 'invoice supplier change']) {
  test('manual Save rejects before NCC write: ' + variant, () => {
    const h = harness(); const record = h.item({ 'vendor.id': '' });
    Object.assign(h.context.vars, { $supplierId: tax + 'THAU-1', $taxCode: tax, $amount: 100 });
    if (variant === 'wrong supplier') h.context.vars.$supplierId = tax + 'THAU-2';
    if (variant === 'wrong tax') h.context.vars.$taxCode = 'WRONG';
    if (variant === 'outside phase') h.db.esdHTKTpayment[0]['current.phase'] = 'approved';
    if (variant === 'other user') h.context.vars.$lo_operator['contact.name'] = 'OTHER';
    if (variant === 'invoice supplier change') record['total.invoice'] = 1;
    assert.throws(() => h.context.saveExpenseXdcbDetails(record));
    assert.equal(h.calls.writes.length, 0);
  });
}

test('XDCB import appends items by contract ID and reuses S6 NCC', () => {
  const h = harness(); const old = h.item({ id: 'DC.OLD', 'vendor.id': '', amount: 20 });
  h.db.esdHTKTpaymentVendor.push(copy(old));
  const rows = [{ contractCode: 'Ctr-1', vendorCode: tax, amount: 100, sourceRow: 2 },
    { contractCode: 'Ctr-1', vendorCode: tax, amount: 200, sourceRow: 3 },
    { contractCode: 'Ctr-2', vendorCode: tax, amount: 50, sourceRow: 4 },
    { contractCode: 'Ctr-1', vendorCode: 'WRONG', amount: 99, sourceRow: 5 }];
  const result = h.context.importExpenseVendors({ details: JSON.stringify({ paymentId: 'DC.TEST', currentUser: actor, rows }) });
  assert.equal(result.success, true, result.message); assert.equal(result.successCount, 3); assert.equal(result.failedCount, 1);
  assert.match(result.errors[0], /Dòng 5/); assert.equal(h.db.esdHTKTvendor.length, 1);
  assert.deepEqual(h.db.esdHTKTpaymentVendor[0], old);
  assert.deepEqual(h.db.esdHTKTpaymentVendor.slice(1).map(r => r['contract.id']), ['Ctr-1', 'Ctr-1', 'Ctr-2']);
  assert.deepEqual(h.db.esdHTKTpaymentVendor.slice(1).map(r => r.currency), ['VND', 'VND', 'USD']);
  assert.equal(h.db.esdHTKTpayment[0]['total.transaction'], 4);
  assert.equal(h.db.esdHTKTpayment[0]['total.amount.paid'], '370');
  assert.equal(h.calls.lookup.length, 0, 'Import OGL remains the separate whole-payment button API');
});

test('duplicate source contract.code cannot redirect ID-based import or fall back to S2', () => {
  const h = harness(); h.contracts.push({ ...h.contracts[0], id: 'Ctr-3' });
  const validate = code => h.context.expenseImportValidateRow({ contractCode: code, vendorCode: tax, amount: 1 },
    { currentUser: actor, contractCategory: 'XDCB' }, { contracts: {}, vendors: {}, links: {} });
  assert.equal(validate('Ctr-1').contractId, 'Ctr-1');
  assert.throws(() => validate('HD/S4-1'), /không có HĐ XDCB/);
  assert.throws(() => validate('S2-ID'), /không có HĐ XDCB/);
  assert.equal(h.calls.writes.length, 0);
});

test('manual creation validates all S4 selections before writing and ignores client currency', () => {
  const h = harness();
  const invoke = contracts => h.context.createPaymentVendor({ details: JSON.stringify({ paymentId: 'DC.TEST', currentUser: actor, contracts }) });
  assert.equal(invoke([{ id: 'Ctr-1' }, { id: 'UNKNOWN' }]).success, false); assert.equal(h.calls.writes.length, 0);
  const result = invoke([{ id: 'Ctr-2', currency: 'FAKE' }]);
  assert.equal(result.success, true, result.message); assert.equal(h.db.esdHTKTpaymentVendor[0].currency, 'USD');
});

test('whole-payment OGL handles old/new XDCB items; checkOnly verifies without writes', () => {
  const h = harness(); h.db.esdHTKTvendor.push(h.vendor());
  h.db.esdHTKTpaymentVendor.push(h.item({ id: 'DC.OLD' }), h.item({ id: 'DC.NEW' }));
  const input = { details: JSON.stringify({ paymentId: 'DC.TEST', currentUser: actor }) };
  const result = h.context.syncExpenseVendorsToOgl(input);
  assert.equal(result.success, true, result.message); assert.equal(result.data.synced, 2);
  assert.equal(h.calls.create.length, 1); assert.equal(h.calls.sharedSync.length, 0);
  const before = h.calls.writes.length;
  const checked = h.context.checkExpenseVendorsOglOnSubmit(h.db.esdHTKTpayment[0]);
  assert.equal(checked.success, true, checked.message); assert.equal(checked.data.skipped, 2);
  assert.equal(h.calls.writes.length, before);
});

test('whole-payment check rejects a HHDV site even when item says synced', () => {
  const h = harness(); h.db.esdHTKTvendor.push(h.vendor()); h.db.esdHTKTvendorSite.push(h.site({ 'ogl.site.code': '126150610' }));
  h.db.esdHTKTpaymentVendor.push(h.item({ 'vendor.site.id': 'SITE1', 'ogl.sync.status': true }));
  const result = h.context.checkExpenseVendorsOglOnSubmit(h.db.esdHTKTpayment[0]);
  assert.equal(result.success, false); assert.equal(h.calls.lookup.length, 0); assert.equal(h.calls.writes.length, 0);
});

test('HHDV default/category retains the existing S2 view loader', () => {
  const h = harness({ parent: { 'original.contract.category': '', 'contract.category': 'XDCB' } });
  h.db.esdHDcontractSupplier.push({ 'contract.id': 'HD1', 'supplier.id': 'SUP1', 'supplier.name': 'NCC S2' });
  h.db.esdDMSupplier.push({ id: 'SUP1', 'tax.code': tax, address: 'Hà Nội' });
  h.db.esdHTKTpaymentVendor.push(h.item({ 'contract.id': 'HD1' }));
  assert.equal(h.context.getExpenseSupplierContext(h.item(), actor, true).category, 'HHDV');
  h.context.loadPaymentVendorInfo(h.item({ 'contract.id': 'HD1', 'vendor.id': '' }));
  assert.equal(h.context.vars.$arrVendors.length, 1);
  assert.equal(h.calls.contractQueries.length, 0);
  assert.equal(h.context.getExpenseContractInfo(h.item({ 'contract.id': 'HD1' })).name, 'HĐ S2');
});

test('XDCB keeps the legacy HHDV edit/sync/site permissions across roles, phases and actors', () => {
  for (const role of ['dmms', 'kttc']) {
    for (const phase of ['initial_dmms', 'initial_kttc', 'approval_dmms', 'approval_kttc', 'approved', 'accounted']) {
      for (const operator of ['CREATOR', 'CHECKER', 'OTHER']) {
        for (const synced of [false, true]) {
          const flags = category => {
            const h = harness({ parent: { 'original.contract.category': category, 'initial.role': role,
              'current.phase': phase, 'created.by': 'CREATOR', 'user.checker.kttc': 'CHECKER' } });
            h.context.vars.$lo_operator['contact.name'] = operator;
            const record = h.item({ 'ogl.sync.status': synced });
            h.db.esdHTKTvendor.push(h.vendor({ 'supplier.id': 'SUP1' }));
            h.db.esdHDcontractSupplier.push({ 'contract.id': 'Ctr-1', 'supplier.id': 'SUP1', 'supplier.name': 'NCC S2' });
            h.db.esdDMSupplier.push({ id: 'SUP1', 'tax.code': tax });
            h.db.esdHTKTpaymentVendor.push(record);
            h.context.loadPaymentVendorInfo(record);
            assert.equal(h.db.esdHTKTpayment[0]['current.phase'], phase);
            assert.equal(h.calls.writes.length, 0);
            return ['canEditObj', 'showSyncVendorOgl', 'canEditSite'].map(key => !!h.context.vars['$' + key]);
          };
          assert.deepEqual(flags('XDCB'), flags('HHDV'), [role, phase, operator, synced].join('/'));
        }
      }
    }
  }
});

test('picker selections, DO, Save, import and pre-OGL validation pass the persisted payment context', () => {
  const invocations = {
    manual(h) { return h.context.createPaymentVendor({ details: JSON.stringify({ paymentId: 'DC.TEST', currentUser: actor,
      contracts: [{ id: 'Ctr-1' }] }) }); },
    change(h) { return h.context.selectExpenseSupplier(h.item(), tax + 'THAU-1'); },
    save(h) {
      Object.assign(h.context.vars, { $supplierId: tax + 'THAU-1', $taxCode: tax, $amount: 100 });
      return h.context.saveExpenseXdcbDetails(h.item({ 'vendor.id': '' }));
    },
    import(h) { return h.context.importExpenseVendors({ details: JSON.stringify({ paymentId: 'DC.TEST', currentUser: actor,
      rows: [{ contractCode: 'Ctr-1', vendorCode: tax, amount: 100, sourceRow: 2 }] }) }); },
    ogl(h) { h.db.esdHTKTvendor.push(h.vendor()); return h.context.validateExpenseXdcbItem(h.item(), actor); },
  };
  for (const [name, invoke] of Object.entries(invocations)) {
    const h = harness(); const phase = h.db.esdHTKTpayment[0]['current.phase'];
    const result = invoke(h);
    if (result.success !== undefined) assert.equal(result.success, true, name + ': ' + result.message);
    assert.ok(h.calls.contractQueries.length > 0, name);
    assert.ok(h.calls.contractQueries.every(query => query.paymentId === 'DC.TEST' && query.currentUser === actor), name);
    assert.equal(h.db.esdHTKTpayment[0]['current.phase'], phase, name);
  }
});

for (const type of ['Thanh toán', 'Tạm ứng']) {
  test('shared tables cannot route ' + type + ' into XDCB Dự chi writer', () => {
    const h = harness({ parent: { 'transaction.type': type } });
    assert.throws(() => h.context.getExpenseSupplierContext(h.item(), actor, true));
    assert.equal(h.context.syncExpenseXdcbVendorToOgl(h.item(), '', '', actor).success, false);
    assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.lookup.length, 0);
  });
}

test('Display Screen Dự chi does not exclude an NCC already used by another item', () => {
  const h = harness(); h.db.esdHTKTvendor.push(h.vendor()); h.db.esdHTKTpaymentVendor.push(h.item());
  h.context.vars.$L_file = h.item({ 'vendor.id': '' });
  h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.new.js'), 'utf8'));
  assert.deepEqual([...h.context.vars.$suppliervalues], [tax + 'THAU-1']);
  // Giả lập ScriptLibrary có global scope khác: caller phải bind giá trị trả về.
  h.context.loadExpenseSupplierScreen = () => [{ 'supplier.id': 'RETURNED-OPTION' }];
  h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.new.js'), 'utf8'));
  assert.equal(h.context.arrVendors[0]['supplier.id'], 'RETURNED-OPTION');
});

test('Display Screen Thanh toán keeps its S2 supplier exclusion and never calls the DC loader', () => {
  const h = harness({ parent: { id: 'TT.TEST', 'transaction.type': 'Thanh toán' } });
  h.db.esdHTKTvendor.push(h.vendor({ 'supplier.id': 'SUP1' }));
  h.db.esdHTKTpaymentVendor.push(h.item({ 'payment.id': 'TT.TEST', 'contract.id': 'HD1' }));
  h.context.vars.$L_file = { 'payment.id': 'TT.TEST', 'contract.id': 'HD1' };
  h.context.loadExpenseSupplierScreen = () => { throw new Error('TT called DC loader'); };
  const original = h.context.SCFile;
  h.context.SCFile = function (table, mode) {
    if (table !== 'esdHTKTpayment') return new original(table, mode);
    let index = 0;
    const rows = ['SUP1', 'SUP2'].map(id => ({ 'supplier.id': id, 'supplier.name': id, 'tax.code': 'TAX-' + id }));
    return { doSelect(query) { assert.match(query, /esdHDcontractSupplier/); Object.assign(this, rows[0]); return 0; },
      getNext() { index++; if (index >= rows.length) return 9; Object.assign(this, rows[index]); return 0; }, doClose() {} };
  };
  h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.new.js'), 'utf8'));
  assert.deepEqual([...h.context.vars.$suppliervalues], ['SUP2']);
});

test('Display Screen HHDV new retains its old S2 query and supplier exclusion', () => {
  const h = harness({ parent: { 'original.contract.category': 'HHDV' } });
  h.db.esdHTKTvendor.push(h.vendor({ 'supplier.id': 'SUP1' }));
  h.db.esdHTKTpaymentVendor.push(h.item());
  for (const id of ['SUP1', 'SUP2']) {
    h.db.esdHDcontractSupplier.push({ 'contract.id': 'Ctr-1', 'supplier.id': id, 'supplier.name': 'NCC ' + id });
    h.db.esdDMSupplier.push({ id, 'tax.code': id });
  }
  h.context.vars.$L_file = h.item({ id: 'DC.NEW', 'vendor.id': '' });
  h.context.loadExpenseSupplierScreen = () => { throw new Error('HHDV called S4 loader'); };
  h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.new.js'), 'utf8'));
  assert.deepEqual([...h.context.vars.$suppliervalues], ['SUP2']);
  assert.equal(h.context.vars.$G_description, 'Dự chi');
  assert.equal(h.calls.contractQueries.length, 0); assert.equal(h.calls.writes.length, 0);
  assert.ok(h.calls.queries.every(call => !/XDCB/i.test(call.table)));
});

test('S4 supplier helpers reject HHDV without querying S4 tables', () => {
  const h = harness({ parent: { 'original.contract.category': 'HHDV' } });
  assert.throws(() => h.context.loadExpenseSupplierScreen(h.item()), /chỉ áp dụng/);
  assert.throws(() => h.context.selectExpenseSupplier(h.item(), 'SUP1'), /chỉ áp dụng/);
  assert.ok(h.calls.queries.every(call => call.table === 'esdHTKTpayment'));
  assert.equal(h.calls.writes.length, 0);
});

test('S4 view displays the saved contract ID and preserves S4 supplier selection', () => {
  const h = harness(); h.db.esdHTKTvendor.push(h.vendor()); h.db.esdHTKTvendorSite.push(h.site(), h.site({ id: 'HHDV', 'ogl.site.code': '126150610' }));
  h.context.lib.ESD_HTKT_PAYMENT_WF = { canEditInCurrenPhase: () => true };
  const record = h.item({ vendor_id: 'V1', 'vendor.site.id': 'SITE1', 'ogl.sync.status': true });
  h.context.vars.$L_file = record;
  h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view.js'), 'utf8'));
  assert.equal(record['contract.id'], 'Ctr-1'); assert.equal(h.context.vars.$contractId, 'Ctr-1');
  assert.equal(h.context.vars.$supplierId, tax + 'THAU-1');
  assert.deepEqual([...h.context.vars.$vendorSiteOptDisp], [xdcbCode]);
});

test('HHDV Save retains the S2 NCC match and existing shared OGL helper', () => {
  const h = harness({ parent: { 'original.contract.category': 'HHDV' } });
  h.db.esdHTKTvendor.push(h.vendor()); h.db.esdHTKTvendorSite.push(h.site({ 'ogl.site.code': '126150610' }));
  const record = h.item({ 'contract.id': 'HD1' });
  Object.assign(h.context.vars, { $L_file: record, $supplierId: 'S2-KEEP', $taxCode: tax,
    $supplierName: 'NCC S6', $amount: 100, $currency: 'VND', $branchCode: '100', $entityCode: 'ENTITY' });
  h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view_save_for_expense.js'), 'utf8'));
  assert.equal(h.context.vars.$G_hasError, false); assert.equal(record['vendor.id'], 'V1');
  assert.equal(record['vendor.site.id'], 'SITE1'); assert.equal(h.calls.sharedSync.length, 1);
  assert.equal(h.calls.lookup.length, 0); assert.equal(h.db.esdHTKTvendor.length, 1);
});

test('OGL failure on Save retains NCC; retry uses it and the OGL site already created', () => {
  const h = harness(); const record = h.item({ 'vendor.id': '' });
  Object.assign(h.context.vars, { $supplierId: tax + 'THAU-1', $taxCode: tax, $amount: 100 });
  h.state.writeFailure = 'esdHTKTvendorSite';
  assert.equal(h.context.saveExpenseXdcbDetails(record).success, false);
  assert.equal(h.db.esdHTKTvendor.length, 1); assert.equal(record['ogl.sync.status'], false);
  const id = record['vendor.id']; h.state.writeFailure = null;
  h.state.response = { success: true, data: [{ vendorNumber: tax, sites: [
    { entity: '100', vendorSiteCode: xdcbCode, debitAccount: 'DR', creditAccount: 'CR' }] }] };
  assert.equal(h.context.saveExpenseXdcbDetails(record).success, true);
  assert.equal(record['vendor.id'], id); assert.equal(h.db.esdHTKTvendor.length, 1); assert.equal(h.calls.create.length, 1);
});

test('inactive or ambiguous OGL XDCB sites are errors, without creating an extra site', () => {
  for (const sites of [
    [{ entity: '100', vendorSiteCode: xdcbCode, active: 'false' }],
    Array.from({ length: 2 }, () => ({ entity: '100', vendorSiteCode: xdcbCode, debitAccount: 'DR', creditAccount: 'CR' })),
  ]) {
    const h = harness(); h.db.esdHTKTvendor.push(h.vendor());
    h.state.response = { success: true, data: [{ vendorNumber: tax, sites }] };
    assert.equal(h.context.syncExpenseXdcbVendorToOgl(h.item(), '', '', actor).success, false);
    assert.equal(h.calls.create.length, 0);
  }
});

test('failed import item write rolls back new items and preserves old data and the reusable NCC', () => {
  const h = harness(); const old = h.item({ id: 'DC.OLD', amount: 20 });
  h.db.esdHTKTpaymentVendor.push(copy(old)); h.state.writeFailure = 'esdHTKTpaymentVendor';
  const result = h.context.importExpenseVendors({ details: JSON.stringify({ paymentId: 'DC.TEST', currentUser: actor,
    rows: [{ contractCode: 'Ctr-1', vendorCode: tax, amount: 100, sourceRow: 2 }] }) });
  assert.equal(result.success, false); assert.equal(result.successCount, 0);
  assert.deepEqual(h.db.esdHTKTpaymentVendor, [old]); assert.equal(h.db.esdHTKTvendor.length, 1);
});

for (const screen of ['new', 'view']) {
  test('XDCB ' + screen + ' retains the selected supplier through DO then DS redisplay without changing amount initialization', () => {
    const h = harness();
    const record = h.item({ 'vendor.id': screen === 'view' ? 'V1' : '', 'transaction.des': 'Nội dung đang nhập' });
    if (screen === 'view') h.db.esdHTKTvendor.push(h.vendor());
    h.db.esdjoinXDCBtenderPackageContractor.push({ id: 'NEW-THAU-1', 'tender.package.id': 'THAU-1',
      'tax.code': '0098765432', name: 'NCC vừa chọn', address: 'Địa chỉ mới' });
    h.context.vars.$L_file = record;
    h.context.lib.ESD_HTKT_PAYMENT_WF = { canEditInCurrenPhase: () => true };
    const screenSource = fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.' + screen + '.js'), 'utf8');
    h.run(screenSource);
    Object.assign(h.context.vars, { $supplierId: 'NEW-THAU-1', $amount: '999.5' });
    h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.' + screen + '_fill_data.js'), 'utf8'));
    assert.equal(h.context.vars.$supplierId, 'NEW-THAU-1');
    h.run(screenSource);
    assert.equal(h.context.vars.$supplierId, 'NEW-THAU-1');
    assert.equal(h.context.vars.$supplierName, 'NCC vừa chọn'); assert.equal(h.context.vars.$taxCode, '0098765432');
    assert.equal(h.context.vars.$amount, record.amount); assert.equal(record['transaction.des'], 'Nội dung đang nhập');
    assert.equal('amount' in JSON.parse(h.context.vars['$L.expense.xdcb.supplier.draft']), false);
    assert.equal(record['vendor.id'], screen === 'view' ? 'V1' : '');
    assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.lookup.length, 0); assert.equal(h.calls.create.length, 0);
    h.context.vars.$amount = '1234';
    h.run(screenSource);
    assert.equal(h.context.vars.$supplierId, 'NEW-THAU-1'); assert.equal(h.context.vars.$amount, record.amount);
  });

  test('DO 4200 ' + screen + ' fills S4 fields/currency and preserves unsaved amount/content', () => {
    const h = harness(); const record = h.item({ 'contract.id': 'Ctr-2', 'vendor.id': '', 'transaction.des': 'Nội dung đang nhập' });
    Object.assign(h.context.vars, { $L_file: record, $supplierId: tax + 'THAU-2', $amount: '999.5',
      $currency: 'VND', $vendorType: 'STALE', $G_description: 'Nội dung cũ' });
    h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.' + screen + '_fill_data.js'), 'utf8'));
    assert.equal(h.context.vars.$G_hasError, false); assert.equal(h.context.vars.$supplierName, 'NCC S4');
    assert.equal(h.context.vars.$taxCode, tax); assert.equal(h.context.vars.$supplierAddress, 'Hà Nội');
    assert.equal(h.context.vars.$G_supplier_id, tax + 'THAU-2'); assert.equal(h.context.vars.$currency, 'USD');
    assert.equal(h.context.vars.$vendorType, ''); assert.equal(h.context.vars.$amount, '999.5');
    assert.equal(record['transaction.des'], 'Nội dung đang nhập'); assert.equal(h.context.vars.$G_description, 'Nội dung đang nhập');
    assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.lookup.length, 0);
    assert.equal(h.calls.create.length, 0); assert.equal(record['vendor.id'], '');
  });

  test('DO 4200 ' + screen + ' rejects another package contractor and clears stale supplier fields', () => {
    const h = harness(); const record = h.item({ 'transaction.des': 'Nội dung đang nhập' });
    Object.assign(h.context.vars, { $L_file: record, $supplierId: tax + 'THAU-2', $supplierName: 'NCC cũ',
      $taxCode: tax, $supplierAddress: 'Địa chỉ cũ', $G_supplier_id: 'OLD', $vendorType: 'OLD', $amount: '999.5' });
    h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.' + screen + '_fill_data.js'), 'utf8'));
    assert.equal(h.context.vars.$G_hasError, true); assert.equal(h.context.vars.$L_action, 'do nothing');
    for (const field of ['$supplierId', '$supplierName', '$taxCode', '$supplierAddress', '$G_supplier_id', '$vendorType']) {
      assert.equal(h.context.vars[field], '', field);
    }
    assert.equal(record['vendor.id'], 'V1'); assert.equal(record['transaction.des'], 'Nội dung đang nhập');
    assert.equal(h.context.vars.$amount, '999.5'); assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.create.length, 0);
  });

  test('DO 4200 ' + screen + ' HHDV keeps the original callback, loader and Save behavior', () => {
    const h = harness({ parent: { 'original.contract.category': 'HHDV' } });
    h.db.esdHTKTvendor.push(h.vendor());
    h.db.esdHDcontractSupplier.push({ 'contract.id': 'HD1', 'supplier.id': 'SUP2', 'supplier.name': 'NCC S2 mới' });
    h.db.esdDMSupplier.push({ id: 'SUP2', 'tax.code': '0000123', address: 'Địa chỉ S2', type: 'DM' });
    const record = h.item({ 'contract.id': 'HD1', currency: 'EUR', 'transaction.des': 'Nội dung đang nhập' });
    h.db.esdHTKTpaymentVendor.push(copy(record));
    h.context.vars.$supplierAddress = 'Địa chỉ trên form';
    h.context.loadPaymentVendorInfo(record);
    assert.equal(h.context.vars.$supplierAddress, 'Địa chỉ trên form');
    const loaderQuery = h.calls.queries.find(call => /^select hpv\.contract\.id/.test(call.query)).query;
    assert.doesNotMatch(loaderQuery, /current\.supplier\.address|dmVendor\.address|dmVendor\.type/);
    assert.equal(h.context.vars.$arrVendors[0].address, undefined);
    assert.equal(h.context.vars.$arrVendors[0].type, undefined);
    h.context.selectExpenseSupplier = () => { throw new Error('HHDV called S4 supplier helper'); };
    Object.assign(h.context.vars, { $L_file: record, $supplierId: 'SUP2', $amount: 499.9,
      $G_hasError: false, $G_description: 'Ghi chú phiếu cũ', $vendorType: 'Giá trị cũ' });
    h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.' + screen + '_fill_data.js'), 'utf8'));
    assert.equal(h.context.vars.$G_hasError, false); assert.equal(h.context.vars.$currency, 'VND');
    assert.equal(h.context.vars.$supplierAddress, 'Địa chỉ trên form');
    assert.equal(h.context.vars.$vendorType, screen === 'new' ? undefined : 'Giá trị cũ');
    assert.equal(h.context.vars.$G_supplier_id, 'SUP2'); assert.equal(h.context.vars.$taxCode, '0000123');
    assert.equal(record['transaction.des'], screen === 'new' ? 'Ghi chú phiếu cũ' : 'Dự chi');
    assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.contractQueries.length, 0);
    h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view_save_for_expense.js'), 'utf8'));
    assert.equal(h.context.vars.$G_hasError, false);
    const savedVendor = h.db.esdHTKTvendor.find(v => v.id === record['vendor.id']);
    assert.equal(savedVendor.address, 'Địa chỉ trên form'); assert.equal(savedVendor['supplier.id'], 'SUP2');
    assert.equal(record.currency, 'VND'); assert.equal(h.calls.sharedSync.length, 1);
  });
}

for (const screen of ['new', 'view']) {
  for (const listType of ['datum', 'array-like', 'array without find']) {
    test('DO 4200 ' + screen + ' fills the selected S2 tax from ' + listType + ' without reloading the form', () => {
      const h = harness({ parent: { 'original.contract.category': 'HHDV' } });
      const record = h.item({ 'contract.id': 'HD1', amount: 123, 'transaction.des': 'Nội dung đang nhập' });
      const rows = [{ 'supplier.id': 'OTHER', 'supplier.name': 'NCC khác', 'tax.code': '999' },
        { 'supplier.id': 'SUP2', 'supplier.name': 'NCC đã chọn', 'tax.code': '0000123', description: 'Nội dung nguồn', type: 'DM' },
        { 'supplier.id': 'SUP2', 'supplier.name': 'Không chọn dòng trùng sau', 'tax.code': '888' }];
      h.context.arrVendors = listType === 'datum' ? { toArray: () => rows } :
        listType === 'array-like' ? Object.assign({ length: rows.length }, rows) : Object.assign(rows, { find: undefined });
      Object.assign(h.context.vars, { $L_file: record, $supplierId: 'SUP2', $amount: 123,
        $G_description: 'Nội dung phiếu', $G_hasError: false });
      h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.' + screen + '_fill_data.js'), 'utf8'));
      assert.equal(h.context.vars.$supplierId, 'SUP2'); assert.equal(h.context.vars.$supplierName, 'NCC đã chọn');
      assert.equal(h.context.vars.$taxCode, '0000123'); assert.equal(h.context.vars.$G_supplier_id, 'SUP2');
      assert.equal(h.context.vars.$amount, 123); assert.equal(record.amount, 123);
      assert.equal(record['transaction.des'], screen === 'new' ? 'Nội dung phiếu' : 'Nội dung nguồn');
      assert.equal(h.context.validateVendorAndPaymentDetails(record).length, 0);
      assert.ok(h.calls.queries.every(call => call.table === 'esdHTKTpayment'));
      assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.lookup.length, 0);
    });
  }

  test('DO 4200 ' + screen + ' keeps the current filtered S2 list when no supplier matches', () => {
    const h = harness({ parent: { 'original.contract.category': 'HHDV' } });
    Object.assign(h.context.vars, { $L_file: h.item(), $supplierId: 'NOT-IN-LIST', $taxCode: '', $amount: 123,
      $arrVendors: [{ 'supplier.id': 'NOT-IN-LIST', 'tax.code': 'SHOULD-NOT-USE' }] });
    h.context.arrVendors = { toArray: () => [] };
    h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.' + screen + '_fill_data.js'), 'utf8'));
    assert.equal(h.context.vars.$taxCode, ''); assert.equal(h.context.vars.$amount, 123);
    assert.equal(h.calls.writes.length, 0);
  });
}

for (const loaderReturn of ['undefined', 'datum', 'empty array']) {
test('Dự chi HHDV view ignores loader return ' + loaderReturn + ' and keeps the legacy supplier/contract binding', () => {
  const h = harness({ parent: { 'original.contract.category': 'HHDV' } });
  const record = h.item({ 'contract.id': 'HD1', 'vendor.id': '', amount: 0 });
  h.db.esdHTKTpaymentVendor.push(copy(record));
  h.db.esdHDcontractSupplier.push({ 'contract.id': 'HD1', 'supplier.id': 'SUP2', 'supplier.name': 'NCC S2' });
  h.db.esdDMSupplier.push({ id: 'SUP2', 'tax.code': '0000123' });
  let datum;
  Object.defineProperty(h.context.vars, '$arrVendors', {
    get: () => datum,
    set: rows => { datum = { toArray: () => rows }; },
    configurable: true,
  });
  h.context.vars.$L_file = record;
  h.context.lib.ESD_HTKT_PAYMENT_WF = { canEditInCurrenPhase: () => true };
  const loadForSideEffects = h.context.loadPaymentVendorInfo;
  h.context.loadPaymentVendorInfo = current => {
    loadForSideEffects(current);
    // Loader cũ điền global/vars; caller không được thay arrVendors bằng return của SL.
    if (loaderReturn === 'datum') return { toArray: () => [] };
    if (loaderReturn === 'empty array') return [];
  };
  h.context.getExpenseContractInfo = () => { throw new Error('HHDV must keep the original S2 contract getter'); };
  const s2ContractCalls = [];
  h.context.lib.ESD_HTKT_PAYMENT_VENDOR.getContractInfo = id => {
    s2ContractCalls.push(id);
    return { id, code: 'DO-NOT-REPLACE-S2-ID', name: 'HĐ S2' };
  };
  h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view.js'), 'utf8'));
  assert.equal(Array.isArray(h.context.arrVendors), true);
  assert.equal(h.context.arrVendors[0]['supplier.id'], 'SUP2');
  assert.deepEqual(s2ContractCalls, ['HD1']); assert.equal(h.context.vars.$contractId, 'HD1');
  assert.equal(record['contract.id'], 'HD1');
  Object.assign(h.context.vars, { $supplierId: 'SUP2', $amount: 123 });
  record.amount = 123; // Input FD ghi số vừa nhập vào record, không chỉ biến màn hình.
  assert.equal(h.run('arrVendors.find(function (row) { return row["supplier.id"] == vars.$supplierId; })["tax.code"]'), '0000123');
  h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view_fill_data.js'), 'utf8'));
  assert.equal(h.context.vars.$taxCode, '0000123');
  assert.equal(h.context.validateVendorAndPaymentDetails(record).length, 0);
  h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view_save_for_expense.js'), 'utf8'));
  assert.equal(h.context.vars.$G_hasError, false); assert.equal(record.amount, 123);
  assert.equal(h.db.esdHTKTvendor.find(v => v.id === record['vendor.id'])['vendor.number'], '0000123');
});
}

test('Dự chi amount validation reads record.amount and ignores the unbound $amount variable', () => {
  const h = harness();
  const record = h.item({ amount: 123 });
  Object.assign(h.context.vars, { $supplierId: 'SUP2', $taxCode: '0000123', $amount: 0 });
  assert.equal(h.context.validateVendorAndPaymentDetails(record).length, 0);
  for (const amount of [123, '123', '1,234.5']) {
    record.amount = amount;
    assert.equal(h.context.validateVendorAndPaymentDetails(record).length, 0);
  }
  h.context.vars.$amount = 2000;
  for (const amount of [-1, '0', '', null, 'abc']) {
    record.amount = amount;
    assert.equal(h.context.validateVendorAndPaymentDetails(record).length, 1);
  }
});

test('DO new 4200 preserves the existing Thanh toán callback and never calls DC helper', () => {
  const h = harness({ parent: { id: 'TT.TEST', 'transaction.type': 'Thanh toán' } });
  const record = { 'payment.id': 'TT.TEST', 'transaction.des': 'Nội dung đang nhập' };
  Object.assign(h.context.vars, { $L_file: record, $supplierId: 'S2-LEGACY', $currency: 'USD',
    $G_description: 'Ghi chú phiếu', $supplierAddress: 'Giữ địa chỉ cũ' });
  h.context.arrVendors = [{ 'supplier.id': 'S2-LEGACY', 'supplier.name': 'NCC TT', 'tax.code': '0000456',
    description: 'Nội dung nguồn', type: 'DM', address: 'Địa chỉ khác' }];
  h.context.selectExpenseSupplier = () => { throw new Error('TT called Dự chi helper'); };
  h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.new_fill_data.js'), 'utf8'));
  assert.equal(h.context.vars.$supplierName, 'NCC TT'); assert.equal(h.context.vars.$taxCode, '0000456');
  assert.equal(h.context.vars.$currency, 'VND'); assert.equal(h.context.vars.$vendorType, 'DM');
  assert.equal(h.context.vars.$G_supplier_id, 'S2-LEGACY'); assert.equal(record['transaction.des'], 'Ghi chú phiếu');
  assert.equal(h.context.vars.$supplierAddress, 'Giữ địa chỉ cũ');
  assert.equal(h.calls.queries.length, 0); assert.equal(h.calls.writes.length, 0);
});

test('HHDV callback preserves the original VND default without querying contract currency', () => {
  const h = harness({ parent: { 'original.contract.category': 'HHDV' } });
  h.db.esdHDcontract = [{ id: 'HD1', currency: 'USD' }];
  Object.assign(h.context.vars, { $L_file: h.item({ 'contract.id': 'HD1', currency: '', 'transaction.des': '' }),
    $supplierId: 'SUP2', $G_hasError: false });
  h.context.arrVendors = [{ 'supplier.id': 'SUP2', 'supplier.name': 'NCC S2', 'tax.code': '0000456', description: 'Nội dung nguồn' }];
  h.context.selectExpenseSupplier = () => { throw new Error('HHDV called S4 supplier helper'); };
  h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view_fill_data.js'), 'utf8'));
  assert.equal(h.context.vars.$G_hasError, false); assert.equal(h.context.vars.$currency, 'VND');
  assert.equal(h.context.vars.$L_file['transaction.des'], 'Nội dung nguồn');
  assert.ok(h.calls.queries.every(call => call.table === 'esdHTKTpayment'));
});

for (const table of ['esdHTKTpaymentVendor', 'esdHTKTpayment']) {
  test('manual XDCB creation rolls back its own items on DB failure: ' + table, () => {
    const h = harness(); const old = h.item({ id: 'DC.OLD', amount: 20 });
    h.db.esdHTKTpaymentVendor.push(copy(old)); h.state.writeFailure = table;
    const result = h.context.createPaymentVendor({ details: JSON.stringify({ paymentId: 'DC.TEST', currentUser: actor,
      contracts: [{ id: 'Ctr-1' }] }) });
    assert.equal(result.success, false); assert.deepEqual(h.db.esdHTKTpaymentVendor, [old]);
    assert.equal(h.context.vars.$G_payment_vendor_id || '', '');
  });
}

test('item list returns the saved contract ID for display without joining source contract.code', () => {
  const h = harness(); h.db.esdHTKTvendor.push(h.vendor()); h.db.esdHTKTpaymentVendor.push(h.item());
  const result = h.context.getListExpenseVendor({ details: JSON.stringify({ paymentId: 'DC.TEST' }) });
  assert.equal(result.length, 1); assert.equal(result[0].contract_id, 'Ctr-1'); assert.equal(result[0].contract_code, 'Ctr-1');
  assert.ok(h.calls.queries.every(call => !call.query.includes('ctr.contract.code') && !call.query.includes('JOIN esdXDCBrepairProjectCtr')));
  const hhdv = h.context.buildExpenseVendorItem(['ITEM', 'DC.TEST', 'S2-KEY'], false);
  assert.equal(hhdv.contract_id, 'S2-KEY'); assert.equal('contract_code' in hhdv, false);
});

for (const changed of ['item', 'contract', 'payment', 'actor', 'phase', 'saved vendor']) {
  test('XDCB draft does not leak across changed form context: ' + changed, () => {
    const h = harness(); h.db.esdHTKTvendor.push(h.vendor());
    h.db.esdjoinXDCBtenderPackageContractor.push({ id: 'NEW-THAU-1', 'tender.package.id': 'THAU-1',
      'tax.code': '0098765432', name: 'NCC chưa lưu', address: 'Địa chỉ mới' });
    const record = h.item(); h.context.vars.$amount = '999';
    h.context.selectExpenseSupplier(record, 'NEW-THAU-1');
    const next = copy(record);
    if (changed === 'item') next.id = 'DC.OTHER_ITEM';
    if (changed === 'contract') next['contract.id'] = 'Ctr-2';
    if (changed === 'payment') {
      h.db.esdHTKTpayment.push({ ...h.db.esdHTKTpayment[0], id: 'DC.OTHER' }); next['payment.id'] = 'DC.OTHER';
    }
    if (changed === 'actor') h.context.vars.$lo_operator['contact.name'] = 'OTHER';
    if (changed === 'phase') h.db.esdHTKTpayment[0]['current.phase'] = 'approved';
    if (changed === 'saved vendor') next['vendor.id'] = '';
    h.context.loadExpenseSupplierScreen(next);
    assert.notEqual(h.context.vars.$supplierId, 'NEW-THAU-1');
    assert.equal(h.context.vars['$L.expense.xdcb.supplier.draft'], '');
    assert.equal(h.context.vars.$amount, 100);
    assert.equal(h.context.vars.$G_supplier_id, h.context.vars.$supplierId);
    assert.equal(h.calls.writes.length, 0);
  });
}

test('XDCB view calls the S4 supplier loader directly even when EXPENSE_VENDOR still has the legacy S2 loader', () => {
  const h = harness();
  const record = h.item({ 'vendor.id': '', amount: 2000, 'transaction.des': 'Nội dung chưa lưu' });
  h.context.vars.$L_file = record;
  h.context.lib.ESD_HTKT_PAYMENT_WF = { canEditInCurrenPhase: () => true };
  let legacyLoads = 0;
  h.context.lib.ESD_HTKT_EXPENSE_VENDOR = {
    hasExpenseVendorInvoices: () => false,
    loadPaymentVendorInfo() {
      legacyLoads++;
      Object.assign(h.context.vars, { $supplierId: '', $supplierName: '', $taxCode: '', $canEditObj: true });
    },
  };
  const screen = fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view.js'), 'utf8');
  h.run(screen);
  h.context.vars.$supplierId = tax + 'THAU-1';
  h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view_fill_data.js'), 'utf8'));
  assert.equal(h.context.vars.$supplierName, 'NCC S4');
  h.run(screen);
  assert.equal(h.context.vars.$supplierId, tax + 'THAU-1');
  assert.equal(h.context.vars.$supplierName, 'NCC S4');
  assert.equal(h.context.vars.$taxCode, tax);
  assert.equal(h.context.arrVendors[0]['supplier.id'], tax + 'THAU-1');
  assert.equal(legacyLoads, 0);
  assert.equal(record.amount, 2000);
  assert.equal(record['transaction.des'], 'Nội dung chưa lưu');
  assert.equal(record['vendor.id'], '');
  assert.equal(h.calls.writes.length, 0);
  assert.equal(h.calls.lookup.length, 0);
  assert.equal(h.calls.create.length, 0);
});

for (const savedVendor of ['', 'V1']) {
  for (const exitValue of ['', undefined, 'nosave']) {
  test('XDCB view Cancel unsaved Back restores supplier after RAD local draft is unavailable: ' + (savedVendor || 'unsaved vendor') + ', exit=' + JSON.stringify(exitValue), () => {
    const h = harness();
    if (savedVendor) h.db.esdHTKTvendor.push(h.vendor());
    const record = h.item({ 'vendor.id': savedVendor });
    const source = { id: 'NEW-THAU-1', 'tender.package.id': 'THAU-1',
      'tax.code': '0098765432', name: 'NCC vừa chọn', address: 'Địa chỉ mới' };
    h.db.esdjoinXDCBtenderPackageContractor.push(source);
    h.context.vars.$L_file = record;
    h.context.lib.ESD_HTKT_PAYMENT_WF = { canEditInCurrenPhase: () => true };
    const screen = fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view.js'), 'utf8');
    h.run(screen);
    h.context.vars.$supplierId = source.id;
    h.run(fs.readFileSync(path.join(root, 'esdHTKTpaymentVendor.view_fill_data.js'), 'utf8'));
    record.amount = 2000;
    record['transaction.des'] = 'Nội dung chưa lưu';
    const backup = JSON.parse(h.context.vars['$expense.xdcb.supplier.cancel.draft']);
    assert.deepEqual(Object.keys(backup).sort(), ['key', 'supplierId']);
    h.context.vars['$L.expense.xdcb.supplier.draft'] = null;
    h.context.vars.$proceed = 'no';
    h.context.vars['$L.exit'] = exitValue;
    source.name = 'Tên cập nhật từ S4';
    h.run(screen);
    assert.equal(h.context.vars.$supplierId, source.id);
    assert.equal(h.context.vars.$G_supplier_id, source.id);
    assert.equal(h.context.vars.$supplierName, source.name);
    assert.equal(h.context.vars.$taxCode, source['tax.code']);
    assert.equal(record.amount, 2000);
    assert.equal(record['transaction.des'], 'Nội dung chưa lưu');
    assert.equal(record['vendor.id'], savedVendor);
    assert.ok(h.context.vars['$L.expense.xdcb.supplier.draft']);
    assert.equal(h.calls.writes.length, 0);
    assert.equal(h.calls.lookup.length, 0);
    assert.equal(h.calls.create.length, 0);
  });
  }
}

for (const proceedValue of ['yes', '', undefined]) {
  test('XDCB view reopening the same item does not restore a previous unsaved Back selection: ' + JSON.stringify(proceedValue), () => {
    const h = harness(); h.db.esdHTKTvendor.push(h.vendor());
    h.db.esdjoinXDCBtenderPackageContractor.push({ id: 'NEW-THAU-1', 'tender.package.id': 'THAU-1',
      'tax.code': '0098765432', name: 'NCC chưa lưu' });
    const record = h.item(); h.context.selectExpenseSupplier(record, 'NEW-THAU-1');
    delete h.context.vars['$L.expense.xdcb.supplier.draft'];
    h.context.vars.$proceed = proceedValue;
    if (proceedValue === 'yes') h.context.vars['$L.exit'] = 'exit';
    h.context.loadExpenseSupplierScreen(record);
    assert.equal(h.context.vars.$supplierId, tax + 'THAU-1');
    assert.equal(h.context.vars['$expense.xdcb.supplier.cancel.draft'], '');
    assert.equal(h.calls.writes.length, 0);
  });
}

test('XDCB view Cancel unsaved Back still rejects a removed supplier and clears both drafts', () => {
  const h = harness(); const record = h.item({ 'vendor.id': '' });
  h.context.selectExpenseSupplier(record, tax + 'THAU-1');
  delete h.context.vars['$L.expense.xdcb.supplier.draft'];
  h.context.vars.$proceed = 'no'; h.context.vars['$L.exit'] = 'nosave';
  h.db.esdjoinXDCBtenderPackageContractor[0].id = 'REPLACED-THAU-1';
  h.context.loadExpenseSupplierScreen(record);
  assert.equal(h.context.vars.$supplierId, '');
  assert.equal(h.context.vars['$L.expense.xdcb.supplier.draft'], '');
  assert.equal(h.context.vars['$expense.xdcb.supplier.cancel.draft'], '');
  assert.equal(h.calls.writes.length, 0);
});

test('XDCB redisplay reloads supplier details from S4 and rejects removed selections', () => {
  const h = harness(); const record = h.item({ 'vendor.id': '' });
  h.db.esdjoinXDCBtenderPackageContractor.push({ id: 'NEW-THAU-1', 'tender.package.id': 'THAU-1',
    'tax.code': '0098765432', name: 'Tên cũ', address: 'Địa chỉ' });
  h.context.selectExpenseSupplier(record, 'NEW-THAU-1');
  h.db.esdjoinXDCBtenderPackageContractor[2].name = 'Tên cập nhật ở S4';
  h.context.loadExpenseSupplierScreen(record);
  assert.equal(h.context.vars.$supplierName, 'Tên cập nhật ở S4');
  h.db.esdjoinXDCBtenderPackageContractor.pop();
  h.context.loadExpenseSupplierScreen(record);
  assert.equal(h.context.vars.$supplierId, ''); assert.equal(h.context.vars.$G_supplier_id, '');
  assert.equal(h.context.vars['$L.expense.xdcb.supplier.draft'], ''); assert.equal(h.calls.writes.length, 0);
});

test('XDCB Save clears the local draft and the next display uses the saved vendor', () => {
  const h = harness(); const record = h.item({ 'vendor.id': '', amount: 500 }); h.context.vars.$amount = 0;
  h.context.selectExpenseSupplier(record, tax + 'THAU-1');
  assert.ok(h.context.vars['$L.expense.xdcb.supplier.draft']);
  assert.equal(h.context.saveExpenseXdcbDetails(record).success, true);
  assert.equal(h.context.vars['$L.expense.xdcb.supplier.draft'], '');
  assert.equal(h.context.vars['$expense.xdcb.supplier.cancel.draft'], '');
  h.context.vars.$supplierId = 'STALE'; h.context.vars.$amount = 999;
  h.context.loadExpenseSupplierScreen(record);
  assert.equal(h.context.vars.$supplierId, tax + 'THAU-1'); assert.equal(h.context.vars.$amount, 500);
});

test('XDCB without a local draft ignores stale thread supplier and amount variables', () => {
  const h = harness(); const record = h.item({ 'vendor.id': '' });
  Object.assign(h.context.vars, { $supplierId: tax + 'THAU-1', $G_supplier_id: tax + 'THAU-1', $amount: 999 });
  h.context.loadExpenseSupplierScreen(record);
  assert.equal(h.context.vars.$supplierId, ''); assert.equal(h.context.vars.$G_supplier_id, '');
  assert.equal(h.context.vars.$amount, 100); assert.equal(h.calls.writes.length, 0);
});

test('HHDV manual create closes source lookup before Add and opens parent for writing only afterward', () => {
  const h = harness({ parent: { 'original.contract.category': 'HHDV' } });
  const result = h.context.createPaymentVendor({ details: JSON.stringify({ paymentId: 'DC.TEST', currentUser: actor,
    contracts: [{ id: 'S2-CONTRACT', currency: 'VND' }] }) });
  assert.equal(result.success, true, result.message);
  const add = h.calls.writes.find(write => write.table === 'esdHTKTpaymentVendor' && write.action === 'add');
  assert.ok(add); assert.ok(add.openFiles.every(file => file.table !== 'esdHTKTpayment'));
  assert.equal(h.calls.contractQueries.length, 0);
  assert.equal(h.calls.writes.at(-1).table, 'esdHTKTpayment');
});

test('failed HHDV manual Add preserves the original error handling and does not retry', () => {
  const h = harness({ parent: { 'original.contract.category': 'HHDV' }, writeFailure: 'esdHTKTpaymentVendor' });
  const result = h.context.createPaymentVendor({ details: JSON.stringify({ paymentId: 'DC.TEST', currentUser: actor,
    contracts: [{ id: 'S2-CONTRACT', currency: 'VND' }] }) });
  assert.equal(result.success, false);
  assert.equal(result.message, 'Lỗi thêm hợp đồng vào phiếu Dự chi: Error: Không ghi được hợp đồng S2-CONTRACT vào esdHTKTpaymentVendor. Code: 99 reason DB failure');
  assert.equal(h.calls.logs.length, 0); assert.equal(h.calls.writes.length, 1);
});
