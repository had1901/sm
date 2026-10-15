/** Tự động sinh và đồng bộ bút toán tạm ứng trong esdHTKTprepaymentEntry. */

// Entry point
function run() {
  try {
    var input = vars['$L.file'];
    if (!input) return;

    var name = input.name;
    if (!name) {
      input.queryReturn = JSON.stringify({
        success: false,
        error: 'Missing action "name"'
      });
      return;
    }

    var result;

    switch (name) {
      // Danh sach hach toan
      case 'getListPrepaymentEntry':
        result = getListPrepaymentEntryByInputDetails(input);
        break;

      // Sinh but toan tu dong
      case 'syncPrepaymentEntry':
        result = syncPrepaymentEntryNowByInputDetails(input);
        break;

      // Sinh but toan tu dong khi nguon sinh thay doi
      case 'syncPrepaymentEntryBySourceChange':
        result = syncPrepaymentEntryBySourceChange(
          safeString(input.sourceTable).trim(),
          input
        );
        break;

      // Luu chinh sua
      case 'savePrepaymentEntryEdit':
        result = savePrepaymentEntryEdit(input);
        break;

      // Lay tai khoan tam ung, GL
      case 'getListGlAccount':
        result = getListGlAccount();
        break;

      default:
        result = {
          success: false,
          error: 'Hanh dong (name) khong hop le: ' + name
        };
    }

    input.queryReturn = JSON.stringify(result);
  } catch (e) {
    if (vars['$L.file']) {
      vars['$L.file'].queryReturn = JSON.stringify({
        success: false,
        error: 'Gateway Error: ' + e.toString()
      });
    }
  }
}

// Tables and business codes
var TABLE_PREPAYMENT_ENTRY = 'esdHTKTprepaymentEntry';       // Bảng chứa dòng bút toán tạm ứng
var TABLE_PREPAYMENT = 'esdHTKTprepayment';                 // Bảng đơn tạm ứng chính
var TABLE_PREPAYMENT_VENDOR = 'esdHTKTprepaymentVendor';   // Bảng NCC đính kèm trong đơn tạm ứng
var TABLE_PREPAYMENT_INVOICE = 'esdHTKTprepaymentInvoice'; // Bảng hóa đơn đính kèm đơn tạm ứng
var TABLE_INVOICE = 'esdHTKTinvoice';                       // Bảng thông tin hóa đơn
var TABLE_VENDOR = 'esdHTKTvendor';                         // Bảng danh mục Nhà cung cấp
var TABLE_VENDOR_SITE = 'esdHTKTvendorSite';               // Bảng danh mục Địa điểm NCC
var TABLE_CATEGORY_ITEM = 'esdDMcategoryItems';             // Bảng thành phần danh mục
var TABLE_GL_ACCOUNT = 'esdDMglAccount';                    // Bảng danh mục tài khoản GL

var TABLE_CONTACT = 'contacts';
var TABLE_ENTITY = 'esdDMentity';
var TABLE_ORG_UNIT = 'esdQTorgUnit';
var TABLE_BANK = 'esdDMbank';
var TABLE_COST_CENTER = 'esdDMcostCenter';
var ENTITY_STATUS_ACTIVE = 'ACTIVE';

var ENTRY_TYPE = {
  AP: 'AP',
  GL: 'GL'
};

var LEGACY_ADDITIONAL_TYPE = 'additional';

var AUTO_ENTRY_CODE = {
  ADVANCE: 'TU-BT-01',
  TAX: 'TU-BT-02',
  PAYMENT: 'TU-BT-03'
};

var LEDGER_TYPE = {
  PREPAYMENT: 'Prepayment',
  STANDARD: 'Standard'
};

var ACCOUNT_TYPE = {
  DEBIT: 'DEBIT',
  ASSET: 'ASSET'
};

var GENERATION_PHASE = {
  DMMS: 'initial_dmms',
  KTTC: 'initial_kttc'
};

var CATEGORY_TAX_ACCOUNT_NUMBER = 'dmhtkt_stk_loai_khau_tru';
var DEDUCTION_TYPE_FULL = 'KHAUTRU_001';
var DEDUCTION_TYPE_RATE = 'KHAUTRU_002';
var DEDUCTION_TYPE_NONE = 'KHAUTRU_003';
var CASH_PAYMENT_ACCOUNT_NUMBER = '101110100';
var CASH_PAYMENT_ACCOUNT_NAME = 'Tiền mặt, vàng tiền tệ tại đơn vị';
var GL_UNIT_TRANSACTION_CODE = '98';
var GL_DEFAULT_ENTITY_CODE = '0000000';
var GL_DEFAULT_BRANCH_CODE = '000';
var GL_DEFAULT_COST_CENTER = '000000';
var GL_DEFAULT_TRANSACTION_OFFICE = '0000000';
var GL_UNIT_PREFERRED_PS_CODE = {
  '1010098': '99901000'
};

// Load and synchronize entries
/** Lấy bút toán đã lưu hoặc sinh mới khi chưa có dữ liệu. */
function getListPrepaymentEntryByInputDetails(input) {
  var params = getInputDetails(input);
  var prepaymentId = safeString(params.prepaymentId).trim();

  if (!prepaymentId) {
    return makeResult([], 'empty', {
      canGenerate: false,
      message: 'Đề nghị đang để trống trường Mã đề nghị. Vui lòng kiểm tra lại.',
      errors: ['Đề nghị đang để trống trường Mã đề nghị. Vui lòng kiểm tra lại.']
    });
  }

  var request = getPrepaymentRequest(prepaymentId);
  var currentPhase = request.current_phase;
  var userCheckerKttc = request.user_checker_kttc;
  var initialRole = request.initial_role;
  var createdBy = request.created_by;
  var additionalUnit = getCreatorAccountingUnit(createdBy);
  var glUnitOptions = getGlUnitOptions();
  var glCostCenterOptions = getGlCostCenterOptions();
  var creatorTransactionOfficeOptions = getTransactionOfficeOptions(additionalUnit.lv1Id);
  var transactionOfficeOptions = getGlTransactionOfficeOptions();
  var defaultTransactionOfficeCode = getDefaultTransactionOfficeCode(creatorTransactionOfficeOptions);
  var savedEntries = getSavedPrepaymentEntries(prepaymentId);
  var responseMeta = {
    currentPhase: currentPhase,
    userCheckerKttc: userCheckerKttc,
    initialRole: initialRole,
    createdBy: createdBy,
    // trưởng thêm: UI GL dùng entity.code để chọn đúng Đơn vị của tài khoản khởi tạo.
    additionalUnitCode: additionalUnit.entityCode || additionalUnit.code,
    additionalUnitName: additionalUnit.name,
    glUnitOptions: glUnitOptions,
    glCostCenterOptions: glCostCenterOptions,
    transactionOfficeOptions: transactionOfficeOptions,
    defaultTransactionOfficeCode: defaultTransactionOfficeCode
  };

  // Entry đã có thì trả ngay; dữ liệu nguồn được kiểm tra khi trigger gọi sinh lại.
  if (savedEntries.length > 0) {
    applyCreatorUnitToEntries(
      savedEntries,
      additionalUnit.code,
      defaultTransactionOfficeCode,
      creatorTransactionOfficeOptions
    );

    return makeResult(savedEntries, 'saved', responseMeta);
  }

  if (isGenerationPhaseLocked(currentPhase)) {
    responseMeta.locked = true;
    return makeResult([], 'empty', responseMeta);
  }

  // Nếu DB chưa có bút toán -> Tiến hành đồng bộ và sinh mới.
  var generatedResult = syncPrepaymentEntryNowByInputDetails(input);
  copyObject(generatedResult, responseMeta);
  return generatedResult;
}

/** Tính lại dữ liệu nguồn, giữ trường được sửa và đồng bộ entry khi chưa khóa. */
function syncPrepaymentEntryNowByInputDetails(input) {
  var params = getInputDetails(input);
  var prepaymentId = safeString(params.prepaymentId).trim();
  var vendorId = safeString(params.vendorId).trim();

  if (!prepaymentId) {
    return makeResult([], 'empty', {
      canGenerate: false,
      message: 'Đề nghị đang để trống trường Mã đề nghị. Vui lòng kiểm tra lại.',
      errors: ['Đề nghị đang để trống trường Mã đề nghị. Vui lòng kiểm tra lại.']
    });
  }

  var savedEntries = getSavedPrepaymentEntries(prepaymentId);
  var expectedResult = buildExpectedPrepaymentEntries(prepaymentId, vendorId);
  var expectedEntries = expectedResult.rows;
  var canGenerate = expectedResult.canGenerate;
  var generationErrors = expectedResult.errors || [];

  // Nếu dữ liệu thiếu/không đủ điều kiện tự động sinh bút toán -> Giữ nguyên CSDL
  if (!canGenerate) {
    return makeResult(savedEntries, savedEntries.length > 0 ? 'saved' : 'empty', makeGenerationErrorMeta(generationErrors));
  }

  if (isGenerationPhaseLocked(expectedResult.currentPhase)) {
    return makeResult(savedEntries, savedEntries.length > 0 ? 'saved' : 'empty', {
      locked: true,
      currentPhase: expectedResult.currentPhase
    });
  }

  // NCC cuoi cung da bi xoa: xoa but toan AP tu sinh, giu nguyen but toan GL bo sung.
  if (expectedEntries.length === 0) {
    var cleared = replaceAutoPrepaymentEntries(prepaymentId, []);

    return makeResult(getSavedPrepaymentEntries(prepaymentId), 'synced', { sync: cleared });
  }

  // Lần đầu tiên sinh bút toán (DB rỗng) -> Chèn mới hoàn toàn
  if (savedEntries.length === 0) {
    assignNewEntryIds(prepaymentId, expectedEntries, savedEntries);
    var inserted = insertPrepaymentEntries(expectedEntries);

    return makeResult(getSavedPrepaymentEntries(prepaymentId), 'generated', {
      sync: {
        inserted: inserted,
        updated: 0,
        deleted: 0
      }
    });
  }

  // Gộp thông tin người dùng đã chỉnh sửa trên UI (description, account_number) vào bút toán mới
  var mergedExpectedEntries = mergeEditableAutoEntryFields(savedEntries, expectedEntries);
  assignNewEntryIds(prepaymentId, mergedExpectedEntries, savedEntries);

  // Tiến hành xóa bút toán cũ và chèn lại bộ bút toán đã merge mới
  var syncResult = replaceAutoPrepaymentEntries(prepaymentId, mergedExpectedEntries);

  return makeResult(getSavedPrepaymentEntries(prepaymentId), 'synced', { sync: syncResult });
}

// Synchronize source changes
/** Đồng bộ các đề nghị chịu ảnh hưởng sau khi bản ghi nguồn được lưu. */
function syncPrepaymentEntryBySourceChange(sourceTable, sourceRecord) {
  var source = sourceRecord || {};

  var prepaymentIds = resolvePrepaymentIdsFromSourceChange(sourceTable, source);
  var results = [];
  var errors = [];

  // Duyệt qua tất cả các mã đơn tạm ứng bị ảnh hưởng để đồng bộ lại
  for (var i = 0; i < prepaymentIds.length; i++) {
    var syncResult = syncPrepaymentEntryNowByInputDetails({
      prepaymentId: prepaymentIds[i],
      vendorId: ''
    });

    results.push(syncResult);

    if (syncResult.canGenerate === false) {
      var syncErrors = syncResult.errors || [];
      if (syncErrors.length > 0) {
        for (var errorIndex = 0; errorIndex < syncErrors.length; errorIndex++) {
          errors.push(prepaymentIds[i] + ': ' + syncErrors[errorIndex]);
        }
      } else if (syncResult.message) {
        errors.push(prepaymentIds[i] + ': ' + syncResult.message);
      }
    }
  }

  if (prepaymentIds.length === 0) {
    errors.push('Không xác định được mã đề nghị tạm ứng từ dữ liệu nguồn.');
  }

  errors = makeUniqueTextList(errors);

  var response = {
    success: true,
    mode: 'source-change-sync',
    sourceTable: sourceTable || '',
    affectedPrepaymentIds: prepaymentIds,
    results: results,
    canGenerate: errors.length === 0
  };

  if (errors.length > 0) {
    response.message = errors.join(' ');
    response.errors = errors;
  }

  return response;
}

/** Tìm các prepaymentId chịu ảnh hưởng theo bảng nguồn. */
function resolvePrepaymentIdsFromSourceChange(sourceTable, sourceRecord) {
  var table = normalizeSourceTableName(sourceTable);

  if (table === normalizeSourceTableName(TABLE_PREPAYMENT)) {
    return makeUniqueTextList([readText(sourceRecord, 'id')]);
  }

  if (table === normalizeSourceTableName(TABLE_PREPAYMENT_VENDOR)) {
    return makeUniqueTextList([readText(sourceRecord, 'prepayment.id')]);
  }

  if (table === normalizeSourceTableName(TABLE_PREPAYMENT_INVOICE)) {
    var directPrepaymentId = readText(sourceRecord, 'prepayment.id');
    if (directPrepaymentId) return makeUniqueTextList([directPrepaymentId]);

    return getPrepaymentIdsByInvoiceId(readText(sourceRecord, 'invoice.id'));
  }

  if (table === normalizeSourceTableName(TABLE_INVOICE)) {
    return getPrepaymentIdsByInvoiceId(readText(sourceRecord, 'id'));
  }

  if (table === normalizeSourceTableName(TABLE_VENDOR)) {
    return getPrepaymentIdsByVendorId(readText(sourceRecord, 'id'));
  }

  if (table === normalizeSourceTableName(TABLE_VENDOR_SITE)) {
    return getPrepaymentIdsByVendorSite(sourceRecord);
  }

  return [];
}

function normalizeSourceTableName(value) {
  return safeString(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getPrepaymentIdsByInvoiceId(invoiceId) {
  var safeInvoiceId = safeString(invoiceId);
  if (!safeInvoiceId) return [];

  return getPrepaymentIdsFromTable(
    TABLE_PREPAYMENT_INVOICE,
    'invoice.id="' + escapeQueryValue(safeInvoiceId) + '"'
  );
}

function getPrepaymentIdsByVendorId(vendorId) {
  var safeVendorId = safeString(vendorId).trim();
  if (!safeVendorId) return [];

  return getPrepaymentIdsFromTable(
    TABLE_PREPAYMENT_VENDOR,
    'vendor.id="' + escapeQueryValue(safeVendorId) + '"'
  );
}

function getPrepaymentIdsByVendorSite(sourceRecord) {
  var vendorSiteId = readText(sourceRecord, 'id');
  if (!vendorSiteId) return [];

  return getPrepaymentIdsFromTable(
    TABLE_PREPAYMENT_VENDOR,
    'vendor.site.id="' + escapeQueryValue(vendorSiteId) + '"'
  );
}

function getPrepaymentIdsFromTable(tableName, query) {
  return makeUniqueTextList(
    selectMappedList(tableName, query, function (record) {
      return readText(record, 'prepayment.id');
    })
  );
}

// Input and response
function getInputDetails(input) {
  var parsed = {};

  copyObject(parsed, parseJsonObject(input.queryString));
  copyObject(parsed, parseJsonObject(input.details));

  if (!parsed.prepaymentId) parsed.prepaymentId = input.prepaymentId || input.id;
  if (!parsed.vendorId && input.vendorId) parsed.vendorId = input.vendorId;
  if (!parsed.entries && input.entries) parsed.entries = input.entries;

  return parsed;
}

function copyObject(target, source) {
  if (!source) return target;

  for (var key in source) {
    if (hasOwn(source, key)) target[key] = source[key];
  }

  return target;
}

function parseJsonObject(value) {
  if (!value) return null;

  try {
    var parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

// Parse danh sách entry gửi từ popup.
function parseJsonArray(value) {
  if (isArray(value)) return value;
  if (!value) return null;

  try {
    var parsed = JSON.parse(value);
    return isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

function makeResult(rows, mode, meta) {
  var data = rows || [];
  var result = {
    success: true,
    mode: mode,
    data: data
  };

  return copyObject(result, meta);
}

function makeError(message) {
  return {
    success: false,
    error: message
  };
}

function makeGenerationErrorMeta(errors) {
  var uniqueErrors = makeUniqueTextList(errors || []);

  return {
    canGenerate: false,
    message: uniqueErrors.length > 0 ? uniqueErrors.join(' ') : 'Không đủ dữ liệu để sinh bút toán.',
    errors: uniqueErrors
  };
}

// Lưu các entry đã chỉnh sửa từ popup.
function savePrepaymentEntryEdit(input) {
  var params = getInputDetails(input);
  var prepaymentId = safeString(params.prepaymentId).trim();
  var entries = parseJsonArray(params.entries);

  if (!prepaymentId) return makeError('Missing prepaymentId.');
  if (!entries) return makeError('Missing entries array.');

  var request = getPrepaymentRequest(prepaymentId);
  var previousEntries = getSavedPrepaymentEntries(prepaymentId);
  if (!isAccountingEditablePhase(request.current_phase)) {
    return makeError('Giai đoạn hiện tại không cho phép chỉnh sửa bút toán.');
  }
  // Chỉ KTTC khởi tạo hoặc KTTC được phân công mới được lưu chỉnh sửa.
  var isKttcCreator =
    normalizeText(request.initial_role) === 'kttc' &&
    isSameUser(request.created_by, params.currentUser);
  var isAssignedKttc = isSameUser(request.user_checker_kttc, params.currentUser);

  if (!isKttcCreator && !isAssignedKttc) {
    return makeError('Chỉ cán bộ KTTC khởi tạo hoặc được phân công mới được chỉnh sửa hạch toán.');
  }

  var normalized = normalizeEditedEntries(prepaymentId, entries, previousEntries);
  if (!normalized.success) return normalized;

  if (normalized.entries.length === 0) {
    var deletedAll = deletePrepaymentEntries(prepaymentId);

    return {
      success: true,
      mode: 'saved',
      prepaymentId: prepaymentId,
      deleted: deletedAll,
      inserted: 0,
      data: []
    };
  }

  var creatorUnit = getCreatorAccountingUnit(request.created_by);
  var creatorTransactionOfficeOptions = getTransactionOfficeOptions(creatorUnit.lv1Id);
  var defaultTransactionOfficeCode = getDefaultTransactionOfficeCode(creatorTransactionOfficeOptions);

  applyCreatorUnitToEntries(
    normalized.entries,
    creatorUnit.code,
    defaultTransactionOfficeCode,
    creatorTransactionOfficeOptions
  );

  var balanceValidation = validateAccountingBalanceRows(normalized.entries);
  if (!balanceValidation.success) return balanceValidation;

  var deleted = deletePrepaymentEntries(prepaymentId);
  var inserted = insertPrepaymentEntries(normalized.entries);

  if (inserted !== normalized.entries.length) {
    deletePrepaymentEntries(prepaymentId);
    var restored = insertPrepaymentEntries(previousEntries);

    return {
      success: false,
      error: 'Insert failed. Previous entries were restored.',
      prepaymentId: prepaymentId,
      deleted: deleted,
      inserted: inserted,
      restored: restored,
      data: getSavedPrepaymentEntries(prepaymentId)
    };
  }

  return {
    success: true,
    mode: 'saved',
    prepaymentId: prepaymentId,
    deleted: deleted,
    inserted: inserted,
    data: getSavedPrepaymentEntries(prepaymentId)
  };
}

function validateAccountingBalanceRows(rows) {
  if (!rows || rows.length === 0) {
    return makeError('Thông tin hạch toán là bắt buộc.');
  }

  var totalDebit = '0';
  var totalCredit = '0';
  var glGroups = {};

  for (var i = 0; i < rows.length; i++) {
    var accountSide = getAccountingSide(rows[i].account_type);
    var amount = normalizeAmountMinor(rows[i].amount);

    if (!accountSide) {
      return makeError('Bút toán dòng ' + (i + 1) + ' chưa xác định Ghi nợ/Ghi có.');
    }

    if (accountSide === 'debit') totalDebit = addAmountTexts(totalDebit, amount);
    if (accountSide === 'credit') totalCredit = addAmountTexts(totalCredit, amount);

    if (isAdditionalEntryType(rows[i].type)) {
      var glIdParts = getGlEntryIdParts(
        rows[i].prepayment_id,
        rows[i].id
      );
      var glGroupOrder = glIdParts ? glIdParts.groupOrder : 1;
      var glGroupKey = safeString(glGroupOrder);

      if (!glGroups[glGroupKey]) {
        glGroups[glGroupKey] = {
          groupOrder: glGroupOrder,
          totalDebit: '0',
          totalCredit: '0'
        };
      }

      if (accountSide === 'debit') {
        glGroups[glGroupKey].totalDebit = addAmountTexts(glGroups[glGroupKey].totalDebit, amount);
      }
      if (accountSide === 'credit') {
        glGroups[glGroupKey].totalCredit = addAmountTexts(glGroups[glGroupKey].totalCredit, amount);
      }
    }
  }

  for (var glGroupKey in glGroups) {
    if (!hasOwn(glGroups, glGroupKey)) continue;

    var glGroup = glGroups[glGroupKey];
    if (compareAmountTexts(glGroup.totalDebit, glGroup.totalCredit) !== 0) {
      return makeError(
        'Bút toán GL ' +
          glGroup.groupOrder +
          ': tổng ghi nợ phải bằng tổng ghi có.'
      );
    }
  }

  // Validate tổng ghi nợ bằng tổng ghi có khi lưu chỉnh sửa bút toán.
  if (compareAmountTexts(totalDebit, totalCredit) !== 0) {
    return makeError('Tổng ghi nợ phải bằng tổng ghi có.');
  }

  return {
    success: true,
    totalDebit: totalDebit,
    totalCredit: totalCredit
  };
}

function getAccountingSide(value) {
  var accountType = normalizeBusinessValue(value);
  if (accountType === 'no' || accountType === 'debit') return 'debit';
  if (
    accountType === 'asset' ||
    accountType === 'taisan' ||
    accountType === 'co' ||
    accountType === 'credit'
  ) {
    return 'credit';
  }
  return '';
}

function getListGlAccount() {
  var rows;
  try {
    rows = selectMappedList(TABLE_GL_ACCOUNT, 'true', function (record) {
      var account = readText(record, 'account');
      if (!account) return null;

      var accountType = readText(record, 'account.type');
      var type = readText(record, 'type');
      return {
        account: account,
        name: readText(record, 'name'),
        account_type: accountType,
        type: type,
        is_debit_eligible: isDebitEligibleAdvanceAccount(accountType, type),
        apply_currency: readText(record, 'apply.currency')
      };
    });
  } catch (e) {
    return makeError('Cannot read GL account list: ' + e.toString());
  }

  rows.sort(compareGlAccount);

  return {
    success: true,
    mode: 'gl-account-list',
    data: rows
  };
}

function getGlAccountName(accountNumber) {
  var account = safeString(accountNumber).trim();
  if (!account) return '';

  var row = selectOne(
    TABLE_GL_ACCOUNT,
    'account="' + escapeQueryValue(account) + '"',
    function (record) {
      return { name: readText(record, 'name') };
    }
  );

  return row ? row.name : '';
}

function isDebitEligibleAdvanceAccount(accountTypeValue, typeValue) {
  var accountType = normalizeBusinessValue(accountTypeValue);
  var type = normalizeBusinessValue(typeValue);

  return (accountType === 'n' || accountType === 'nc') && type === 'tamung';
}

// Chuẩn hóa và kiểm tra các entry nhận từ popup.
function normalizeEditedEntries(prepaymentId, entries, savedEntries) {
  var result = [];
  var usedIds = {};
  var savedIds = makeEntryIdSet(savedEntries);
  var nextApSequence = getNextApEntryIdSequence(prepaymentId, savedEntries);
  var nextGlRowSequence = getNextGlRowSequence(prepaymentId, 1, savedEntries);

  for (var i = 0; i < entries.length; i++) {
    var row = normalizeEditedEntry(entries[i]);

    if (!savedIds[row.id]) {
      if (isAdditionalEntryType(row.type)) {
        if (!isStructuredGlEntryId(prepaymentId, row.id)) {
          row.id = makeGlEntryId(prepaymentId, 1, nextGlRowSequence++);
        }
      } else {
        row.id = makeApEntryId(prepaymentId, nextApSequence++);
      }
    }

    var validationError = validateEditedEntry(prepaymentId, row, i + 1, usedIds);

    if (validationError) return makeError(validationError);

    usedIds[row.id] = true;
    result.push(row);
  }

  return {
    success: true,
    entries: result
  };
}

function normalizeEditedEntry(raw) {
  var type = safeString(raw.type).trim();
  var isGlEntry = isAdditionalEntryType(type);
  var entryCode = getAutoEntryCode(raw.entry_type);
  var selectedGlEntityCode = safeString(raw.branch_entity_code).trim();
  var selectedGlBranchCode =
    isGlEntry && selectedGlEntityCode === GL_DEFAULT_ENTITY_CODE
      ? GL_DEFAULT_BRANCH_CODE
      : isGlEntry && selectedGlEntityCode
      ? getGlBranchCodeByEntityCode(selectedGlEntityCode)
      : safeString(raw.branch).trim();

  return {
    id: safeString(raw.id).trim(),
    prepayment_id: safeString(raw.prepayment_id).trim(),
    entry_type: isGlEntry || !entryCode ? safeString(raw.entry_type).trim() : entryCode,
    ledger_type: isGlEntry ? ENTRY_TYPE.GL : entryCode ? getAutoLedgerType(entryCode) : safeString(raw.ledger_type).trim(),
    account_type: isGlEntry ? toStoredAccountType(raw.account_type) : entryCode ? getAutoAccountType(entryCode) : safeString(raw.account_type).trim(),
    account_number: safeString(raw.account_number).trim(),
    account_name: safeString(raw.account_name).trim(),
    branch: selectedGlBranchCode,
    department:
      isGlEntry
        ? safeString(raw.department).trim() || GL_DEFAULT_COST_CENTER
        : safeString(raw.department).trim(),
    transaction_office:
      isGlEntry
        ? safeString(raw.transaction_office).trim() || GL_DEFAULT_TRANSACTION_OFFICE
        : safeString(raw.transaction_office).trim(),
    amount: safeString(raw.amount).trim(),
    currency: safeString(raw.currency).trim(),
    description: safeString(raw.description).trim(),
    vendor_id: safeString(raw.vendor_id).trim(),
    type: isGlEntry ? ENTRY_TYPE.GL : ENTRY_TYPE.AP,
    order: toNumber(raw.order),
    accounting_request_id: safeString(raw.accounting_request_id).trim()
  };
}

function validateEditedEntry(prepaymentId, row, index, usedIds) {
  var prefix = 'Invalid entry at index ' + index + ': ';

  if (!row.id) return prefix + 'missing id.';
  if (usedIds[row.id]) return prefix + 'duplicate id ' + row.id + '.';
  if (row.prepayment_id !== prepaymentId) return prefix + 'prepayment_id does not match prepaymentId.';
  if (!isAdditionalEntryType(row.type) && !row.entry_type) return prefix + 'missing entry_type.';
  if (!row.account_number) return prefix + 'missing account_number.';
  if (compareAmountTexts(normalizeAmountMinor(row.amount), '0') <= 0) return prefix + 'amount must be greater than 0.';
  if (!row.currency) return prefix + 'missing currency.';
  if (!row.type) return prefix + 'missing type.';
  if (isAdditionalEntryType(row.type) && !/^[0-9]{3}$/.test(row.branch)) {
    return prefix + 'missing or invalid GL branch.';
  }
  if (!(row.order > 0)) return prefix + 'order must be greater than 0.';

  return '';
}

function isAdditionalEntryType(value) {
  var type = normalizeText(value);
  return type === normalizeText(ENTRY_TYPE.GL) || type === LEGACY_ADDITIONAL_TYPE;
}

function getAutoLedgerType(entryCode) {
  return entryCode === AUTO_ENTRY_CODE.TAX ? LEDGER_TYPE.STANDARD : LEDGER_TYPE.PREPAYMENT;
}

function getAutoAccountType(entryCode) {
  return entryCode === AUTO_ENTRY_CODE.PAYMENT ? ACCOUNT_TYPE.ASSET : ACCOUNT_TYPE.DEBIT;
}

function toStoredAccountType(value) {
  var accountType = normalizeBusinessValue(value);

  if (accountType === 'debit' || accountType === 'no') return ACCOUNT_TYPE.DEBIT;
  if (
    accountType === 'asset' ||
    accountType === 'credit' ||
    accountType === 'co' ||
    accountType === 'taisan'
  ) {
    return ACCOUNT_TYPE.ASSET;
  }

  return safeString(value).trim();
}

function compareGlAccount(a, b) {
  var left = safeString(a.account);
  var right = safeString(b.account);

  if (left === right) return 0;
  return left > right ? 1 : -1;
}

// Build automatic entries
/** Tạo bộ TU-BT-01, TU-BT-02 và TU-BT-03 theo từng NCC. */
function buildExpectedPrepaymentEntries(prepaymentId, vendorId) {
  var request = getPrepaymentRequest(prepaymentId);
  var creatorUnit = getCreatorAccountingUnit(request.created_by);
  var creatorUnitCode = creatorUnit.code;
  var defaultTransactionOfficeCode = getDefaultTransactionOfficeCode(
    getTransactionOfficeOptions(creatorUnit.lv1Id)
  );
  var vendors = getPrepaymentVendors(prepaymentId, vendorId);
  var rows = [];
  var errors = [];
  var canGenerate = true;

  if (!request.id) {
    canGenerate = false;
    errors.push('Không tìm thấy thông tin đề nghị ' + prepaymentId + '. Vui lòng kiểm tra lại.');
  }

  for (var vendorIndex = 0; vendorIndex < vendors.length; vendorIndex++) {
    vendors[vendorIndex] = enrichVendor(vendors[vendorIndex]);
  }

  for (var i = 0; i < vendors.length; i++) {
    var vendor = vendors[i];
    var vendorErrors = getVendorAutoEntryErrors(vendor);

    // Kiểm tra NCC có đủ điều kiện sinh tự động hay không
    if (vendorErrors.length > 0) {
      canGenerate = false;
      errors = errors.concat(vendorErrors);
      continue;
    }

    var taxInfo = getInvoiceTaxInfo(prepaymentId, vendor, vendors.length);
    if (taxInfo.errors.length > 0) {
      canGenerate = false;
      errors = errors.concat(taxInfo.errors);
    }
    var amounts = calculateEntryAmounts(vendor, taxInfo);
    var baseOrder = rows.length + 1;
    var vendorRows = [];

    // 1. Dòng bút toán Tạm ứng (TU-BT-01)
    vendorRows.push(
      buildEntryRow({
        prepaymentId: prepaymentId,
        request: request,
        branch: creatorUnitCode,
        transactionOffice: defaultTransactionOfficeCode,
        vendor: vendor,
        entryCode: AUTO_ENTRY_CODE.ADVANCE,
        amount: amounts.advanceAmount,
        order: baseOrder
      })
    );

    // 2. Dòng bút toán Thuế GTGT (TU-BT-02) theo từng loại khấu trừ
    for (var taxIndex = 0; taxIndex < taxInfo.groups.length; taxIndex++) {
      var taxGroup = taxInfo.groups[taxIndex];

      vendorRows.push(
        buildEntryRow({
          prepaymentId: prepaymentId,
          request: request,
          branch: creatorUnitCode,
          transactionOffice: defaultTransactionOfficeCode,
          vendor: vendor,
          entryCode: AUTO_ENTRY_CODE.TAX,
          amount: taxGroup.amount,
          order: baseOrder + taxIndex + 1,
          taxInfo: taxGroup
        })
      );
    }

    // 3. Dòng bút toán Thanh toán (TU-BT-03)
    vendorRows.push(
      buildEntryRow({
        prepaymentId: prepaymentId,
        request: request,
        branch: creatorUnitCode,
        transactionOffice: defaultTransactionOfficeCode,
        vendor: vendor,
        entryCode: AUTO_ENTRY_CODE.PAYMENT,
        amount: amounts.paymentAmount,
        order: baseOrder + taxInfo.groups.length + 1
      })
    );

    // Kiểm tra tính hợp lệ của các dòng bút toán vừa sinh
    var rowErrors = getAutoEntryRowsErrors(vendorRows);
    if (rowErrors.length > 0) {
      canGenerate = false;
      errors = errors.concat(rowErrors);
      continue;
    }

    rows = rows.concat(vendorRows);
  }

  return {
    rows: rows,
    canGenerate: canGenerate,
    errors: makeUniqueTextList(errors),
    currentPhase: request.current_phase
  };
}

function calculateEntryAmounts(vendor, taxInfo) {
  var vendorAmount = normalizeAmountMinor(vendor.amount);
  var taxAmount = taxInfo.hasDeductibleTax ? taxInfo.totalDeductibleTax : '0';

  return {
    advanceAmount: formatAmountFromMinor(subtractAmountTexts(vendorAmount, taxAmount)),
    paymentAmount: formatAmountFromMinor(vendorAmount)
  };
}

function buildEntryRow(params) {
  var account = resolveAccount(params.entryCode, params.vendor, params.taxInfo || {});

  return {
    id: '',
    prepayment_id: params.prepaymentId,
    entry_type: params.entryCode,
    ledger_type: getAutoLedgerType(params.entryCode),
    account_type: getAutoAccountType(params.entryCode),
    account_number: account.number,
    account_name: account.name,
    branch: safeString(params.branch).trim(),
    department: safeString(params.request.department).trim(),
    transaction_office: safeString(params.transactionOffice).trim(),
    amount: params.amount,
    currency: params.vendor.currency,
    description: resolveEntryDescription(params.entryCode, params.request, params.vendor),
    vendor_id: params.vendor.vendor_id,
    vendor_name: params.vendor.vendor_name,
    type: ENTRY_TYPE.AP,
    order: params.order,
    accounting_request_id: '',
    payment_method: params.vendor.payment_method
  };
}

function resolveEntryDescription(entryCode, request, vendor) {
  if (entryCode === AUTO_ENTRY_CODE.PAYMENT) {
    return safeString(vendor.transaction_description).trim();
  }

  return safeString(request.description).trim();
}

function resolveAccount(entryCode, vendor, taxInfo) {
  if (entryCode === AUTO_ENTRY_CODE.ADVANCE) {
    return {
      number: vendor.debit_account,
      name: getGlAccountName(vendor.debit_account)
    };
  }

  if (entryCode === AUTO_ENTRY_CODE.TAX) {
    return {
      number: taxInfo.accountNumber,
      name: taxInfo.accountName
    };
  }

  if (entryCode === AUTO_ENTRY_CODE.PAYMENT && isBankTransfer(vendor.payment_method)) {
    return {
      number: vendor.beneficiary_account,
      name: vendor.beneficiary_name
    };
  }

  if (entryCode === AUTO_ENTRY_CODE.PAYMENT && isCashPayment(vendor.payment_method)) {
    return {
      number: CASH_PAYMENT_ACCOUNT_NUMBER,
      name: CASH_PAYMENT_ACCOUNT_NAME
    };
  }

  return { number: '', name: '' };
}

function getAutoEntryRowsErrors(rows) {
  var errors = [];

  for (var i = 0; i < rows.length; i++) {
    errors = errors.concat(getAutoEntryRowErrors(rows[i]));
  }

  return makeUniqueTextList(errors);
}

function getAutoEntryRowErrors(row) {
  var errors = [];
  var subject = row.entry_type ? 'Bút toán ' + row.entry_type : 'Bút toán tự động';
  var entryCode = getAutoEntryCode(row.entry_type);
  var vendorLabel = safeString(row.vendor_name).trim() || safeString(row.vendor_id).trim();
  var vendorReference = vendorLabel ? ' của nhà cung cấp ' + vendorLabel : '';

  if (!row.vendor_id) {
    errors.push(subject + ' đang để trống Nhà cung cấp. Vui lòng kiểm tra lại.');
  }

  if (!row.account_number) {
    if (entryCode === AUTO_ENTRY_CODE.ADVANCE) {
      errors.push(subject + vendorReference + ' đang để trống trường Tài khoản ghi nợ. Vui lòng kiểm tra lại.');
    } else if (entryCode === AUTO_ENTRY_CODE.PAYMENT && isBankTransfer(row.payment_method)) {
      errors.push(subject + vendorReference + ' đang để trống trường Số tài khoản thụ hưởng. Vui lòng kiểm tra lại.');
    } else if (entryCode === AUTO_ENTRY_CODE.PAYMENT && isCashPayment(row.payment_method)) {
      errors.push(subject + vendorReference + ' đang để trống trường Tài khoản ghi có. Vui lòng kiểm tra lại.');
    } else {
      errors.push(subject + vendorReference + ' chưa xác định được tài khoản. Vui lòng kiểm tra lại.');
    }
  }

  return errors;
}

function getVendorAutoEntryErrors(vendor) {
  var errors = [];
  var subject = getVendorGenerationSubject(vendor);

  if (!vendor.vendor_id) {
    errors.push('Đề nghị đang để trống Nhà cung cấp. Vui lòng kiểm tra lại.');
  }
  if (!vendor.vendor_site_id) {
    errors.push(subject + ' đang để trống trường Site NCC. Vui lòng kiểm tra lại.');
  }

  // Chỉ kiểm tra dữ liệu Site NCC sau khi đã xác định được Site NCC cần tra cứu.
  if (vendor.vendor_site_id) {
    if (!vendor.vendor_site_code) {
      errors.push(subject + ' đang để trống trường Mã Site NCC. Vui lòng kiểm tra lại.');
    }
  }

  return errors;
}

// Map tên NCC dùng trong thông báo lỗi sinh bút toán.
function getVendorGenerationSubject(vendor) {
  var vendorName = safeString(vendor.vendor_name).trim();
  var vendorId = safeString(vendor.vendor_id).trim();

  if (vendorName) return 'Nhà cung cấp ' + vendorName;
  if (vendorId) return 'Nhà cung cấp ' + vendorId;
  return 'Nhà cung cấp';
}

// Source data
function getPrepaymentRequest(prepaymentId) {
  if (!prepaymentId) return {};

  return (
    selectOne(TABLE_PREPAYMENT, 'id="' + escapeQueryValue(prepaymentId) + '"', function (record) {
      return {
        id: readText(record, 'id'),
        department: readText(record, 'department'),
        description: readText(record, 'description'),
        current_phase: readText(record, 'current.phase'),
        user_checker_kttc: readText(record, 'user.checker.kttc'),
        initial_role: readText(record, 'initial.role'),
        // Dùng để xác định đúng người KTTC khởi tạo.
        created_by: readText(record, 'created.by')
      };
    }) || {}
  );
}

function getCreatorAccountingUnit(createdBy) {
  var creator = safeString(createdBy).trim();
  if (!creator) return { code: '', entityCode: '', name: '', lv1Id: '' };

  var lv1Id = selectOne(
    TABLE_CONTACT,
    'contact.name="' + escapeQueryValue(creator) + '"',
    function (record) {
      return readText(record, 'lv1.id');
    }
  );
  // trưởng thêm: lv1.id chính là ps.code dùng để tìm entity.code; không cắt số 0 đầu.
  var psCode = safeString(lv1Id).trim();
  if (!psCode) return { code: '', entityCode: '', name: '', lv1Id: '' };

  return (
    selectOne(
      TABLE_ENTITY,
      'ps.code="' +
        escapeQueryValue(psCode) +
        '"',
      function (record) {
        return {
          code: normalizeGlBranchCode(readText(record, 'ogl.branch.code')),
          entityCode: readText(record, 'entity.code').trim(),
          name: getBranchNamePrefix(readText(record, 'branch.name')),
          lv1Id: lv1Id
        };
      }
    ) || { code: '', entityCode: '', name: '', lv1Id: lv1Id }
  );
}

/** map danh sách đơn vị segment1 của GL theo org.transaction.code = 98. */
function getGlUnitOptions() {
  var optionMap = {};
  var options = [];
  var fields = [
    ['d.ps.code', 'ps_code', 'S'],
    ['d.entity.code', 'entity_code', 'S'],
    ['d.ogl.branch.code', 'branch_code', 'S'],
    ['d.branch.name', 'branch_name', 'S']
  ];
  var sql =
    'SELECT ' +
    selectFields(fields) +
    ' FROM ' +
    TABLE_ENTITY +
    ' d WHERE d.org.transaction.code="' +
    escapeQueryValue(GL_UNIT_TRANSACTION_CODE) +
    '"';
  var rows;

  try {
    rows = selectList(TABLE_ENTITY, sql, fields);
  } catch (e) {
    return options;
  }

  for (var i = 0; i < rows.length; i++) {
    var psCode = safeString(rows[i].ps_code).trim();
    var entityCode = safeString(rows[i].entity_code).trim();
    var rawBranchCode = safeString(rows[i].branch_code).trim();
    var branchCode = normalizeGlBranchCode(rawBranchCode);
    var matchBranchCode = rawBranchCode;
    var branchName = getBranchNamePrefix(rows[i].branch_name);
    var currentOption = optionMap[entityCode];
    var preferredPsCode = GL_UNIT_PREFERRED_PS_CODE[entityCode] || '';
    var currentIsPreferred =
      preferredPsCode &&
      currentOption &&
      currentOption.psCode === preferredPsCode;
    var candidateIsPreferred =
      preferredPsCode &&
      psCode === preferredPsCode;

    // map entity.code bị trùng theo ps.code ưu tiên; nếu chưa cấu hình thì lấy ps.code nhỏ nhất.
    if (
      entityCode &&
      (
        !currentOption ||
        (candidateIsPreferred && !currentIsPreferred) ||
        (
          !currentIsPreferred &&
          !candidateIsPreferred &&
          (
            (!currentOption.psCode && psCode) ||
            (psCode && currentOption.psCode && psCode < currentOption.psCode)
          )
        )
      )
    ) {
      optionMap[entityCode] = {
        label: entityCode + (branchName ? ' - ' + branchName : ''),
        value: entityCode,
        entityCode: entityCode,
        branchCode: branchCode,
        matchBranchCode: matchBranchCode,
        psCode: psCode
      };
    }
  }

  for (var optionKey in optionMap) {
    if (!hasOwn(optionMap, optionKey)) continue;

    options.push({
      label: optionMap[optionKey].label,
      value: optionMap[optionKey].value,
      entityCode: optionMap[optionKey].entityCode,
      branchCode: optionMap[optionKey].branchCode,
      matchBranchCode: optionMap[optionKey].matchBranchCode
    });
  }

  options.sort(compareGlUnitOption);
  return options;
}

/** map danh sách Phòng ban GL đang ACTIVE theo dbdict esdDMcostCenter mới. */
function getGlCostCenterOptions() {
  var optionMap = {};
  var options = [];
  var rows;

  try {
    rows = selectMappedList(
      TABLE_COST_CENTER,
      'status="' + escapeQueryValue(ENTITY_STATUS_ACTIVE) + '"',
      function (record) {
        return {
          org_code: readText(record, 'org.code'),
          division_code: readText(record, 'division.code'),
          department_code: readText(record, 'department.code'),
          cost_center: readText(record, 'cost.center'),
          name: readText(record, 'name'),
          status: readText(record, 'status')
        };
      }
    );
  } catch (e) {
    return options;
  }

  for (var i = 0; i < rows.length; i++) {
    var orgCode = safeString(rows[i].org_code).trim();
    var divisionCode = safeString(rows[i].division_code).trim();
    var departmentCode = safeString(rows[i].department_code).trim();
    var costCenter = safeString(rows[i].cost_center).trim();
    var name = safeString(rows[i].name).trim();
    var status = safeString(rows[i].status).trim();
    var optionKey =
      orgCode + '|' + divisionCode + '|' + departmentCode + '|' + costCenter;

    if (
      !costCenter ||
      !orgCode ||
      status !== ENTITY_STATUS_ACTIVE ||
      optionMap[optionKey]
    ) continue;

    optionMap[optionKey] = true;
    options.push({
      value: costCenter,
      label: costCenter + (name ? ' - ' + name : ''),
      name: name,
      orgCode: orgCode,
      divisionCode: divisionCode,
      departmentCode: departmentCode,
      status: status
    });
  }

  options.sort(function (left, right) {
    var leftValue = safeString(left.value);
    var rightValue = safeString(right.value);

    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;

    var leftOrgCode = safeString(left.orgCode);
    var rightOrgCode = safeString(right.orgCode);
    if (leftOrgCode < rightOrgCode) return -1;
    if (leftOrgCode > rightOrgCode) return 1;

    var leftDepartmentCode = safeString(left.departmentCode);
    var rightDepartmentCode = safeString(right.departmentCode);
    if (leftDepartmentCode < rightDepartmentCode) return -1;
    if (leftDepartmentCode > rightDepartmentCode) return 1;
    return 0;
  });

  return options;
}

/** map ogl.branch.code về đúng 3 ký tự để lưu vào entry.branch. */
function normalizeGlBranchCode(value) {
  var branchCode = safeString(value).replace(/\s+/g, '').trim();

  if (!/^[0-9]+$/.test(branchCode)) return '';

  while (branchCode.length > 3 && branchCode.charAt(0) === '0') {
    branchCode = branchCode.substring(1);
  }

  if (branchCode.length > 3) return '';

  while (branchCode.length < 3) {
    branchCode = '0' + branchCode;
  }

  return branchCode;
}

/** map entity.code người dùng chọn sang ogl.branch.code để lưu entry.branch. */
function getGlBranchCodeByEntityCode(entityCode) {
  var code = safeString(entityCode).trim();

  if (!code) return '';

  return (
    selectOne(
      TABLE_ENTITY,
      'entity.code="' +
        escapeQueryValue(code) +
        '" and org.transaction.code="' +
        escapeQueryValue(GL_UNIT_TRANSACTION_CODE) +
        '"',
      function (record) {
        return normalizeGlBranchCode(readText(record, 'ogl.branch.code'));
      }
    ) || ''
  );
}

/** map thứ tự hiển thị đơn vị GL theo entity.code. */
function compareGlUnitOption(left, right) {
  var leftCode = safeString(left.entityCode);
  var rightCode = safeString(right.entityCode);

  if (leftCode < rightCode) return -1;
  if (leftCode > rightCode) return 1;
  return 0;
}

function getTransactionOfficeOptions(lv1Id) {
  var lv2Rows = getLv2OrgUnitsByLv1(lv1Id);
  var optionMap = {};
  var options = [];

  for (var i = 0; i < lv2Rows.length; i++) {
    addTransactionOfficeOption(options, optionMap, lv2Rows[i]);
  }

  options.sort(compareTransactionOfficeOption);

  return options;
}

/** map danh sách PGD segment6 của GL theo entity.code; vẫn lưu org.transaction.code và lọc theo ogl.branch.code. */
function getGlTransactionOfficeOptions() {
  var optionMap = {};
  var options = [];
  var fields = [
    ['d.org.transaction.code', 'transaction_code', 'S'],
    ['d.entity.code', 'entity_code', 'S'],
    ['d.ogl.branch.code', 'branch_code', 'S'],
    ['d.branch.name', 'branch_name', 'S']
  ];
  var sql =
    'SELECT ' +
    selectFields(fields) +
    ' FROM ' +
    TABLE_ENTITY +
    ' d WHERE d.status="' +
    escapeQueryValue(ENTITY_STATUS_ACTIVE) +
    '"';
  var rows;

  try {
    rows = selectList(TABLE_ENTITY, sql, fields);
  } catch (e) {
    return options;
  }

  for (var i = 0; i < rows.length; i++) {
    var transactionCode = safeString(rows[i].transaction_code).trim();
    var entityCode = safeString(rows[i].entity_code).trim();
    var branchCode = safeString(rows[i].branch_code).trim();
    var branchName = safeString(rows[i].branch_name).trim();
    var branchNameSeparatorIndex = branchName.indexOf('-');
    var optionKey = branchCode + '|' + transactionCode;

    // map tên PGD bằng phần bên phải dấu "-" trong branch.name.
    if (branchNameSeparatorIndex >= 0) {
      branchName = branchName.substring(branchNameSeparatorIndex + 1).trim();
    }

    if (
      transactionCode &&
      transactionCode !== GL_UNIT_TRANSACTION_CODE &&
      transactionCode !== '00' &&
      branchCode &&
      !optionMap[optionKey]
    ) {
      optionMap[optionKey] = true;
      options.push({
        value: transactionCode,
        label: (entityCode || transactionCode) + (branchName ? ' - ' + branchName : ''),
        entityCode: entityCode,
        name: branchName,
        branchCode: branchCode
      });
    }
  }

  options.sort(compareTransactionOfficeOption);
  return options;
}

function getLv2OrgUnitsByLv1(lv1Id) {
  lv1Id = safeString(lv1Id).trim();
  if (!lv1Id) return [];

  try {
    return selectMappedList(
      TABLE_ORG_UNIT,
      'parent.id="' + escapeQueryValue(lv1Id) + '"',
      function (record) {
        return {
          'unit.id': readText(record, 'unit.id'),
          'unit.name': readText(record, 'unit.name')
        };
      }
    );
  } catch (e) {
    return [];
  }
}

function addTransactionOfficeOption(options, optionMap, lv2Row) {
  var lv2Id = safeString(lv2Row['unit.id']).trim();
  var lv2Name = safeString(lv2Row['unit.name']).trim();
  var entity = getTransactionOfficeByLv2(lv2Id);
  var code = safeString(entity.code).trim();
  var name = lv2Name || safeString(entity.name).trim();
  var psCode = lv2Id;

  if (!code || optionMap[code]) return;

  optionMap[code] = true;
  options.push({
    value: code,
    label: code + (name ? ' - ' + name : ''),
    name: name,
    psCode: psCode
  });
}

function getTransactionOfficeByLv2(lv2Id) {
  var psCode = safeString(lv2Id).trim();
  if (!psCode) return { code: '', name: '' };

  try {
    return (
      selectOne(
        TABLE_ENTITY,
        'ps.code="' +
          escapeQueryValue(psCode) +
          '" and status="' +
          escapeQueryValue(ENTITY_STATUS_ACTIVE) +
          '"',
        function (record) {
          return {
            code: readText(record, 'org.transaction.code').trim(),
            name: getBranchNamePrefix(readText(record, 'branch.name'))
          };
        }
      ) || { code: '', name: '' }
    );
  } catch (e) {
    return { code: '', name: '' };
  }
}

function compareTransactionOfficeOption(left, right) {
  var leftPsCode = safeString(left.psCode);
  var rightPsCode = safeString(right.psCode);

  if (leftPsCode < rightPsCode) return -1;
  if (leftPsCode > rightPsCode) return 1;

  var leftValue = safeString(left.value);
  var rightValue = safeString(right.value);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function getDefaultTransactionOfficeCode(options) {
  return options && options.length > 0 ? safeString(options[0].value).trim() : '';
}

function isTransactionOfficeCodeAllowed(value, options) {
  var code = safeString(value).trim();
  if (!code) return false;
  if (!options || options.length === 0) return true;

  for (var i = 0; i < options.length; i++) {
    if (code === safeString(options[i].value).trim()) return true;
  }

  return false;
}

function removeFirstLeadingZero(value) {
  var text = safeString(value).trim();
  return text.charAt(0) === '0' ? text.substring(1) : text;
}

function getBranchNamePrefix(value) {
  var text = safeString(value).trim();
  var separatorIndex = text.indexOf('-');
  return (separatorIndex >= 0 ? text.substring(0, separatorIndex) : text).trim();
}

function applyCreatorUnitToEntries(entries, unitCode, defaultTransactionOfficeCode, transactionOfficeOptions) {
  for (var i = 0; i < entries.length; i++) {
    // map đơn vị người tạo cho AP; GL giữ branch do người dùng chọn.
    if (!isAdditionalEntryType(entries[i].type)) {
      if (unitCode) entries[i].branch = unitCode;

      if (
        defaultTransactionOfficeCode &&
        !isTransactionOfficeCodeAllowed(entries[i].transaction_office, transactionOfficeOptions)
      ) {
        entries[i].transaction_office = defaultTransactionOfficeCode;
      }
    }
  }
}

function getPrepaymentVendors(prepaymentId, vendorId) {
  var query = 'prepayment.id="' + escapeQueryValue(prepaymentId) + '"';

  if (vendorId) query += ' and vendor.id="' + escapeQueryValue(vendorId) + '"';

  return selectMappedList(TABLE_PREPAYMENT_VENDOR, query, function (record) {
    return {
      vendor_id: readText(record, 'vendor.id'),
      vendor_site_id: readText(record, 'vendor.site.id'),
      amount: readText(record, 'amount'),
      currency: readText(record, 'currency'),
      payment_method: readText(record, 'payment.method'),
      transaction_description: readText(record, 'transaction.des'),
      beneficiary_account: readText(record, 'beneficiary.account'),
      beneficiary_name: readText(record, 'beneficiary.name')
    };
  });
}

function enrichVendor(vendor) {
  var vendorInfo = getVendorInfo(vendor.vendor_id);
  var siteInfo = getVendorSiteInfo(vendor.vendor_site_id);

  vendor.vendor_name = vendorInfo.vendor_name;
  vendor.vendor_number = vendorInfo.vendor_number;
  vendor.vendor_site_code = siteInfo.vendor_site_code;
  vendor.debit_account = siteInfo.debit_account;
  vendor.credit_account = siteInfo.credit_account;

  return vendor;
}

function getVendorInfo(vendorId) {
  if (!vendorId) return {};

  return (
    selectOne(
      TABLE_VENDOR,
      'id="' + escapeQueryValue(vendorId) + '"',
      function (record) {
        return {
          vendor_name: readText(record, 'vendor.name'),
          vendor_number: readText(record, 'vendor.number')
        };
      }
    ) || {}
  );
}

function getVendorSiteInfo(vendorSiteId) {
  if (!vendorSiteId) return {};

  return (
    selectOne(
      TABLE_VENDOR_SITE,
      'id="' + escapeQueryValue(vendorSiteId) + '"',
      function (record) {
        return {
          vendor_site_code: readText(record, 'ogl.site.code'),
          debit_account: extractAccountNumber(readText(record, 'debit.account')),
          credit_account: extractAccountNumber(readText(record, 'credit.account'))
        };
      }
    ) || {}
  );
}

/** Tính tổng thuế khấu trừ của các hóa đơn thuộc NCC. */
function getInvoiceTaxInfo(prepaymentId, vendor, vendorCount) {
  var links = getLinkedInvoices(prepaymentId);
  var taxAmounts = {};
  var deductionTypes = [DEDUCTION_TYPE_FULL, DEDUCTION_TYPE_RATE];
  var result = {
    totalDeductibleTax: '0',
    hasDeductibleTax: false,
    groups: [],
    errors: []
  };

  taxAmounts[DEDUCTION_TYPE_FULL] = '0';
  taxAmounts[DEDUCTION_TYPE_RATE] = '0';

  for (var i = 0; i < links.length; i++) {
    var invoice = getInvoiceById(links[i].invoice_id);
    if (!isInvoiceForVendor(invoice, vendor, vendorCount)) continue;

    var taxAmount = normalizeAmountMinor(invoice.total_tax);
    if (compareAmountTexts(taxAmount, '0') <= 0) continue;

    var deductionType = links[i].deduction_type;
    if (!deductionType) {
      result.errors.push('Hóa đơn ' + links[i].invoice_id + ' đang để trống Loại khấu trừ. Vui lòng kiểm tra lại.');
      continue;
    }

    var deductionTypeCode = safeString(deductionType).trim().toUpperCase();
    if (deductionTypeCode === DEDUCTION_TYPE_NONE) continue;

    if (deductionTypeCode !== DEDUCTION_TYPE_FULL && deductionTypeCode !== DEDUCTION_TYPE_RATE) {
      result.errors.push(
        'Hóa đơn ' +
          links[i].invoice_id +
          ' có Loại khấu trừ không hợp lệ (' +
          deductionType +
          '). Vui lòng kiểm tra lại.'
      );
      continue;
    }

    taxAmounts[deductionTypeCode] = addAmountTexts(taxAmounts[deductionTypeCode], taxAmount);
  }

  for (var typeIndex = 0; typeIndex < deductionTypes.length; typeIndex++) {
    var deductionTypeCode = deductionTypes[typeIndex];
    var groupedTaxAmount = taxAmounts[deductionTypeCode];
    if (compareAmountTexts(groupedTaxAmount, '0') <= 0) continue;

    var taxAccount = getTaxDeductionAccount(deductionTypeCode);
    result.groups.push({
      deductionType: deductionTypeCode,
      amount: formatAmountFromMinor(groupedTaxAmount),
      accountNumber: taxAccount.number,
      accountName: taxAccount.name
    });
    result.totalDeductibleTax = addAmountTexts(result.totalDeductibleTax, groupedTaxAmount);
  }

  result.hasDeductibleTax = result.groups.length > 0;

  result.errors = makeUniqueTextList(result.errors);

  return result;
}

function getTaxDeductionAccount(deductionType) {
  var itemId = safeString(deductionType).trim();
  var accountItem = null;

  if (itemId) {
    accountItem = selectOne(
      TABLE_CATEGORY_ITEM,
      'category.id="' + escapeQueryValue(CATEGORY_TAX_ACCOUNT_NUMBER) + '" and item.id="' + escapeQueryValue(itemId) + '"',
      function (record) {
        return { itemName: readText(record, 'item.name') };
      }
    );
  }

  var accountNumber = accountItem ? safeString(accountItem.itemName).trim() : '';

  return {
    number: accountNumber,
    name: getGlAccountName(accountNumber)
  };
}

function getLinkedInvoices(prepaymentId) {
  return selectMappedList(
    TABLE_PREPAYMENT_INVOICE,
    'prepayment.id="' + escapeQueryValue(prepaymentId) + '"',
    function (record) {
      var invoiceId = readText(record, 'invoice.id');
      if (!invoiceId) return null;

      return {
        invoice_id: invoiceId,
        deduction_type: readText(record, 'deduction.type')
      };
    }
  );
}

function isInvoiceForVendor(invoice, vendor, vendorCount) {
  var sellerTaxCode = normalizeBusinessValue(invoice.seller_tax_code);
  var vendorTaxCode = normalizeBusinessValue(vendor.vendor_number);

  if (sellerTaxCode && vendorTaxCode) return sellerTaxCode === vendorTaxCode;

  return vendorCount <= 1;
}

function getInvoiceById(invoiceId) {
  if (!invoiceId) return {};

  return (
    selectOne(TABLE_INVOICE, 'id="' + escapeQueryValue(invoiceId) + '"', function (record) {
      return {
        id: readText(record, 'id'),
        total_tax: readText(record, 'total.tax'),
        seller_tax_code: readText(record, 'seller.tax.code')
      };
    }) || {}
  );
}

// Saved entries and persistence
/** Đọc entry cùng thông tin NCC bằng LEFT JOIN. */
function getSavedPrepaymentEntries(prepaymentId) {
  var fields = getPrepaymentEntryFields();
  var sql =
    'SELECT ' +
    selectFields(fields) +
    ' FROM ' +
    TABLE_PREPAYMENT_ENTRY +
    ' e LEFT JOIN ' +
    TABLE_PREPAYMENT_VENDOR +
    ' pv ON (e.prepayment.id = pv.prepayment.id AND e.vendor.id = pv.vendor.id)' +
    ' LEFT JOIN ' +
    TABLE_VENDOR +
    ' v ON (e.vendor.id = v.id)' +
    ' LEFT JOIN ' +
    TABLE_VENDOR_SITE +
    ' vs ON (pv.vendor.site.id = vs.id)' +
    ' WHERE e.prepayment.id="' +
    escapeQueryValue(prepaymentId) +
    '" ORDER BY e.order ASC';

  var entries = selectList(TABLE_PREPAYMENT_ENTRY, sql, fields);
  var bankNames = {};

  for (var i = 0; i < entries.length; i++) {
    var citadBranchCode = getFirstBeneficiaryBankCitadCode(entries[i].beneficiary_bank);

    if (!citadBranchCode) {
      entries[i].beneficiary_bank_name = '';
      continue;
    }

    if (!hasOwn(bankNames, citadBranchCode)) {
      bankNames[citadBranchCode] =
        selectOne(
          TABLE_BANK,
          'citad.branch.code="' + escapeQueryValue(citadBranchCode) + '"',
          function (record) {
            return readText(record, 'name');
          }
        ) || '';
    }

    entries[i].beneficiary_bank_name = bankNames[citadBranchCode];
  }

  return entries;
}

/** Lấy mã CITAD đầu tiên từ chuỗi beneficiary.bank, ví dụ 25201005|01201001|970415. */
function getFirstBeneficiaryBankCitadCode(value) {
  var bankValue = safeString(value).trim();
  var separatorIndex = bankValue.indexOf('|');

  if (separatorIndex >= 0) bankValue = bankValue.substring(0, separatorIndex);

  return bankValue.trim();
}

function getPrepaymentEntryFields() {
  return [
    ['e.id', 'id', 'S'],
    ['e.prepayment.id', 'prepayment_id', 'S'],
    ['e.entry.type', 'entry_type', 'S'],
    ['e.ledger.type', 'ledger_type', 'S'],
    ['e.account.type', 'account_type', 'S'],
    ['e.account.number', 'account_number', 'S'],
    ['e.account.name', 'account_name', 'S'],
    ['e.branch', 'branch', 'S'],
    ['e.department', 'department', 'S'],
    ['e.transaction.code', 'transaction_office', 'S'],
    ['e.amount', 'amount', 'S'],
    ['e.currency', 'currency', 'S'],
    ['e.description', 'description', 'S'],
    ['e.vendor.id', 'vendor_id', 'S'],
    ['v.vendor.name', 'vendor_name', 'S'],
    ['e.type', 'type', 'S'],
    ['e.order', 'order', 'N'],
    ['e.accounting.request.id', 'accounting_request_id', 'S'],
    ['pv.vendor.site.id', 'vendor_site_id', 'S'],
    ['vs.ogl.site.code', 'vendor_site_code', 'S'],
    ['pv.payment.method', 'payment_method', 'S'],
    ['pv.beneficiary.account', 'beneficiary_account', 'S'],
    ['pv.beneficiary.name', 'beneficiary_name', 'S'],
    ['pv.beneficiary.bank', 'beneficiary_bank', 'S']
  ];
}

/** Giữ description và tài khoản Nợ người dùng đã sửa khi sinh lại. */
function mergeEditableAutoEntryFields(savedEntries, expectedEntries) {
  var savedMap = {};
  var result = [];

  // Gom các dòng đã lưu theo NCC và loại bút toán; thứ tự trong nhóm phân biệt các dòng thuế.
  for (var i = 0; i < savedEntries.length; i++) {
    var saved = savedEntries[i];
    if (!isAutoEntry(saved)) continue;

    var savedEntryKey = makeAutoEntryMatchKey(saved);
    if (!savedEntryKey) continue;

    if (!savedMap[savedEntryKey]) savedMap[savedEntryKey] = [];
    savedMap[savedEntryKey].push(saved);
  }

  // Giữ ID và các trường được phép chỉnh sửa của dòng tương ứng.
  for (var j = 0; j < expectedEntries.length; j++) {
    var expected = copyObject({}, expectedEntries[j]);
    var expectedEntryKey = makeAutoEntryMatchKey(expected);
    var matches = savedMap[expectedEntryKey] || [];
    var matched = matches.length > 0 ? matches.shift() : null;

    if (matched) {
      expected.id = safeString(matched.id);
      if (!isPaymentEntry(expected)) {
        expected.description = safeString(matched.description).trim() || expected.description;
      }

      if (isEditableDebitAccountEntry(expected)) {
        var generatedAccountNumber = safeString(expected.account_number);
        var savedAccountNumber = safeString(matched.account_number);
        expected.account_number = savedAccountNumber;
        expected.account_name =
          savedAccountNumber === generatedAccountNumber
            ? expected.account_name
            : getGlAccountName(savedAccountNumber);
      }
    }

    result.push(expected);
  }

  return result;
}

function makeAutoEntryMatchKey(row) {
  var entryCode = getAutoEntryCode(row.entry_type);
  if (!entryCode) return '';

  var key = safeString(row.vendor_id).trim() + '|' + entryCode;
  if (entryCode === AUTO_ENTRY_CODE.TAX) {
    key += '|' + safeString(row.account_number).trim();
  }

  return key;
}

function isEditableDebitAccountEntry(row) {
  return getAutoEntryCode(row.entry_type) === AUTO_ENTRY_CODE.ADVANCE;
}

function isPaymentEntry(row) {
  return getAutoEntryCode(row.entry_type) === AUTO_ENTRY_CODE.PAYMENT;
}

function replaceAutoPrepaymentEntries(prepaymentId, rows) {
  var deleted = deleteAutoPrepaymentEntries(prepaymentId);
  var inserted = insertPrepaymentEntries(rows);

  return {
    inserted: inserted,
    updated: 0,
    deleted: deleted
  };
}

function insertPrepaymentEntries(rows) {
  var inserted = 0;

  for (var i = 0; i < rows.length; i++) {
    if (insertRecord(TABLE_PREPAYMENT_ENTRY, toPrepaymentEntryRecord(rows[i])) === RC_SUCCESS) inserted++;
  }

  return inserted;
}

function toPrepaymentEntryRecord(row) {
  return {
    id: row.id,
    'prepayment.id': row.prepayment_id,
    'entry.type': row.entry_type,
    'ledger.type': row.ledger_type,
    'account.type': row.account_type,
    'account.number': row.account_number,
    'account.name': row.account_name,
    branch: row.branch,
    department: row.department,
    'transaction.code': row.transaction_office,
    amount: row.amount,
    currency: row.currency,
    description: row.description,
    'vendor.id': row.vendor_id,
    type: row.type,
    order: row.order,
    'accounting.request.id': row.accounting_request_id
  };
}

function insertRecord(tableName, row) {
  var f;

  try {
    f = new SCFile(tableName);
    for (var key in row) {
      if (hasOwn(row, key)) f[key] = row[key];
    }
    return f.doInsert();
  } finally {
    // closeFile(f);
    // trưởng thêm: gọi trực tiếp doClose để đóng SCFile
    try {
      if (f) f.doClose();
    } catch (eClose) {}
  }
}

function deleteAutoPrepaymentEntries(prepaymentId) {
  var deleted = 0;
  var f;

  try {
    f = new SCFile(TABLE_PREPAYMENT_ENTRY);
    var rc = f.doSelect('prepayment.id="' + escapeQueryValue(prepaymentId) + '"');

    while (rc === RC_SUCCESS) {
      if (isAutoEntry({ type: f['type'] })) {
        if (f.doDelete() === RC_SUCCESS) deleted++;
      }

      rc = f.getNext();
    }

    return deleted;
  } finally {
    // closeFile(f);
    // trưởng thêm: gọi trực tiếp doClose để đóng SCFile
    try {
      if (f) f.doClose();
    } catch (eClose) {}
  }
}

// Xóa toàn bộ AP và GL khi lưu chỉnh sửa từ popup.
function deletePrepaymentEntries(prepaymentId) {
  var deleted = 0;
  var f;

  try {
    f = new SCFile(TABLE_PREPAYMENT_ENTRY);
    var rc = f.doSelect('prepayment.id="' + escapeQueryValue(prepaymentId) + '"');

    while (rc === RC_SUCCESS) {
      if (f.doDelete() === RC_SUCCESS) deleted++;
      rc = f.getNext();
    }

    return deleted;
  } finally {
    // closeFile(f);
    // trưởng thêm: gọi trực tiếp doClose để đóng SCFile
    try {
      if (f) f.doClose();
    } catch (eClose) {}
  }
}

function isGenerationPhaseLocked(currentPhase) {
  var phase = normalizeText(currentPhase);
  return phase !== GENERATION_PHASE.DMMS && phase !== GENERATION_PHASE.KTTC;
}

function isAccountingEditablePhase(currentPhase) {
  return normalizeText(currentPhase) === GENERATION_PHASE.KTTC;
}

function isSameUser(expectedUser, currentUser) {
  var expected = safeString(expectedUser).trim();
  var actual = safeString(currentUser).trim();

  return !!expected && !!actual && normalizeText(expected) === normalizeText(actual);
}

function isAutoEntry(row) {
  var type = normalizeText(row.type);
  return type !== normalizeText(ENTRY_TYPE.GL) && type !== LEGACY_ADDITIONAL_TYPE;
}

function getAutoEntryCode(value) {
  var raw = safeString(value).trim().toUpperCase();
  if (raw === AUTO_ENTRY_CODE.ADVANCE || raw === AUTO_ENTRY_CODE.TAX || raw === AUTO_ENTRY_CODE.PAYMENT) return raw;

  var normalized = normalizeBusinessValue(value);
  if (normalized === 'tamung') return AUTO_ENTRY_CODE.ADVANCE;
  if (normalized === 'thue') return AUTO_ENTRY_CODE.TAX;
  if (normalized === 'chuyentien') return AUTO_ENTRY_CODE.PAYMENT;

  return '';
}

// Query helpers
function isBankTransfer(value) {
  return normalizeBusinessValue(value) === 'chuyenkhoan';
}

function isCashPayment(value) {
  return normalizeBusinessValue(value) === 'tienmat';
}

function selectOne(tableName, query, mapper) {
  var f;

  try {
    f = new SCFile(tableName, SCFILE_READONLY);
    var rc = f.doSelect(query);
    return rc === RC_SUCCESS ? mapper(f) : null;
  } finally {
    // closeFile(f);
    // trưởng thêm: gọi trực tiếp doClose để đóng SCFile
    try {
      if (f) f.doClose();
    } catch (eClose) {}
  }
}

function selectMappedList(tableName, query, mapper) {
  var list = [];
  var f;

  try {
    f = new SCFile(tableName, SCFILE_READONLY);
    var rc = f.doSelect(query);

    while (rc === RC_SUCCESS) {
      var item = mapper(f);
      if (item !== null && item !== undefined) list.push(item);
      rc = f.getNext();
    }

    return list;
  } finally {
    // closeFile(f);
    // trưởng thêm: gọi trực tiếp doClose để đóng SCFile
    try {
      if (f) f.doClose();
    } catch (eClose) {}
  }
}

function selectList(tableName, sql, fields) {
  return selectMappedList(tableName, sql, function (record) {
    return mapSqlRow(record, fields);
  });
}

function mapSqlRow(record, fields) {
  var item = {};

  for (var i = 0; i < fields.length; i++) {
    var key = fields[i][1];
    var type = fields[i][2];
    var value = record[i];
    item[key] = type === 'N' ? toNumber(value) : safeString(value);
  }

  return item;
}

function selectFields(fields) {
  var items = [];

  for (var i = 0; i < fields.length; i++) {
    items.push(fields[i][0]);
  }

  return items.join(', ');
}

function makeUniqueTextList(values) {
  var map = {};
  var list = [];

  for (var i = 0; i < values.length; i++) {
    var value = safeString(values[i]).trim();
    if (!value || map[value]) continue;

    map[value] = true;
    list.push(value);
  }

  return list;
}

/**
 * Chuẩn hóa số tài khoản từ vendor site.
 * Dạng mới: lấy đoạn giữa dấu chấm thứ hai và thứ ba; dạng cũ giữ nguyên.
 */
function extractAccountNumber(value) {
  var account = safeString(value).trim();
  var firstDot = account.indexOf('.');
  var secondDot = firstDot >= 0 ? account.indexOf('.', firstDot + 1) : -1;
  var thirdDot = secondDot >= 0 ? account.indexOf('.', secondDot + 1) : -1;

  if (secondDot < 0 || thirdDot < 0) return account;

  var extracted = account.substring(secondDot + 1, thirdDot).trim();
  return extracted || account;
}

function readText(record, fieldName) {
  var value = readField(record, fieldName);
  return value === null || value === undefined ? '' : safeString(value);
}

function readNumber(record, fieldName) {
  return toNumber(readField(record, fieldName));
}

function readField(record, fieldName) {
  try {
    return record[fieldName];
  } catch (e) {
    return null;
  }
}

function assignNewEntryIds(prepaymentId, rows, savedEntries) {
  var nextApSequence = getNextApEntryIdSequence(prepaymentId, savedEntries);
  var nextGlRowSequence = getNextGlRowSequence(prepaymentId, 1, savedEntries);

  for (var i = 0; i < rows.length; i++) {
    if (!safeString(rows[i].id).trim()) {
      if (isAdditionalEntryType(rows[i].type)) {
        rows[i].id = makeGlEntryId(prepaymentId, 1, nextGlRowSequence++);
      } else {
        rows[i].id = makeApEntryId(prepaymentId, nextApSequence++);
      }
    }
  }
}

function getNextApEntryIdSequence(prepaymentId, rows) {
  var prefix = getEntryIdPrefix(prepaymentId, ENTRY_TYPE.AP);
  var maxSequence = 0;
  var list = rows || [];

  for (var i = 0; i < list.length; i++) {
    var id = safeString(list[i].id).trim();
    if (id.indexOf(prefix) !== 0) continue;

    var suffix = id.substring(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;

    var sequence = Number(suffix);
    if (sequence > maxSequence) maxSequence = sequence;
  }

  return maxSequence + 1;
}

function makeApEntryId(prepaymentId, sequence) {
  return getEntryIdPrefix(prepaymentId, ENTRY_TYPE.AP) + sequence;
}

function getEntryIdPrefix(prepaymentId, entryType) {
  var prefix = safeString(prepaymentId).trim() + '.';
  return entryType === ENTRY_TYPE.GL ? prefix + ENTRY_TYPE.GL + '.' : prefix;
}

/** Tạo ID GL theo cấu trúc <prepaymentId>.GL.<số bút toán>.<số dòng>. */
function makeGlEntryId(prepaymentId, groupOrder, rowOrder) {
  return (
    getEntryIdPrefix(prepaymentId, ENTRY_TYPE.GL) +
    groupOrder +
    '.' +
    rowOrder
  );
}

/** Kiểm tra ID GL có đúng cấu trúc hai cấp nhóm/dòng của đề nghị hay không. */
function isStructuredGlEntryId(prepaymentId, entryId) {
  var parts = getGlEntryIdParts(prepaymentId, entryId);
  return !!parts && !parts.legacy;
}

/** Đọc số bút toán và số dòng từ ID GL; ID cũ .GL.<dòng> thuộc nhóm 1. */
function getGlEntryIdParts(prepaymentId, entryId) {
  var prefix = getEntryIdPrefix(prepaymentId, ENTRY_TYPE.GL);
  var id = safeString(entryId).trim();

  if (id.indexOf(prefix) !== 0) return null;

  var suffix = id.substring(prefix.length);
  var parts = suffix.split('.');

  if (
    parts.length === 2 &&
    /^\d+$/.test(parts[0]) &&
    /^\d+$/.test(parts[1]) &&
    Number(parts[0]) > 0 &&
    Number(parts[1]) > 0
  ) {
    return {
      groupOrder: Number(parts[0]),
      rowOrder: Number(parts[1]),
      legacy: false
    };
  }

  if (
    parts.length === 1 &&
    /^\d+$/.test(parts[0]) &&
    Number(parts[0]) > 0
  ) {
    return {
      groupOrder: 1,
      rowOrder: Number(parts[0]),
      legacy: true
    };
  }

  return null;
}

/** Lấy số dòng GL tiếp theo trong một nhóm dựa trên giá trị lớn nhất đã lưu. */
function getNextGlRowSequence(prepaymentId, groupOrder, rows) {
  var maxSequence = 0;
  var list = rows || [];

  for (var i = 0; i < list.length; i++) {
    var parts = getGlEntryIdParts(prepaymentId, list[i].id);
    if (!parts || parts.groupOrder !== groupOrder) continue;
    if (parts.rowOrder > maxSequence) maxSequence = parts.rowOrder;
  }

  return maxSequence + 1;
}

function makeEntryIdSet(rows) {
  var result = {};
  var list = rows || [];

  for (var i = 0; i < list.length; i++) {
    var id = safeString(list[i].id).trim();
    if (id) result[id] = true;
  }

  return result;
}

function isArray(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeAmountText(value) {
  var text = safeString(value).replace(/[^0-9]/g, '');
  while (text.length > 1 && text.charAt(0) === '0') text = text.substring(1);
  return text || '0';
}

function compareAmountTexts(a, b) {
  var left = normalizeAmountText(a);
  var right = normalizeAmountText(b);
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function addAmountTexts(a, b) {
  var left = normalizeAmountText(a).split('').reverse();
  var right = normalizeAmountText(b).split('').reverse();
  var result = [];
  var carry = 0;
  var maxLength = Math.max(left.length, right.length);

  for (var i = 0; i < maxLength || carry > 0; i++) {
    var sum =
      (i < left.length ? Number(left[i]) : 0) +
      (i < right.length ? Number(right[i]) : 0) +
      carry;
    result.push(String(sum % 10));
    carry = Math.floor(sum / 10);
  }

  return result.reverse().join('') || '0';
}

function subtractAmountTexts(a, b) {
  var left = normalizeAmountText(a);
  var right = normalizeAmountText(b);
  if (compareAmountTexts(left, right) <= 0) return '0';

  var leftDigits = left.split('').reverse();
  var rightDigits = right.split('').reverse();
  var result = [];
  var borrow = 0;

  for (var i = 0; i < leftDigits.length; i++) {
    var digit = Number(leftDigits[i]) - (i < rightDigits.length ? Number(rightDigits[i]) : 0) - borrow;
    if (digit < 0) {
      digit += 10;
      borrow = 1;
    } else {
      borrow = 0;
    }
    result.push(String(digit));
  }

  return normalizeAmountText(result.reverse().join(''));
}

function normalizeAmountMinor(value) {
  var text = safeString(value).replace(/[,\s]/g, '').trim();
  var match = /^(-?)(\d*)(?:\.(\d+)?)?$/.exec(text);
  if (!match || (!match[2] && match[3] === undefined)) return '0';

  var major = match[2] || '0';
  var minorRaw = (match[3] || '').slice(0, 2);
  while (minorRaw.length < 2) minorRaw += '0';

  var combined = major + minorRaw;
  combined = combined.replace(/^0+(?=\d)/, '');
  return combined || '0';
}

function formatAmountFromMinor(minorText) {
  var value = normalizeAmountText(minorText);
  while (value.length < 3) value = '0' + value;
  var major = value.substring(0, value.length - 2).replace(/^0+(?=\d)/, '') || '0';
  var minor = value.substring(value.length - 2).replace(/0+$/, '');

  return major + (minor ? '.' + minor : '');
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  var numberValue = Number(String(value).replace(/,/g, '').replace(/%/g, '').trim());
  return isNaN(numberValue) ? 0 : numberValue;
}

function safeString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function normalizeText(value) {
  var text = safeString(value).toLowerCase();

  try {
    if (text.normalize) text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (e) {}

  return text
    .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, 'a')
    .replace(/[èéẹẻẽêềếệểễ]/g, 'e')
    .replace(/[ìíịỉĩ]/g, 'i')
    .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, 'o')
    .replace(/[ùúụủũưừứựửữ]/g, 'u')
    .replace(/[ỳýỵỷỹ]/g, 'y')
    .replace(/\u0111/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBusinessValue(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

function escapeQueryValue(value) {
  return safeString(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function closeFile(file) {
  try {
    if (file) file.doClose();
  } catch (e) {}
}
