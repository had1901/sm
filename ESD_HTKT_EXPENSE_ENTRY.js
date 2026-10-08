/**
 * ScriptLibrary : ESD_HTKT_EXPENSE_ENTRY
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị dự chi
 * Version      : 1.0.0
 * Chức năng:
 * - Tự động tính toán và sinh các dòng bút toán định khoản Nợ/Có (esdHTKTpaymentEntry) cho phiếu Dự chi.
 * - Áp dụng quy tắc sinh bút toán tự động theo đặc tả 2.7 (gồm 3 dòng tự sinh TT-BK-01*, TT-BK-02, TT-BK-03*).
 * - Xác định điều kiện thuế theo DC_BR_01 (Có/Không có thuế khấu trừ).
 * - Đồng bộ bút toán tự động khi có thay đổi từ hóa đơn hoặc nhà cung cấp.
 * - Lưu chỉnh sửa theo luồng riêng của Dự chi; các danh mục dùng chung ESD_HTKT_PAYMENT_ENTRY.
 * -----------------------------------------------------------------------------
 */

var logger = typeof getLog === 'function' ? getLog("ESD_HTKT_EXPENSE_ENTRY") : { info: function(m) {}, error: function(m) {} };

function debugExpenseEntry(point, message) {
    try {
        if (typeof print === 'function') {
            print('[EXPENSE-ENTRY][' + point + '] ' + message);
        }
    } catch (ignore) {}
}

/*
 * ===========================================================================
 *  SƠ ĐỒ LUỒNG XỬ LÝ BÚT TOÁN DỰ CHI
 * ---------------------------------------------------------------------------
 *  01. ENTRY POINT
 *      run() tiếp nhận action và điều phối xử lý.
 *
 *  02. LOAD / SYNC
 *      Đọc bút toán đã lưu -> sinh bộ bút toán tự động theo quy tắc 2.7
 *      -> merge dữ liệu chỉnh sửa -> validate cân đối -> lưu DB.
 *
 *  03. QUY TẮC SINH BÚT TOÁN TỰ ĐỘNG (2.7)
 *      - TT-BK-01* (Nợ TK Chi phí): Số tiền = Số tiền dự chi - Thuế khấu trừ (nếu có)
 *      - TT-BK-02  (Nợ TK Thuế GTGT): Số tiền = Thuế trên hóa đơn (theo DC_BR_01)
 *      - TT-BK-03* (Có TK Phải trả NCC): Số tiền = Số tiền dự chi
 *      - Dòng thủ công do người dùng tự thêm (MANUAL)
 *
 *  04. VALIDATE & PERSISTENCE
 *      Kiểm tra tài khoản, số tiền, cân bằng tổng Nợ = tổng Có và lưu bảng esdHTKTpaymentEntry.
 * ===========================================================================
 */

// =============================================================================
// SECTION 01 - ENTRY POINT: tiếp nhận action và điều phối luồng
// =============================================================================

function run() {
    var startTime = new Date().getTime();
    try {
        var input = vars['$L.file'];
        if (!input) return;

        var action = input.name || '';
        var details = getInputDetails(input);
        var result;

        // 1. Danh sách hạch toán
        if (action === 'getListExpenseEntry' || action === 'getListPaymentEntry') {
            result = getListExpenseEntry(details);
        // 2. Options khi thêm dòng thủ công
        } else if (action === 'syncExpenseEntry' || action === 'syncPaymentEntry') {
            result = syncExpenseEntryNowByInputDetails(details);
        // 3. Đồng bộ bút toán khi nguồn thay đổi
        } else if (action === 'syncExpenseEntryBySourceChange') {
            result = syncExpenseEntryBySourceChange(
                safeString(details.sourceTable || input.sourceTable).trim(),
                details
            );
        // 5. Lưu chỉnh sửa bút toán từ UI
        } else if (action === 'saveExpenseEntryEdit') {
            result = saveExpenseEntryEdit(details);
        // 6. Danh mục tài khoản kế toán
        } else {
            result = { success: false, error: 'Invalid action: ' + action };
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

// =============================================================================
// SUPPORT - CONSTANTS: bảng DB, mã dòng bút toán và loại tài khoản
// =============================================================================

var TABLE_PAYMENT_ENTRY = 'esdHTKTpaymentEntry';             // Bảng chứa dòng bút toán
var TABLE_PAYMENT = 'esdHTKTpayment';                         // Bảng phiếu đề nghị (Dự chi/Thanh toán)
var TABLE_PAYMENT_VENDOR = 'esdHTKTpaymentVendor';           // Bảng NCC / món dự chi
var TABLE_PAYMENT_INVOICE = 'esdHTKTpaymentInvoice';         // Bảng hóa đơn đính kèm
var TABLE_COST_DIVISION = 'esdHTKTpaymentCostDivision';       // Bảng phân bổ chi phí (nếu có)
var TABLE_INVOICE = 'esdHTKTinvoice';                         // Bảng thông tin hóa đơn
var TABLE_VENDOR = 'esdHTKTvendor';                           // Bảng danh mục Nhà cung cấp
var TABLE_VENDOR_SITE = 'esdHTKTvendorSite';                 // Bảng danh mục Địa điểm NCC
var TABLE_CATEGORY_ITEM = 'esdDMcategoryItems';               // Bảng thành phần danh mục
var TABLE_GL_ACCOUNT = 'esdDMglAccount';                      // Bảng danh mục tài khoản GL
var TABLE_CONTACT = 'contacts';
var TABLE_ENTITY = 'esdDMentity';
var TABLE_ORG_UNIT = 'esdQTorgUnit';
var TABLE_BANK = 'esdDMbank';
var TABLE_COST_CENTER = 'esdDMcostCenter';
var ENTITY_STATUS_ACTIVE = 'ACTIVE';

var TYPE = {
    AP: 'AP',
    GL: 'GL'
};

// Mã dòng bút toán tự động theo đặc tả 2.7.2
var AUTO_ENTRY_CODE = {
    COST:      'TT-BK-01',   // Ghi nhận chi phí        (Nợ)
    TAX:       'TT-BK-02',   // Dòng thuế GTGT          (Nợ)
    LIABILITY: 'TT-BK-03'    // Ghi nhận nghĩa vụ TT    (Có)
};

var MONEY_EPSILON = 0.001;

var LEDGER_TYPE = {
    STANDARD: 'Standard'
};

var ACCOUNT_TYPE = {
    DEBIT: 'DEBIT',
    ASSET: 'ASSET'
};

var ENTRY_TYPE = {
    COST: 'COST',             // TK chi phí
    TAX: 'TAX',               // TK thuế
    PAYABLE: 'PAYABLE',       // TK phải trả NCC
    OTHER: 'OTHER'            // TK khác
};

var GENERATION_PHASE = {
    DMMS: 'initial_dmms',
    KTTC: 'initial_kttc',
    START: 'start'
};

var CATEGORY_TAX_ACCOUNT_NUMBER = 'dmhtkt_stk_loai_khau_tru';
var CATEGORY_TAX_DEDUCTION_TYPE = 'dmhd_loai_khau_tru';
var DEDUCTION_TYPE_FULL = 'KHAUTRU_001';
var DEDUCTION_TYPE_RATE = 'KHAUTRU_002';
var DEDUCTION_TYPE_NONE = 'KHAUTRU_003';
var GL_UNIT_TRANSACTION_CODE = '98';
var GL_DEFAULT_ENTITY_CODE = '0000000';
var GL_DEFAULT_COST_CENTER = '000000';
var GL_DEFAULT_TRANSACTION_OFFICE = '0000000';
var GL_UNIT_PREFERRED_PS_CODE = {
    '1010098': '99901000'
};

// =============================================================================
// SECTION 02 - LOAD / SYNC: đọc, sinh lại, merge, validate và lưu tự động
// =============================================================================

function readThreeDigits(number, isFirstGroup) {
    var digits = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
    var hundred = Math.floor(number / 100);
    var ten = Math.floor((number % 100) / 10);
    var unit = number % 10;
    var result = '';

    if (hundred > 0 || !isFirstGroup) {
        result += digits[hundred] + ' trăm ';
    }

    if (ten > 1) {
        result += digits[ten] + ' mươi ';
        if (unit === 1) result += 'mốt ';
        else if (unit === 5) result += 'lăm ';
        else if (unit > 0) result += digits[unit] + ' ';
    } else if (ten === 1) {
        result += 'mười ';
        if (unit === 5) result += 'lăm ';
        else if (unit > 0) result += digits[unit] + ' ';
    } else {
        if (!isFirstGroup && unit > 0) {
            result += 'linh ' + digits[unit] + ' ';
        } else if (unit > 0) {
            result += digits[unit] + ' ';
        }
    }

    return result.trim();
}

function readMoneyInWords(amount, currency) {
    var num = Math.round(toNumber(amount));
    if (isNaN(num) || num === 0) {
        return 'Không đồng';
    }
    if (num < 0) {
        return 'Âm ' + readMoneyInWords(Math.abs(num), currency).toLowerCase();
    }

    var scales = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
    var groups = [];
    var temp = num;

    while (temp > 0) {
        groups.push(temp % 1000);
        temp = Math.floor(temp / 1000);
    }

    var words = [];
    for (var i = groups.length - 1; i >= 0; i--) {
        var groupValue = groups[i];
        if (groupValue === 0) continue;
        var isFirst = (i === groups.length - 1);
        var groupText = readThreeDigits(groupValue, isFirst);
        var scaleText = scales[i % scales.length];
        if (scaleText) groupText += ' ' + scaleText;
        words.push(groupText);
    }

    var result = words.join(' ').replace(/\s+/g, ' ').trim();
    var curr = safeString(currency || 'VND').trim().toUpperCase();
    var currSuffix = 'đồng';
    if (curr === 'USD') currSuffix = 'đô la Mỹ';
    else if (curr === 'EUR') currSuffix = 'Euro';
    else if (curr && curr !== 'VND') currSuffix = curr;

    result = result + ' ' + currSuffix;
    result = result.charAt(0).toUpperCase() + result.slice(1);
    return result;
}

function getExpenseSummaryMeta(expenseId, request, metaParams) {
    var params = metaParams || {};
    var req = request || {};
    var vendors = getExpenseVendors(expenseId);
    var vendorCount = vendors.length;
    var currency = safeString(req.currency || (vendors.length > 0 ? vendors[0].currency : '') || 'VND').trim().toUpperCase() || 'VND';

    // 1. Tổng số tiền đề nghị dự chi của tất cả các NCC thuộc phiếu Dự chi
    var totalExpenseAmount = 0;
    for (var vIdx = 0; vIdx < vendors.length; vIdx++) {
        totalExpenseAmount += toNumber(vendors[vIdx].amount);
    }
    if (totalExpenseAmount === 0 && req.total_amount_paid) {
        totalExpenseAmount = toNumber(req.total_amount_paid);
    }

    // 2. Tổng số tiền thuế của phiếu Dự chi
    var totalTaxAmount = 0;
    if (vendors.length > 0) {
        for (var vIdx2 = 0; vIdx2 < vendors.length; vIdx2++) {
            var vTaxInfo = getExpenseInvoiceTaxInfo(expenseId, vendors[vIdx2], vendorCount);
            var vendorTax = toNumber(vTaxInfo.totalDeductibleTax);
            if (vendorTax === 0 && (toNumber(vendors[vIdx2].tax_amount) > 0 || toNumber(vendors[vIdx2]['tax.amount']) > 0)) {
                vendorTax = toNumber(vendors[vIdx2].tax_amount) || toNumber(vendors[vIdx2]['tax.amount']);
            }
            totalTaxAmount += vendorTax;
        }
    } else {
        var links = getExpenseLinkedInvoices(expenseId);
        for (var invIdx = 0; invIdx < links.length; invIdx++) {
            var inv = getInvoiceById(links[invIdx].invoice_id);
            totalTaxAmount += toNumber(inv.total_tax);
        }
    }
    if (totalTaxAmount === 0 && (req.total_tax_amount || req['total.tax.amount'])) {
        totalTaxAmount = toNumber(req.total_tax_amount || req['total.tax.amount']);
    }

    // 3. Số tiền bằng chữ
    var amountInWords = readMoneyInWords(totalExpenseAmount, currency);

    // 4. Phân quyền hiển thị nút Chỉnh sửa / Xem chi tiết
    var currentUser = getCurrentOperatorName();
    var currentPhase = safeString(params.currentPhase || req.current_phase).trim();
    var isEditablePhase = isAccountingEditablePhase(currentPhase);
    var isKttcCreator = normalizeText(params.initialRole || req.initial_role) === 'kttc';
    var isAssignedKttc = isSameUser(params.userCheckerKttc || req.user_checker_kttc, currentUser);
    var canEdit = isEditablePhase && (isKttcCreator || isAssignedKttc);
    var buttonLabel = canEdit ? 'Chỉnh sửa' : 'Xem chi tiết';

    var meta = {
        currentPhase: params.currentPhase,
        userCheckerKttc: params.userCheckerKttc,
        initialRole: params.initialRole,
        createdBy: params.createdBy,
        additionalUnitCode: params.additionalUnitCode,
        additionalUnitEntityCode: params.additionalUnitEntityCode,
        additionalUnitName: params.additionalUnitName,
        totalAmountAfterTax: totalExpenseAmount,
        totalPaidAmount: totalExpenseAmount,
        total_amount_paid: totalExpenseAmount,
        total_amount_after_tax: totalExpenseAmount,
        amountInWords: amountInWords,
        totalAmountInWords: amountInWords,
        moneyInWords: amountInWords,
        amount_in_words: amountInWords,
        totalTaxAmount: totalTaxAmount,
        totalTax: totalTaxAmount,
        total_tax_amount: totalTaxAmount,
        currency: currency,
        currencyType: currency,
        currency_type: currency,
        vendorCount: vendorCount,
        totalVendorCount: vendorCount,
        totalVendors: vendorCount,
        vendor_count: vendorCount,
        paymentVendorCount: vendorCount,
        canEdit: canEdit,
        isEditable: canEdit,
        buttonLabel: buttonLabel,
        buttonAction: buttonLabel,
        viewMode: canEdit ? 'edit' : 'view'
    };

    if (params.locked !== undefined) meta.locked = params.locked;
    if (params.canGenerate !== undefined) meta.canGenerate = params.canGenerate;
    if (params.message !== undefined) meta.message = params.message;
    if (params.errors !== undefined) meta.errors = params.errors;

    return meta;
}

/** Lấy danh sách bút toán Dự chi */
function getListExpenseEntry(details) {
    var expenseId = safeString(details.expenseId || details.paymentId || details.id).trim();

    if (!expenseId) {
        return makeResult([], 'empty', {
            canGenerate: false,
            message: 'Thiếu mã đề nghị dự chi.',
            errors: ['Thiếu mã đề nghị dự chi.']
        });
    }

    var request = getExpenseRequest(expenseId);
    var currentPhase = request.current_phase;
    var userCheckerKttc = request.user_checker_kttc;
    var initialRole = request.initial_role;
    var createdBy = request.created_by;
    var currentUser = safeString(details.currentUser).trim();
    var creatorUnit = getCreatorAccountingUnit(currentUser || createdBy);
    var savedEntries = getSavedExpenseEntries(expenseId);

    var summaryMeta = getExpenseSummaryMeta(expenseId, request, {
        currentPhase: currentPhase,
        userCheckerKttc: userCheckerKttc,
        initialRole: initialRole,
        createdBy: createdBy,
        additionalUnitCode: creatorUnit.code,
        additionalUnitEntityCode: creatorUnit.entityCode,
        additionalUnitName: creatorUnit.name
    });

    if (savedEntries.length > 0) {
        applyCreatorUnitToEntries(savedEntries, creatorUnit.code);
        return makeResult(getUniqueCostEntriesByAccountNumber(savedEntries), 'saved', summaryMeta);
    }

    if (isGenerationPhaseLocked(currentPhase)) {
        summaryMeta.locked = true;
        return makeResult([], 'empty', summaryMeta);
    }

    // Nếu DB chưa có bút toán -> Đồng bộ và sinh mới theo quy tắc 2.7
    var generatedResult = syncExpenseEntryNowByInputDetails(details);
    if (generatedResult.data && generatedResult.data.length > 0) {
        applyCreatorUnitToEntries(generatedResult.data, creatorUnit.code);
        generatedResult.data = getUniqueCostEntriesByAccountNumber(generatedResult.data);
        generatedResult.accountingItems = mapAccountingTableItems(generatedResult.data);
    }
    copyObject(generatedResult, summaryMeta);
    return generatedResult;
}

function getUniqueCostEntriesByAccountNumber(entries) {
    var result = [];
    var usedCostAccounts = {};

    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (normalizeEntryType(entry.entry_type) === ENTRY_TYPE.COST) {
            var accountNumber = safeString(entry.account_number).trim();
            var accountKey = 'ref|' + safeString(entry.ref_id || entry['ref.id']).trim() +
                '|vendor|' + safeString(entry.vendor_id).trim() +
                '|account|' + accountNumber;
            if (accountNumber && usedCostAccounts[accountKey]) {
                usedCostAccounts[accountKey].amount += toNumber(entry.amount);
                continue;
            }
            if (accountNumber) {
                entry.amount = toNumber(entry.amount);
                usedCostAccounts[accountKey] = entry;
            }
        }
        result.push(entry);
    }

    return result;
}

function enrichExpenseEntriesWithNames(entries) {
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.branch) {
            var branchName = selectOne(TABLE_ENTITY, 'entity.code="' + escapeQueryValue(entry.branch) + '"', function (r) {
                return readText(r, 'branch.name');
            });
            if (branchName) {
                var prefix = getBranchNamePrefix(branchName);
                entry.branchLabel = entry.branch + ' - ' + prefix;
                entry.branchName = prefix;
                entry.branchEntityCode = entry.branch;
            }
        }
        if (entry.department) {
            if (entry.department === '000000') {
                entry.departmentLabel = '000000 - Không xác định';
                entry.departmentName = 'Không xác định';
            } else {
                var deptName = selectOne(TABLE_COST_CENTER, 'cost.center="' + escapeQueryValue(entry.department) + '"', function (r) {
                    return readText(r, 'name');
                });
                if (deptName) {
                    entry.departmentLabel = entry.department + ' - ' + deptName;
                    entry.departmentName = deptName;
                }
            }
        }
        if (entry.transaction_office) {
            if (entry.transaction_office === '0000000' || entry.transaction_office === '000000') {
                entry.transactionOfficeLabel = '0000000 - Không xác định';
                entry.transactionOfficeName = 'Không xác định';
            } else {
                var transOfficeName = selectOne(TABLE_ENTITY, 'entity.code="' + escapeQueryValue(entry.transaction_office) + '"', function (r) {
                    return readText(r, 'branch.name');
                });
                if (transOfficeName) {
                    var prefix = getTransFromNamePrefix(transOfficeName);
                    entry.transactionOfficeLabel = entry.transaction_office + ' - ' + prefix;
                    entry.transactionOfficeName = prefix;
                }
            }
        }
    }
}

function getTransFromNamePrefix(value) {
    var text = safeString(value).trim();
    var index = text.indexOf('-');
    return (index >= 0 ? text.substring(index + 1) : text).trim();
}

/** Đồng bộ và sinh bút toán Dự chi */
function syncExpenseEntryNowByInputDetails(details) {
    var expenseId = safeString(details.expenseId || details.paymentId || details.id).trim();
    var vendorId = safeString(details.vendorId).trim();
    var paymentVendorId = safeString(details.paymentVendorId || details.payment_vendor_id).trim();

    debugExpenseEntry(
        'SYNC-NOW-START',
        'expenseId=' + expenseId + ', vendorId=' + vendorId + ', paymentVendorId=' + paymentVendorId
    );

    if (!expenseId) {
        debugExpenseEntry('SYNC-NOW-SKIP', 'Thiếu expenseId.');
        return makeResult([], 'empty', {
            canGenerate: false,
            message: 'Thiếu mã đề nghị dự chi.',
            errors: ['Thiếu mã đề nghị dự chi.']
        });
    }

    var savedEntries = getSavedExpenseEntries(expenseId);
    var expectedResult = buildExpectedExpenseEntries(expenseId, vendorId, paymentVendorId);
    var expectedEntries = expectedResult.rows;
    var canGenerate = expectedResult.canGenerate;
    var generationErrors = expectedResult.errors || [];
    var successfulVendorIds = expectedResult.successfulVendorIds || [];
    var hasPartialSuccess = successfulVendorIds.length > 0;

    debugExpenseEntry(
        'SYNC-NOW-BUILD',
        'expenseId=' + expenseId +
        ', saved=' + savedEntries.length +
        ', expected=' + expectedEntries.length +
        ', canGenerate=' + canGenerate +
        ', errors=' + JSON.stringify(generationErrors)
    );

    if (!canGenerate && !hasPartialSuccess) {
        debugExpenseEntry('SYNC-NOW-NOT-GENERATED', 'expenseId=' + expenseId);
        return makeResult(savedEntries, savedEntries.length > 0 ? 'saved' : 'empty', makeGenerationErrorMeta(generationErrors));
    }

    if (hasPartialSuccess) {
        expectedEntries = expectedEntries.concat(
            getPreservedAutoEntriesForOtherVendors(savedEntries, successfulVendorIds)
        );
    }

    if (isGenerationPhaseLocked(expectedResult.currentPhase)) {
        debugExpenseEntry('SYNC-NOW-LOCKED', 'expenseId=' + expenseId + ', phase=' + expectedResult.currentPhase);
        return makeResult(savedEntries, savedEntries.length > 0 ? 'saved' : 'empty', {
            locked: true,
            currentPhase: expectedResult.currentPhase
        });
    }

    // Trường hợp không còn dòng kỳ vọng: xóa bút toán tự sinh, giữ nguyên bút toán thủ công
    if (expectedEntries.length === 0) {
        var cleared = replaceAutoExpenseEntries(expenseId, []);
        return makeResult(getSavedExpenseEntries(expenseId), 'synced', { sync: cleared });
    }

    // Lần đầu tiên sinh bút toán (DB rỗng) -> Chèn mới hoàn toàn
    if (savedEntries.length === 0) {
        assignNewEntryIds(expenseId, expectedEntries, savedEntries);
        var inserted = insertExpenseEntries(expectedEntries);

        debugExpenseEntry('SYNC-NOW-INSERT', 'expenseId=' + expenseId + ', inserted=' + inserted + '/' + expectedEntries.length);

        return makeResult(getSavedExpenseEntries(expenseId), 'generated', {
            canGenerate: canGenerate,
            partial: !canGenerate,
            errors: generationErrors,
            sync: {
                inserted: inserted,
                updated: 0,
                deleted: 0
            }
        });
    }

    // Gộp thông tin người dùng đã chỉnh sửa trên UI vào bút toán mới
    var mergedExpectedEntries = mergeEditableAutoEntryFields(savedEntries, expectedEntries);

    // Xóa bút toán tự động cũ, gán ID cho dòng mới và chèn lại
    var deleted = deleteAutoExpenseEntries(expenseId);
    var remainingEntries = getSavedExpenseEntries(expenseId);
    assignNewEntryIds(expenseId, mergedExpectedEntries, remainingEntries);

    var inserted = insertExpenseEntries(mergedExpectedEntries);
    var syncResult = { inserted: inserted, updated: 0, deleted: deleted };

    debugExpenseEntry(
        'SYNC-NOW-REPLACE',
        'expenseId=' + expenseId + ', deleted=' + deleted + ', inserted=' + inserted + '/' + mergedExpectedEntries.length
    );

    return makeResult(getSavedExpenseEntries(expenseId), 'synced', {
        canGenerate: canGenerate,
        partial: !canGenerate,
        errors: generationErrors,
        sync: syncResult
    });
}

function getPreservedAutoEntriesForOtherVendors(savedEntries, successfulVendorIds) {
    var successfulMap = {};
    var result = [];

    for (var i = 0; i < successfulVendorIds.length; i++) {
        successfulMap[safeString(successfulVendorIds[i]).trim()] = true;
    }

    for (var j = 0; j < savedEntries.length; j++) {
        var saved = savedEntries[j];
        if (!isAutoEntry(saved)) continue;
        if (successfulMap[safeString(saved.ref_id || saved['ref.id']).trim()]) continue;
        result.push(copyObject({}, saved));
    }

    return result;
}

// -----------------------------------------------------------------------------
// SECTION 02A - SOURCE CHANGE: đồng bộ bút toán khi bảng nguồn thay đổi
// -----------------------------------------------------------------------------

function syncExpenseEntryBySourceChange(sourceTable, sourceRecord) {
    var source = sourceRecord || {};
    var expenseIds = resolveExpenseIdsFromSourceChange(sourceTable, source);
    var isPaymentVendorSource = normalizeSourceTableName(sourceTable) ===
        normalizeSourceTableName(TABLE_PAYMENT_VENDOR);
    var sourcePaymentVendorId = isPaymentVendorSource ? safeString(source['id']).trim() : '';
    var results = [];
    var errors = [];

    debugExpenseEntry(
        'SOURCE-SYNC-START',
        'sourceTable=' + safeString(sourceTable) +
        ', sourceId=' + safeString(source['id']) +
        ', paymentId=' + safeString(source['payment.id']) +
        ', expenseIds=' + JSON.stringify(expenseIds)
    );

    for (var i = 0; i < expenseIds.length; i++) {
        var syncResult = syncExpenseEntryNowByInputDetails({
            expenseId: expenseIds[i],
            vendorId: '',
            paymentVendorId: sourcePaymentVendorId
        });
        results.push(syncResult);

        debugExpenseEntry(
            'SOURCE-SYNC-RESULT',
            'expenseId=' + expenseIds[i] + ', result=' + JSON.stringify(syncResult)
        );

        if (syncResult.canGenerate === false) {
            var syncErrors = syncResult.errors || [];
            if (syncErrors.length > 0) {
                for (var errorIndex = 0; errorIndex < syncErrors.length; errorIndex++) {
                    errors.push(expenseIds[i] + ': ' + syncErrors[errorIndex]);
                }
            } else if (syncResult.message) {
                errors.push(expenseIds[i] + ': ' + syncResult.message);
            }
        }
    }

    if (expenseIds.length === 0) {
        errors.push('Không xác định được mã đề nghị dự chi từ dữ liệu nguồn.');
    }

    errors = makeUniqueTextList(errors);
    var response = {
        success: true,
        mode: 'source-change-sync',
        sourceTable: sourceTable || '',
        affectedExpenseIds: expenseIds,
        results: results,
        canGenerate: errors.length === 0
    };

    if (errors.length > 0) {
        response.message = errors.join(' ');
        response.errors = errors;
    }

    return response;
}

function resolveExpenseIdsFromSourceChange(sourceTable, sourceRecord) {
    var table = normalizeSourceTableName(sourceTable);

    if (table === normalizeSourceTableName(TABLE_PAYMENT)) {
        return makeUniqueTextList([readText(sourceRecord, 'id')]);
    }

    if (table === normalizeSourceTableName(TABLE_PAYMENT_VENDOR)) {
        return makeUniqueTextList([readText(sourceRecord, 'payment.id')]);
    }

    if (table === normalizeSourceTableName(TABLE_PAYMENT_INVOICE)) {
        var directId = readText(sourceRecord, 'payment.id');
        if (directId) return makeUniqueTextList([directId]);
        return getExpenseIdsByInvoiceId(readText(sourceRecord, 'invoice.id'));
    }

    if (table === normalizeSourceTableName(TABLE_COST_DIVISION)) {
        return makeUniqueTextList([readText(sourceRecord, 'payment.id')]);
    }

    if (table === normalizeSourceTableName(TABLE_INVOICE)) {
        return getExpenseIdsByInvoiceId(readText(sourceRecord, 'id'));
    }

    if (table === normalizeSourceTableName(TABLE_VENDOR)) {
        return getExpenseIdsByVendorId(readText(sourceRecord, 'id'));
    }

    if (table === normalizeSourceTableName(TABLE_VENDOR_SITE)) {
        return getExpenseIdsByVendorSite(sourceRecord);
    }

    return [];
}

function normalizeSourceTableName(value) {
    return safeString(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getExpenseIdsByInvoiceId(invoiceId) {
    var safeInvoiceId = safeString(invoiceId);
    if (!safeInvoiceId) return [];
    return getExpenseIdsFromTable(
        TABLE_PAYMENT_INVOICE,
        'invoice.id="' + escapeQueryValue(safeInvoiceId) + '"'
    );
}

function getExpenseIdsByVendorId(vendorId) {
    var safeVendorId = safeString(vendorId).trim();
    if (!safeVendorId) return [];
    return getExpenseIdsFromTable(
        TABLE_PAYMENT_VENDOR,
        'vendor.id="' + escapeQueryValue(safeVendorId) + '"'
    );
}

function getExpenseIdsByVendorSite(sourceRecord) {
    var vendorSiteId = readText(sourceRecord, 'id');
    if (!vendorSiteId) return [];
    return getExpenseIdsFromTable(
        TABLE_PAYMENT_VENDOR,
        'vendor.site.id="' + escapeQueryValue(vendorSiteId) + '"'
    );
}

function getExpenseIdsFromTable(tableName, query) {
    var result = [];
    var f = new SCFile(tableName, SCFILE_READONLY);
    var rc;

    try {
        rc = f.doSelect(query);
    } catch (e) {
        closeFile(f);
        return result;
    }

    while (rc === RC_SUCCESS) {
        result.push(readText(f, 'payment.id'));
        rc = f.getNext();
    }

    closeFile(f);
    return makeUniqueTextList(result);
}

// =============================================================================
// SUPPORT - INPUT / RESPONSE HELPERS
// =============================================================================

function getInputDetails(input) {
    var parsed = {};

    copyObject(parsed, parseJsonObject(input.queryString));
    copyObject(parsed, parseJsonObject(input.details));

    if (!parsed.expenseId) parsed.expenseId = input.expenseId || input.paymentId || input.id;
    if (!parsed.paymentId) parsed.paymentId = parsed.expenseId;
    if (!parsed.vendorId && input.vendorId) parsed.vendorId = input.vendorId;
    if (!parsed.entries && input.entries) parsed.entries = input.entries;

    return parsed;
}

function copyObject(target, source) {
    if (!source) return target;

    for (var key in source) {
        if (source.hasOwnProperty(key)) target[key] = source[key];
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

function makeResult(rows, mode, meta) {
    var data = rows || [];
    var result = {
        success: true,
        mode: mode,
        data: data,
        accountingItems: mapAccountingTableItems(data)
    };

    if (meta) {
        for (var key in meta) {
            if (meta.hasOwnProperty(key)) result[key] = meta[key];
        }
    }

    return result;
}

function makeGenerationErrorMeta(errors) {
    var uniqueErrors = makeUniqueTextList(errors || []);

    return {
        canGenerate: false,
        message: uniqueErrors.length > 0 ? uniqueErrors.join(' ') : 'Không đủ dữ liệu để sinh bút toán.',
        errors: uniqueErrors
    };
}

// =============================================================================
// SECTION 03 - SAVE CHỈNH SỬA: validate dữ liệu UI và ghi lại toàn bộ bút toán
// =============================================================================

function getAccountingSide(value) {
    var accountType = normalizeBusinessText(value).replace(/\s+/g, '');
    if (accountType === 'debit') return 'debit';
    if (accountType === 'asset') return 'credit';
    return '';
}

function mapAccountingTableItems(rows) {
    var groups = {};
    var keys = [];
    var list = rows || [];

    for (var i = 0; i < list.length; i++) {
        var row = list[i];
        var key = safeString(row.vendor_id).trim() + '|' +
            safeString(row.vendor_site_id).trim() + '|' +
            safeString(row.vendor_site_code).trim();

        if (!groups[key]) {
            groups[key] = { items: [], totalDebt: 0, totalCr: 0 };
            keys.push(key);
        }

        var side = getAccountingSide(row.account_type);
        var amount = toNumber(row.amount);
        var debtAmount = side === 'debit' ? amount : 0;
        var crAmount = side === 'credit' ? amount : 0;

        groups[key].items.push({
            id: safeString(row.id).trim(),
            stt: toNumber(row.order),
            accountNumner: safeString(row.account_number).trim(),
            accountName: safeString(row.account_name).trim(),
            bankName: '',
            description: safeString(row.description).trim(),
            debtAmount: debtAmount,
            crAmount: crAmount
        });
        groups[key].totalDebt += debtAmount;
        groups[key].totalCr += crAmount;
    }

    var result = [];
    for (var kIdx = 0; kIdx < keys.length; kIdx++) {
        result.push(groups[keys[kIdx]]);
    }
    return result;
}

// -----------------------------------------------------------------------------
// SECTION 03A - DANH MỤC GL: hỗ trợ chọn tài khoản khi chỉnh sửa
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// SECTION 03B - VALIDATE SAVE: chuẩn hóa từng dòng và kiểm tra dữ liệu bắt buộc
// -----------------------------------------------------------------------------

function normalizeEntryType(value) {
    var type = safeString(value).trim().toUpperCase();
    if (type === ENTRY_TYPE.COST) return ENTRY_TYPE.COST;
    if (type === ENTRY_TYPE.TAX) return ENTRY_TYPE.TAX;
    if (type === ENTRY_TYPE.PAYABLE) return ENTRY_TYPE.PAYABLE;
    if (type === ENTRY_TYPE.OTHER) return ENTRY_TYPE.OTHER;
    return '';
}

function getEntryTypeByRuleCode(entryCode) {
    if (entryCode === AUTO_ENTRY_CODE.COST) return ENTRY_TYPE.COST;
    if (entryCode === AUTO_ENTRY_CODE.TAX) return ENTRY_TYPE.TAX;
    if (entryCode === AUTO_ENTRY_CODE.LIABILITY) return ENTRY_TYPE.PAYABLE;
    return ENTRY_TYPE.OTHER;
}

// =============================================================================
// SECTION 04/05 - QUY TẮC SINH BÚT TOÁN TỰ ĐỘNG DỰ CHI (2.7)
// =============================================================================

/**
 * 2.7. Quy tắc sinh bút toán tự động:
 * Mỗi món dự chi gắn với một HĐ/KMS và một NCC, luôn phát sinh tối thiểu:
 * - Ghi Nợ TK Chi phí (TT-BK-01*)
 * - Ghi Có TK Phải trả NCC (TT-BK-03*)
 * Bút toán thuế GTGT (TT-BK-02) chỉ phát sinh khi hóa đơn NCC có thuế khấu trừ (DC_BR_01).
 */
function buildExpectedExpenseEntries(expenseId, vendorId, paymentVendorId) {
    var request = getExpenseRequest(expenseId);
    var creatorUnit = getCreatorAccountingUnit(request.created_by);
    request.creator_unit_code = creatorUnit.code;
    request.default_transaction_office_code = getDefaultTransactionOfficeCode(
        getTransactionOfficeOptions(creatorUnit.lv1Id)
    );

    var vendors = getExpenseVendors(expenseId, vendorId, paymentVendorId);
    var rows = [];
    var errors = [];
    var successfulVendorIds = [];
    var canGenerate = true;

    if (!request.id) {
        return {
            rows: [],
            canGenerate: false,
            errors: ['Không có dữ liệu ở bảng ' + TABLE_PAYMENT + '.'],
            successfulVendorIds: [],
            currentPhase: ''
        };
    }

    for (var vi = 0; vi < vendors.length; vi++) {
        vendors[vi] = enrichVendor(vendors[vi]);
    }

    for (var i = 0; i < vendors.length; i++) {
        var vendor = vendors[i];
        var vendorErrors = getVendorAutoEntryErrors(vendor);
        if (vendorErrors.length > 0) {
            canGenerate = false;
            errors = errors.concat(vendorErrors);
            continue;
        }

        var context = buildExpenseCaseContext(
            expenseId,
            request,
            vendor,
            vendors.length,
            rows.length + 1
        );

        if (context.errors.length > 0) {
            canGenerate = false;
            errors = errors.concat(context.errors);
            continue;
        }

        // Sinh bút toán theo quy tắc 2.7
        var vendorRows = buildExpenseCaseEntries(context);
        var rowErrors = getAutoEntryRowsErrors(vendorRows);
        if (rowErrors.length > 0) {
            canGenerate = false;
            errors = errors.concat(rowErrors);
            continue;
        }

        rows = rows.concat(vendorRows);
        successfulVendorIds.push(vendor.payment_vendor_id);
    }

    return {
        rows: rows,
        canGenerate: canGenerate,
        errors: makeUniqueTextList(errors),
        successfulVendorIds: successfulVendorIds,
        currentPhase: request.current_phase
    };
}

/**
 * Gom ngữ cảnh thông tin một món dự chi / NCC
 */
function buildExpenseCaseContext(expenseId, request, vendor, vendorCount, firstOrder) {
    var taxInfo = getExpenseInvoiceTaxInfo(expenseId, vendor, vendorCount);
    var hasInvoice = hasLinkedInvoicesForVendor(expenseId, vendor, vendorCount);
    var expenseAmount = toNumber(vendor.amount); // Số tiền dự chi do NSD nhập

    var errors = taxInfo.errors.slice(0);

    return {
        expenseId: expenseId,
        paymentId: expenseId,
        request: request,
        vendor: vendor,
        vendorCount: vendorCount,
        expenseAmount: expenseAmount,
        hasInvoice: hasInvoice,
        hasTax: taxInfo.hasDeductibleTax,
        taxInfo: taxInfo,
        firstOrder: firstOrder,
        errors: errors
    };
}

/**
 * 2.7.2. Sinh 3 dòng bút toán theo danh mục:
 * 1. TT-BK-01*: Ghi nhận chi phí (Nợ) = Số tiền dự chi - Thuế khấu trừ
 * 2. TT-BK-02 : Dòng thuế GTGT (Nợ)   = Số tiền thuế trên hóa đơn (nếu có thuế khấu trừ theo DC_BR_01)
 * 3. TT-BK-03*: Ghi nhận nghĩa vụ TT (Có) = Số tiền dự chi
 */
function buildExpenseCaseEntries(c) {
    var rows = [];
    var order = c.firstOrder;
    var totalTaxAmount = c.hasTax ? c.taxInfo.totalDeductibleTax : 0;
    var costAmount = Math.max(0, c.expenseAmount - totalTaxAmount);

    // Dòng 1: TT-BK-01* - Ghi nhận chi phí (Nợ)
    if (c.expenseAmount > 0) {
        rows.push(buildExpenseEntryRow({
            expenseId: c.expenseId,
            request: c.request,
            vendor: c.vendor,
            entryCode: AUTO_ENTRY_CODE.COST,
            amount: costAmount,
            order: order++,
            accountOverride: {
                number: c.vendor.debit_account,
                name: getGlAccountName(c.vendor.debit_account)
            }
        }));
    }

    // Dòng 2: TT-BK-02 - Dòng thuế GTGT (Nợ) (chỉ sinh khi có thuế khấu trừ)
    if (c.hasTax && totalTaxAmount > 0) {
        for (var tIdx = 0; tIdx < c.taxInfo.groups.length; tIdx++) {
            var taxGroup = c.taxInfo.groups[tIdx];
            rows.push(buildExpenseEntryRow({
                expenseId: c.expenseId,
                request: c.request,
                vendor: c.vendor,
                entryCode: AUTO_ENTRY_CODE.TAX,
                amount: taxGroup.amount,
                order: order++,
                taxInfo: taxGroup
            }));
        }
    }

    // Dòng 3: TT-BK-03* - Ghi nhận nghĩa vụ thanh toán (Có)
    if (c.expenseAmount > 0) {
        rows.push(buildExpenseEntryRow({
            expenseId: c.expenseId,
            request: c.request,
            vendor: c.vendor,
            entryCode: AUTO_ENTRY_CODE.LIABILITY,
            amount: c.expenseAmount,
            order: order++,
            accountOverride: {
                number: c.vendor.credit_account,
                name: getGlAccountName(c.vendor.credit_account)
            }
        }));
    }

    return rows;
}

function buildExpenseEntryRow(params) {
    var account = params.accountOverride || resolveAccount(params.entryCode, params.vendor, params.taxInfo || {});
    var entryType = getEntryTypeByRuleCode(params.entryCode);
    var beneficiary = getBeneficiaryByEntryType(entryType, params.vendor);
    var branch = params.branchOverride || params.request.creator_unit_code || '';
    var contractId = safeString(params.vendor && params.vendor.contract_id || params.contractId || '').trim();

    return {
        id: '',
        payment_id: params.expenseId,
        contract_id: contractId,
        entry_type: entryType,
        rule_code: params.entryCode,
        ledger_type: LEDGER_TYPE.STANDARD,
        account_type: getAutoAccountType(params.entryCode),
        account_number: account.number,
        account_name: account.name,
        branch: formatSegment1(branch, GL_DEFAULT_ENTITY_CODE),
        department: params.departmentOverride || GL_DEFAULT_COST_CENTER,
        transaction_office: params.transactionOfficeOverride || GL_DEFAULT_TRANSACTION_OFFICE,
        amount: params.amount,
        currency: params.vendor.currency,
        description: safeString(params.vendor.transaction_description).trim(),
        vendor_id: params.vendor.vendor_id,
        ref_id: params.vendor.payment_vendor_id,
        type: TYPE.AP,
        order: params.order,
        accounting_request_id: '',
        payment_method: params.vendor.payment_method,
        beneficiary_account: beneficiary.account,
        beneficiary_name: beneficiary.name,
        beneficiary_bank: beneficiary.bank,
        bank_name: beneficiary.bank_name
    };
}

function getAutoAccountType(entryCode) {
    if (entryCode === AUTO_ENTRY_CODE.LIABILITY) return ACCOUNT_TYPE.ASSET; // Có
    return ACCOUNT_TYPE.DEBIT; // Nợ (COST, TAX)
}

function resolveAccount(entryCode, vendor, taxInfo) {
    if (entryCode === AUTO_ENTRY_CODE.TAX) {
        return {
            number: taxInfo.accountNumber,
            name: taxInfo.accountName
        };
    }

    if (entryCode === AUTO_ENTRY_CODE.LIABILITY) {
        return {
            number: vendor.credit_account,
            name: getGlAccountName(vendor.credit_account)
        };
    }

    return {
        number: vendor.debit_account,
        name: getGlAccountName(vendor.debit_account)
    };
}

function getBeneficiaryByEntryType(entryType, vendor) {
    var normalizedType = normalizeEntryType(entryType);

    if (normalizedType === ENTRY_TYPE.PAYABLE) {
        return {
            account: safeString(vendor && vendor.beneficiary_account).trim(),
            name: safeString(vendor && vendor.beneficiary_name).trim(),
            bank: safeString(vendor && vendor.beneficiary_bank).trim(),
            bank_name: safeString(vendor && vendor.bank_name).trim()
        };
    }

    if (normalizedType === ENTRY_TYPE.COST) {
        return { account: '', name: 'VietinBank', bank: '' };
    }

    return { account: '', name: '', bank: '' };
}

// -----------------------------------------------------------------------------
// SECTION 04C - DC_BR_01: QUY TẮC XÁC ĐỊNH GIÁ TRỊ ĐIỀU KIỆN CÓ/KHÔNG CÓ THUẾ
// -----------------------------------------------------------------------------

/**
 * DC_BR_01: Quy tắc Xác định giá trị Điều kiện 1: Có/Không có thuế
 * Output = "Không":
 * - Đề nghị không gắn hóa đơn, HOẶC
 * - Đề nghị có gắn hóa đơn và Loại khấu trừ = "Không khấu trừ" (KHAUTRU_003), HOẶC
 * - Đề nghị có gắn hóa đơn, Loại khấu trừ khác "Không khấu trừ", và Số tiền thuế = 0
 *
 * Output = "Có":
 * - Có gắn hóa đơn, Loại khấu trừ khác "Không khấu trừ", và Số tiền thuế > 0
 */
function getExpenseInvoiceTaxInfo(expenseId, vendor, vendorCount) {
    var links = getExpenseLinkedInvoices(expenseId);
    var taxAmounts = {};
    var deductionTypes = [DEDUCTION_TYPE_FULL, DEDUCTION_TYPE_RATE];
    var result = {
        totalDeductibleTax: 0,
        hasDeductibleTax: false,
        groups: [],
        errors: []
    };

    taxAmounts[DEDUCTION_TYPE_FULL] = 0;
    taxAmounts[DEDUCTION_TYPE_RATE] = 0;

    for (var i = 0; i < links.length; i++) {
        var invoice = getInvoiceById(links[i].invoice_id);
        if (!isInvoiceForVendor(invoice, vendor, vendorCount, links[i])) continue;

        var taxAmount = toNumber(invoice.total_tax);
        if (taxAmount <= 0) continue;

        var deductionType = links[i].deduction_type;
        if (!deductionType) {
            result.errors.push('Hóa đơn ' + links[i].invoice_id + ': thiếu deduction.type tại ' + TABLE_PAYMENT_INVOICE + '.');
            continue;
        }

        var deductionTypeCode = safeString(deductionType).trim().toUpperCase();
        if (deductionTypeCode === DEDUCTION_TYPE_NONE) continue; // Không khấu trừ

        if (deductionTypeCode !== DEDUCTION_TYPE_FULL && deductionTypeCode !== DEDUCTION_TYPE_RATE) {
            result.errors.push('Hóa đơn ' + links[i].invoice_id + ': deduction.type không hợp lệ (' + deductionType + ').');
            continue;
        }

        taxAmounts[deductionTypeCode] += taxAmount;
    }

    for (var typeIndex = 0; typeIndex < deductionTypes.length; typeIndex++) {
        var deductionTypeCode = deductionTypes[typeIndex];
        var groupedTaxAmount = taxAmounts[deductionTypeCode];
        if (groupedTaxAmount <= 0) continue;

        var taxAccount = getTaxDeductionAccount(deductionTypeCode);
        result.groups.push({
            deductionType: deductionTypeCode,
            amount: groupedTaxAmount,
            accountNumber: taxAccount.number,
            accountName: taxAccount.name
        });
        result.totalDeductibleTax += groupedTaxAmount;
        if (taxAccount.error) result.errors.push(taxAccount.error);
    }

    result.hasDeductibleTax = result.groups.length > 0;
    result.errors = makeUniqueTextList(result.errors);

    return result;
}

function getTaxDeductionAccount(deductionType) {
    var itemId = safeString(deductionType).trim();
    var deductionItem = null;
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
    var accountName = accountNumber ? getGlAccountName(accountNumber) : '';

    if (!accountName && itemId) {
        deductionItem = selectOne(
            TABLE_CATEGORY_ITEM,
            'category.id="' + escapeQueryValue(CATEGORY_TAX_DEDUCTION_TYPE) + '" and item.id="' + escapeQueryValue(itemId) + '"',
            function (record) {
                return { itemName: readText(record, 'item.name') };
            }
        );
        accountName = deductionItem ? safeString(deductionItem.itemName).trim() : '';
    }

    return {
        number: accountNumber,
        name: accountName
    };
}

function hasLinkedInvoicesForVendor(expenseId, vendor, vendorCount) {
    var links = getExpenseLinkedInvoices(expenseId);

    for (var i = 0; i < links.length; i++) {
        var invoice = getInvoiceById(links[i].invoice_id);
        if (isInvoiceForVendor(invoice, vendor, vendorCount, links[i])) return true;
    }

    return false;
}

function isInvoiceForVendor(invoice, vendor, vendorCount, invoiceLink) {
    if (invoiceLink) {
        // 1. Khớp trực tiếp theo vendor.id trên bảng esdHTKTpaymentInvoice
        var linkVendorId = safeString(invoiceLink.vendor_id).trim();
        var targetVendorId = safeString(vendor && vendor.vendor_id).trim();

        if (linkVendorId && targetVendorId) {
            if (linkVendorId !== targetVendorId) {
                return false;
            }
            // Nếu có cả contract.id trên hóa đơn và NCC thì kiểm tra khớp thêm contract.id
            var linkContractId = safeString(invoiceLink.contract_id).trim();
            var targetContractId = safeString(vendor && vendor.contract_id).trim();
            if (linkContractId && targetContractId) {
                return linkContractId === targetContractId;
            }
            return true;
        }

        // 2. Nếu hóa đơn có gắn contract.id nhưng chưa có vendor_id trên link
        var linkContract = safeString(invoiceLink.contract_id).trim();
        var targetContract = safeString(vendor && vendor.contract_id).trim();
        if (linkContract && targetContract && linkContract !== targetContract) {
            return false;
        }
    }

    // 3. Đối soát theo Mã số thuế bên bán (seller.tax.code) và MST NCC (vendor.number)
    var sellerTaxCode = normalizeIdentity(invoice.seller_tax_code);
    var vendorTaxCode = normalizeIdentity(vendor && vendor.vendor_number);

    if (sellerTaxCode && vendorTaxCode) return sellerTaxCode === vendorTaxCode;

    return vendorCount <= 1;
}

function getExpenseLinkedInvoices(expenseId) {
    var list = [];
    var f = new SCFile(TABLE_PAYMENT_INVOICE, SCFILE_READONLY);
    var rc;

    try {
        rc = f.doSelect('payment.id="' + escapeQueryValue(expenseId) + '"');
    } catch (e) {
        closeFile(f);
        return list;
    }

    while (rc === RC_SUCCESS) {
        var invoiceId = readText(f, 'invoice.id');
        if (invoiceId) {
            list.push({
                invoice_id: invoiceId,
                contract_id: readText(f, 'contract.id'),
                vendor_id: readText(f, 'vendor.id'),
                deduction_type: readText(f, 'deduction.type'),
                deduction_amount: readNumber(f, 'deduction.amount'),
                deduction_rate: readNumber(f, 'deduction.rate')
            });
        }
        rc = f.getNext();
    }

    closeFile(f);
    return list;
}

function getInvoiceById(invoiceId) {
    if (!invoiceId) return {};

    return (
        selectOne(TABLE_INVOICE, 'id="' + escapeQueryValue(invoiceId) + '"', function (record) {
            return {
                id: readText(record, 'id'),
                total_tax: readNumber(record, 'total.tax'),
                exchange_rate: readNumber(record, 'exchange.rate'),
                seller_tax_code: readText(record, 'seller.tax.code')
            };
        }) || {}
    );
}

// =============================================================================
// SECTION 06 - VALIDATE: tài khoản, số tiền và các trường bắt buộc
// =============================================================================

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
    var entryCode = safeString(row.rule_code || row.entry_type).trim();
    var vendorLabel = safeString(row.vendor_name).trim() || safeString(row.vendor_id).trim();
    var vendorReference = vendorLabel ? ' của nhà cung cấp ' + vendorLabel : '';

    if (!row.payment_id) {
        errors.push(subject + ' chưa xác định được Số đề nghị dự chi. Vui lòng kiểm tra lại.');
    }
    if (!row.vendor_id) {
        errors.push(subject + ' chưa xác định được Nhà cung cấp. Vui lòng kiểm tra lại.');
    }
    if (!row.currency) {
        errors.push(subject + vendorReference + ' chưa chọn Loại tiền. Vui lòng kiểm tra lại.');
    }

    if (!row.account_number) {
        if (entryCode === AUTO_ENTRY_CODE.COST) {
            // Cho phép sinh dòng chi phí chưa chọn tài khoản để KT nhập sau
        } else if (entryCode === AUTO_ENTRY_CODE.TAX) {
            errors.push(subject + vendorReference + ' chưa được thiết lập Tài khoản thuế GTGT đầu vào. Vui lòng kiểm tra lại.');
        } else if (entryCode === AUTO_ENTRY_CODE.LIABILITY) {
            errors.push(subject + vendorReference + ' chưa được thiết lập Tài khoản công nợ phải trả tại danh mục Site NCC. Vui lòng kiểm tra lại.');
        }
    }

    return errors;
}

function getVendorAutoEntryErrors(vendor) {
    var errors = [];
    var vendorName = safeString(vendor.vendor_name || vendor.name).trim();
    var vendorId = safeString(vendor.vendor_id || vendor.id).trim();
    var subject = vendorName ? 'Nhà cung cấp ' + vendorName : (vendorId ? 'Nhà cung cấp ' + vendorId : 'Nhà cung cấp');

    if (!vendor.vendor_id) {
        errors.push('Hồ sơ đề nghị chưa lựa chọn Nhà cung cấp. Vui lòng kiểm tra lại.');
    }
    if (!vendor.vendor_site_id) {
        errors.push(subject + ' chưa có thông tin Site nhà cung cấp. Vui lòng kiểm tra lại.');
    }
    if (vendor.vendor_site_id && !vendor.vendor_site_code) {
        errors.push(subject + ' chưa có thông tin Site nhà cung cấp. Vui lòng kiểm tra lại.');
    }
    if (!vendor.currency) {
        errors.push(subject + ' chưa chọn Loại tiền. Vui lòng kiểm tra lại.');
    }

    return errors;
}

// =============================================================================
// SECTION 04E - READ SOURCE DATA: phiếu dự chi, NCC và Vendor Site
// =============================================================================

function getExpenseRequest(expenseId) {
    if (!expenseId) return {};

    return (
        selectOne(TABLE_PAYMENT, 'id="' + escapeQueryValue(expenseId) + '"', function (record) {
            return {
                id: readText(record, 'id'),
                department: readText(record, 'department'),
                description: readText(record, 'description'),
                current_phase: readText(record, 'current.phase'),
                user_checker_kttc: readText(record, 'user.checker.kttc'),
                initial_role: readText(record, 'initial.role'),
                created_by: readText(record, 'created.by'),
                total_advance_amount: readNumber(record, 'total.advance.amount'),
                total_amount_paid: readNumber(record, 'total.amount.paid'),
                total_tax_amount: readNumber(record, 'total.tax.amount'),
                currency: readText(record, 'currency') || readText(record, 'currentcy')
            };
        }) || {}
    );
}

function getExpenseVendors(expenseId, vendorId, paymentVendorId) {
    var list = [];
    var f = new SCFile(TABLE_PAYMENT_VENDOR, SCFILE_READONLY);
    var query = 'payment.id="' + escapeQueryValue(expenseId) + '"';
    var rc;

    if (paymentVendorId) {
        query += ' and id="' + escapeQueryValue(paymentVendorId) + '"';
    } else if (vendorId) {
        query += ' and vendor.id="' + escapeQueryValue(vendorId) + '"';
    }

    try {
        rc = f.doSelect(query);
    } catch (e) {
        closeFile(f);
        return list;
    }

    while (rc === RC_SUCCESS) {
        list.push({
            payment_vendor_id: readText(f, 'id'),
            vendor_id: readText(f, 'vendor.id'),
            vendor_site_id: readText(f, 'vendor.site.id'),
            contract_id: readText(f, 'contract.id'),
            amount: readNumber(f, 'amount'),
            currency: readText(f, 'currency'),
            payment_method: readText(f, 'payment.method'),
            bank_name: readText(f, 'bank.name'),
            beneficiary_account: readText(f, 'beneficiary.account'),
            beneficiary_name: readText(f, 'beneficiary.name'),
            beneficiary_bank: readText(f, 'beneficiary.bank'),
            transaction_description: readText(f, 'transaction.des'),
            exchange_rate: readText(f, 'exchange.rate'),
            tax_amount: readNumber(f, 'tax.amount') || readNumber(f, 'tax_amount')
        });

        rc = f.getNext();
    }

    closeFile(f);
    return list;
}

function enrichVendor(vendor) {
    var vendorInfo = getVendorInfo(vendor.vendor_id);
    var siteInfo = getVendorSiteInfo(vendor.vendor_site_id, vendor.vendor_id);

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

function getVendorSiteInfo(vendorSiteId, vendorId) {
    if (!vendorSiteId) return {};

    var exact = selectOne(
        TABLE_VENDOR_SITE,
        'id="' + escapeQueryValue(vendorSiteId) + '"',
        function (record) {
            return {
                vendor_site_code: readText(record, 'ogl.site.code'),
                debit_account: extractAccountNumber(readText(record, 'debit.account')),
                credit_account: extractAccountNumber(readText(record, 'credit.account'))
            };
        }
    );
    if (exact) return exact;

    var f = new SCFile(TABLE_VENDOR_SITE, SCFILE_READONLY);
    var query = vendorId ? 'vendor.id="' + escapeQueryValue(vendorId) + '"' : '';
    var rc;
    var onlyCandidate = null;
    var candidateCount = 0;
    try {
        rc = f.doSelect(query);
        while (rc === RC_SUCCESS) {
            candidateCount++;
            onlyCandidate = {
                vendor_site_code: readText(f, 'ogl.site.code'),
                debit_account: extractAccountNumber(readText(f, 'debit.account')),
                credit_account: extractAccountNumber(readText(f, 'credit.account'))
            };
            if (lookupIdsEqual(readText(f, 'id'), vendorSiteId)) {
                closeFile(f);
                return onlyCandidate;
            }
            rc = f.getNext();
        }
    } catch (e) {}
    closeFile(f);
    if (candidateCount === 1) {
        return onlyCandidate;
    }
    return {};
}

function lookupIdsEqual(left, right) {
    var a = safeString(left).trim();
    var b = safeString(right).trim();
    if (a === b) return true;
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
        return a.replace(/^0+/, '') === b.replace(/^0+/, '');
    }
    return false;
}

// =============================================================================
// SECTION 07 - PERSISTENCE / SAVE DB: đọc, merge, xóa và insert paymentEntry
// =============================================================================

function getSavedExpenseEntries(expenseId) {
    var fields = getExpenseEntryFields();
    var sql =
        'SELECT ' +
        selectFields(fields) +
        ' FROM ' +
        TABLE_PAYMENT_ENTRY +
        ' e LEFT JOIN ' +
        TABLE_PAYMENT_VENDOR +
        ' pv ON (e.ref.id = pv.id AND e.payment.id = pv.payment.id)' +
        ' LEFT JOIN ' +
        TABLE_VENDOR +
        ' v ON (e.vendor.id = v.id)' +
        ' LEFT JOIN ' +
        TABLE_VENDOR_SITE +
        ' vs ON (pv.vendor.site.id = vs.id)' +
        ' WHERE e.payment.id="' +
        escapeQueryValue(expenseId) +
        '" ORDER BY e.order ASC';

    var entries = selectList(TABLE_PAYMENT_ENTRY, sql, fields);
    enrichExpenseEntriesWithNames(entries);
    return entries;
}

function getExpenseEntryFields() {
    return [
        ['e.id', 'id', 'S'],
        ['e.payment.id', 'payment_id', 'S'],
        ['e.contract.id', 'contract_id', 'S'],
        ['e.entry.type', 'entry_type', 'S'],
        ['e.ledger.type', 'ledger_type', 'S'],
        ['e.account.type', 'account_type', 'S'],
        ['e.account.number', 'account_number', 'S'],
        ['e.account.name', 'account_name', 'S'],
        ['e.branch', 'branch', 'S'],
        ['e.department', 'department', 'S'],
        ['e.transaction.code', 'transaction_office', 'S'],
        ['e.amount', 'amount', 'N?'],
        ['e.currency', 'currency', 'S'],
        ['e.description', 'description', 'S'],
        ['e.vendor.id', 'vendor_id', 'S'],
        ['v.vendor.name', 'vendor_name', 'S'],
        ['e.type', 'type', 'S'],
        ['e.order', 'order', 'N'],
        ['e.accounting.request.id', 'accounting_request_id', 'S'],
        ['e.ref.id', 'ref_id', 'S'],
        ['e.ap.code', 'ap_code', 'S'],
        ['pv.vendor.site.id', 'vendor_site_id', 'S'],
        ['vs.ogl.site.code', 'vendor_site_code', 'S'],
        ['pv.payment.method', 'payment_method', 'S'],
        ['pv.beneficiary.account', 'beneficiary_account', 'S'],
        ['pv.beneficiary.name', 'beneficiary_name', 'S'],
        ['pv.beneficiary.bank', 'beneficiary_bank', 'S'],
        ['pv.bank.name', 'bank_name', 'S']
    ];
}

function mergeEditableAutoEntryFields(savedEntries, expectedEntries) {
    var savedMap = {};
    var result = [];

    for (var i = 0; i < savedEntries.length; i++) {
        var saved = savedEntries[i];
        if (!isAutoEntry(saved)) continue;

        var savedEntryKey = makeAutoEntryMatchKey(saved);
        if (!savedEntryKey) continue;

        if (!savedMap[savedEntryKey]) savedMap[savedEntryKey] = [];
        savedMap[savedEntryKey].push(saved);
    }

    for (var j = 0; j < expectedEntries.length; j++) {
        var expected = copyObject({}, expectedEntries[j]);
        var expectedEntryKey = makeAutoEntryMatchKey(expected);
        var matches = savedMap[expectedEntryKey] || [];
        var matched = matches.length > 0 ? matches.shift() : null;

        if (matched) {
            expected.id = safeString(matched.id);
            expected.description = safeString(matched.description).trim() || expected.description;

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
    var entryType = normalizeEntryType(row.entry_type);
    if (!entryType) return '';

    var key = safeString(row.ref_id || row['ref.id']).trim() + '|' +
        safeString(row.vendor_id).trim() + '|' + entryType;
    if (entryType === ENTRY_TYPE.COST || entryType === ENTRY_TYPE.TAX) {
        key += '|' + safeString(row.account_number).trim();
    }
    return key;
}

function isEditableDebitAccountEntry(row) {
    return normalizeEntryType(row.entry_type) === ENTRY_TYPE.COST;
}

function replaceAutoExpenseEntries(expenseId, rows) {
    var deleted = deleteAutoExpenseEntries(expenseId);
    var inserted = insertExpenseEntries(rows);

    return {
        inserted: inserted,
        updated: 0,
        deleted: deleted
    };
}

function insertExpenseEntries(rows) {
    var inserted = 0;
    var seenIds = {};

    for (var i = 0; i < rows.length; i++) {
        var rowId = safeString(rows[i].id).trim();

        if (!rowId) {
            debugExpenseEntry('DB-INSERT-SKIP', 'Dòng ' + (i + 1) + ' không có id.');
            continue;
        }

        if (seenIds[rowId]) {
            debugExpenseEntry(
                'DB-INSERT-SKIP',
                'Trùng id trong cùng bộ dữ liệu: id=' + rowId + ', dòng=' + (i + 1)
            );
            continue;
        }

        seenIds[rowId] = true;
        debugExpenseEntry(
            'DB-INSERT-BEFORE',
            'id=' + rowId +
            ', paymentId=' + safeString(rows[i].payment_id) +
            ', contractId=' + safeString(rows[i].contract_id) +
            ', vendorId=' + safeString(rows[i].vendor_id)
        );

        var rc = insertRecord(TABLE_PAYMENT_ENTRY, toPaymentEntryRecord(rows[i]));
        debugExpenseEntry('DB-INSERT-AFTER', 'id=' + rowId + ', rc=' + rc);
        if (rc === RC_SUCCESS) inserted++;
    }

    return inserted;
}

function toPaymentEntryRecord(row) {
    return {
        id: row.id,
        'payment.id': row.payment_id,
        'contract.id': row.contract_id || row['contract.id'] || '',
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
        'ref.id': row.ref_id,
        'ap.code': row.ap_code,
        order: row.order
    };
}

function insertRecord(tableName, row) {
    var f = new SCFile(tableName);
    try {
        for (var key in row) {
            if (row.hasOwnProperty(key)) f[key] = row[key];
        }
        return f.doInsert();
    } catch (error) {
        var messages = '';
        try {
            messages = f.getMessages();
        } catch (ignore) {}
        debugExpenseEntry(
            'DB-INSERT-ERROR',
            'table=' + tableName +
            ', id=' + safeString(row.id) +
            ', paymentId=' + safeString(row['payment.id']) +
            ', error=' + error.toString() +
            ', messages=' + safeString(messages)
        );
        return typeof RC_ERROR !== 'undefined' ? RC_ERROR : -1;
    } finally {
        closeFile(f);
    }
}

function deleteAutoExpenseEntries(expenseId) {
    var deleted = 0;
    var f = new SCFile(TABLE_PAYMENT_ENTRY);
    var rc = f.doSelect('payment.id="' + escapeQueryValue(expenseId) + '"');

    while (rc === RC_SUCCESS) {
        if (isAutoEntry({
            id: f['id'],
            payment_id: f['payment.id'],
            vendor_id: f['vendor.id'],
            type: f['type'],
            entry_type: f['entry.type'],
            ref_id: f['ref.id'],
            'ref.id': f['ref.id']
        })) {
            var deleteRc = f.doDelete();
            if (deleteRc === RC_SUCCESS) deleted++;
        }
        rc = f.getNext();
    }

    closeFile(f);
    return deleted;
}

// =============================================================================
// SUPPORT - PHASE / PERMISSION: kiểm tra trạng thái và phân quyền
// =============================================================================

function isGenerationPhaseLocked(currentPhase) {
    var phase = normalizeText(currentPhase);
    return phase !== GENERATION_PHASE.DMMS &&
        phase !== GENERATION_PHASE.KTTC &&
        phase !== GENERATION_PHASE.START;
}

function isAccountingEditablePhase(currentPhase) {
    var phase = normalizeText(currentPhase);
    return phase === GENERATION_PHASE.KTTC || phase === GENERATION_PHASE.START;
}

function getCurrentOperatorName() {
    var currentOperator = vars.$lo_operator;
    return currentOperator ? safeString(currentOperator['contact.name']).trim() : '';
}

function isSameUser(expectedUser, currentUser) {
    var expected = safeString(expectedUser).trim();
    var actual = safeString(currentUser).trim();
    return !!expected && !!actual && normalizeText(expected) === normalizeText(actual);
}

function isAutoEntry(row) {
    if (isUserAddedEntryId(row.id)) return false;
    return true;
}

// =============================================================================
// SUPPORT - ID GENERATION: sinh ID tuần tự cho dòng mới
// =============================================================================

function assignNewEntryIds(expenseId, rows, savedEntries) {
    var list = rows || [];
    var combined = (savedEntries || []).concat(list);
    var usedIds = makeEntryIdSet(combined);
    var nextSequence = getNextEntryIdSequence(expenseId, TYPE.AP, combined);

    for (var i = 0; i < list.length; i++) {
        if (!safeString(list[i].id).trim() || usedIds[list[i].id] > 1) {
            var newId;
            do {
                newId = makeSequentialEntryId(expenseId, TYPE.AP, nextSequence++);
            } while (usedIds[newId]);
            list[i].id = newId;
            usedIds[newId] = true;
        }
    }
}

function getNextEntryIdSequence(expenseId, entryType, rows) {
    var prefix = getEntryIdPrefix(expenseId, entryType);
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

function makeSequentialEntryId(expenseId, entryType, sequence) {
    return getEntryIdPrefix(expenseId, entryType) + sequence;
}

function isUserAddedEntryId(entryId) {
    return safeString(entryId).indexOf('.MANUAL.') >= 0;
}

function getEntryIdPrefix(expenseId, entryType) {
    return safeString(expenseId).trim() + '.';
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

// =============================================================================
// SUPPORT - CREATOR ACCOUNTING INFO & COMBOS (Đơn vị, Cost Center, PGD)
// =============================================================================

function getCreatorAccountingUnit(createdBy) {
    var creator = safeString(createdBy).trim();
    if (!creator) return { code: '', name: '', lv1Id: '' };

    var lv1Id = selectOne(
        TABLE_CONTACT,
        'contact.name="' + escapeQueryValue(creator) + '"',
        function (record) { return readText(record, 'lv1.id'); }
    );
    if (!lv1Id) return { code: '', name: '', lv1Id: '' };

    var psCode = lv1Id;

    return selectOne(
        TABLE_ENTITY,
        'ps.code="' + escapeQueryValue(psCode) + '"',
        function (record) {
            return {
                code: removeFirstLeadingZero(readText(record, 'ogl.branch.code')).trim(),
                name: getBranchNamePrefix(readText(record, 'branch.name')),
                lv1Id: lv1Id,
                entityCode: readText(record, 'entity.code')
            };
        }
    ) || { code: '', name: '', lv1Id: lv1Id, entityCode: '' };
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

function addTransactionOfficeOption(options, optionMap, lv2Row) {
    var lv2Id = safeString(lv2Row['unit.id']).trim();
    var lv2Name = safeString(lv2Row['unit.name']).trim();
    var entity = getTransactionOfficeByLv2(lv2Id);
    var code = safeString(entity.code).trim();
    var name = lv2Name || safeString(entity.name).trim();

    if (!code || optionMap[code]) return;

    optionMap[code] = true;
    options.push({
        value: code,
        label: code + (name ? ' - ' + name : ''),
        name: name,
        psCode: lv2Id
    });
}

function getLv2OrgUnitsByLv1(lv1Id) {
    var id = safeString(lv1Id).trim();
    if (!id) return [];
    return (typeof lib !== 'undefined' && lib.ESD_Utils && typeof lib.ESD_Utils.fetchData === 'function')
        ? lib.ESD_Utils.fetchData('esdQTorgUnit', 'parent.id="' + escapeQueryValue(id) + '"', ['unit.id', 'unit.name']) || []
        : [];
}

function getTransactionOfficeByLv2(lv2Id) {
    var psCode = safeString(lv2Id).trim();
    if (!psCode) return { code: '', name: '' };

    try {
        return (
            selectOne(
                TABLE_ENTITY,
                'ps.code="' + escapeQueryValue(psCode) + '" and status="' + escapeQueryValue(ENTITY_STATUS_ACTIVE) + '"',
                function (record) {
                    return {
                        code: readText(record, 'entity.code').trim(),
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
    var a = safeString(left.segment1EntityCode || left.psCode) + '|' + safeString(left.value);
    var b = safeString(right.segment1EntityCode || right.psCode) + '|' + safeString(right.value);
    return a === b ? 0 : a < b ? -1 : 1;
}

function getDefaultTransactionOfficeCode(options) {
    return options && options.length ? safeString(options[0].value).trim() : '';
}

function applyCreatorUnitToEntries(entries, unitCode, defaultOffice, options) {
    for (var i = 0; i < entries.length; i++) {
        var isManual = isUserAddedEntryId(entries[i].id);

        if (isManual) {
            if (unitCode && !safeString(entries[i].branch).trim()) {
                entries[i].branch = formatSegment1(unitCode, GL_DEFAULT_ENTITY_CODE);
            }
            if (!entries[i].transaction_office) entries[i].transaction_office = GL_DEFAULT_TRANSACTION_OFFICE;
            if (!entries[i].department) entries[i].department = GL_DEFAULT_COST_CENTER;
        }

        if (unitCode && !safeString(entries[i].branch).trim()) {
            entries[i].branch = unitCode;
        }

        var rawBranch = entries[i].branch;
        if (rawBranch) {
            var matchingEntity = selectOne(
                TABLE_ENTITY,
                'ogl.branch.code="' + escapeQueryValue(rawBranch) + '" or ogl.branch.code="' + escapeQueryValue('0' + rawBranch) + '" or ogl.branch.code="' + escapeQueryValue(removeFirstLeadingZero(rawBranch)) + '"',
                function (record) {
                    return {
                        entityCode: readText(record, 'entity.code'),
                        branchName: getBranchNamePrefix(readText(record, 'branch.name'))
                    };
                }
            );
            if (matchingEntity) {
                entries[i].branch_entity_code = matchingEntity.entityCode;
                entries[i].branch_name = matchingEntity.branchName;
            }
        }
    }
}

function formatSegment1(branch, defaultSegment1) {
    var br = safeString(branch).trim();
    if (br.length === 7 && br.substring(0, 2) === '10') {
        return br;
    }
    if (br.length === 3 && /^\d+$/.test(br)) {
        return '10' + br + '98';
    }
    return defaultSegment1;
}

function removeFirstLeadingZero(value) {
    var text = safeString(value).trim();
    return text.charAt(0) === '0' ? text.substring(1) : text;
}

function getBranchNamePrefix(value) {
    var text = safeString(value).trim();
    var parts = text.split('-');
    var cleanedParts = [];
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i].trim();
        var isNum = true;
        if (part.length === 0) {
            isNum = false;
        } else {
            for (var j = 0; j < part.length; j++) {
                var ch = part.charAt(j);
                if (ch < '0' || ch > '9') {
                    isNum = false;
                    break;
                }
            }
        }
        if (!isNum) {
            cleanedParts.push(part);
        }
    }
    var name = cleanedParts.join(' - ').trim();
    return name || text;
}

// =============================================================================
// SUPPORT - QUERY HELPERS & UTILITIES
// =============================================================================

function selectOne(tableName, query, mapper) {
    var f;
    var rc;

    try {
        f = new SCFile(tableName, SCFILE_READONLY);
        rc = f.doSelect(query);
    } catch (e) {
        closeFile(f);
        return null;
    }

    var result = rc === RC_SUCCESS ? mapper(f) : null;
    closeFile(f);
    return result;
}

function selectList(tableName, sql, fields) {
    var list = [];
    var f = new SCFile(tableName, SCFILE_READONLY);
    var rc = f.doSelect(sql);

    while (rc === RC_SUCCESS) {
        list.push(mapSqlRow(f, fields));
        rc = f.getNext();
    }

    closeFile(f);
    return list;
}

function mapSqlRow(record, fields) {
    var item = {};

    for (var i = 0; i < fields.length; i++) {
        var key = fields[i][1];
        var type = fields[i][2];
        var value = record[i];
        if (type === 'N?') {
            item[key] = value === null || value === undefined || value === '' ? null : toNumber(value);
        } else {
            item[key] = type === 'N' ? toNumber(value) : safeString(value);
        }
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

function extractAccountNumber(value) {
    var account = safeString(value).trim();
    var separator = '.';
    if (account.indexOf('-') >= 0) {
        separator = '-';
    }
    var firstSep = account.indexOf(separator);
    var secondSep = firstSep >= 0 ? account.indexOf(separator, firstSep + 1) : -1;
    var thirdSep = secondSep >= 0 ? account.indexOf(separator, secondSep + 1) : -1;

    if (secondSep < 0 || thirdSep < 0) return account;

    var extracted = account.substring(secondSep + 1, thirdSep).trim();
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
        .replace(/\u0111/g, 'd')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeBusinessText(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeIdentity(value) {
    return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function escapeQueryValue(value) {
    return safeString(value).replace(/"/g, '\\"');
}

function closeFile(file) {
    try {
        if (file) file.doClose();
    } catch (e) {}
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

// =============================================================================
// SECTION 08 - TRIGGER HANDLERS: Đồng bộ tự động khi nguồn thay đổi
// =============================================================================

function handleExpenseVendorChange(rec) {
    if (!rec) return;
    var expenseId = rec['payment.id'] || rec['id'];
    if (!expenseId) return;

    var request = getExpenseRequest(expenseId);
    if (!request || request.current_phase !== 'initial_kttc') return;

    try {
        syncExpenseEntryBySourceChange('esdHTKTpaymentVendor', rec);
    } catch (ex) {}
}

function handleExpenseInvoiceChange(rec) {
    if (!rec) return;
    var expenseId = rec['payment.id'] || rec['id'];
    if (!expenseId) return;

    var request = getExpenseRequest(expenseId);
    if (!request || request.current_phase !== 'initial_kttc') return;

    try {
        syncExpenseEntryBySourceChange('esdHTKTpaymentInvoice', rec);
    } catch (ex) {}
}

// Logic lưu chỉnh sửa riêng cho phiếu Dự chi.
function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return null;

    try {
        var parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
        return null;
    }
}

function makeError(message) {
    return {
        success: false,
        error: message
    };
}

function saveExpenseEntryEdit(details) {
    var expenseId = safeString(details.expenseId || details.paymentId || details.id).trim();
    var entries = parseJsonArray(details.entries);

    if (!expenseId) return makeError('Missing expenseId/paymentId.');
    if (!entries) return makeError('Missing entries array.');

    var request = getExpenseRequest(expenseId);
    var previousEntries = getSavedExpenseEntries(expenseId);
    if (!isAccountingEditablePhase(request.current_phase)) {
        return makeError('Giai đoạn hiện tại không cho phép chỉnh sửa bút toán.');
    }

    var isKttcCreator = normalizeText(request.initial_role) === 'kttc';
    var isAssignedKttc = isSameUser(request.user_checker_kttc, details.currentUser);

    if (!isKttcCreator && !isAssignedKttc) {
        return makeError('Chỉ cán bộ KTTC khởi tạo hoặc được phân công mới được chỉnh sửa hạch toán.');
    }

    // Chuẩn hóa từng dòng
    var normalized = normalizeEditedEntries(expenseId, entries, previousEntries);
    if (!normalized.success) return normalized;

    if (normalized.entries.length === 0) {
        var deletedAll = deleteExpenseEntries(expenseId);
        return makeResult([], 'saved', {
            expenseId: expenseId,
            deleted: deletedAll,
            inserted: 0
        });
    }

    var creatorUnit = getCreatorAccountingUnit(safeString(details.currentUser).trim());
    var transactionOfficeOptions = getTransactionOfficeOptions(creatorUnit.lv1Id);
    var defaultTransactionOfficeCode = getDefaultTransactionOfficeCode(transactionOfficeOptions);
    applyCreatorUnitToEntries(
        normalized.entries,
        creatorUnit.code,
        defaultTransactionOfficeCode,
        transactionOfficeOptions
    );

    // Kiểm tra cân đối kế toán: Tổng ghi Nợ = Tổng ghi Có
    var balanceValidation = validateAccountingBalanceRows(normalized.entries);
    if (!balanceValidation.success) return balanceValidation;

    // Xóa bộ cũ và insert bộ mới đã validate
    var deleted = deleteExpenseEntries(expenseId);
    var inserted = insertExpenseEntries(normalized.entries);

    if (inserted !== normalized.entries.length) {
        deleteExpenseEntries(expenseId);
        var restored = insertExpenseEntries(previousEntries);

        return {
            success: false,
            error: 'Insert failed. Previous entries were restored.',
            expenseId: expenseId,
            deleted: deleted,
            inserted: inserted,
            restored: restored,
            data: getSavedExpenseEntries(expenseId)
        };
    }

    return makeResult(getSavedExpenseEntries(expenseId), 'saved', {
        expenseId: expenseId,
        deleted: deleted,
        inserted: inserted
    });
}

function validateAccountingBalanceRows(rows) {
    if (!rows || rows.length === 0) {
        return makeError('Thông tin hạch toán là bắt buộc.');
    }

    var totalDebit = 0;
    var totalCredit = 0;

    for (var i = 0; i < rows.length; i++) {
        var accountSide = getAccountingSide(rows[i].account_type);
        var amount = toNumber(rows[i].amount);

        if (!accountSide) {
            return makeError('Bút toán dòng ' + (i + 1) + ' chưa xác định Ghi nợ/Ghi có.');
        }

        if (accountSide === 'debit') totalDebit += amount;
        if (accountSide === 'credit') totalCredit += amount;
    }

    // Validate tổng ghi Nợ = tổng ghi Có
    if (Math.abs(totalDebit - totalCredit) > MONEY_EPSILON) {
        return makeError('Tổng ghi Nợ (' + totalDebit + ') phải bằng tổng ghi Có (' + totalCredit + ').');
    }

    return {
        success: true,
        totalDebit: totalDebit,
        totalCredit: totalCredit
    };
}

function normalizeEditedEntries(expenseId, entries, savedEntries) {
    var result = [];
    var usedIds = {};
    var savedIds = makeEntryIdSet(savedEntries);
    var combined = (savedEntries || []).concat(entries || []);
    var nextManualSequence = getNextManualEntryIdSequence(expenseId, combined);
    var savedById = {};
    for (var savedIndex = 0; savedIndex < savedEntries.length; savedIndex++) {
        savedById[safeString(savedEntries[savedIndex].id).trim()] = savedEntries[savedIndex];
    }

    for (var i = 0; i < entries.length; i++) {
        var row = normalizeEditedEntry(entries[i]);
        var savedRow = savedById[row.id];
        if (!row.contract_id && savedRow) {
            row.contract_id = safeString(savedRow.contract_id || savedRow['contract.id']).trim();
        }

        if (!savedIds[row.id] || usedIds[row.id]) {
            var newManualId;
            do {
                newManualId = makeUserAddedEntryId(expenseId, nextManualSequence++);
            } while (savedIds[newManualId] || usedIds[newManualId]);
            row.id = newManualId;
        }

        var validationError = validateEditedEntry(expenseId, row, i + 1, usedIds);
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
    return {
        id: safeString(raw.id).trim(),
        payment_id: safeString(raw.payment_id || raw.expense_id).trim(),
        contract_id: safeString(raw.contract_id || raw['contract.id']).trim(),
        entry_type: normalizeEntryType(raw.entry_type),
        ledger_type: LEDGER_TYPE.STANDARD,
        account_type: toStoredAccountType(raw.account_type),
        account_number: safeString(raw.account_number).trim(),
        account_name: safeString(raw.account_name).trim(),
        branch: formatSegment1(raw.branch, GL_DEFAULT_ENTITY_CODE),
        department: safeString(raw.department).trim(),
        transaction_office: safeString(raw.transaction_office).trim(),
        amount: toNumber(raw.amount),
        currency: safeString(raw.currency).trim(),
        description: safeString(raw.description).trim(),
        vendor_id: safeString(raw.vendor_id).trim(),
        type: TYPE.AP,
        order: toNumber(raw.order),
        ref_id: safeString(raw.ref_id).trim(),
        ap_code: safeString(raw.ap_code).trim(),
        accounting_request_id: safeString(raw.accounting_request_id).trim()
    };
}

function validateEditedEntry(expenseId, row, index, usedIds) {
    var prefix = 'Dòng hạch toán ' + index + ': ';

    if (!row.id) return prefix + 'thiếu ID.';
    if (usedIds[row.id]) return prefix + 'trùng lặp ID ' + row.id + '.';
    if (row.payment_id !== expenseId) return prefix + 'mã đề nghị không khớp.';
    if (!row.account_number) return prefix + 'chưa chọn tài khoản hạch toán.';
    if (!(row.amount > 0)) return prefix + 'số tiền phải lớn hơn 0.';
    if (!row.currency) return prefix + 'chưa chọn loại tiền.';
    if (!(row.order > 0)) return prefix + 'số thứ tự (order) phải lớn hơn 0.';

    return '';
}

function toStoredAccountType(value) {
    var accountType = normalizeBusinessText(value).replace(/\s+/g, '');
    if (accountType === 'debit') return ACCOUNT_TYPE.DEBIT;
    if (accountType === 'asset' || accountType === 'credit') return ACCOUNT_TYPE.ASSET;
    return safeString(value).trim();
}

function deleteExpenseEntries(expenseId) {
    var deleted = 0;
    var f = new SCFile(TABLE_PAYMENT_ENTRY);
    var rc = f.doSelect('payment.id="' + escapeQueryValue(expenseId) + '"');

    while (rc === RC_SUCCESS) {
        if (f.doDelete() === RC_SUCCESS) deleted++;
        rc = f.getNext();
    }

    closeFile(f);
    return deleted;
}

function makeUserAddedEntryId(expenseId, sequence) {
    return safeString(expenseId).trim() + '.MANUAL.' + sequence;
}

function getNextManualEntryIdSequence(expenseId, rows) {
    var prefix = safeString(expenseId).trim() + '.MANUAL.';
    var legacyPrefix = safeString(expenseId).trim() + '.MANUAL.AP.';
    var maxSequence = 0;
    var list = rows || [];

    for (var i = 0; i < list.length; i++) {
        var id = safeString(list[i].id).trim();
        var suffix = '';
        if (id.indexOf(legacyPrefix) === 0) {
            suffix = id.substring(legacyPrefix.length);
        } else if (id.indexOf(prefix) === 0) {
            suffix = id.substring(prefix.length);
        }
        if (suffix && /^\d+$/.test(suffix) && Number(suffix) > maxSequence) {
            maxSequence = Number(suffix);
        }
    }

    return maxSequence + 1;
}


/**
 * Trigger handler cho esdHTKTpaymentVendor (Update)
 * Hàm điều phối cập nhật và đồng bộ bút toán Dự chi
 * Chỉ chạy khi record ở Phase 'initial_kttc'
 */
function handleUpdatePaymentVendorAndAccountingSync(rec, oldRec) {
    debugExpenseEntry('TRIGGER-START', 'record=' + (rec ? 'available' : 'null'));

    if (!rec) {
        debugExpenseEntry('TRIGGER-SKIP', 'Record không tồn tại.');
        return;
    }

    var paymentId = safeString(rec["payment.id"] || rec["id"]).trim();
    debugExpenseEntry(
        'TRIGGER-RECORD',
        'recordId=' + safeString(rec["id"]) + ', paymentId=' + paymentId
    );

    if (!paymentId) {
        debugExpenseEntry('TRIGGER-SKIP', 'Không lấy được payment.id từ record.');
        return;
    }

    var payment = getExpenseRequest(paymentId);
    debugExpenseEntry(
        'TRIGGER-PAYMENT',
        'paymentId=' + paymentId +
        ', found=' + (!!payment) +
        ', phase=' + safeString(payment && payment.current_phase)
    );

    if (!payment || !payment.id) {
        debugExpenseEntry('TRIGGER-SKIP', 'Không tìm thấy phiếu ' + paymentId + '.');
        return;
    }

    if (payment.current_phase !== "initial_kttc") {
        debugExpenseEntry('TRIGGER-SKIP', 'Phase không hợp lệ: ' + safeString(payment.current_phase));
        return;
    }

    try {
        var syncResult = syncExpenseEntryBySourceChange(
                "esdHTKTpaymentVendor",
                rec
        );
        debugExpenseEntry('TRIGGER-DONE', 'paymentId=' + paymentId + ', result=' + JSON.stringify(syncResult));
    } catch (ex) {
        debugExpenseEntry('TRIGGER-ERROR', 'paymentId=' + paymentId + ', error=' + ex.toString());
    }
}
