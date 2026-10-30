const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const smRoot = path.resolve(__dirname, '..');
const root = path.resolve(smRoot, '../vtb-csep-addon');
const ts = require(path.join(root, 'node_modules/typescript'));
const source = fs.readFileSync(path.join(smRoot, 'ESD_HTKT_EXPENSE_CONTRACT.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

// Minimal evaluator for the generated SM predicates; the real SM SQL translation is checked in UAT.
function predicate(query) {
  const tokens = query.match(/"(?:\\.|[^"\\])*"|>=|<=|~=|[()=<>]|[A-Za-z][A-Za-z0-9.]*|-?\d+(?:\.\d+)?/g) || [];
  let index = 0;
  function atom() {
    const token = tokens[index++];
    if (token === '(') { const value = or(); assert.equal(tokens[index++], ')'); return value; }
    if (token === 'null' || token === 'tolower') {
      assert.equal(tokens[index++], '('); const value = or(); assert.equal(tokens[index++], ')');
      return row => token === 'null' ? value(row) == null : String(value(row) ?? '').toLowerCase();
    }
    if (token?.startsWith('"')) { const value = JSON.parse(token); return () => value; }
    if (/^-?\d+(?:\.\d+)?$/.test(token)) return () => Number(token);
    if (token === 'true' || token === 'false') return () => token === 'true';
    assert.ok(token, 'Unexpected end of query');
    return row => row[token] ?? null;
  }
  function comparison() {
    const left = atom();
    const operation = tokens[index];
    if (!['=', '~=', '>', '<', '>=', '<=', 'like'].includes(operation)) return left;
    index++; const right = atom();
    return row => {
      const a = left(row), b = right(row);
      if (operation === '=') return a === b;
      if (operation === '~=') return a !== b;
      if (operation === '>=') return a >= b;
      if (operation === '<=') return a <= b;
      if (operation === '>') return a > b;
      if (operation === '<') return a < b;
      const pattern = String(b).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp('^' + pattern + '$').test(String(a));
    };
  }
  function not() { if (tokens[index] === 'not') { index++; const value = not(); return row => !value(row); } return comparison(); }
  function and() { let result = not(); while (tokens[index] === 'and') { index++; const left = result, right = not(); result = row => left(row) && right(row); } return result; }
  function or() { let result = and(); while (tokens[index] === 'or') { index++; const left = result, right = and(); result = row => left(row) || right(row); } return result; }
  const result = or(); assert.equal(index, tokens.length, query); return result;
}

const fixtures = Array.from({ length: 14 }, (_, i) => ({
  id: 'S4-' + String(i + 1).padStart(2, '0'), 'contract.code': 'HD-' + String(i + 1).padStart(2, '0'),
  'contract.name': 'Hợp đồng ' + (i + 1), 'contract.amount': (i + 1) * 100,
  currency: 'VND', 'effective.date': '2026-10-27 12:00:00', 'signed.date': '', 'expire.date': '',
  status: 'Đang thực hiện', 'responsible.officer': 'ACTOR', 'created.by': 'ACTOR',
  'repair.id': i % 2 ? null : 'REPAIR', 'construction.id': i % 2 ? 'CONSTRUCTION' : null,
  'unit.level1': i < 7 ? 'U1' : 'U2', 'unit.level2': 'U12', 'unit.level3': 'U123', 'vendor.name': 'NCC',
}));
const invalidRows = [
  { ...fixtures[0], id: 'DELETED', 'deleted.flag': true },
  { ...fixtures[0], id: 'STOPPED', status: 'Dừng thực hiện' },
  { ...fixtures[0], id: 'CANCELLED', status: 'cancelled' },
  { ...fixtures[0], id: 'COMPLETED', status: 'Hoàn thành' },
  { ...fixtures[0], id: 'UPDATING', status: 'Cập nhật' },
  { ...fixtures[0], id: 'DRAFT', status: 'Nháp' },
  { ...fixtures[0], id: 'EMPTY_STATUS', status: '' },
  { ...fixtures[0], id: 'NULL_STATUS', status: null },
  { ...fixtures[0], id: 'BOTH', 'construction.id': 'CONSTRUCTION' },
  { ...fixtures[0], id: 'NEITHER', 'repair.id': '' },
];
function setup(options = {}) {
  const state = { files: [], legacy: [], writes: 0 };
  const parent = { id: 'DC.TEST', 'transaction.type': 'Dự chi', 'original.contract.category': 'XDCB', 'contract.category': 'HHDV',
    'current.phase': 'initial_kttc', 'initial.role': 'kttc', 'created.by': 'ACTOR', ...options.parent };
  function SCFile(table, mode) {
    assert.equal(mode, 1, 'The contract library must only open read-only files');
    assert.ok(['contacts', 'esdXDCBrepairProjectCtr', 'esdHTKTpayment', 'esdDMentity', 'esdHDcontract'].includes(table));
    const stateFile = { table, closed: false }; state.files.push(stateFile);
    let selected = [], position = 0, fields, order = ['id'], directions = [0];
    const contractRows = options.rows || [...fixtures, ...invalidRows];
    const rows = table === 'contacts' ? options.contacts || [{ 'contact.name': 'ACTOR', 'lv1.id': 'U1' }]
      : table === 'esdHTKTpayment' ? [parent] : table === 'esdDMentity' ? options.entities || []
      : table === 'esdHDcontract' ? contractRows.map(row => ({ ...row, category: 'HD_GT',
        'contract.value.after.tax': 100, 'unit.lv1': row['unit.level1'], 'executor.id': row['responsible.officer'],
        status: row.status === 'Đang thực hiện' ? 'Dang thuc hien' : row.status })) : contractRows;
    const methods = {
      setFields(value) { fields = [...value]; stateFile.fields = fields; },
      setOrderBy(value, sequence) { order = [...value]; directions = [...sequence]; stateFile.order = order; },
      doSelect(query) {
        stateFile.query = query;
        if (options.entityError && table === 'esdDMentity') return -99;
        selected = rows.filter(predicate(query)); position = 0; return selected.length ? 0 : 1;
      },
      doCount(query) { stateFile.query = query; return options.countError ? -99 : rows.filter(predicate(query)).length; },
      doSelectEx(query, start, count) {
        stateFile.query = query; stateFile.start = start; stateFile.count = count;
        if (options.selectError) return -99;
        selected = rows.filter(predicate(query)).sort((a, b) => {
          for (let i = 0; i < order.length; i++) {
            const field = order[i], comparison = a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0;
            if (comparison) return directions[i] === 1 ? -comparison : comparison;
          }
          return 0;
        }).slice(start - 1, start - 1 + count);
        position = 0; return selected.length ? 0 : 1;
      },
      getNext() { position++; return options.nextError ? -99 : position < selected.length ? 0 : 1; },
      doClose() { stateFile.closed = true; },
    };
    return new Proxy(methods, { get(target, key) {
      if (key in target) return target[key];
      if (['doAdd', 'doUpdate', 'doDelete', 'doAction'].includes(key)) return () => { state.writes++; throw new Error('Write forbidden'); };
      assert.ok(!fields || fields.includes(key), 'Read outside field projection: ' + String(key));
      return selected[position]?.[key] ?? null;
    } });
  }
  const context = vm.createContext({ SCFile, SCFILE_READONLY: 1, RC_SUCCESS: 0, RC_NO_MORE: 1, SCFILE_ASC: 0, SCFILE_DSC: 1,
    lib: {
      ESD_PERMS_RIGHTS: {
        permsRight: () => options.denied ? [] : ['0040040004000001'],
        getUnitByDataPermissions: () => options.permission || { scope: 'QT_PQDL_06' },
      },
      ESD_HTKT_EXPENSE_VENDOR: { expenseImportGetContractParams: () => ({ currentUser: 'ACTOR', unitLv1: 'SERVER_UNIT', scope: 'SERVER_SCOPE', status: 'Dang thuc hien', initialRole: 'kttc' }) },
      ESD_HTKT_PAYMENT_CREATE_REQUEST: { listPurchaseContracts: input => { state.legacy.push(JSON.parse(input.queryString)); return { success: true, data: [{ id: 'S2-ID' }], totalCount: 1 }; } },
    },
  });
  vm.runInContext(source, context);
  // Chạy đúng khai báo S2 đang có hiệu lực để so sánh kết quả, không mô phỏng lại chính sách quyền.
  const s2Source = fs.readFileSync(path.join(smRoot, 'ESD_HTKT_PAYMENT_CREATE_REQUEST.js'), 'utf8');
  const s2Ast = ts.createSourceFile('S2.js', s2Source, ts.ScriptTarget.Latest, true);
  const s2Functions = new Map(s2Ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name)
    .map(node => [node.name.text, node.getText(s2Ast)]));
  const s2Context = vm.createContext({ SCFile, SCFILE_READONLY: 1, RC_SUCCESS: 0, RC_NO_MORE: 1,
    SCFILE_ASC: 0, SCFILE_DSC: 1, print() {}, escapeQueryValue: context.expenseContractQuote });
  vm.runInContext(['listPurchaseContracts', 'mapRowToObject', 'htktCreatePay_resolveCurrentUser',
    'htktCreatePay_normalizeValue', 'escapeSmQueryValue'].map(name => s2Functions.get(name)).join('\n'), s2Context);
  const s2 = params => plain(s2Context.listPurchaseContracts({ queryString: JSON.stringify({
    currentUser: 'ACTOR', status: 'Dang thuc hien', count: 100, ...params }) }));
  const list = params => plain(context.listExpenseXdcbContracts({ details: { currentUser: 'ACTOR', ...params } }));
  const route = params => plain(context.listExpenseContracts({ details: { currentUser: 'ACTOR', paymentId: 'DC.TEST', ...params } }));
  function clean() { assert.equal(state.writes, 0); assert.ok(state.files.every(file => file.closed)); }
  return { state, context, list, route, clean, s2 };
}

let checks = 0;
function test(name, run) { run(); checks++; }
test('server pagination and eligible records', () => {
  const h = setup(); const result = h.list({ start: 6, count: 5 });
  assert.equal(result.success, true); assert.equal(result.totalCount, 14);
  assert.deepEqual(result.data.map(row => row.id), fixtures.slice(5, 10).map(row => row.id));
  assert.equal(result.hasMore, true); assert.equal(result.data[0].contractCode, 'S4-06');
  const files = h.state.files.filter(file => file.table === 'esdXDCBrepairProjectCtr');
  assert.equal(files[0].query, files[1].query); assert.equal(files[1].start, 6); assert.equal(files[1].count, 5); h.clean();
});
for (const [params, total] of [[{ projectType: 'REPAIR' }, 7], [{ projectType: 'CONSTRUCTION' }, 7],
  [{ effectiveDateFrom: '2026-10-27', effectiveDateTo: '2026-10-27' }, 14], [{ contractId: 'S4-03' }, 1],
  [{ contractCode: 'S4-03' }, 1], [{ keyword: 's4-03' }, 1], [{ keyword: 'HD-03' }, 0],
  [{ keyword: 'đồng 14' }, 1], [{ start: 99 }, 14]]) {
  test('filters ' + JSON.stringify(params), () => { const h = setup(); const r = h.list(params); assert.equal(r.success, true); assert.equal(r.totalCount, total); if (params.start === 99) assert.equal(r.data.length, 0); h.clean(); });
}
for (const scope of ['QT_PQDL_01', 'QT_PQDL_02', 'QT_PQDL_03', 'QT_PQDL_04', 'QT_PQDL_05', 'UNKNOWN']) {
  test('scope follows S2 contact LV1 and ignores caller/permission unit list: ' + scope, () => {
    const h = setup({ rows: fixtures, permission: { scope, unit: ['U2'] } });
    const r = h.list({ scope: 'QT_PQDL_06', unitLv1: 'OTHER', count: 100 });
    const old = h.s2({ scope, unitLv1: 'U1' });
    assert.equal(r.success, true); assert.equal(old.success, true);
    assert.equal(r.totalCount, 7); assert.deepEqual(r.data.map(row => row.id), old.data.map(row => row.id)); h.clean();
  });
}

const scopeRows = fixtures.map((row, i) => ({ ...row,
  'unit.level1': i < 5 ? '099922000' : i < 10 ? '099917000' : 'U1',
  'responsible.officer': i % 2 ? 'OTHER' : 'ACTOR', 'created.by': 'ACTOR' }));
for (const scenario of [
  { name: 'KTTC headquarters mapped', scope: 'QT_PQDL_04', unit: '099922000', mapped: true },
  { name: 'KTTC headquarters unmapped keeps S2 1=1', scope: 'QT_PQDL_04', unit: '099922000' },
  { name: 'inactive entity is not a mapping', scope: 'QT_PQDL_04', unit: '099922000', entityStatus: 'INACTIVE' },
  { name: 'wrong entity is not a mapping', scope: 'QT_PQDL_04', unit: '099922000', entityCode: 'OTHER' },
  { name: 'DMMS global still requires responsible officer', scope: 'QT_PQDL_06', unit: 'U1', dmms: true },
  { name: 'DMMS own branch', scope: 'QT_PQDL_01', unit: 'U1', dmms: true },
  { name: 'DMMS headquarters mapped', scope: 'QT_PQDL_04', unit: '099922000', mapped: true, dmms: true },
  { name: 'DMMS headquarters unmapped still requires responsible officer', scope: 'QT_PQDL_04', unit: '099922000', dmms: true },
  { name: 'DMMS-created request at KTTC uses KTTC scope', scope: 'QT_PQDL_06', unit: 'U1', checker: true },
  { name: 'global user does not require LV1', scope: 'QT_PQDL_06', unit: '' },
]) {
  test('actual S2/S4 permission parity: ' + scenario.name, () => {
    const parent = scenario.dmms ? { 'initial.role': 'dmms', 'current.phase': 'initial_dmms' }
      : scenario.checker ? { 'initial.role': 'dmms', 'created.by': 'DMMS_CREATOR', 'user.checker.kttc': 'ACTOR' } : {};
    const entities = scenario.mapped || scenario.entityStatus || scenario.entityCode ? [{
      'ps.code': scenario.unit, status: scenario.entityStatus || 'ACTIVE', 'entity.code': scenario.entityCode || '1010098' }] : [];
    const h = setup({ rows: scopeRows, parent, entities,
      contacts: [{ 'contact.name': 'ACTOR', 'lv1.id': scenario.unit }],
      permission: { scope: scenario.scope, unit: ['ATTACKER_UNIT'] } });
    const r = h.route({ count: 100, initialRole: 'kttc', scope: 'QT_PQDL_06', unitLv1: 'ATTACKER_UNIT' });
    const old = h.s2({ scope: scenario.scope, unitLv1: scenario.unit, initialRole: scenario.dmms ? 'dmms' : 'kttc' });
    assert.equal(r.success, true, r.message); assert.equal(old.success, true, old.message);
    assert.equal(r.totalCount, old.totalCount);
    assert.deepEqual(r.data.map(row => row.id), old.data.map(row => row.id));
    const queries = h.state.files.filter(file => file.table === 'esdXDCBrepairProjectCtr');
    assert.equal(queries[0].query, queries[1].query);
    if (scenario.dmms) assert.ok(r.data.every(row => row.responsibleOfficer === 'ACTOR'));
    h.clean();
  });
}

test('mapping lookup failure does not become the legitimate unmapped fallback', () => {
  const h = setup({ entityError: true, contacts: [{ 'contact.name': 'ACTOR', 'lv1.id': '099922000' }],
    permission: { scope: 'QT_PQDL_04' } });
  const r = h.route({});
  assert.equal(r.success, false); assert.equal(r.errorCode, 'CONTRACT_SCOPE_QUERY_FAILED'); h.clean();
});

test('DMMS cannot fetch or import another officer contract by ID with a fake role', () => {
  const h = setup({ rows: scopeRows, parent: { 'initial.role': 'dmms', 'current.phase': 'initial_dmms' } });
  const detail = h.context.getExpenseXdcbContract({ details: { currentUser: 'ACTOR', paymentId: 'DC.TEST',
    contractId: 'S4-02', initialRole: 'kttc' } });
  assert.equal(detail.success, false); assert.equal(detail.errorCode, 'CONTRACT_NOT_AVAILABLE');
  const imported = h.list({ paymentId: 'DC.TEST', contractId: 'S4-02', initialRole: 'kttc' });
  assert.equal(imported.success, true); assert.equal(imported.totalCount, 0); h.clean();
});

for (const parent of [{ 'original.contract.category': 'HHDV' }, { 'transaction.type': 'Thanh toán' }]) {
  test('direct selection context rejects wrong-source requests', () => {
    const h = setup({ parent });
    const r = h.list({ paymentId: 'DC.TEST', initialRole: 'kttc' });
    assert.equal(r.success, false); h.clean();
  });
}

test('reading filter context adds no phase permission; existing picker guard still rejects closed/foreign requests', () => {
  for (const parent of [{ 'current.phase': 'approved' }, { 'created.by': 'OTHER' }]) {
    const h = setup({ parent });
    assert.equal(h.list({ paymentId: 'DC.TEST' }).success, true);
    const r = h.route({});
    assert.equal(r.success, false); assert.equal(r.errorCode, 'EXPENSE_NOT_EDITABLE'); h.clean();
  }
});

for (const params of [{ start: 0 }, { count: -1 }, { start: 1.1 }, { count: 1e20 }, { sortField: '__proto__' },
  { sortField: 'id; DROP' }, { sortOrder: 'bad' }, { projectType: 'KMS' }, { effectiveDateFrom: '2026-02-30' },
  { effectiveDateFrom: '2026-10-28', effectiveDateTo: '2026-10-27' }]) {
  test('reject invalid input', () => { const h = setup(); assert.equal(h.list(params).success, false); h.clean(); });
}
for (const options of [{ denied: true }, { contacts: [] }, { contacts: [{ 'contact.name': 'ACTOR' }, { 'contact.name': 'ACTOR' }] },
  { contacts: [{ 'contact.name': 'ACTOR' }], permission: { scope: 'QT_PQDL_04', unit: ['U1'] } },
  { countError: true }, { selectError: true }, { nextError: true }]) {
  test('fail closed and close files', () => { const h = setup(options); assert.equal(h.list({}).success, false); h.clean(); });
}
test('sorting and count cap', () => { const h = setup(); const r = h.list({ count: 999, sortField: 'contractAmount', sortOrder: 'desc' }); assert.equal(r.count, 100); assert.equal(r.data[0].id, 'S4-14'); h.clean(); });
test('detail uses id for both displayed contract code and permission lookup', () => { const h = setup(); const r = plain(h.context.getExpenseXdcbContract({ details: { currentUser: 'ACTOR', contractId: 'S4-02' } })); assert.equal(r.data.id, 'S4-02'); assert.equal(r.data.contractCode, 'S4-02'); h.clean(); });
test('detail does not fall back to business code', () => { const h = setup(); const r = h.context.getExpenseXdcbContract({ details: { currentUser: 'ACTOR', contractId: 'HD-02' } }); assert.equal(r.success, false); assert.equal(r.data, null); h.clean(); });

test('picker ignores caller status and excludes completed contracts from rows and total', () => {
  const h = setup(); const r = h.route({ status: 'Hoàn thành', count: 100 });
  assert.equal(r.success, true); assert.equal(r.totalCount, 14);
  assert.equal(r.data.length, 14);
  assert.ok(r.data.every(row => row.status === 'Đang thực hiện'));
  h.clean();
});

for (const row of invalidRows.filter(row => row.status !== 'Đang thực hiện')) {
  test('detail rejects ineligible status: ' + row.id, () => {
    const h = setup();
    const r = h.context.getExpenseXdcbContract({ details: { currentUser: 'ACTOR', contractId: row.id } });
    assert.equal(r.success, false); assert.equal(r.errorCode, 'CONTRACT_NOT_AVAILABLE');
    assert.equal(r.data, null); h.clean();
  });
}

test('detail rechecks status after a contract was selected in the picker', () => {
  const rows = fixtures.map(row => ({ ...row })); const h = setup({ rows });
  assert.equal(h.list({ contractId: 'S4-01' }).totalCount, 1);
  rows[0].status = 'Hoàn thành';
  const r = h.context.getExpenseXdcbContract({ details: { currentUser: 'ACTOR', contractId: 'S4-01' } });
  assert.equal(r.success, false); assert.equal(r.errorCode, 'CONTRACT_NOT_AVAILABLE'); h.clean();
});
test('HHDV router preserves S2 delegation and server actor context', () => {
  const h = setup({ parent: { 'original.contract.category': 'HHDV', 'contract.category': 'XDCB' } }); const r = h.route({ start: 6, count: 5, scope: 'ATTACKER', unitLv1: 'ATTACKER' });
  assert.equal(r.contractCategory, 'HHDV'); assert.equal(r.data[0].id, 'S2-ID');
  assert.equal(h.state.legacy[0].scope, 'SERVER_SCOPE'); assert.equal(h.state.legacy[0].unitLv1, 'SERVER_UNIT');
  assert.equal(h.state.legacy[0].start, 6); assert.ok(!h.state.files.some(file => file.table === 'esdXDCBrepairProjectCtr')); h.clean();
});
test('empty original category is HHDV and ignores old field', () => { const h = setup({ parent: { 'original.contract.category': null, 'contract.category': 'XDCB' } }); assert.equal(h.route({}).contractCategory, 'HHDV'); h.clean(); });
test('XDCB router derives source from persisted parent and normalizes picker shape', () => {
  const h = setup(); const r = h.route({ contractCategory: 'HHDV', start: 1, count: 5 });
  assert.equal(r.contractCategory, 'XDCB'); assert.equal(h.state.legacy.length, 0);
  assert.equal(r.data[0].id, 'S4-01'); assert.equal(r.data[0]['contract.no'], 'S4-01'); assert.equal(r.data[0].totalValue, 100); h.clean();
});
for (const parent of [{ id: 'OTHER' }, { 'transaction.type': 'Thanh toán' }, { 'original.contract.category': 'BAD' },
  { 'current.phase': 'approval_kttc' }, { 'created.by': 'OTHER', 'user.checker.kttc': 'OTHER' }]) {
  test('router rejects invalid or uneditable expense', () => { const h = setup({ parent }); assert.equal(h.route({}).success, false); assert.equal(h.state.legacy.length, 0); h.clean(); });
}

// Exercise the actual dispatcher, including the unchanged TT action.
test('dispatcher isolates DC actions from TT', () => {
  const h = setup(); const input = { name: 'listExpenseContracts', queryString: JSON.stringify({ currentUser: 'ACTOR', paymentId: 'DC.TEST' }) };
  h.context.vars = { '$L.file': input }; h.context.system = { functions: { tod: () => 0 } };
  h.context.lib.ESD_HTKT_EXPENSE_CONTRACT = h.context;
  const dispatcher = fs.readFileSync(path.join(smRoot, 'ESD_ApiCustomScript_HTKT.js'), 'utf8'); vm.runInContext(dispatcher, h.context);
  assert.equal(JSON.parse(input.queryReturn).contractCategory, 'XDCB');
  input.name = 'listPurchaseContracts'; input.queryString = '{}'; h.context.run();
  assert.equal(JSON.parse(input.queryReturn).data[0].id, 'S2-ID'); h.clean();
});

(async () => {
  const module = { exports: {} }; const calls = []; let securityFails = false;
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/services/HachToanKeToan/DuChi/ThongTinMonDuChi/xdcbContracts.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '@/services/common') return { callCustomAPIHTKT: async (action, payload) => {
      calls.push({ action, payload }); return { success: true, data: action === 'getExpenseXdcbContract' ? { id: payload.contractId, source: 'S4' } : [], totalCount: 0, contractCategory: 'XDCB' };
    } };
    if (name.includes('essSecurityContext')) return { requireEssSecurityContext: async () => { if (securityFails) throw new Error('NO_SESSION'); return { currentUser: 'SERVER_ACTOR' }; } };
    throw new Error(name);
  }, module, module.exports);
  const server = module.exports;
  assert.equal((await server.getDuChiContracts('DC.TEST', { start: 1, count: 5, currentUser: 'ATTACKER', contractCategory: 'HHDV' })).success, true);
  assert.equal(calls[0].payload.currentUser, 'SERVER_ACTOR'); assert.equal('contractCategory' in calls[0].payload, false);
  assert.equal((await server.getDuChiXdcbContract('S4-01')).data.id, 'S4-01');
  assert.equal((await server.getDuChiContracts('TT.TEST', { start: 1, count: 5 })).success, false);
  securityFails = true; const before = calls.length;
  assert.equal((await server.getDuChiXdcbContracts()).success, false); assert.equal(calls.length, before);
  console.log('PASS: ' + checks + ' SM contract cases plus server identity validation; read-only S4, S2 delegation, filters, pagination, scope, failures and dispatcher.');
})().catch(error => { console.error(error); process.exitCode = 1; });
