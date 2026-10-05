/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_ENTRY
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Tự động tính toán và sinh các dòng bút toán định khoản Nợ/Có (esdHTKTpaymentEntry).
 * - Đồng bộ bút toán tự động khi có thay đổi từ hóa đơn, nhà cung cấp hoặc phân bổ chi phí.
 * - Áp dụng các quy tắc hạch toán kế toán theo loại đề nghị, tài khoản thuế, tạm ứng và thanh toán.
 * - Kiểm tra tính cân bằng Nợ/Có (Balance check) trước khi chuyển trạng thái hồ sơ.
 * -----------------------------------------------------------------------------
 */

var logger = typeof getLog === 'function' ? getLog("ESD_HTKT_PAYMENT_ENTRY") : { info: function(m) {}, error: function(m) {} };

/*
 * ===========================================================================
 *  SƠ ĐỒ LUỒNG CODE
 * ---------------------------------------------------------------------------
 *  01. ENTRY POINT
 *      run() nhận action và chuyển đến đúng chức năng.
 *
 *  02. LOAD / SYNC
 *      Đọc bút toán đã lưu -> sinh bộ bút toán mong đợi -> merge dữ liệu
 *      được phép sửa -> validate -> lưu lại DB.
 *
 *  03. SAVE CHỈNH SỬA
 *      Nhận danh sách người dùng sửa -> normalize -> validate cân đối -> save.
 *
 *  04. PHÂN CASE
 *      Đọc (1), (2), (3), thuế và loại NCC -> classifyPaymentCase().
 *
 *  05. SINH BÚT TOÁN
 *      Dispatch đến hàm TT-01 ... TT-17 -> buildStandardPaymentCase().
 *
 *  06. VALIDATE
 *      Kiểm tra tài khoản, số tiền và các trường DB bắt buộc.
 *
 *  07. PERSISTENCE / SAVE DB
 *      Xóa bút toán tự động cũ -> insert bộ bút toán mới.
 * ===========================================================================
 */

// =============================================================================
// SECTION 01 - ENTRY POINT: nhận action và điều phối luồng xử lý
// =============================================================================

function run() {
    var startTime = new Date().getTime();
    try {
        var input = vars['$L.file'];
        if (!input) return;

        var action = input.name || '';

        var details = getInputDetails(input);

        var result;
        // debugPaymentEntry('RUN', 'Bắt đầu action=' + action + ', paymentId=' + safeString(details.paymentId));

        // danh sach hach toan
        if (action === 'getListPaymentEntry') {
            result = getListPaymentEntryByInputDetails(details);
        } else if (action === 'getGLAddRowOptions') {
            result = getGLAddRowOptions(details);
            // sinh but toan tu dong
        } else if (action === 'syncPaymentEntry') {
            result = syncPaymentEntryNowByInputDetails(details);
            // sinh but toan tu dong khi nguon sinh thay doi
        } else if (action === 'syncPaymentEntryBySourceChange') {
            result = syncPaymentEntryBySourceChange(
                    safeString(details.sourceTable || input.sourceTable).trim(),
                    details
            );
            // luu chinh sua
        } else if (action === 'savePaymentEntryEdit') {
            result = savePaymentEntryEdit(details);
            // lay tai khoan GL
        } else if (action === 'getListGLAccount' || action === 'getGlAccounts') {
            result = getListGlAccount(details);
            // lay don vi GL
        } else if (action === 'getGlUnits' || action === 'getGLUnits') {
            result = getGlUnitsApi(details);
            // lay don vi ke toan hien tai theo nguoi dung
        } else if (action === 'getCreatorAccountingInfo') {
            result = getCreatorAccountingInfo(details);
            // lay danh sach phong ban (cost center)
        } else if (action === 'getCostCenterOptions' || action === 'getGlDepartments') {
            result = getCostCenterOptions(details);
            // lay danh sach phong giao dich (transaction office)
        } else if (action === 'getTransactionOfficeOptions' || action === 'getGlTransactionOffices') {
            result = getTransactionOfficeOptionsApi(details);
        } else {
            result = { success: false, error: 'Invalid action: ' + action };
        }

        var duration = new Date().getTime() - startTime;
        // debugPaymentEntry('RUN', 'Kết thúc action=' + action + ' trong ' + duration + 'ms, mode=' + safeString(result && result.mode) + ', success=' + safeString(result && result.success));
        input.queryReturn = JSON.stringify(result);
    } catch (e) {
        var errDuration = new Date().getTime() - startTime;
        // debugPaymentEntry('RUN-ERROR', 'Thất bại sau ' + errDuration + 'ms: ' + e.toString());
        if (vars['$L.file']) {
            vars['$L.file'].queryReturn = JSON.stringify({
                success: false,
                error: 'Gateway Error: ' + e.toString()
            });
        }
    }
}

function debugPaymentEntry(point, message) {
    try {
        if (typeof print === 'function') {
            // print('[PAYMENT-ENTRY][' + safeString(point) + '] ' + safeString(message));
        }
    } catch (ignore) {}
}

// =============================================================================
// SUPPORT - CONSTANTS: bảng DB, mã bút toán, mã case và loại tài khoản
// =============================================================================

var TABLE_PAYMENT_ENTRY = 'esdHTKTpaymentEntry';             // Bảng chứa dòng bút toán thanh toán
var TABLE_PAYMENT = 'esdHTKTpayment';                         // Bảng đơn thanh toán chính
var TABLE_PAYMENT_VENDOR = 'esdHTKTpaymentVendor';           // Bảng NCC đính kèm trong đơn thanh toán
var TABLE_PAYMENT_INVOICE = 'esdHTKTpaymentInvoice';         // Bảng hóa đơn đính kèm đơn thanh toán
var TABLE_COST_DIVISION = 'esdHTKTpaymentCostDivision';       // Bảng phân bổ chi phí (chỉ có ở thanh toán)
var TABLE_INVOICE = 'esdHTKTinvoice';                         // Bảng thông tin hóa đơn (dùng chung)
var TABLE_VENDOR = 'esdHTKTvendor';                           // Bảng danh mục Nhà cung cấp (dùng chung)
var TABLE_VENDOR_SITE = 'esdHTKTvendorSite';                 // Bảng danh mục Địa điểm NCC (dùng chung)
var TABLE_CATEGORY_ITEM = 'esdDMcategoryItems';               // Bảng thành phần danh mục (dùng chung)
var TABLE_GL_ACCOUNT = 'esdDMglAccount';                      // Bảng danh mục tài khoản GL (dùng chung)
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

var AUTO_ENTRY_CODE = {
    COST:      'TT-BK-01',   // Ghi nhận chi phí        (Nợ)
    TAX:       'TT-BK-02',   // Thuế GTGT               (Nợ)
    LIABILITY: 'TT-BK-03',   // Ghi nhận nghĩa vụ TT    (Có)
    REFUND_DR: 'TT-BK-04',   // Hoàn ứng                (Nợ)
    REFUND_CR: 'TT-BK-05',   // Giảm dư tạm ứng         (Có)
    PAYMENT:   'TT-BK-06',   // Thanh toán              (Nợ)
    SUSPENDED: 'TT-BK-07',   // Trả khoản treo          (Nợ)
    TRANSFER:  'TT-BK-08'    // Chuyển tiền             (Có)
};

var PAYMENT_CASE = {
    TT01: 'TT-01', TT02: 'TT-02', TT03: 'TT-03', TT04: 'TT-04',
    TT05: 'TT-05', TT06: 'TT-06', TT07: 'TT-07', TT08: 'TT-08',
    TT09: 'TT-09', TT10: 'TT-10', TT11: 'TT-11', TT12: 'TT-12',
    TT13: 'TT-13', TT14: 'TT-14', TT15: 'TT-15', TT16: 'TT-16',
    TT17: 'TT-17'
};

// Dùng khi so sánh số tiền để tránh sai số kiểu Number.
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
    PREPAYMENT: 'PREPAYMENT', // TK tạm ứng
    TAX: 'TAX',               // TK thuế
    PAYABLE: 'PAYABLE',       // TK phải trả
    CUSTOMER: 'CUSTOMER',     // TK KH
    OTHER: 'OTHER'            // TK khác
};

var GENERATION_PHASE = {
    DMMS: 'initial_dmms',
    KTTC: 'initial_kttc'
};

var CATEGORY_TAX_ACCOUNT_NUMBER = 'dmhtkt_stk_loai_khau_tru';
var CATEGORY_TAX_DEDUCTION_TYPE = 'dmhd_loai_khau_tru';
var DEDUCTION_TYPE_FULL = 'KHAUTRU_001';
var DEDUCTION_TYPE_RATE = 'KHAUTRU_002';
var DEDUCTION_TYPE_NONE = 'KHAUTRU_003';
var GL_UNIT_TRANSACTION_CODE = '98';
var GL_DEFAULT_ENTITY_CODE = '0000000';
var GL_DEFAULT_BRANCH_CODE = '000';
var GL_DEFAULT_COST_CENTER = '000000';
var GL_DEFAULT_TRANSACTION_OFFICE = '0000000';
var GL_UNIT_PREFERRED_PS_CODE = {
    '1010098': '99901000'
};
var CASH_CUSTOMER_ACCOUNT_NUMBER = '101110100';
var CASH_CUSTOMER_ACCOUNT_NAME = 'Tài khoản tiền mặt';

// =============================================================================
// SECTION 02 - LOAD / SYNC: đọc, sinh lại, merge, validate và lưu tự động
// =============================================================================


// -----------------------------------------------------------------------------
// SUPPORT - ĐỌC TIỀN BẰNG CHỮ & META THÔNG TIN THANH TOÁN
// -----------------------------------------------------------------------------

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

function getPaymentSummaryMeta(paymentId, request, metaParams) {
    var params = metaParams || {};
    var req = request || {};
    var vendors = getPaymentVendors(paymentId);
    var vendorCount = vendors.length;
    var currency = safeString(req.currency || (vendors.length > 0 ? vendors[0].currency : '') || 'VND').trim().toUpperCase() || 'VND';

    // 1. Tổng số tiền đề nghị thanh toán của tất cả các NCC thuộc DNTT (NUMBER)
    var totalPaidAmount = 0;
    for (var vIdx = 0; vIdx < vendors.length; vIdx++) {
        totalPaidAmount += toNumber(vendors[vIdx].amount);
    }
    if (totalPaidAmount === 0 && req.total_amount_paid) {
        totalPaidAmount = toNumber(req.total_amount_paid);
    }

    // 3. Tổng số tiền thuế của DNTT (tổng tiền thuế của mỗi NCC / hóa đơn)
    var totalTaxAmount = 0;
    if (vendors.length > 0) {
        for (var vIdx2 = 0; vIdx2 < vendors.length; vIdx2++) {
            var vTaxInfo = getInvoiceTaxInfo(paymentId, vendors[vIdx2], vendorCount);
            var vendorTax = toNumber(vTaxInfo.totalDeductibleTax);
            if (vendorTax === 0 && (toNumber(vendors[vIdx2].tax_amount) > 0 || toNumber(vendors[vIdx2]['tax.amount']) > 0)) {
                vendorTax = toNumber(vendors[vIdx2].tax_amount) || toNumber(vendors[vIdx2]['tax.amount']);
            }
            totalTaxAmount += vendorTax;
        }
    } else {
        var links = getLinkedInvoices(paymentId);
        for (var invIdx = 0; invIdx < links.length; invIdx++) {
            var inv = getInvoiceById(links[invIdx].invoice_id);
            totalTaxAmount += toNumber(inv.total_tax);
        }
    }
    if (totalTaxAmount === 0 && (req.total_tax_amount || req['total.tax.amount'])) {
        totalTaxAmount = toNumber(req.total_tax_amount || req['total.tax.amount']);
    }

    // 2. Số tiền thanh toán sau thuế bằng chữ (Text)
    var amountInWords = readMoneyInWords(totalPaidAmount, currency);

    // 6. Phân quyền hiển thị Button Chỉnh sửa / Xem chi tiết:
    // - Role KTTC khởi tạo/tiếp nhận trong phase KTTC: Chỉnh sửa (canEdit = true)
    // - Role ĐMMS/RS1 2, Lãnh đạo hoặc giai đoạn đã khóa: Xem chi tiết (canEdit = false)
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
        // 1. Tổng số tiền thanh toán sau thuế (NUMBER) - Tổng số tiền đề nghị thanh toán của tất cả các NCC thuộc DNTT
        totalAmountAfterTax: totalPaidAmount,
        totalPaidAmount: totalPaidAmount,
        total_amount_paid: totalPaidAmount,
        total_amount_after_tax: totalPaidAmount,
        // 2. Số tiền bằng chữ (Text) - Số tiền thanh toán sau thuế bằng chữ
        amountInWords: amountInWords,
        totalAmountInWords: amountInWords,
        moneyInWords: amountInWords,
        amount_in_words: amountInWords,
        // 3. Tổng số tiền thuế (NUMBER / Text) - Số tiền thuế của DNTT
        totalTaxAmount: totalTaxAmount,
        totalTax: totalTaxAmount,
        total_tax_amount: totalTaxAmount,
        // 4. Loại tiền (Text)
        currency: currency,
        currencyType: currency,
        currency_type: currency,
        // 5. Số NCC thanh toán (NUMBER) - Tổng số NCC được lựa chọn tại Tab thông tin đề nghị
        vendorCount: vendorCount,
        totalVendorCount: vendorCount,
        totalVendors: vendorCount,
        vendor_count: vendorCount,
        paymentVendorCount: vendorCount,
        // 6. Phân quyền hiển thị Button (Text / Boolean)
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

/** Chỉ lấy bút toán đã lưu; việc sinh mới được thực hiện qua action syncPaymentEntry. */
function getListPaymentEntryByInputDetails(details) {
    var paymentId = safeString(details.paymentId).trim();
    // debugPaymentEntry('GET-LIST', 'Bắt đầu paymentId=' + paymentId);

    if (!paymentId) {
        return makeResult([], 'empty', {
            canGenerate: false,
            message: 'Thiếu mã đề nghị thanh toán.',
            errors: ['Thiếu mã đề nghị thanh toán.']
        });
    }

    var request = getPaymentRequest(paymentId);
    var currentPhase = request.current_phase;
    var userCheckerKttc = request.user_checker_kttc;
    var initialRole = request.initial_role;
    var createdBy = request.created_by;
    var currentUser = safeString(details.currentUser).trim();
    var creatorUnit = getCreatorAccountingUnit(currentUser || createdBy);
    var savedEntries = getSavedPaymentEntries(paymentId);
    // debugPaymentEntry('GET-LIST', 'Đã đọc ' + savedEntries.length + ' dòng đã lưu, phase=' + currentPhase);

    // Khi có dữ liệu đã lưu, không query options đồng bộ ở API load list để tối ưu hiệu năng (tách API call)
    // options sẽ được Frontend gọi bất đồng bộ riêng
    var summaryMeta = getPaymentSummaryMeta(paymentId, request, {
        currentPhase: currentPhase,
        userCheckerKttc: userCheckerKttc,
        initialRole: initialRole,
        createdBy: createdBy,
        additionalUnitCode: creatorUnit.code,
        additionalUnitEntityCode: creatorUnit.entityCode,
        additionalUnitName: creatorUnit.name,

    });

    // Entry đã có thì trả ngay; dữ liệu nguồn được kiểm tra khi trigger gọi sinh lại.
    if (savedEntries.length > 0) {
        // debugPaymentEntry('GET-LIST', 'Trả dữ liệu đã lưu, không sinh lại');
        applyCreatorUnitToEntries(
                savedEntries,
                creatorUnit.code
        );
        return makeResult(getUniqueCostEntriesByAccountNumber(savedEntries), 'saved', summaryMeta);
    }

    if (isGenerationPhaseLocked(currentPhase)) {
        // debugPaymentEntry('GET-LIST', 'Không có dữ liệu và phase đang khóa');
        summaryMeta.locked = true;
        return makeResult([], 'empty', summaryMeta);
    }

    // Nếu DB chưa có bút toán -> Tiến hành đồng bộ và sinh mới.
    var generatedResult = syncPaymentEntryNowByInputDetails(details);
    if (generatedResult.data && generatedResult.data.length > 0) {
        applyCreatorUnitToEntries(
                generatedResult.data,
                creatorUnit.code
        );
        generatedResult.data = getUniqueCostEntriesByAccountNumber(generatedResult.data);
        generatedResult.accountingItems = mapAccountingTableItems(generatedResult.data);
    }
    copyObject(generatedResult, summaryMeta);
    return generatedResult;
}

/**
 * API danh sách chỉ trả một dòng COST cho mỗi account.number. Các thông tin khác
 * lấy theo dòng đầu tiên, còn amount là tổng của tất cả dòng COST cùng tài khoản.
 * Việc gộp chỉ áp dụng trên dữ liệu trả về; các paymentEntry được sinh và lưu
 * theo từng costDivision vẫn được giữ nguyên.
 */
function getUniqueCostEntriesByAccountNumber(entries) {
    var result = [];
    var usedCostAccounts = {};

    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (normalizeEntryType(entry.entry_type) === ENTRY_TYPE.COST) {
            var accountNumber = safeString(entry.account_number).trim();
            var accountKey = 'vendor|' + safeString(entry.vendor_id).trim() + '|account|' + accountNumber;
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

function enrichPaymentEntriesWithNames(entries) {
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
    // debugPaymentEntry('ENRICH', 'Đã enrich names/labels cho ' + entries.length + ' dòng');
}

function getTransFromNamePrefix(value) {
    var text = safeString(value).trim();
    var index = text.indexOf('-');
    return (index >= 0 ? text.substring(index + 1) : text).trim();
}

/** Tính lại dữ liệu nguồn, giữ trường được sửa và đồng bộ entry khi chưa khóa. */
function syncPaymentEntryNowByInputDetails(details) {
    var paymentId = safeString(details.paymentId).trim();
    var vendorId = safeString(details.vendorId).trim();
    // debugPaymentEntry('SYNC', 'Bắt đầu paymentId=' + paymentId + ', vendorId=' + vendorId);

    if (!paymentId) {
        return makeResult([], 'empty', {
            canGenerate: false,
            message: 'Thiếu mã đề nghị thanh toán.',
            errors: ['Thiếu mã đề nghị thanh toán.']
        });
    }

    var savedEntries = getSavedPaymentEntries(paymentId);
    var expectedResult = buildExpectedPaymentEntries(paymentId, vendorId);
    var expectedEntries = expectedResult.rows;
    var canGenerate = expectedResult.canGenerate;
    var generationErrors = expectedResult.errors || [];
    var successfulVendorIds = expectedResult.successfulVendorIds || [];
    var hasPartialSuccess = successfulVendorIds.length > 0;
    // debugPaymentEntry('SYNC', 'Build xong: rows=' + expectedEntries.length + ', NCC thành công=' + successfulVendorIds.length + ', errors=' + generationErrors.length);

    // Chỉ giữ nguyên toàn bộ CSDL khi không có NCC nào sinh thành công.
    if (!canGenerate && !hasPartialSuccess) {
        // debugPaymentEntry('SYNC', 'Không có NCC nào thành công, giữ nguyên CSDL');
        return makeResult(savedEntries, savedEntries.length > 0 ? 'saved' : 'empty', makeGenerationErrorMeta(generationErrors));
    }

    // NCC lỗi giữ nguyên bút toán đã lưu; chỉ NCC thành công được thay bằng kết quả mới.
    if (hasPartialSuccess) {
        // debugPaymentEntry('SYNC', 'Giữ bút toán cũ của NCC lỗi và thay bút toán NCC thành công');
        expectedEntries = expectedEntries.concat(
                getPreservedAutoEntriesForOtherVendors(savedEntries, successfulVendorIds)
        );
    }
    expectedEntries = removeForbiddenAutoCreditEntries(expectedEntries, 'SYNC');

    if (isGenerationPhaseLocked(expectedResult.currentPhase)) {
        // debugPaymentEntry('SYNC', 'Dừng do phase đang khóa: ' + expectedResult.currentPhase);
        return makeResult(savedEntries, savedEntries.length > 0 ? 'saved' : 'empty', {
            locked: true,
            currentPhase: expectedResult.currentPhase
        });
    }

    // NCC cuối cùng đã bị xóa: xóa bút toán AP tự sinh, giữ nguyên bút toán GL bổ sung.
    if (expectedEntries.length === 0) {
        // debugPaymentEntry('SYNC', 'Không còn dòng kỳ vọng, xóa các dòng tự động');
        var cleared = replaceAutoPaymentEntries(paymentId, []);

        return makeResult(getSavedPaymentEntries(paymentId), 'synced', { sync: cleared });
    }

    // Lần đầu tiên sinh bút toán (DB rỗng) -> Chèn mới hoàn toàn
    if (savedEntries.length === 0) {
        // debugPaymentEntry('SYNC', 'CSDL rỗng, insert mới ' + expectedEntries.length + ' dòng');
        assignNewEntryIds(paymentId, expectedEntries, savedEntries);
        var inserted = insertPaymentEntries(expectedEntries);

        return makeResult(getSavedPaymentEntries(paymentId), 'generated', {
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

    // Gộp thông tin người dùng đã chỉnh sửa trên UI (description, account_number) vào bút toán mới
    var mergedExpectedEntries = mergeEditableAutoEntryFields(savedEntries, expectedEntries);
    // debugPaymentEntry('SYNC', 'Merge dữ liệu chỉnh sửa xong, rows=' + mergedExpectedEntries.length);

    // Xóa bút toán auto cũ trước, rồi mới gán ID cho dòng mới dựa trên DB còn lại
    var deleted = deleteAutoPaymentEntries(paymentId);
    var remainingEntries = getSavedPaymentEntries(paymentId);
    assignNewEntryIds(paymentId, mergedExpectedEntries, remainingEntries);

    // Chèn lại bộ bút toán đã merge mới
    var inserted = insertPaymentEntries(mergedExpectedEntries);
    // debugPaymentEntry('SYNC', 'Đồng bộ xong: inserted=' + inserted + ', deleted=' + deleted);
    var syncResult = { inserted: inserted, updated: 0, deleted: deleted };

    return makeResult(getSavedPaymentEntries(paymentId), 'synced', {
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
        if (successfulMap[safeString(saved.vendor_id).trim()]) continue;
        result.push(copyObject({}, saved));
    }

    // debugPaymentEntry('SYNC-PRESERVE', 'Giữ lại ' + result.length + ' dòng của NCC không sinh thành công');
    return result;
}

// -----------------------------------------------------------------------------
// SECTION 02A - SOURCE CHANGE: xác định phiếu bị ảnh hưởng và gọi LOAD / SYNC
// -----------------------------------------------------------------------------

/** Lấy thông tin bản ghi payment từ bảng esdHTKTpayment theo paymentId. */
function getPaymentById(paymentId) {
    if (!paymentId) {
        return null;
    }

    var file = null;
    var payment = null;
    try {
        file = new SCFile(TABLE_PAYMENT, SCFILE_READONLY);
        var rc = file.doSelect('id="' + escapeQueryValue(paymentId) + '"');
        if (rc === RC_SUCCESS) {
            payment = {
                "id": file["id"],
                "current.phase": file["current.phase"]
            };
        }
    } catch (e) {
        // logger.info("getPaymentById failed for paymentId: " + paymentId + " | Exception: " + e);
    } finally {
        if (file) {
            try {
                file.doClose();
            } catch (ignoreClose) {}
        }
    }
    return payment;
}

/**
 * Trigger handler cho esdHTKTpaymentCostDivision
 * Chỉ chạy khi record Payment ở Phase 'initial_kttc'
 */
function handlePaymentCostDivisionAndAccountingSync(rec) {
    if (!rec) {
        return;
    }

    var paymentId = rec["payment.id"] || rec["id"];
    if (!paymentId) {
        return;
    }

    var payment = getPaymentById(paymentId);
    // logger.info("handlePaymentCostDivisionAndAccountingSync | paymentId: " + paymentId + " | payment: " + (payment ? JSON.stringify(payment) : payment));

    if (!payment || payment["current.phase"] !== "initial_kttc") {
        return;
    }

    try {
        syncPaymentEntryBySourceChange(
                "esdHTKTpaymentCostDivision",
                rec
        );
    } catch (ex) {
        // logger.info("handlePaymentCostDivisionAndAccountingSync failed for ID: " + (rec["id"] || "") + " | Exception: " + ex);
    }
}

/**
 * Trigger handler cho esdHTKTpaymentInvoice
 * Chỉ chạy khi record Payment ở Phase 'initial_kttc'
 */
function handleSyncPaymentEntryByInvoice(rec) {
    if (!rec) {
        return;
    }

    var paymentId = rec["payment.id"] || rec["id"];
    if (!paymentId) {
        return;
    }

    var payment = getPaymentById(paymentId);
    // logger.info("handleSyncPaymentEntryByInvoice | paymentId: " + paymentId + " | payment: " + (payment ? JSON.stringify(payment) : payment));

    if (!payment || payment["current.phase"] !== "initial_kttc") {
        return;
    }

    try {
        syncPaymentEntryBySourceChange(
                "esdHTKTpaymentInvoice",
                rec
        );
    } catch (ex) {
        // logger.info("handleSyncPaymentEntryByInvoice failed for ID: " + (rec["id"] || "") + " | Exception: " + ex);
    }
}

/**
 * Trigger handler cho esdHTKTpaymentVendor (Add/Delete/Sync)
 * Hàm đồng bộ bút toán Payment Entry từ sự thay đổi của Payment Vendor
 * Chỉ thực thi khi record ở Phase 'initial_kttc'
 */
function handleSyncPaymentEntryByVendor(rec) {
    if (!rec) {
        return;
    }

    var paymentId = rec["payment.id"] || rec["id"];
    if (!paymentId) {
        return;
    }

    var payment = getPaymentById(paymentId);
    // logger.info("handleSyncPaymentEntryByVendor | paymentId: " + paymentId + " | payment: " + (payment ? JSON.stringify(payment) : payment));

    if (!payment || payment["current.phase"] !== "initial_kttc") {
        return;
    }

    try {
        syncPaymentEntryBySourceChange(
                "esdHTKTpaymentVendor",
                rec
        );
    } catch (ex) {
        // logger.info("handleSyncPaymentEntryByVendor failed for ID: " + (rec["id"] || "") + " | Exception: " + ex);
    }
}

/**
 * Trigger handler cho esdHTKTpaymentVendor (Update)
 * Hàm điều phối cập nhật tổng tiền ĐNTT và đồng bộ bút toán
 * Chỉ chạy khi record ở Phase 'initial_kttc'
 */
function handleUpdatePaymentVendorAndAccountingSync(rec, oldRec) {
    if (typeof lib !== 'undefined' && lib.ESD_HTKT_PAYMENT_VENDOR && typeof lib.ESD_HTKT_PAYMENT_VENDOR.handleVendorChangeUpdate === 'function') {
        lib.ESD_HTKT_PAYMENT_VENDOR.handleVendorChangeUpdate(rec);
    }
    if (!rec) {
        return;
    }

    var paymentId = rec["payment.id"] || rec["id"];
    if (!paymentId) {
        return;
    }

    var payment = getPaymentById(paymentId);
    // logger.info("handleUpdatePaymentVendorAndAccountingSync | paymentId: " + paymentId + " | payment: " + (payment ? JSON.stringify(payment) : payment));

    if (!payment || payment["current.phase"] !== "initial_kttc") {
        return;
    }

    try {
        syncPaymentEntryBySourceChange(
                "esdHTKTpaymentVendor",
                rec
        );
    } catch (ex) {
        // logger.info("handleUpdatePaymentVendorAndAccountingSync failed for ID: " + (rec["id"] || "") + " | Exception: " + ex);
    }
}

/** Đồng bộ các đề nghị chịu ảnh hưởng sau khi bản ghi nguồn được lưu. */
function syncPaymentEntryBySourceChange(sourceTable, sourceRecord) {
    var source = sourceRecord || {};
    var paymentIds = resolvePaymentIdsFromSourceChange(sourceTable, source);
    var results = [];
    var errors = [];

    for (var i = 0; i < paymentIds.length; i++) {
        var syncResult = syncPaymentEntryNowByInputDetails({
            paymentId: paymentIds[i],
            vendorId: ''
        });
        results.push(syncResult);

        if (syncResult.canGenerate === false) {
            var syncErrors = syncResult.errors || [];
            if (syncErrors.length > 0) {
                for (var errorIndex = 0; errorIndex < syncErrors.length; errorIndex++) {
                    errors.push(paymentIds[i] + ': ' + syncErrors[errorIndex]);
                }
            } else if (syncResult.message) {
                errors.push(paymentIds[i] + ': ' + syncResult.message);
            }
        }
    }

    if (paymentIds.length === 0) {
        errors.push('Không xác định được mã đề nghị thanh toán từ dữ liệu nguồn.');
    }

    errors = makeUniqueTextList(errors);
    var response = {
        success: true,
        mode: 'source-change-sync',
        sourceTable: sourceTable || '',
        affectedPaymentIds: paymentIds,
        results: results,
        canGenerate: errors.length === 0
    };

    if (errors.length > 0) {
        response.message = errors.join(' ');
        response.errors = errors;
    }

    return response;
}

/** Tìm các paymentId chịu ảnh hưởng theo bảng nguồn. */
function resolvePaymentIdsFromSourceChange(sourceTable, sourceRecord) {
    var table = normalizeSourceTableName(sourceTable);

    if (table === normalizeSourceTableName(TABLE_PAYMENT)) {
        return makeUniqueTextList([readText(sourceRecord, 'id')]);
    }

    if (table === normalizeSourceTableName(TABLE_PAYMENT_VENDOR)) {
        return makeUniqueTextList([readText(sourceRecord, 'payment.id')]);
    }

    if (table === normalizeSourceTableName(TABLE_PAYMENT_INVOICE)) {
        var directPaymentId = readText(sourceRecord, 'payment.id');
        if (directPaymentId) return makeUniqueTextList([directPaymentId]);
        return getPaymentIdsByInvoiceId(readText(sourceRecord, 'invoice.id'));
    }

    if (table === normalizeSourceTableName(TABLE_COST_DIVISION)) {
        return makeUniqueTextList([readText(sourceRecord, 'payment.id')]);
    }

    if (table === normalizeSourceTableName(TABLE_INVOICE)) {
        return getPaymentIdsByInvoiceId(readText(sourceRecord, 'id'));
    }

    if (table === normalizeSourceTableName(TABLE_VENDOR)) {
        return getPaymentIdsByVendorId(readText(sourceRecord, 'id'));
    }

    if (table === normalizeSourceTableName(TABLE_VENDOR_SITE)) {
        return getPaymentIdsByVendorSite(sourceRecord);
    }

    return [];
}

function normalizeSourceTableName(value) {
    return safeString(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getPaymentIdsByInvoiceId(invoiceId) {
    var safeInvoiceId = safeString(invoiceId);
    if (!safeInvoiceId) return [];
    return getPaymentIdsFromTable(
            TABLE_PAYMENT_INVOICE,
            'invoice.id="' + escapeQueryValue(safeInvoiceId) + '"'
    );
}

function getPaymentIdsByVendorId(vendorId) {
    var safeVendorId = safeString(vendorId).trim();
    if (!safeVendorId) return [];
    return getPaymentIdsFromTable(
            TABLE_PAYMENT_VENDOR,
            'vendor.id="' + escapeQueryValue(safeVendorId) + '"'
    );
}

function getPaymentIdsByVendorSite(sourceRecord) {
    var vendorSiteId = readText(sourceRecord, 'id');
    if (!vendorSiteId) return [];
    return getPaymentIdsFromTable(
            TABLE_PAYMENT_VENDOR,
            'vendor.site.id="' + escapeQueryValue(vendorSiteId) + '"'
    );
}

function getPaymentIdsFromTable(tableName, query) {
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
// SUPPORT - INPUT / RESPONSE: parse request và chuẩn hóa kết quả trả về UI
// =============================================================================

function getInputDetails(input) {
    var parsed = {};

    copyObject(parsed, parseJsonObject(input.queryString));
    copyObject(parsed, parseJsonObject(input.details));

    if (!parsed.paymentId) parsed.paymentId = input.paymentId || input.id;
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

// =============================================================================
// SECTION 03 - SAVE CHỈNH SỬA: validate dữ liệu UI và ghi lại toàn bộ bút toán
// =============================================================================

function savePaymentEntryEdit(details) {
    // SAVE-1: đọc dữ liệu người dùng gửi từ UI.
    var paymentId = safeString(details.paymentId).trim();
    var entries = parseJsonArray(details.entries);

    if (!paymentId) return makeError('Missing paymentId.');
    if (!entries) return makeError('Missing entries array.');

    // SAVE-2: kiểm tra giai đoạn và đúng cán bộ KTTC được phân công.
    var request = getPaymentRequest(paymentId);
    var previousEntries = getSavedPaymentEntries(paymentId);
    if (!isAccountingEditablePhase(request.current_phase)) {
        return makeError('Giai đoạn hiện tại không cho phép chỉnh sửa bút toán.');
    }
//    var currentUser = getCurrentOperatorName();
    var isKttcCreator =
            normalizeText(request.initial_role) === 'kttc';
    var isAssignedKttc = isSameUser(request.user_checker_kttc, details.currentUser);


    if (!isKttcCreator && !isAssignedKttc) {
        return makeError('Chỉ cán bộ KTTC khởi tạo hoặc được phân công mới được chỉnh sửa hạch toán.');
    }

    // SAVE-3: chuẩn hóa từng dòng và kiểm tra tổng Nợ = tổng Có.
    var normalized = normalizeEditedEntries(paymentId, entries, previousEntries);
    if (!normalized.success) return normalized;

    // UI chỉ hiển thị một dòng COST đã cộng tổng theo NCC + tài khoản. Khôi phục
    // lại từng dòng chi tiết trước khi lưu để không làm mất các segment PCCP.
    normalized.entries = restoreCostDivisionEntries(normalized.entries, previousEntries);

    // Dòng AP/PREPAYMENT được tạo từ tab Công nợ: tab Hạch toán không được
    // thêm/xóa dòng hoặc thay đổi số tài khoản tạm ứng.
    var prepaymentValidation = validateProtectedPrepaymentEntries(
            normalized.entries,
            previousEntries
    );
    if (!prepaymentValidation.success) return prepaymentValidation;

    if (normalized.entries.length === 0) {
        var deletedAll = deletePaymentEntries(paymentId);
        return makeResult([], 'saved', {
            paymentId: paymentId,
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


//    // === BỔ SUNG: Kiểm tra khớp chi tiết tài khoản COST với bảng esdHTKTpaymentCostDivision ===
    var costDivisionValidation = validateCostDivisionAgainstTable(paymentId, normalized.entries);
    if (!costDivisionValidation.success) return costDivisionValidation;
//    // =================H=========================/\

    var balanceValidation = validateAccountingBalanceRows(normalized.entries);
    if (!balanceValidation.success) return balanceValidation;

    // SAVE-4: xóa bộ cũ và insert toàn bộ bộ mới đã validate.
    var deleted = deletePaymentEntries(paymentId);
    var inserted = insertPaymentEntries(normalized.entries);

    // SAVE-5: nếu insert thiếu dòng, khôi phục bộ dữ liệu cũ.
    if (inserted !== normalized.entries.length) {
        deletePaymentEntries(paymentId);
        var restored = insertPaymentEntries(previousEntries);

        return {
            success: false,
            error: 'Insert failed. Previous entries were restored.',
            paymentId: paymentId,
            deleted: deleted,
            inserted: inserted,
            restored: restored,
            data: getSavedPaymentEntries(paymentId)
        };
    }

    return makeResult(getSavedPaymentEntries(paymentId), 'saved', {
        paymentId: paymentId,
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
    var glGroups = {};

    for (var i = 0; i < rows.length; i++) {
        var accountSide = getAccountingSide(rows[i].account_type);
        var amount = toNumber(rows[i].amount);

        if (!accountSide) {
            return makeError('Bút toán dòng ' + (i + 1) + ' chưa xác định Ghi nợ/Ghi có.');
        }

        if (accountSide === 'debit') totalDebit += amount;
        if (accountSide === 'credit') totalCredit += amount;

        if (isAdditionalEntryType(rows[i].type)) {
            var glIdParts = getGlEntryIdParts(rows[i].payment_id, rows[i].id);
            // ID GL một cấp cũ và hai cấp mới đều được quy về groupOrder/rowOrder.
            var groupOrder = glIdParts ? glIdParts.groupOrder : 1;
            var groupKey = safeString(groupOrder);
            if (!glGroups[groupKey]) {
                glGroups[groupKey] = {
                    groupOrder: groupOrder,
                    totalDebit: 0,
                    totalCredit: 0
                };
            }
            if (accountSide === 'debit') glGroups[groupKey].totalDebit += amount;
            if (accountSide === 'credit') glGroups[groupKey].totalCredit += amount;
        }
    }

    for (var glGroupKey in glGroups) {
        if (!glGroups.hasOwnProperty(glGroupKey)) continue;
        var glGroup = glGroups[glGroupKey];
        if (Math.abs(glGroup.totalDebit - glGroup.totalCredit) > MONEY_EPSILON) {
            return makeError(
                    'Bút toán GL ' + glGroup.groupOrder + ': tổng ghi nợ phải bằng tổng ghi có.'
            );
        }
    }

    // Validate tổng ghi nợ bằng tổng ghi có khi lưu chỉnh sửa bút toán.
    if (Math.abs(totalDebit - totalCredit) > MONEY_EPSILON) {
        return makeError('Tổng ghi nợ phải bằng tổng ghi có.');
    }

    return {
        success: true,
        totalDebit: totalDebit,
        totalCredit: totalCredit
    };
}

function getAccountingSide(value) {
    var accountType = normalizeBusinessText(value).replace(/\s+/g, '');
    if (accountType === 'debit') return 'debit';
    if (accountType === 'asset') return 'credit';
    return '';
}

function mapAccountingTableItems(rows) {
    var apGroups = {};
    var apKeys = [];
    var glGroups = {};
    var glKeys = [];
    var list = rows || [];

    for (var i = 0; i < list.length; i++) {
        var row = list[i];
        var isGl = isAdditionalEntryType(row.type);
        var idParts = isGl ? getGlEntryIdParts(row.payment_id, row.id) : null;
        var key = isGl
                ? safeString(idParts ? idParts.groupOrder : 1)
                : safeString(row.vendor_id).trim() + '|' +
                safeString(row.vendor_site_id).trim() + '|' +
                safeString(row.vendor_site_code).trim();
        var groups = isGl ? glGroups : apGroups;
        var keys = isGl ? glKeys : apKeys;

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
            stt: isGl && idParts ? idParts.rowOrder : toNumber(row.order),
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
    for (var apIndex = 0; apIndex < apKeys.length; apIndex++) {
        result.push(apGroups[apKeys[apIndex]]);
    }
    for (var glIndex = 0; glIndex < glKeys.length; glIndex++) {
        result.push(glGroups[glKeys[glIndex]]);
    }
    return result;
}

// -----------------------------------------------------------------------------
// SECTION 03A - DANH MỤC GL: hỗ trợ chọn tài khoản khi chỉnh sửa
// -----------------------------------------------------------------------------

function getListGlAccount(details) {
    var startTime = new Date().getTime();
    var page = 1;
    var pageSize = details && details.pageSize ? Number(details.pageSize) : 30;
    if (details && details.page && Number(details.page) > 0) page = Number(details.page);
    var keyword = safeString(details && details.keyword).trim();

    var rows = [];
    var f = new SCFile(TABLE_GL_ACCOUNT, SCFILE_READONLY);
    var rc;
    var query = 'true';
    var rawType = details && (details.accountType || details.type || details.account_type);
    var typeFilter = safeString(rawType).trim();
    if (typeFilter) {
        var upperType = normalizeText(typeFilter).toUpperCase();

        // "DEBIT"/"CREDIT"/"ASSET" là loại Nợ/Có, không phải loại tài khoản GL → bỏ qua
        var isDebitCredit = upperType === 'DEBIT' || upperType === 'CREDIT' || upperType === 'ASSET';
        if (isDebitCredit) {
            typeFilter = '';
        } else if (upperType.indexOf('CHI PHI') >= 0 || upperType.indexOf('COST') >= 0 || upperType.indexOf('EXPENSE') >= 0 || upperType === 'CP') {
            query += ' and (type="Chi phí" or type="CHI PHI" or type="COST" or type="Chi phi")';
        } else if (upperType.indexOf('THUE') >= 0 || upperType.indexOf('TAX') >= 0 || upperType.indexOf('VAT') >= 0) {
            query += ' and (type="Thuế" or type="THUE" or type="TAX" or type="Thue")';
        } else if (upperType.indexOf('TAM UNG') >= 0 || upperType.indexOf('PREPAYMENT') >= 0 || upperType.indexOf('ADVANCE') >= 0 || upperType === 'TU') {
            query += ' and (type="Tạm ứng" or type="TAM UNG" or type="PREPAYMENT" or type="Tam ung")';
        } else if (upperType.indexOf('PHAI TRA') >= 0 || upperType.indexOf('PAYABLE') >= 0 || upperType.indexOf('LIABILITY') >= 0 || upperType === 'PT') {
            query += ' and (type="Phải trả" or type="PHAI TRA" or type="PAYABLE" or type="Phai tra")';
        } else {
            query += ' and type="' + escapeQueryValue(typeFilter) + '"';
        }
    }

    if (keyword) {
        query += ' and (account like "*' + escapeQueryValue(keyword) + '*" or name like "*' + escapeQueryValue(keyword) + '*")';
    }

    var filterCategory = '';
    if (typeFilter) {
        var norm = normalizeText(typeFilter);
        if (norm.indexOf('chi phi') >= 0 || norm.indexOf('cost') >= 0 || norm.indexOf('expense') >= 0 || norm === 'cp') filterCategory = 'chi phi';
        else if (norm.indexOf('thue') >= 0 || norm.indexOf('tax') >= 0 || norm.indexOf('vat') >= 0) filterCategory = 'thue';
        else if (norm.indexOf('tam ung') >= 0 || norm.indexOf('prepayment') >= 0 || norm.indexOf('advance') >= 0 || norm === 'tu') filterCategory = 'tam ung';
        else if (norm.indexOf('phai tra') >= 0 || norm.indexOf('payable') >= 0 || norm.indexOf('liability') >= 0 || norm === 'pt') filterCategory = 'phai tra';
    }

    try {
        rc = f.doSelect(query);
    } catch (e) {
        closeFile(f);
        return makeError('Cannot read GL account list: ' + e.toString());
    }

    while (rc === RC_SUCCESS) {
        var account = readText(f, 'account');

        if (account) {
            var accountType = readText(f, 'account.type');
            var type = readText(f, 'type');
            var name = readText(f, 'name');

            if (filterCategory) {
                var rowNorm = normalizeText(type || accountType);
                var match = false;
                if (filterCategory === 'chi phi' && (rowNorm.indexOf('chi phi') >= 0 || rowNorm.indexOf('cost') >= 0 || rowNorm.indexOf('expense') >= 0 || rowNorm === 'cp')) match = true;
                else if (filterCategory === 'thue' && (rowNorm.indexOf('thue') >= 0 || rowNorm.indexOf('tax') >= 0 || rowNorm.indexOf('vat') >= 0)) match = true;
                else if (filterCategory === 'tam ung' && (rowNorm.indexOf('tam ung') >= 0 || rowNorm.indexOf('prepayment') >= 0 || rowNorm.indexOf('advance') >= 0 || rowNorm === 'tu')) match = true;
                else if (filterCategory === 'phai tra' && (rowNorm.indexOf('phai tra') >= 0 || rowNorm.indexOf('payable') >= 0 || rowNorm.indexOf('liability') >= 0 || rowNorm === 'pt')) match = true;
                else if (rowNorm.indexOf(filterCategory) >= 0) match = true;

                if (!match) {
                    rc = f.getNext();
                    continue;
                }
            }

            rows.push({
                account: account,
                accountCode: account,
                accountNumber: account,
                name: name,
                accountName: name,
                type: type,
                account_type: accountType,
                accountType: type,
                is_debit_eligible: isDebitEligibleAccountType(accountType),
                apply_currency: readText(f, 'apply.currency')
            });
        }

        rc = f.getNext();
    }

    closeFile(f);
    rows.sort(compareGlAccount);

    var totalRecords = rows.length;
    var totalPages = Math.ceil(totalRecords / pageSize);
    var startIndex = (page - 1) * pageSize;
    var sliced = rows.slice(startIndex, startIndex + pageSize);

    var duration = new Date().getTime() - startTime;
    // debugPaymentEntry('GL-ACCOUNT', 'Đọc ' + totalRecords + ' tài khoản GL (trang ' + page + '/' + totalPages + ', ' + sliced.length + ' items) trong ' + duration + 'ms (query: ' + query + ')');

    return {
        success: true,
        mode: 'gl-account-list',
        data: sliced,
        pagination: {
            page: page,
            pageSize: pageSize,
            totalRecords: totalRecords,
            totalPages: totalPages
        }
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

function isDebitEligibleAccountType(value) {
    var accountType = normalizeBusinessText(value).replace(/\s+/g, '');
    return accountType === 'duno' || accountType === 'luongtinh';
}

function compareGlAccount(a, b) {
    var left = safeString(a.account);
    var right = safeString(b.account);

    if (left === right) return 0;
    return left > right ? 1 : -1;
}

// -----------------------------------------------------------------------------
// SECTION 03B - VALIDATE SAVE: normalize từng dòng và kiểm tra dữ liệu bắt buộc
// -----------------------------------------------------------------------------

function normalizeEditedEntries(paymentId, entries, savedEntries) {
    var result = [];
    var usedIds = {};
    var savedIds = makeEntryIdSet(savedEntries);
    var combined = (savedEntries || []).concat(entries || []);
    var nextManualApSequence = getNextManualEntryIdSequence(paymentId, combined);
    var nextGlRowSequence = getNextGlRowSequence(paymentId, 1, combined);

    for (var i = 0; i < entries.length; i++) {
        var row = normalizeEditedEntry(entries[i]);

        if (!savedIds[row.id] || usedIds[row.id]) {
            if (isAdditionalEntryType(row.type)) {
                if (!isStructuredGlEntryId(paymentId, row.id) || usedIds[row.id]) {
                    var newGlId;
                    do {
                        newGlId = makeGlEntryId(paymentId, 1, nextGlRowSequence++);
                    } while (savedIds[newGlId] || usedIds[newGlId]);
                    row.id = newGlId;
                }
            } else {
                var newManualId;
                do {
                    newManualId = makeUserAddedEntryId(paymentId, nextManualApSequence++);
                } while (savedIds[newManualId] || usedIds[newManualId]);
                row.id = newManualId;
            }
        }

        var validationError = validateEditedEntry(paymentId, row, i + 1, usedIds);

        if (validationError) return makeError(validationError);

        usedIds[row.id] = true;
        result.push(row);
    }

    return {
        success: true,
        entries: result
    };
}

/**
 * Tách dòng COST đã được gộp khi trả về UI thành các dòng đã lưu ban đầu.
 * Branch/department/transaction office và ID giữ theo từng dòng cũ; tài khoản,
 * tên tài khoản và diễn giải lấy từ dòng UI. Nếu tổng tiền được sửa, số tiền mới
 * được phân bổ theo tỷ trọng cũ và dòng cuối nhận phần chênh lệch làm tròn.
 */
function restoreCostDivisionEntries(editedEntries, previousEntries) {
    var previousById = {};
    var previousCostGroups = {};
    var result = [];
    var i;

    for (i = 0; i < previousEntries.length; i++) {
        var previous = previousEntries[i];
        previousById[safeString(previous.id).trim()] = previous;

        if (normalizeEntryType(previous.entry_type) !== ENTRY_TYPE.COST) continue;
        var previousKey = makeCostGroupKey(previous.vendor_id, previous.account_number);
        if (!previousCostGroups[previousKey]) previousCostGroups[previousKey] = [];
        previousCostGroups[previousKey].push(previous);
    }

    for (i = 0; i < editedEntries.length; i++) {
        var edited = editedEntries[i];
        if (normalizeEntryType(edited.entry_type) !== ENTRY_TYPE.COST) {
            result.push(edited);
            continue;
        }

        var original = previousById[safeString(edited.id).trim()];
        if (!original || normalizeEntryType(original.entry_type) !== ENTRY_TYPE.COST) {
            result.push(edited);
            continue;
        }

        var groupKey = makeCostGroupKey(original.vendor_id, original.account_number);
        var sourceRows = previousCostGroups[groupKey] || [];
        if (sourceRows.length <= 1) {
            result.push(edited);
            continue;
        }

        var oldTotal = 0;
        for (var sourceIndex = 0; sourceIndex < sourceRows.length; sourceIndex++) {
            oldTotal += toNumber(sourceRows[sourceIndex].amount);
        }

        var newTotal = toNumber(edited.amount);
        var allocatedTotal = 0;
        for (sourceIndex = 0; sourceIndex < sourceRows.length; sourceIndex++) {
            var restored = copyObject({}, sourceRows[sourceIndex]);
            var isLast = sourceIndex === sourceRows.length - 1;
            var restoredAmount = isLast
                    ? newTotal - allocatedTotal
                    : oldTotal > 0
                            ? newTotal * toNumber(sourceRows[sourceIndex].amount) / oldTotal
                            : newTotal / sourceRows.length;

            restored.account_number = edited.account_number;
            restored.account_name = edited.account_name;
            restored.description = edited.description;
            restored.amount = restoredAmount;
            allocatedTotal += restoredAmount;
            result.push(restored);
        }
    }

    return result;
}

function makeCostGroupKey(vendorId, accountNumber) {
    return 'vendor|' + safeString(vendorId).trim() + '|account|' + safeString(accountNumber).trim();
}


function normalizeEditedEntry(raw) {
    var type = safeString(raw.type).trim();
    var isGlEntry = isAdditionalEntryType(type);

    return {
        id: safeString(raw.id).trim(),
        payment_id: safeString(raw.payment_id).trim(),
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
        type: isGlEntry ? TYPE.GL : TYPE.AP,
        order: toNumber(raw.order),
        ref_id: safeString(raw.ref_id).trim(),
        ap_code: safeString(raw.ap_code).trim(),
        accounting_request_id: safeString(raw.accounting_request_id).trim()
    };
}

function validateEditedEntry(paymentId, row, index, usedIds) {
    var prefix = 'Invalid entry at index ' + index + ': ';
    var type = safeString(row.type).trim();
    var isGlEntry = isAdditionalEntryType(type);

    if (!row.id) return prefix + 'missing id.';
    if (usedIds[row.id]) return prefix + 'duplicate id ' + row.id + '.';
    if (row.payment_id !== paymentId) return prefix + 'payment_id does not match paymentId.';
    if (!row.entry_type && !isGlEntry) return prefix + 'missing entry_type.';
    if (!row.account_number) return prefix + 'missing account_number.';
    if (!(row.amount > 0)) return prefix + 'amount must be greater than 0.';
    if (!row.currency) return prefix + 'missing currency.';
    if (!row.type) return prefix + 'missing type.';
//    if (isGlEntry && !/^[0-9]{3}$/.test(row.branch)) {
//        return prefix + 'missing or invalid GL branch.';
//    }
    if (!(row.order > 0)) return prefix + 'order must be greater than 0.';

    return '';
}

function isAdditionalEntryType(value) {
    return normalizeText(value) === normalizeText(TYPE.GL);
}

// =============================================================================
// SUPPORT - QUY TẮC DÒNG: tên bút toán, ledger type và bên Nợ/Có
// =============================================================================

function getAutoLedgerType(entryCode) {
    return LEDGER_TYPE.STANDARD;
}

function getAutoAccountType(entryCode) {
    // Có (Credit): TT-BK-03, TT-BK-05, TT-BK-08
    if (entryCode === AUTO_ENTRY_CODE.LIABILITY) return ACCOUNT_TYPE.ASSET;
    if (entryCode === AUTO_ENTRY_CODE.REFUND_CR) return ACCOUNT_TYPE.ASSET;
    if (entryCode === AUTO_ENTRY_CODE.TRANSFER) return ACCOUNT_TYPE.ASSET;
    // Nợ (Debit): TT-BK-01, TT-BK-02, TT-BK-04, TT-BK-06, TT-BK-07
    return ACCOUNT_TYPE.DEBIT;
}

function toStoredAccountType(value) {
    var accountType = normalizeBusinessText(value).replace(/\s+/g, '');

    if (accountType === 'debit') return ACCOUNT_TYPE.DEBIT;
    if (accountType === 'asset') return ACCOUNT_TYPE.ASSET;

    return safeString(value).trim();
}

function normalizeEntryType(value) {
    var type = safeString(value).trim().toUpperCase();
    if (type === ENTRY_TYPE.COST) return ENTRY_TYPE.COST;
    if (type === ENTRY_TYPE.PREPAYMENT) return ENTRY_TYPE.PREPAYMENT;
    if (type === ENTRY_TYPE.TAX) return ENTRY_TYPE.TAX;
    if (type === ENTRY_TYPE.PAYABLE) return ENTRY_TYPE.PAYABLE;
    if (type === ENTRY_TYPE.CUSTOMER) return ENTRY_TYPE.CUSTOMER;
    if (type === ENTRY_TYPE.OTHER) return ENTRY_TYPE.OTHER;
    return '';
}

function getEntryTypeByRuleCode(entryCode) {
    if (entryCode === AUTO_ENTRY_CODE.COST) return ENTRY_TYPE.COST;
    if (entryCode === AUTO_ENTRY_CODE.TAX) return ENTRY_TYPE.TAX;
    if (entryCode === AUTO_ENTRY_CODE.REFUND_CR) return ENTRY_TYPE.PREPAYMENT;
    if (entryCode === AUTO_ENTRY_CODE.TRANSFER) return ENTRY_TYPE.CUSTOMER;
    if (
            entryCode === AUTO_ENTRY_CODE.LIABILITY ||
            entryCode === AUTO_ENTRY_CODE.REFUND_DR ||
            entryCode === AUTO_ENTRY_CODE.PAYMENT ||
            entryCode === AUTO_ENTRY_CODE.SUSPENDED
    ) {
        return ENTRY_TYPE.PAYABLE;
    }
    return '';
}

// =============================================================================
// SECTION 04/05 - ĐIỀU PHỐI: đọc dữ liệu, phân case và sinh bút toán từng NCC
// =============================================================================

/**
 * Tạo bộ TT-BK-01 → TT-BK-08 theo từng NCC.
 *
 * Luồng chính theo đặc tả 2.7:
 * 1) Xác định 5 biến: hasNewInvoice, hasRefund, hasSuspended, hasTax, remainingAmount
 * 2) Validate: phiếu phải có ≥ 1 nguồn (hóa đơn / hoàn ứng / khoản treo)
 * 3) Nhóm hóa đơn:    TT-BK-01 (chi phí), TT-BK-02 (thuế), TT-BK-03 (nghĩa vụ)
 * 4) Hoàn ứng: refund.amount chỉ dùng phân case; không sinh Có TK tạm ứng hoặc
 *    Phải trả tại paymentEntry. Phần đối ứng được xử lý sau tại tab Công nợ.
 * 5) Thanh toán:       TT-BK-06 khi remainingAmount > 0
 * 6) Khoản treo:       TT-BK-07 (hiện không tự sinh trong TT-17)
 * 7) Chuyển tiền:      TT-BK-08
 */
/**
 * Sinh bút toán theo 17 case thanh toán.
 * Các case chưa đủ quy tắc được giữ bằng hàm rỗng để bổ sung sau.
 */
function buildExpectedPaymentEntries(paymentId, vendorId) {
    // debugPaymentEntry('BUILD', 'Bắt đầu paymentId=' + paymentId + ', vendorId=' + safeString(vendorId));
    var request = getPaymentRequest(paymentId);
    var creatorUnit = getCreatorAccountingUnit(request.created_by);
    request.creator_unit_code = creatorUnit.code;
    request.default_transaction_office_code = getDefaultTransactionOfficeCode(
            getTransactionOfficeOptions(creatorUnit.lv1Id)
    );
    var vendors = getPaymentVendors(paymentId, vendorId);
    // debugPaymentEntry('BUILD', 'Tìm thấy ' + vendors.length + ' NCC');
    var rows = [];
    var errors = [];
    var cases = [];
    var successfulVendorIds = [];
    var canGenerate = true;

    if (!request.id) {
        return {
            rows: [],
            canGenerate: false,
            errors: ['Không có dữ liệu ở bảng ' + TABLE_PAYMENT + '.'],
            cases: [],
            currentPhase: ''
        };
    }

    for (var vi = 0; vi < vendors.length; vi++) {
        vendors[vi] = enrichVendor(vendors[vi]);
    }

    var invoiceVendorErrors = getLinkedInvoiceVendorErrors(paymentId, vendors);
    if (invoiceVendorErrors.length > 0) {
        canGenerate = false;
        errors = errors.concat(invoiceVendorErrors);
    }

    for (var i = 0; i < vendors.length; i++) {
        var vendor = vendors[i];
        // debugPaymentEntry('BUILD-VENDOR', 'Bắt đầu NCC ' + (vendor.vendor_id || '?') + ' (' + (i + 1) + '/' + vendors.length + ')');
        var vendorErrors = getVendorAutoEntryErrors(vendor);
        if (vendorErrors.length > 0) {
            // debugPaymentEntry('BUILD-VENDOR-ERROR', 'NCC ' + (vendor.vendor_id || '?') + ': ' + vendorErrors.join(' | '));
            canGenerate = false;
            errors = errors.concat(vendorErrors);
            continue;
        }

        // Bước 1: gom toàn bộ dữ liệu cần phân case của một NCC.
        var context = buildPaymentCaseContext(
                paymentId,
                request,
                vendor,
                vendors.length,
                rows.length + 1
        );

        if (context.errors.length > 0) {
            // debugPaymentEntry('BUILD-VENDOR-ERROR', 'NCC ' + (vendor.vendor_id || '?') + ': ' + context.errors.join(' | '));
            canGenerate = false;
            errors = errors.concat(context.errors);
            continue;
        }

        // Bước 2: chỉ phân case tại đây; không rải điều kiện case sang phần save.
        var caseCode = classifyPaymentCase(context);
        context.caseCode = caseCode;
        // debugPaymentEntry('BUILD-CASE', 'NCC ' + (vendor.vendor_id || '?') + ' => ' + (caseCode || 'NO_CASE'));
        cases.push({ vendorId: vendor.vendor_id, caseCode: caseCode || 'NO_CASE' });

        var vendorRows;
        if (!caseCode) {
            // NO_CASE dùng rule độc lập theo (1), thuế/PCCP và (2); không xét (3).
            vendorRows = buildPaymentNoCase(context);
        } else if (!isImplementedPaymentCase(caseCode)) {
            // debugPaymentEntry('BUILD-VENDOR-ERROR', 'Case chưa triển khai: ' + caseCode);
            canGenerate = false;
            errors.push('NCC ' + (vendor.vendor_id || '?') + ': case ' + caseCode + ' đang để hàm rỗng, chưa sinh bút toán.');
            continue;
        } else if (isHumanActionPaymentCase(caseCode) && !context.hasUserAccountingAction) {
            canGenerate = false;
            errors.push('NCC ' + (vendor.vendor_id || '?') + ': ' + caseCode +
                    ' chi hop le sau khi co tac dong cua ke toan.');
            continue;
        } else {
            // Bước 3: gọi đúng handler TT-xx để tạo các dòng Nợ/Có.
            vendorRows = buildEntriesByPaymentCase(caseCode, context);
        }

        vendorRows = removeForbiddenAutoCreditEntries(
                vendorRows,
                'BUILD ' + (caseCode || 'NO_CASE') + ' NCC ' + (vendor.vendor_id || '?')
        );
        var rowErrors = getAutoEntryRowsErrors(vendorRows);
        if (rowErrors.length > 0) {
            // debugPaymentEntry('BUILD-VENDOR-ERROR', 'NCC ' + (vendor.vendor_id || '?') + ': ' + rowErrors.join(' | '));
            canGenerate = false;
            errors = errors.concat(rowErrors);
            continue;
        }

        rows = rows.concat(vendorRows);
        successfulVendorIds.push(vendor.vendor_id);
        // debugPaymentEntry('BUILD-VENDOR', 'NCC ' + (vendor.vendor_id || '?') + ' sinh thành công ' + vendorRows.length + ' dòng');
    }

    // debugPaymentEntry('BUILD', 'Kết thúc: rows=' + rows.length + ', NCC thành công=' + successfulVendorIds.length + ', errors=' + errors.length);

    return {
        rows: rows,
        canGenerate: canGenerate,
        errors: makeUniqueTextList(errors),
        cases: cases,
        successfulVendorIds: successfulVendorIds,
        currentPhase: request.current_phase
    };
}

/**
 * Chốt nghiệp vụ cho dòng tự động:
 * - Không bao giờ sinh Có TK Phải trả (PAYABLE/ASSET).
 * - Không bao giờ sinh Có TK Tạm ứng (PREPAYMENT/ASSET).
 * TT-17 hiện chỉ sinh CUSTOMER/ASSET, không sinh PAYABLE/DEBIT.
 */
function removeForbiddenAutoCreditEntries(rows, source) {
    var list = rows || [];
    var result = [];
    for (var i = 0; i < list.length; i++) {
        var entryType = normalizeEntryType(list[i].entry_type);
        var accountType = toStoredAccountType(list[i].account_type);
        var forbidden = accountType === ACCOUNT_TYPE.ASSET &&
                (entryType === ENTRY_TYPE.PAYABLE || entryType === ENTRY_TYPE.PREPAYMENT);
        if (forbidden) {
            // debugPaymentEntry(
            //         'AUTO-CREDIT-BLOCKED',
            //         safeString(source) + ': type=' + entryType + ', id=' + safeString(list[i].id)
            // );
            continue;
        }
        result.push(list[i]);
    }
    return result;
}

// -----------------------------------------------------------------------------
// SECTION 04A - DATA CASE: gom (1), (2), (3), thuế, loại NCC và Cost Division
// -----------------------------------------------------------------------------
function buildPaymentCaseContext(paymentId, request, vendor, vendorCount, firstOrder) {
    var taxInfo = getInvoiceTaxInfo(paymentId, vendor, vendorCount);
    var hasInvoice = hasLinkedInvoicesForVendor(paymentId, vendor, vendorCount);
    var selectedPrepayment = getSelectedPrepaymentSummary(paymentId, vendor.vendor_id);
    var hasUserAccountingAction = hasUserAccountingActionEntry(paymentId, vendor.vendor_id);
    var approvedAmount = toNumber(vendor.approved_invoice_amount);
    // Phân bổ chi phí phục vụ hạch toán giá trị được chấp nhận (1), không phụ
    // thuộc việc phiếu đã gắn bản ghi hóa đơn hay chưa.
    var costDivisions = approvedAmount > 0
            ? getPaymentCostDivisions(paymentId, vendor.vendor_id)
            : [];
    var isPersonal = isPersonalPaymentVendor(vendor.vendor_type);
    // Thuế GTGT từ hóa đơn sinh tự động cho mọi NCC (bao gồm cá nhân); Thuế TNCN do KT tự thêm sau dưới dạng dòng GL.
    var errors = taxInfo.errors.slice(0);
    // debugPaymentEntry('CONTEXT', 'NCC ' + (vendor.vendor_id || '?') + ': approved=' + approvedAmount + ', PCCP=' + costDivisions.length + ', personal=' + isPersonal + ', taxGroups=' + taxInfo.groups.length);

    if (approvedAmount > 0 && costDivisions.length === 0 && isPersonal && !vendor.debit_account) {
        errors.push('NCC cá nhân ' + (vendor.vendor_id || '?') + ': không có PCCP và thiếu debit.account tại ' + TABLE_VENDOR_SITE + '.');
    }

    return {
        paymentId: paymentId,
        request: request,
        vendor: vendor,
        vendorCount: vendorCount,
        approvedAmount: approvedAmount,                            // (1)
        paymentAmount: toNumber(vendor.amount),                    // (2)
        refundAmount: toNumber(vendor.refund_amount),              // (3)
        hasInvoice: hasInvoice,
        hasTax: hasInvoice && taxInfo.hasDeductibleTax,
        isPersonal: isPersonal,
        taxInfo: taxInfo,
        costDivisions: costDivisions,
        selectedPrepaymentAmount: selectedPrepayment.totalAmount,
        hasSelectedPrepayment: selectedPrepayment.rowCount > 0,
        hasUserAccountingAction: hasUserAccountingAction,
        firstOrder: firstOrder,
        errors: errors
    };
}

/**
 * Bảo vệ các dòng hoàn ứng được chuyển từ tab Công nợ sang tab Hạch toán.
 * - Số dòng AP/PREPAYMENT phải giữ nguyên theo từng NCC.
 * - Mỗi dòng cũ phải còn đúng ID.
 * - account.number không được chỉnh sửa tại tab Hạch toán.
 */
function validateProtectedPrepaymentEntries(editedEntries, previousEntries) {
    var previousById = {};
    var editedById = {};
    var previousCountByVendor = {};
    var editedCountByVendor = {};
    var i;

    for (i = 0; i < previousEntries.length; i++) {
        var previous = previousEntries[i];
        if (!isApPrepaymentEntry(previous)) continue;

        var previousId = safeString(previous.id).trim();
        var previousVendorId = safeString(previous.vendor_id).trim();
        previousById[previousId] = previous;
        previousCountByVendor[previousVendorId] =
                (previousCountByVendor[previousVendorId] || 0) + 1;
    }

    for (i = 0; i < editedEntries.length; i++) {
        var edited = editedEntries[i];
        if (!isApPrepaymentEntry(edited)) continue;

        var editedId = safeString(edited.id).trim();
        var editedVendorId = safeString(edited.vendor_id).trim();
        editedById[editedId] = edited;
        editedCountByVendor[editedVendorId] =
                (editedCountByVendor[editedVendorId] || 0) + 1;
    }

    var vendorMap = {};
    var vendorId;
    for (vendorId in previousCountByVendor) {
        if (previousCountByVendor.hasOwnProperty(vendorId)) vendorMap[vendorId] = true;
    }
    for (vendorId in editedCountByVendor) {
        if (editedCountByVendor.hasOwnProperty(vendorId)) vendorMap[vendorId] = true;
    }

    for (vendorId in vendorMap) {
        if (!vendorMap.hasOwnProperty(vendorId)) continue;
        var previousCount = previousCountByVendor[vendorId] || 0;
        var editedCount = editedCountByVendor[vendorId] || 0;
        if (previousCount !== editedCount) {
            return makeError(
                    'NCC ' + (vendorId || '?') + ': số dòng bút toán Tạm ứng (' +
                    editedCount + ') phải bằng số dòng hoàn ứng từ tab Công nợ (' +
                    previousCount + ').'
            );
        }
    }

    for (var previousEntryId in previousById) {
        if (!previousById.hasOwnProperty(previousEntryId)) continue;
        var previousEntry = previousById[previousEntryId];
        var editedEntry = editedById[previousEntryId];

        if (!editedEntry) {
            return makeError(
                    'Không được xóa hoặc thay thế dòng Tạm ứng ' + previousEntryId +
                    ' được tạo từ tab Công nợ.'
            );
        }

        if (safeString(editedEntry.account_number).trim() !==
                safeString(previousEntry.account_number).trim()) {
            return makeError(
                    'Không được sửa số tài khoản của dòng Tạm ứng ' + previousEntryId + '.'
            );
        }
    }

    return { success: true };
}

function isApPrepaymentEntry(row) {
    return normalizeText(row.type) === normalizeText(TYPE.AP) &&
            normalizeEntryType(row.entry_type) === ENTRY_TYPE.PREPAYMENT;
}

/**
 * Đọc các dòng AP/PREPAYMENT đã được tạo sau khi người dùng chọn hoàn ứng.
 * Các dòng này không thuộc bộ tự động ban đầu và được giữ lại khi sinh lại.
 */
function getSelectedPrepaymentSummary(paymentId, vendorId) {
    var result = { rowCount: 0, totalAmount: 0 };
    var f = null;
    var query =
            'payment.id="' + escapeQueryValue(paymentId) + '"' +
            ' and vendor.id="' + escapeQueryValue(vendorId) + '"' +
            ' and entry.type="' + ENTRY_TYPE.PREPAYMENT + '"';
    var rc;

    try {
        f = new SCFile(TABLE_PAYMENT_ENTRY, SCFILE_READONLY);
        rc = f.doSelect(query);
        while (rc === RC_SUCCESS) {
            // Chỉ tính dòng AP hoàn ứng; PREPAYMENT loại GL không thuộc luồng này.
            if (normalizeText(readText(f, 'type')) === normalizeText(TYPE.AP)) {
                var amt = readNumber(f, 'amount');
                if (amt > 0) {
                    result.rowCount++;
                    result.totalAmount += amt;
                }
            }
            rc = f.getNext();
        }
    } catch (e) {
        // debugPaymentEntry('READ-PREPAYMENT-ERROR', e.toString());
    }

    closeFile(f);
    return result;
}

/**
 * Xac dinh tac dong cua ke toan: AP/PREPAYMENT, AP/PAYABLE thu cong hoac GL.
 * PAYABLE tu sinh cua TT-08..TT-10 khong lam thay doi case.
 */
function hasUserAccountingActionEntry(paymentId, vendorId) {
    var f = null;
    var query =
            'payment.id="' + escapeQueryValue(paymentId) + '"' +
            ' and vendor.id="' + escapeQueryValue(vendorId) + '"';
    var rc;

    try {
        f = new SCFile(TABLE_PAYMENT_ENTRY, SCFILE_READONLY);
        rc = f.doSelect(query);
        while (rc === RC_SUCCESS) {
            var type = normalizeText(readText(f, 'type'));
            var entryType = normalizeEntryType(readText(f, 'entry.type'));
            var amount = readNumber(f, 'amount');
            var isManualGl = type === normalizeText(TYPE.GL);
            var isManualPrepayment = type === normalizeText(TYPE.AP) &&
                    entryType === ENTRY_TYPE.PREPAYMENT && amount > 0;
            var isManualPayable = type === normalizeText(TYPE.AP) &&
                    entryType === ENTRY_TYPE.PAYABLE &&
                    toStoredAccountType(readText(f, 'account.type')) === ACCOUNT_TYPE.ASSET &&
                    isUserAddedEntryId(readText(f, 'id'));

            if (isManualGl || isManualPrepayment || isManualPayable) {
                closeFile(f);
                return true;
            }
            rc = f.getNext();
        }
    } catch (e) {
        // debugPaymentEntry('READ-MANUAL-PAYABLE-ERROR', e.toString());
    }

    closeFile(f);
    return false;
}

// -----------------------------------------------------------------------------
// SECTION 04B - PHÂN CASE: toàn bộ điều kiện TT-01 đến TT-17 nằm tại đây
// -----------------------------------------------------------------------------
/**
 * BANG QUYET DINH la nguon quy tac uu tien cao nhat.
 * Case trung dieu kien phan biet bang AP/PREPAYMENT, AP/PAYABLE thu cong hoac GL.
 * (1) Giá trị hóa đơn chấp nhận; (2) Số tiền đề nghị; (3) Số tiền hoàn ứng.
 */
function classifyPaymentCase(c) {
    var invoice = c.approvedAmount;
    var payment = c.paymentAmount;
    var refund = c.refundAmount;
    var personal = c.isPersonal;
    var tax = c.hasTax;

    // Không có hóa đơn, chỉ đề nghị thanh toán.
    if (moneyIsZero(invoice) && moneyIsPositive(payment) && moneyIsZero(refund)) return PAYMENT_CASE.TT17;

    // Không hoàn ứng: (1) = (2).
    if (moneyIsZero(refund) && moneyEquals(invoice, payment)) {
        if (personal) return PAYMENT_CASE.TT02;
        if (!tax) return PAYMENT_CASE.TT01;
        return PAYMENT_CASE.TT03;
    }

    // Không hoàn ứng: (1) > (2).
    if (moneyIsZero(refund) && moneyGreaterThan(invoice, payment)) {
        if (personal) return PAYMENT_CASE.TT05;
        if (!tax) return PAYMENT_CASE.TT04;
        return PAYMENT_CASE.TT06;
    }

    // Chỉ hoàn ứng: (1) = (3), không đi tiền.
    if (moneyIsPositive(refund) && moneyIsZero(payment) && moneyEquals(invoice, refund)) {
        return PAYMENT_CASE.TT07;
    }

    // Có hoàn ứng, không đi tiền: (1) khác (3).
    if (moneyIsPositive(refund) && moneyIsZero(payment) && !moneyEquals(invoice, refund)) {
        if (personal) return PAYMENT_CASE.TT13;
        if (!tax) return PAYMENT_CASE.TT11;
        return PAYMENT_CASE.TT12;
    }

    // Có cả hoàn ứng và đi tiền: phân biệt bằng hành động của kế toán.
    // Luon xac dinh case co ban TT-08..TT-10 truoc. TT-14..TT-16 chi la
    // trang thai dac biet sau khi co tac dong nguoi dung, khong phai case khoi tao.
    if (moneyIsPositive(refund) && moneyIsPositive(payment)) {
        var baseCase = personal
                ? PAYMENT_CASE.TT10
                : (!tax ? PAYMENT_CASE.TT08 : PAYMENT_CASE.TT09);
        return c.hasUserAccountingAction ? toHumanActionPaymentCase(baseCase) : baseCase;
    }

    return '';
}

// Các hàm so sánh tiền dùng chung cho phần chia case.
function moneyEquals(left, right) {
    return Math.abs(toNumber(left) - toNumber(right)) <= MONEY_EPSILON;
}

function moneyIsZero(value) {
    return Math.abs(toNumber(value)) <= MONEY_EPSILON;
}

function moneyIsPositive(value) {
    return toNumber(value) > MONEY_EPSILON;
}

function moneyGreaterThan(left, right) {
    return toNumber(left) - toNumber(right) > MONEY_EPSILON;
}

function isPersonalPaymentVendor(vendorType) {
    var value = normalizeBusinessText(vendorType).replace(/\s+/g, '');
    return value === 'cn' || value === 'canhan';
}

// Chỉ cho phép sinh DB đối với các case đã được hoàn thiện.
function isImplementedPaymentCase(caseCode) {
    return caseCode === PAYMENT_CASE.TT01 ||
            caseCode === PAYMENT_CASE.TT02 ||
            caseCode === PAYMENT_CASE.TT03 ||
            caseCode === PAYMENT_CASE.TT04 ||
            caseCode === PAYMENT_CASE.TT05 ||
            caseCode === PAYMENT_CASE.TT06 ||
            caseCode === PAYMENT_CASE.TT07 ||
            caseCode === PAYMENT_CASE.TT08 ||
            caseCode === PAYMENT_CASE.TT09 ||
            caseCode === PAYMENT_CASE.TT10 ||
            caseCode === PAYMENT_CASE.TT11 ||
            caseCode === PAYMENT_CASE.TT12 ||
            caseCode === PAYMENT_CASE.TT13 ||
            caseCode === PAYMENT_CASE.TT14 ||
            caseCode === PAYMENT_CASE.TT15 ||
            caseCode === PAYMENT_CASE.TT16 ||
            caseCode === PAYMENT_CASE.TT17;
}

// -----------------------------------------------------------------------------
// SECTION 05A - CASE ROUTER: ánh xạ mã case sang đúng hàm sinh bút toán
// -----------------------------------------------------------------------------
function buildEntriesByPaymentCase(caseCode, context) {
    if (caseCode === PAYMENT_CASE.TT01) return buildPaymentCaseTT01(context);
    if (caseCode === PAYMENT_CASE.TT02) return buildPaymentCaseTT02(context);
    if (caseCode === PAYMENT_CASE.TT03) return buildPaymentCaseTT03(context);
    if (caseCode === PAYMENT_CASE.TT04) return buildPaymentCaseTT04(context);
    if (caseCode === PAYMENT_CASE.TT05) return buildPaymentCaseTT05(context);
    if (caseCode === PAYMENT_CASE.TT06) return buildPaymentCaseTT06(context);
    if (caseCode === PAYMENT_CASE.TT07) return buildPaymentCaseTT07(context);
    if (caseCode === PAYMENT_CASE.TT08) return buildPaymentCaseTT08(context);
    if (caseCode === PAYMENT_CASE.TT09) return buildPaymentCaseTT09(context);
    if (caseCode === PAYMENT_CASE.TT10) return buildPaymentCaseTT10(context);
    if (caseCode === PAYMENT_CASE.TT11) return buildPaymentCaseTT11(context);
    if (caseCode === PAYMENT_CASE.TT12) return buildPaymentCaseTT12(context);
    if (caseCode === PAYMENT_CASE.TT13) return buildPaymentCaseTT13(context);
    if (caseCode === PAYMENT_CASE.TT14) return buildPaymentCaseTT14(context);
    if (caseCode === PAYMENT_CASE.TT15) return buildPaymentCaseTT15(context);
    if (caseCode === PAYMENT_CASE.TT16) return buildPaymentCaseTT16(context);
    if (caseCode === PAYMENT_CASE.TT17) return buildPaymentCaseTT17(context);
    return [];
}

// -----------------------------------------------------------------------------
// SECTION 05B - CASE ĐÃ CODE: 16 case khởi tạo invoice
// -----------------------------------------------------------------------------
// Mỗi hàm chỉ khai báo thành phần cần sinh; logic tạo dòng nằm ở SECTION 05D.
// Số dòng hiển thị (n = số Cost Division, t = số nhóm thuế):
// TT-01 n+1; TT-03 n+t+1; TT-04 n+1; TT-06 n+t+1; TT-07 n+1(+t);
// TT-08 n+2; TT-09 n+t+2; TT-11 n; TT-12 n+t;
// TT-14 n+1; TT-15 n+t+1.
function buildPaymentCaseTT01(c) { return buildStandardPaymentCase(c, true, false, false, true); }
function buildPaymentCaseTT03(c) { return buildStandardPaymentCase(c, true, true,  false, true); }
function buildPaymentCaseTT04(c) { return buildStandardPaymentCase(c, true, false, false, true); }
function buildPaymentCaseTT06(c) { return buildStandardPaymentCase(c, true, true,  false, true); }
function buildPaymentCaseTT07(c) { return buildStandardPaymentCase(c, true, c.hasTax, true, false); }
function buildPaymentCaseTT08(c) { return buildStandardPaymentCase(c, true, false, true, true); }
function buildPaymentCaseTT09(c) { return buildStandardPaymentCase(c, true, true,  true, true); }
function buildPaymentCaseTT11(c) { return buildStandardPaymentCase(c, true, false, true, false, true); }
function buildPaymentCaseTT12(c) { return buildStandardPaymentCase(c, true, true,  true, false, true); }
function buildPaymentCaseTT14(c) { return buildStandardPaymentCase(c, true, false, true, true,  true); }
function buildPaymentCaseTT15(c) { return buildStandardPaymentCase(c, true, true,  true, true,  true); }

// Case cá nhân: sinh tài khoản, để trống số tiền KT phải nhập.
function buildPaymentCaseTT02(c) { return buildPersonalPaymentCase(c, false, true); }
function buildPaymentCaseTT05(c) { return buildPersonalPaymentCase(c, false, true); }
function buildPaymentCaseTT10(c) { return buildPersonalPaymentCase(c, true,  true); }
function buildPaymentCaseTT13(c) { return buildPersonalPaymentCase(c, true,  false, true); }
function buildPaymentCaseTT16(c) { return buildPersonalPaymentCase(c, true,  true,  true); }

// TT-17: chỉ sinh Có TK Khách hàng; không tự sinh Nợ TK Phải trả.
function buildPaymentCaseTT17(c) {
    return [buildEntryRow({
        paymentId: c.paymentId,
        request: c.request,
        vendor: c.vendor,
        entryCode: AUTO_ENTRY_CODE.TRANSFER,
        amount: c.paymentAmount,
        order: c.firstOrder
    })];
}

/**
 * Rule dự phòng khi dữ liệu không khớp TT-01..TT-17.
 * - (1) > 0: sinh Nợ chi phí; nếu có thuế thì chi phí = (1) - thuế và sinh Nợ thuế.
 * - Nếu có PCCP: giữ nguyên cách gom tài khoản/số tiền PCCP hiện tại.
 * - (2) > 0: luôn sinh Có Khách hàng.
 * - Không sử dụng (3).
 */
function buildPaymentNoCase(c) {
    var rows = [];
    var order = c.firstOrder;
    var i;

    if (moneyIsPositive(c.approvedAmount)) {
        var expenseAllocations = getStandardExpenseAllocations(c);
        for (i = 0; i < expenseAllocations.length; i++) {
            var division = expenseAllocations[i];
            rows.push(buildEntryRow({
                paymentId: c.paymentId,
                request: c.request,
                vendor: c.vendor,
                entryCode: AUTO_ENTRY_CODE.COST,
                amount: toNumber(division.amount),
                order: order++,
                accountOverride: { number: division.account_number, name: division.account_name },
                departmentOverride: division.department,
                branchOverride: division.branch,
                transactionOfficeOverride: division.transactionCode
            }));
        }

        if (c.hasTax) {
            for (i = 0; i < c.taxInfo.groups.length; i++) {
                rows.push(buildEntryRow({
                    paymentId: c.paymentId,
                    request: c.request,
                    vendor: c.vendor,
                    entryCode: AUTO_ENTRY_CODE.TAX,
                    amount: c.taxInfo.groups[i].amount,
                    order: order++,
                    taxInfo: c.taxInfo.groups[i]
                }));
            }
        }
    }

    if (moneyIsPositive(c.paymentAmount)) {
        rows.push(buildEntryRow({
            paymentId: c.paymentId,
            request: c.request,
            vendor: c.vendor,
            entryCode: AUTO_ENTRY_CODE.TRANSFER,
            amount: c.paymentAmount,
            order: order++
        }));
    }

    return rows;
}

/**
 * Sinh paymentEntry cho NCC cá nhân.
 * - Có PCCP: mỗi account.number duy nhất sinh một dòng chi phí.
 * - Không PCCP: sinh một dòng chi phí từ vendorSite.debit.account.
 * - Có PCCP: tiền chi phí lấy từ tổng amount theo tài khoản.
 * - Không PCCP: tiền chi phí để trống cho KT nhập.
 * - Dòng đi tiền vẫn để amount=null cho KT nhập.
 * - Không tự sinh dòng Có TK Phải trả; KT xử lý thủ công khi cần.
 */
function buildPersonalPaymentCase(c, includeRefund, includePayment, accountingCreatesCredit) {
    var rows = [];
    var order = c.firstOrder;
    var expenseAccounts = getPersonalExpenseAccounts(c);
    var i;

    for (i = 0; i < expenseAccounts.length; i++) {
        rows.push(buildEntryRow({
            paymentId: c.paymentId,
            request: c.request,
            vendor: c.vendor,
            entryCode: AUTO_ENTRY_CODE.COST,
            amount: expenseAccounts[i].from_cost_division
                    ? expenseAccounts[i].amount
                    : null,
            allowBlankAmount: !expenseAccounts[i].from_cost_division,
            order: order++,
            accountOverride: {
                number: expenseAccounts[i].account_number,
                name: expenseAccounts[i].account_name
            },
            departmentOverride: expenseAccounts[i].department,
            branchOverride: expenseAccounts[i].branch,
            transactionOfficeOverride: expenseAccounts[i].transactionCode
        }));
    }

    if (c.hasTax) {
        for (i = 0; i < c.taxInfo.groups.length; i++) {
            rows.push(buildEntryRow({
                paymentId: c.paymentId,
                request: c.request,
                vendor: c.vendor,
                entryCode: AUTO_ENTRY_CODE.TAX,
                amount: c.taxInfo.groups[i].amount,
                order: order++,
                taxInfo: c.taxInfo.groups[i]
            }));
        }
    }

    // SỬA NGHIỆP VỤ HOÀN ỨNG:
    // refund.amount chỉ dùng để phân case có/không có tạm ứng.
    // Không sinh dòng Có TK tạm ứng (TT-BK-05) tại paymentEntry.
    // Dòng này sẽ được xử lý sau khi người dùng nhập "Số tiền hoàn ứng lần này"
    // tại tab Công nợ.

    if (includePayment && moneyIsPositive(c.paymentAmount)) {
        rows.push(buildEntryRow({
            paymentId: c.paymentId,
            request: c.request,
            vendor: c.vendor,
            entryCode: AUTO_ENTRY_CODE.TRANSFER,
            amount: null,
            allowBlankAmount: true,
            order: order++
        }));
    }

    if (accountingCreatesCredit) return rows;

    // KHÔNG TỰ ĐỘNG SINH CÓ TK PHẢI TRẢ.
    // Đoạn tính chênh lệch và push AUTO_ENTRY_CODE.LIABILITY cũ được giữ
    // dưới dạng comment để đối chiếu nghiệp vụ khi cần.
    // var personalPayableDifference = personalExpenseBase - personalPayableBase;
    // if (moneyIsPositive(personalPayableDifference)) {
    //  rows.push(buildEntryRow({
    //      paymentId: c.paymentId,
    //      request: c.request,
    //      vendor: c.vendor,
    //      entryCode: AUTO_ENTRY_CODE.LIABILITY,
    //      amount: null,
    //      allowBlankAmount: true,
    //      order: order++
    //  }));
    // }

    return rows;
}

function getPersonalExpenseAccounts(c) {
    var result = [];

    for (var i = 0; i < c.costDivisions.length; i++) {
        var division = c.costDivisions[i];
        var accountNumber = safeString(division.account_number).trim();
        if (!accountNumber) continue;

        result.push({
            account_number: accountNumber,
            account_name: division.account_name || getGlAccountName(accountNumber),
            department: division.department,
            branch: division.branch,
            transactionCode: division.transaction_code,
            amount: toNumber(division.amount),
            from_cost_division: true
        });
    }

    if (result.length === 0) {
        result.push({
            account_number: c.vendor.debit_account,
            account_name: getGlAccountName(c.vendor.debit_account),
            department: '',
            branch: '',
            amount: null,
            from_cost_division: false
        });
    }

    return result;
}

/**
 * Mỗi PCCP sinh một dòng chi phí riêng, kể cả khi trùng tài khoản.
 * Khi không có PCCP, dùng đúng một dòng từ vendorSite.debit.account.
 */
function getStandardExpenseAllocations(c) {
    var result = [];

    for (var i = 0; i < c.costDivisions.length; i++) {
        var division = c.costDivisions[i];
        var accountNumber = safeString(division.account_number).trim();
        if (!accountNumber) continue;

        result.push({
            account_number: accountNumber,
            account_name: division.account_name || getGlAccountName(accountNumber),
            department: division.department,
            branch: division.branch,
            transactionCode: division.transaction_code,
            amount: toNumber(division.amount)
        });
    }

    if (result.length === 0) {
        // debugPaymentEntry('COST-FALLBACK', 'NCC ' + (c.vendor.vendor_id || '?') + ': không có PCCP, dùng debit.account=' + safeString(c.vendor.debit_account));
        result.push({
            account_number: '',
            account_name: '',
            department: '',
            branch: '',
            amount: Math.max(0, c.approvedAmount - (c.hasTax ? c.taxInfo.totalDeductibleTax : 0))
        });
    }

    // debugPaymentEntry('COST-ALLOCATE', 'NCC ' + (c.vendor.vendor_id || '?') + ': ' + c.costDivisions.length + ' PCCP => ' + result.length + ' dòng chi phí');
    return result;
}

// -----------------------------------------------------------------------------
// SECTION 05D - ENTRY BUILDER DÙNG CHUNG: tạo dòng Nợ/Có, tránh lặp giữa case
// -----------------------------------------------------------------------------
/**
 * Sinh đúng các dòng được hiển thị tại tab Hạch toán.
 *
 * Không lưu các cặp TK phải trả trung gian của Standard / Payment.
 * Không tự sinh dòng Có TK tạm ứng hoặc Có TK Phải trả tại paymentEntry.
 * TT-17 cũng không tự sinh Nợ TK Phải trả.
 *
 * Thứ tự hiển thị:
 *   chi phí -> thuế -> Có tài khoản đi tiền -> phải trả còn lại.
 */
function buildStandardPaymentCase(c, includeInvoice, includeTax, includeRefund, includePayment, accountingCreatesCredit) {
    var rows = [];
    var order = c.firstOrder;
    var i;
    var payableCredit = includeInvoice ? c.approvedAmount : 0;
    var payableDebit = 0;

    if (includeInvoice) {
        var expenseAllocations = getStandardExpenseAllocations(c);
        for (i = 0; i < expenseAllocations.length; i++) {
            var division = expenseAllocations[i];
            rows.push(buildEntryRow({
                paymentId: c.paymentId,
                request: c.request,
                vendor: c.vendor,
                entryCode: AUTO_ENTRY_CODE.COST,
                amount: toNumber(division.amount),
                order: order++,
                accountOverride: { number: division.account_number, name: division.account_name },
                departmentOverride: division.department,
                branchOverride: division.branch,
                transactionOfficeOverride: division.transactionCode
            }));
        }

        if (includeTax) {
            for (i = 0; i < c.taxInfo.groups.length; i++) {
                rows.push(buildEntryRow({
                    paymentId: c.paymentId,
                    request: c.request,
                    vendor: c.vendor,
                    entryCode: AUTO_ENTRY_CODE.TAX,
                    amount: c.taxInfo.groups[i].amount,
                    order: order++,
                    taxInfo: c.taxInfo.groups[i]
                }));
            }
        }

    }

    // NGHIỆP VỤ CÓ HOÀN ỨNG/TÀI KHOẢN TẠM ỨNG:
    // Không tự sinh dòng Có TK tạm ứng. Sau khi người dùng chọn hoàn ứng và dòng
    // AP/PREPAYMENT đã được lưu, dùng tổng thực tế của các dòng đó để khử Phải trả.
    if (includeRefund && c.hasSelectedPrepayment) {
        payableDebit += c.selectedPrepaymentAmount;
    }

    if (includePayment && moneyIsPositive(c.paymentAmount)) {
        // Dòng Nợ phải trả của Payment được khử; chỉ hiển thị Có tài khoản đi tiền.
        payableDebit += c.paymentAmount;
        rows.push(buildEntryRow({
            paymentId: c.paymentId,
            request: c.request,
            vendor: c.vendor,
            entryCode: AUTO_ENTRY_CODE.TRANSFER,
            amount: c.paymentAmount,
            order: order++
        }));
    }

    if (accountingCreatesCredit) return rows;

    // KHÔNG TỰ ĐỘNG SINH CÓ TK PHẢI TRẢ.
    // Đoạn sinh AUTO_ENTRY_CODE.LIABILITY cũ được giữ dưới dạng comment:
    // var payableDifference = payableCredit - payableDebit;
    // if (moneyIsPositive(payableDifference)) {
    //  rows.push(buildEntryRow({
    //      paymentId: c.paymentId,
    //      request: c.request,
    //      vendor: c.vendor,
    //      entryCode: AUTO_ENTRY_CODE.LIABILITY,
    //      amount: payableDifference,
    //      order: order++
    //  }));
    // }

    return rows;
}

// =============================================================================
// SECTION 05E - BUILD ENTRY ROW: chuẩn hóa cấu trúc một dòng paymentEntry
// =============================================================================

function buildEntryRow(params) {
    var account = params.accountOverride || resolveAccount(params.entryCode, params.vendor, params.taxInfo || {});
    var entryType = getEntryTypeByRuleCode(params.entryCode);
    var beneficiary = getBeneficiaryByEntryType(entryType, params.vendor);
    var branch = params.branchOverride || params.request.creator_unit_code || '';

    return {
        id: '',
        payment_id: params.paymentId,
        entry_type: entryType,
        rule_code: params.entryCode,
        ledger_type: getAutoLedgerType(params.entryCode),
        account_type: getAutoAccountType(params.entryCode),
        account_number: account.number,
        account_name: account.name,
        branch: formatSegment1(branch, GL_DEFAULT_ENTITY_CODE),
        department: params.departmentOverride,
        transaction_office: params.transactionOfficeOverride,
        amount: params.amount,
        currency: params.vendor.currency,
        description: safeString(params.vendor.transaction_description).trim(),
        vendor_id: params.vendor.vendor_id,
        type: TYPE.AP,
        order: params.order,
        accounting_request_id: '',
        payment_method: params.vendor.payment_method,
        beneficiary_account: beneficiary.account,
        beneficiary_name: beneficiary.name,
        beneficiary_bank: beneficiary.bank,
        bank_name: beneficiary.bank_name,
        // Chỉ dùng trong bước validate lúc khởi tạo case cá nhân; không lưu DB.
        allow_blank_amount: params.allowBlankAmount === true
    };
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

/** Chuẩn hóa thông tin thụ hưởng theo loại bút toán hiển thị. */
function getBeneficiaryByEntryType(entryType, vendor) {
    var normalizedType = normalizeEntryType(entryType);

    if (normalizedType === ENTRY_TYPE.CUSTOMER) {
        return {
            account: safeString(vendor && vendor.beneficiary_account).trim(),
            name: safeString(vendor && vendor.beneficiary_name).trim(),
            bank: safeString(vendor && vendor.beneficiary_bank).trim(),
            bank_name: safeString(vendor && vendor.bank_name).trim(),
        };
    }

    if (normalizedType === ENTRY_TYPE.COST) {
        return { account: '', name: 'VietinBank', bank: '' };
    }

    // TAX, PAYABLE, PREPAYMENT và các loại còn lại không lấy thông tin NCC.
    return { account: '', name: '', bank: '' };
}

function applyBeneficiaryByEntryType(rows) {
    var list = rows || [];

    for (var i = 0; i < list.length; i++) {
        var beneficiary = getBeneficiaryByEntryType(list[i].entry_type, list[i]);
        list[i].beneficiary_account = beneficiary.account;
        list[i].beneficiary_name = beneficiary.name;
        list[i].beneficiary_bank = beneficiary.bank;
        list[i].bank_name = beneficiary.bank_name || "Vietinbank";

        var rawBranch = list[i].branch;
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
                list[i].branch_entity_code = matchingEntity.entityCode;
                list[i].branch_name = matchingEntity.branchName;
            }
        }
    }

    return list;
}

// -----------------------------------------------------------------------------
// SECTION 05F - ACCOUNT MAPPING: xác định tài khoản theo mã TT-BK
// -----------------------------------------------------------------------------

/**
 * Xác định tài khoản hạch toán cho từng dòng bút toán.
 *
 * TT-BK-01 (Cost)     : từ costDivision → truyền qua accountOverride, không vào đây.
 * TT-BK-02 (Tax)      : từ loại khấu trừ thuế (category item).
 * TT-BK-03 (Liability): TK phải trả NCC từ vendorSite.credit.account.
 * TT-BK-04 (Refund DR): TK phải trả NCC từ vendorSite.credit.account.
 * TT-BK-05 (Refund CR): TK tạm ứng khoản được chọn → truyền qua accountOverride.
 * TT-BK-06 (Payment)  : TK phải trả NCC từ vendorSite.credit.account.
 * TT-BK-07 (Suspended): TK phải trả NCC từ vendorSite.credit.account.
 * TT-BK-08 (Transfer) : paymentVendor.beneficiary.account do người dùng nhập.
 */
function resolveAccount(entryCode, vendor, taxInfo) {
    // TT-BK-02: Tài khoản thuế theo loại khấu trừ
    if (entryCode === AUTO_ENTRY_CODE.TAX) {
        return {
            number: taxInfo.accountNumber,
            name: taxInfo.accountName
        };
    }

    // TT-BK-08 / CUSTOMER:
    // - Chuyển khoản: lấy tài khoản người dùng nhập tại paymentVendor.
    // - Tiền mặt: tạm dùng tài khoản cố định 99999999.
    if (entryCode === AUTO_ENTRY_CODE.TRANSFER) {
        if (isCashPayment(vendor.payment_method)) {
            return {
                number: CASH_CUSTOMER_ACCOUNT_NUMBER,
                name: CASH_CUSTOMER_ACCOUNT_NAME
            };
        }
        return {
            number: safeString(vendor.beneficiary_account).trim(),
            name: safeString(vendor.beneficiary_name).trim()
        };
    }

    // Các dòng Phải trả còn lại lấy credit.account của Vendor Site.
    return {
        number: vendor.credit_account,
        name: getGlAccountName(vendor.credit_account)
    };
}

// =============================================================================
// SECTION 06 - VALIDATE: tài khoản, số tiền và các trường DB bắt buộc
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
        errors.push(subject + ' chưa xác định được Số đề nghị thanh toán. Vui lòng kiểm tra lại.');
    }
    if (!row.vendor_id) {
        errors.push(subject + ' chưa xác định được Nhà cung cấp. Vui lòng kiểm tra lại.');
    }
    if (!row.currency) {
        errors.push(subject + vendorReference + ' chưa chọn Loại tiền. Vui lòng kiểm tra lại.');
    }

    if (!row.account_number) {
        if (entryCode === AUTO_ENTRY_CODE.COST) {
            // Cho phép sinh dòng chi phí chưa chọn tài khoản để KT nhập sau.
        } else if (entryCode === AUTO_ENTRY_CODE.TAX) {
            errors.push(subject + vendorReference + ' chưa được thiết lập Tài khoản thuế GTGT đầu vào trong danh mục hệ thống. Vui lòng kiểm tra lại.');
        } else if (entryCode === AUTO_ENTRY_CODE.LIABILITY ||
                entryCode === AUTO_ENTRY_CODE.REFUND_DR ||
                entryCode === AUTO_ENTRY_CODE.PAYMENT ||
                entryCode === AUTO_ENTRY_CODE.SUSPENDED) {
            errors.push(subject + vendorReference + ' chưa được thiết lập Tài khoản công nợ phải trả tại danh mục Site nhà cung cấp. Vui lòng kiểm tra lại.');
        } else if (entryCode === AUTO_ENTRY_CODE.REFUND_CR) {
            errors.push(subject + vendorReference + ' chưa được thiết lập Tài khoản tạm ứng tại danh mục Site nhà cung cấp. Vui lòng kiểm tra lại.');
        } else if (entryCode === AUTO_ENTRY_CODE.TRANSFER && !isCashPayment(row.payment_method)) {
            errors.push(subject + vendorReference + ' chưa có thông tin Số tài khoản thụ hưởng. Vui lòng kiểm tra lại.');
        } else {
            errors.push(subject + vendorReference + ' chưa xác định được tài khoản định khoản kế toán. Vui lòng kiểm tra lại.');
        }
    }

    return errors;
}

// Map tên NCC dùng trong thông báo lỗi sinh bút toán.
function getVendorGenerationSubject(vendor) {
    var vendorName = safeString(vendor.vendor_name || vendor.name).trim();
    var vendorId = safeString(vendor.vendor_id || vendor.id).trim();

    if (vendorName) return 'Nhà cung cấp ' + vendorName;
    if (vendorId) return 'Nhà cung cấp ' + vendorId;
    return 'Nhà cung cấp';
}

// -----------------------------------------------------------------------------
// SECTION 06A - VALIDATE NCC: kiểm tra dữ liệu trước khi chia case
// -----------------------------------------------------------------------------

function getVendorAutoEntryErrors(vendor) {
    var errors = [];
    var subject = getVendorGenerationSubject(vendor);

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

// Chỉ bắt buộc thông tin thụ hưởng khi case thực sự có đi tiền.
    if (toNumber(vendor.amount) > 0) {
        if (isBankTransfer(vendor.payment_method)) {
            if (!vendor.beneficiary_account) {
                errors.push(subject + ' chưa nhập Số tài khoản thụ hưởng. Vui lòng kiểm tra lại.');
            }
            if (!vendor.beneficiary_name) {
                errors.push(subject + ' chưa nhập Tên đơn vị thụ hưởng. Vui lòng kiểm tra lại.');
            }
            if (!vendor.beneficiary_bank) {
                errors.push(subject + ' chưa chọn Ngân hàng thụ hưởng. Vui lòng kiểm tra lại.');
            }
        } else if (!isCashPayment(vendor.payment_method)) {
            if (!vendor.beneficiary_account) {
                errors.push(subject + ' chưa nhập Số tài khoản thụ hưởng. Vui lòng kiểm tra lại.');
            }
        }
    }

    return errors;
}

// =============================================================================
// SECTION 04C - READ INVOICE / TAX: dữ liệu phục vụ phân case
// =============================================================================

/** Kiểm tra NCC có hóa đơn mới đính kèm trong phiếu thanh toán hay không. */
function hasLinkedInvoicesForVendor(paymentId, vendor, vendorCount) {
    var links = getLinkedInvoices(paymentId);

    for (var i = 0; i < links.length; i++) {
        var invoice = getInvoiceById(links[i].invoice_id);
        if (isInvoiceForVendor(invoice, vendor, vendorCount)) return true;
    }

    return false;
}

/**
 * Tính tổng thuế của các hóa đơn gắn với payment theo logic bút toán tạm ứng:
 * - Số tiền thuế từng hóa đơn lấy từ esdHTKTinvoice.total.tax.
 * - deduction.type tại esdHTKTpaymentInvoice chỉ xác định loại khấu trừ
 *   và tài khoản ghi Nợ của dòng TT-BK-02.
 * - deduction.amount và deduction.rate là dữ liệu nghiệp vụ đã lưu từ hóa đơn,
 *   nhưng không dùng để thay thế invoice.total.tax khi sinh dòng thuế.
 *
 * Nếu payment có nhiều NCC, hàm được gọi theo từng NCC. Tổng thuế của toàn bộ
 * lần hạch toán bằng tổng total.tax của tất cả hóa đơn hợp lệ gắn với payment.
 */
function getInvoiceTaxInfo(paymentId, vendor, vendorCount) {
    var links = getLinkedInvoices(paymentId);
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
        if (!isInvoiceForVendor(invoice, vendor, vendorCount)) continue;

        // Số tiền ghi Nợ TAX luôn giữ nguyên theo total.tax của hóa đơn.
        // Loại khấu trừ chỉ dùng để xác định tài khoản thuế, không điều chỉnh số tiền.
        var taxAmount = toNumber(invoice.total_tax);
        if (taxAmount <= 0) continue;

        var deductionType = links[i].deduction_type;
        if (!deductionType) {
            result.errors.push('Hóa đơn ' + links[i].invoice_id + ': thiếu deduction.type tại ' + TABLE_PAYMENT_INVOICE + '.');
            continue;
        }

        var deductionTypeCode = safeString(deductionType).trim().toUpperCase();
        if (deductionTypeCode === DEDUCTION_TYPE_NONE) continue;

        if (deductionTypeCode !== DEDUCTION_TYPE_FULL && deductionTypeCode !== DEDUCTION_TYPE_RATE) {
            result.errors.push('Hóa đơn ' + links[i].invoice_id + ': deduction.type không hợp lệ (' + deductionType + ').');
            continue;
        }

        // Gom nguyên số thuế theo loại để sinh đúng tài khoản TT-BK-02.
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

function getLinkedInvoices(paymentId) {
    var list = [];
    var f = new SCFile(TABLE_PAYMENT_INVOICE, SCFILE_READONLY);
    var rc;

    try {
        rc = f.doSelect('payment.id="' + escapeQueryValue(paymentId) + '"');
    } catch (e) {
        closeFile(f);
        return list;
    }

    while (rc === RC_SUCCESS) {
        var invoiceId = readText(f, 'invoice.id');

        if (invoiceId) {
            list.push({
                invoice_id: invoiceId,
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

function isInvoiceForVendor(invoice, vendor, vendorCount) {
    var sellerTaxCode = normalizeIdentity(invoice.seller_tax_code);
    var vendorTaxCode = normalizeIdentity(vendor.vendor_number);

    if (sellerTaxCode && vendorTaxCode) return sellerTaxCode === vendorTaxCode;

    return vendorCount <= 1;
}

/** Kiểm tra MST hóa đơn khớp ít nhất một NCC trong đề nghị. */
function getLinkedInvoiceVendorErrors(paymentId, vendors) {
    var links = getLinkedInvoices(paymentId);
    var errors = [];

    for (var i = 0; i < links.length; i++) {
        var invoice = getInvoiceById(links[i].invoice_id);
        var sellerTaxCode = normalizeIdentity(invoice.seller_tax_code);
        var matched = false;

        for (var vendorIndex = 0; vendorIndex < vendors.length; vendorIndex++) {
            var vendorTaxCode = normalizeIdentity(vendors[vendorIndex].vendor_number);
            if (sellerTaxCode && vendorTaxCode && sellerTaxCode === vendorTaxCode) {
                matched = true;
                break;
            }
        }

        if (!sellerTaxCode) {
            errors.push('Hóa đơn ' + links[i].invoice_id + ' đang để trống Mã số thuế bên bán. Vui lòng kiểm tra lại.');
        } else if (!matched) {
            errors.push('Hóa đơn ' + links[i].invoice_id + ': Mã số thuế bên bán không khớp với Mã số thuế của Nhà cung cấp trong đề nghị.');
        }
    }

    return makeUniqueTextList(errors);
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

// -----------------------------------------------------------------------------
// SECTION 04D - READ COST DIVISION: dữ liệu phục vụ sinh bút toán
// -----------------------------------------------------------------------------

/**
 * Đọc các dòng phân bổ chi phí từ bảng esdHTKTpaymentCostDivision.
 * Mỗi dòng phân bổ tương ứng 1 dòng TT-BK-01.
 */
function getPaymentCostDivisions(paymentId, vendorId) {
    var list = [];
    var f = new SCFile(TABLE_COST_DIVISION, SCFILE_READONLY);
    // ĐÃ CHỐT: lọc theo cả payment.id và vendor.id.
    // Hiện giả định: lọc theo cả payment.id + vendor.id.
    var query = 'payment.id="' + escapeQueryValue(paymentId) + '"';
    if (vendorId) query += ' and vendor.id="' + escapeQueryValue(vendorId) + '"';

    var rc;

    try {
        rc = f.doSelect(query);
    } catch (e) {
        closeFile(f);
        return list;
    }

    while (rc === RC_SUCCESS) {
        list.push({
            id: readText(f, 'id'),
            payment_id: readText(f, 'payment.id'),
            account_number: readText(f, 'account.number'),
            account_name: readText(f, 'account.name'),
            amount: readNumber(f, 'amount'),
            currency: readText(f, 'currency'),
            department: readText(f, 'department'),
            department_name: readText(f, 'department.name'),
            transaction_code: readText(f, 'transaction.code'),
            branch: readText(f, 'branch'),
            description: readText(f, 'description'),
            vendor_id: readText(f, 'vendor.id'),
            order: readNumber(f, 'order')
        });

        rc = f.getNext();
    }

    closeFile(f);
    return list;
}

// =============================================================================
// SECTION 04E - READ SOURCE DATA: phiếu thanh toán, NCC và Vendor Site
// =============================================================================

function getPaymentRequest(paymentId) {
    if (!paymentId) return {};

    return (
            selectOne(TABLE_PAYMENT, 'id="' + escapeQueryValue(paymentId) + '"', function (record) {
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
                    total_refund_amount: readNumber(record, 'total.refund.amount'),
                    total_tax_amount: readNumber(record, 'total.tax.amount'),
                    currency: readText(record, 'currency') || readText(record, 'currentcy')
                };
            }) || {}
    );
}

function getCreatorAccountingUnit(createdBy) {
    var creator = safeString(createdBy).trim();
    if (!creator) return { code: '', name: '', lv1Id: '' };

    var lv1Id = selectOne(
            TABLE_CONTACT,
            'contact.name="' + escapeQueryValue(creator) + '"',
            function (record) { return readText(record, 'lv1.id'); }
    );
    if (!lv1Id) return { code: '', name: '', lv1Id: '' };

    // ps.code = lv1Id (giữ nguyên lv1.id, không cắt số 0 đầu)
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

function getCreatorAccountingInfo(details) {
    var currentUser = safeString(details.currentUser || details.createdBy).trim();
    if (!currentUser) {
        return { success: false, error: 'User is required.' };
    }

    var lv1Id = selectOne(
            TABLE_CONTACT,
            'contact.name="' + escapeQueryValue(currentUser) + '"',
            function (record) { return readText(record, 'lv1.id'); }
    );
    if (!lv1Id) {
        return { success: false, error: 'User contact info not found: ' + currentUser };
    }

    // ps.code = lv1Id (giữ nguyên lv1.id, không cắt số 0 đầu)
    var entityInfo = selectOne(
            TABLE_ENTITY,
            'ps.code="' + escapeQueryValue(lv1Id) + '"',
            function (record) {
                var rawBranchCode = readText(record, 'ogl.branch.code').trim();
                return {
                    entityCode: readText(record, 'entity.code').trim(),
                    branchCode: removeFirstLeadingZero(rawBranchCode).trim(), // 100 (chuẩn hóa từ 0100)
                    branchName: getBranchNamePrefix(readText(record, 'branch.name')),
                    rawBranchCode: rawBranchCode // 0100
                };
            }
    );

    if (!entityInfo) {
        return { success: false, error: 'Accounting unit not found for contact ID: ' + lv1Id };
    }

    return {
        success: true,
        data: entityInfo
    };
}

function getGLAddRowOptions(details) {
    var startTime = new Date().getTime();
    var paymentId = safeString(details.paymentId).trim();
    if (!paymentId) {
        return { success: false, error: 'Thiếu mã đề nghị thanh toán.' };
    }

    var request = getPaymentRequest(paymentId);
    var createdBy = request.created_by;
    var currentUser = safeString(details.currentUser).trim();
    var creatorUnit = getCreatorAccountingUnit(currentUser || createdBy);
    var creatorTransactionOfficeOptions = creatorUnit ? getTransactionOfficeOptions(creatorUnit.lv1Id) : [];
    var defaultTransactionOfficeCode = creatorTransactionOfficeOptions ? getDefaultTransactionOfficeCode(creatorTransactionOfficeOptions) : '';

    var creatorUnitOption = creatorUnit && (creatorUnit.entityCode || creatorUnit.code) ? {
        value: creatorUnit.entityCode || creatorUnit.code,
        label: (creatorUnit.entityCode || creatorUnit.code) + ' - ' + creatorUnit.name,
        entityCode: creatorUnit.entityCode || creatorUnit.code,
        branchCode: creatorUnit.code,
        name: creatorUnit.name,
        matchBranchCode: creatorUnit.code
    } : null;

    var glUnitOptions = creatorUnitOption ? [creatorUnitOption] : [];

    var duration = new Date().getTime() - startTime;
    // debugPaymentEntry('GET-ADD-OPTIONS', 'getGLAddRowOptions hoàn thành trong ' + duration + 'ms (1 đơn vị theo user)');

    return {
        success: true,
        glUnitOptions: glUnitOptions,
        glCostCenterOptions: [],
        transactionOfficeOptions: [],
        defaultTransactionOfficeCode: defaultTransactionOfficeCode,
        creatorUnit: creatorUnitOption
    };
}

function getGlUnitsApi(details) {
    var startTime = new Date().getTime();
    var page = 1;
    var pageSize = details && details.pageSize ? Number(details.pageSize) : 100;
    if (details && details.page && Number(details.page) > 0) page = Number(details.page);
    var keyword = safeString(details && details.keyword).trim();

    var options = getGlUnitOptions();
    if (keyword) {
        var kw = normalizeText(keyword);
        var filtered = [];
        for (var i = 0; i < options.length; i++) {
            var o = options[i];
            if (
                    normalizeText(o.label).indexOf(kw) >= 0 ||
                    normalizeText(o.value).indexOf(kw) >= 0 ||
                    normalizeText(o.entityCode).indexOf(kw) >= 0 ||
                    normalizeText(o.branchCode).indexOf(kw) >= 0
            ) {
                filtered.push(o);
            }
        }
        options = filtered;
    }

    var totalRecords = options.length;
    var totalPages = Math.ceil(totalRecords / pageSize);
    var startIndex = (page - 1) * pageSize;
    var sliced = options.slice(startIndex, startIndex + pageSize);

    var duration = new Date().getTime() - startTime;
    // debugPaymentEntry('GL-UNITS-API', 'Đọc ' + options.length + ' đơn vị trong ' + duration + 'ms');

    return {
        success: true,
        data: sliced,
        pagination: {
            page: page,
            pageSize: pageSize,
            totalRecords: totalRecords,
            totalPages: totalPages
        }
    };
}

function getCostCenterOptions(details) {
    var startTime = new Date().getTime();
    var page = 1;
    var pageSize = details && details.pageSize ? Number(details.pageSize) : 100;
    if (details && details.page && Number(details.page) > 0) page = Number(details.page);
    var keyword = safeString(details && details.keyword).trim();
    var entityCode = safeString(details && (details.entityCode || details.entity_code || details.unitId || details.code)).trim();

    if (!entityCode) {
        return {
            success: true,
            data: [{
                value: '000000',
                label: '000000 - Không xác định',
                name: 'Không xác định'
            }],
            pagination: {
                page: 1,
                pageSize: pageSize,
                totalRecords: 1,
                totalPages: 1
            }
        };
    }

    var options = getCostCenterOptionsForUnit(entityCode);
    if (keyword) {
        var kw = normalizeText(keyword);
        var filtered = [];
        for (var i = 0; i < options.length; i++) {
            var o = options[i];
            if (
                    normalizeText(o.label).indexOf(kw) >= 0 ||
                    normalizeText(o.value).indexOf(kw) >= 0 ||
                    normalizeText(o.name).indexOf(kw) >= 0
            ) {
                filtered.push(o);
            }
        }
        options = filtered;
    }

    var totalRecords = options.length;
    var totalPages = Math.ceil(totalRecords / pageSize);
    var startIndex = (page - 1) * pageSize;
    var sliced = options.slice(startIndex, startIndex + pageSize);

    var duration = new Date().getTime() - startTime;
    // debugPaymentEntry('COST-CENTER-OPTIONS', 'Đọc ' + options.length + ' phòng ban của unit ' + entityCode + ' trong ' + duration + 'ms');

    return {
        success: true,
        data: sliced,
        pagination: {
            page: page,
            pageSize: pageSize,
            totalRecords: totalRecords,
            totalPages: totalPages
        }
    };
}

function getCostCenterOptionsForUnit(entityCode) {
    var options = [];

    // Mặc định gán giá trị không xác định
    options.push({
        value: '000000',
        label: '000000 - Không xác định',
        name: 'Không xác định'
    });

    var code = safeString(entityCode).trim();
    if (!code) return options;

    // Tách 3 chữ số giữa (xxx) từ mã đơn vị (ví dụ 1010098 -> xxx = 100)
    var xxx = '';
    if (code.length >= 5 && code.substring(0, 2) === '10') {
        xxx = code.substring(2, 5);
    }

    if (!xxx) return options;

    var query = 'status="ACTIVE"';
    if (xxx === '100') {
        query += ' and not org.code like "3*"';
    } else {
        query += ' and org.code like "3*"';
    }

    var list = [];
    var f = new SCFile('esdDMcostCenter', SCFILE_READONLY);
    var rc;
    try {
        rc = f.doSelect(query);
    } catch (e) {
        closeFile(f);
        return options;
    }

    while (rc === RC_SUCCESS) {
        var ccCode = safeString(readText(f, 'cost.center')).trim();
        var ccName = safeString(readText(f, 'name')).trim();

        if (ccCode && ccCode !== '000000') {
            list.push({
                value: ccCode,
                label: ccCode + (ccName ? ' - ' + ccName : ''),
                name: ccName
            });
        }
        rc = f.getNext();
    }
    closeFile(f);

    list.sort(function (left, right) {
        var a = left.value;
        var b = right.value;
        return a === b ? 0 : a < b ? -1 : 1;
    });

    return options.concat(list);
}

function getTransactionOfficeOptionsApi(details) {
    var startTime = new Date().getTime();
    var page = 1;
    var pageSize = details && details.pageSize ? Number(details.pageSize) : 100;
    if (details && details.page && Number(details.page) > 0) page = Number(details.page);
    var keyword = safeString(details && details.keyword).trim();
    var entityCode = safeString(details && (details.entityCode || details.entity_code || details.unitId || details.code)).trim();

    if (!entityCode) {
        return {
            success: true,
            data: [{
                value: '000000',
                label: '000000 - Không xác định',
                name: 'Không xác định'
            }],
            pagination: {
                page: 1,
                pageSize: pageSize,
                totalRecords: 1,
                totalPages: 1
            }
        };
    }

    var options = getTransactionOfficeOptionsForUnit(entityCode);
    if (keyword) {
        var kw = normalizeText(keyword);
        var filtered = [];
        for (var i = 0; i < options.length; i++) {
            var o = options[i];
            if (
                    normalizeText(o.label).indexOf(kw) >= 0 ||
                    normalizeText(o.value).indexOf(kw) >= 0 ||
                    normalizeText(o.name).indexOf(kw) >= 0
            ) {
                filtered.push(o);
            }
        }
        options = filtered;
    }

    var totalRecords = options.length;
    var totalPages = Math.ceil(totalRecords / pageSize);
    var startIndex = (page - 1) * pageSize;
    var sliced = options.slice(startIndex, startIndex + pageSize);

    var duration = new Date().getTime() - startTime;
    // debugPaymentEntry('TRANS-OFFICE-OPTIONS', 'Đọc ' + options.length + ' PGD của unit ' + entityCode + ' trong ' + duration + 'ms');

    return {
        success: true,
        data: sliced,
        pagination: {
            page: page,
            pageSize: pageSize,
            totalRecords: totalRecords,
            totalPages: totalPages
        }
    };
}

function getUnitPrefix5(unitId) {
    var code = safeString(unitId).trim();
    if (!code) return "";
    if (code.length >= 5 && code.substring(0, 2) === "10") {
        return code.substring(0, 5);
    }
    if (code.length === 3) {
        return "10" + code;
    }
    if (code.length === 4) {
        return "10" + code.slice(-3);
    }
    return "";
}

function getUnitXxx(unitId) {
    var prefix = getUnitPrefix5(unitId);
    return prefix ? prefix.substring(2, 5) : "";
}

function getTransactionOfficeOptionsForUnit(entityCode) {
    var options = [];

    // Mặc định gán giá trị không xác định
    options.push({
        value: '000000',
        label: '000000 - Không xác định',
        name: 'Không xác định'
    });

    var prefix = getUnitPrefix5(entityCode);
    if (!prefix) return options;

    var query = 'status="ACTIVE" and entity.code like "' + escapeQueryValue(prefix) + '*"';
    var list = [];
    var optionMap = { '000000': true };
    var f = new SCFile('esdDMentity', SCFILE_READONLY);
    var rc;
    try {
        rc = f.doSelect(query);
    } catch (e) {
        closeFile(f);
        return options;
    }

    while (rc === RC_SUCCESS) {
        var entCode = safeString(readText(f, 'entity.code')).trim();
        var branchName = safeString(readText(f, 'branch.name')).trim();

        var isMainUnit = (entCode.length >= 2 && entCode.substring(entCode.length - 2) === '98');

        if (entCode && entCode.length === 7 && entCode.substring(0, 5) === prefix && !isMainUnit && !optionMap[entCode]) {
            optionMap[entCode] = true;
            var branchNameSeparatorIndex = branchName.indexOf('-');
            if (branchNameSeparatorIndex >= 0) {
                branchName = branchName.substring(branchNameSeparatorIndex + 1).trim();
            }

            list.push({
                value: entCode,
                label: entCode + (branchName ? ' - ' + branchName : ''),
                name: branchName
            });
        }
        rc = f.getNext();
    }
    closeFile(f);

    list.sort(function (left, right) {
        var a = left.value;
        var b = right.value;
        return a === b ? 0 : a < b ? -1 : 1;
    });

    return options.concat(list);
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


/** map danh sách Phòng ban GL từ esdDMcostCenter lọc theo status ACTIVE và quy tắc mã đơn vị. */
function getGlCostCenterOptions(unitId) {
    var options = [];
    var fields = [
        ['d.cost.center', 'cost_center', 'S'],
        ['d.name', 'name', 'S'],
        ['d.org.code', 'org_code', 'S']
    ];
    var sql =
            'SELECT ' +
            selectFields(fields) +
            ' FROM ' +
            TABLE_COST_CENTER +
            ' d WHERE d.status="ACTIVE"';
    var rows;

    try {
        rows = selectList(TABLE_COST_CENTER, sql, fields);
    } catch (e) {
        return options;
    }

    var unitOptions = [];
    if (unitId) {
        unitOptions.push({ entityCode: unitId });
    } else {
        unitOptions = getGlUnitOptions() || [];
    }

    for (var u = 0; u < unitOptions.length; u++) {
        var unitCode = safeString(unitOptions[u].entityCode).trim();
        if (!unitCode) continue;

        var xxx = getUnitXxx(unitCode);

        // Thêm mã mặc định 000000 - Không xác định cho đơn vị này
        options.push({
            value: GL_DEFAULT_COST_CENTER,
            label: GL_DEFAULT_COST_CENTER + ' - Không xác định',
            name: 'Không xác định',
            segment1EntityCode: unitCode
        });

        for (var i = 0; i < rows.length; i++) {
            var costCenter = safeString(rows[i].cost_center).trim();
            var name = safeString(rows[i].name).trim();
            var orgCode = safeString(rows[i].org_code).trim();

            if (!costCenter || costCenter === GL_DEFAULT_COST_CENTER) continue;

            var startsWith3 = costCenter.charAt(0) === '3';
            var isValid = false;

            if (xxx === '100') {
                if (!startsWith3) isValid = true;
            } else {
                if (startsWith3) isValid = true;
            }

            if (isValid) {
                options.push({
                    value: costCenter,
                    label: costCenter + (name ? ' - ' + name : ''),
                    name: name,
                    segment1EntityCode: unitCode
                });
            }
        }
    }

    options.sort(function (left, right) {
        var leftValue = safeString(left.value);
        var rightValue = safeString(right.value);

        if (leftValue < rightValue) return -1;
        if (leftValue > rightValue) return 1;

        var leftEntityCode = safeString(left.segment1EntityCode);
        var rightEntityCode = safeString(right.segment1EntityCode);
        if (leftEntityCode < rightEntityCode) return -1;
        if (leftEntityCode > rightEntityCode) return 1;
        return 0;
    });

    return options;
}


function normalizeGlBranchCode(value) {
    var code = safeString(value).replace(/\s+/g, '').trim();
    if (!/^[0-9]+$/.test(code)) return '';
    while (code.length > 3 && code.charAt(0) === '0') code = code.substring(1);
    if (code.length > 3) return '';
    while (code.length < 3) code = '0' + code;
    return code;
}

function getGlBranchCodeByEntityCode(entityCode) {
    var code = safeString(entityCode).trim();
    if (!code) return '';
    return selectOne(
            TABLE_ENTITY,
            'entity.code="' + escapeQueryValue(code) +
            '" and org.transaction.code="' + escapeQueryValue(GL_UNIT_TRANSACTION_CODE) + '"',
            function (record) {
                return normalizeGlBranchCode(readText(record, 'ogl.branch.code'));
            }
    ) || '';
}

function compareGlUnitOption(left, right) {
    var a = safeString(left.entityCode);
    var b = safeString(right.entityCode);
    return a === b ? 0 : a < b ? -1 : 1;
}


/** map danh sách PGD segment6 của GL khác mã 98, 00 và kèm segment1EntityCode để lọc theo Đơn vị. */
function getGlTransactionOfficeOptions(unitId) {
    var options = [];
    var fields = [
        ['d.entity.code', 'entity_code', 'S'],
        ['d.org.transaction.code', 'transaction_code', 'S'],
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

    var unitOptions = [];
    if (unitId) {
        unitOptions.push({ entityCode: unitId });
    } else {
        unitOptions = getGlUnitOptions() || [];
    }

    for (var u = 0; u < unitOptions.length; u++) {
        var unitCode = safeString(unitOptions[u].entityCode).trim();
        if (!unitCode) continue;

        var prefix = getUnitPrefix5(unitCode);

        // Thêm mã mặc định 0000000 - Không xác định cho đơn vị này
        options.push({
            value: GL_DEFAULT_TRANSACTION_OFFICE,
            label: GL_DEFAULT_TRANSACTION_OFFICE + ' - Không xác định',
            name: 'Không xác định',
            segment1EntityCode: unitCode
        });

        if (!prefix) continue;

        for (var i = 0; i < rows.length; i++) {
            var entityCode = safeString(rows[i].entity_code).trim();
            var transactionCode = safeString(rows[i].transaction_code).trim();
            var branchCode = safeString(rows[i].branch_code).trim();
            var branchName = safeString(rows[i].branch_name).trim();
            var branchNameSeparatorIndex = branchName.indexOf('-');

            if (branchNameSeparatorIndex >= 0) {
                branchName = branchName.substring(branchNameSeparatorIndex + 1).trim();
            }

            // Kiểm tra PGD thuộc đơn vị (cùng tiền tố 10xxx) và không phải là 98 hoặc 00
            if (
                    entityCode.length === 7 &&
                    entityCode.substring(0, 5) === prefix &&
                    transactionCode &&
                    transactionCode !== GL_UNIT_TRANSACTION_CODE &&
                    transactionCode.slice(-2) !== '98' &&
                    transactionCode !== '00' &&
                    branchCode
            ) {
                options.push({
                    value: entityCode,
                    label: entityCode + (branchName ? ' - ' + branchName : ''),
                    name: branchName,
                    branchCode: branchCode,
                    transactionCode: transactionCode,
                    segment1EntityCode: unitCode
                });
            }
        }
    }

    options.sort(compareTransactionOfficeOption);
    return options;
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


function getLv2OrgUnitsByLv1(lv1Id) {
    var id = safeString(lv1Id).trim();
    if (!id) return [];
    return lib.ESD_Utils.fetchData(
            'esdQTorgUnit',
            'parent.id="' + escapeQueryValue(id) + '"',
            ['unit.id', 'unit.name']
    ) || [];
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

function validateTransactionOfficeRows(entries, options) {
    if (!options || !options.length) return { success: true };
    var allowed = {};
    for (var i = 0; i < options.length; i++) {
        allowed[safeString(options[i].value).trim()] = true;
    }
    for (var j = 0; j < entries.length; j++) {
        var code = safeString(entries[j].transaction_office).trim();
        if (code && !allowed[code]) {
            // print("code" + code);
            return makeError('Phòng giao dịch dòng ' + (j + 1) + ' không thuộc đơn vị đã chọn.');
        }
    }
    return { success: true };
}

function isTransactionOfficeCodeAllowed(value, options) {
    var code = safeString(value).trim();
    if (!code) return false;
    if (!options || !options.length) return true;
    for (var i = 0; i < options.length; i++) {
        if (code === safeString(options[i].value).trim()) return true;
    }
    return false;
}

function applyCreatorUnitToEntries(entries, unitCode, defaultOffice, options) {
    for (var i = 0; i < entries.length; i++) {
        var isManualCost =
                normalizeEntryType(entries[i].entry_type) === ENTRY_TYPE.COST &&
                isUserAddedEntryId(entries[i].id);

        if (isManualCost) {
            if (unitCode) entries[i].branch = formatSegment1(unitCode, GL_DEFAULT_ENTITY_CODE);
            if (!entries[i].transaction_office) entries[i].transaction_office = GL_DEFAULT_TRANSACTION_OFFICE;
            if (!entries[i].department) entries[i].department = GL_DEFAULT_COST_CENTER;
        }

        if (unitCode && !isAdditionalEntryType(entries[i].type) && !safeString(entries[i].branch).trim()) {
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

function getPaymentVendors(paymentId, vendorId) {
    var list = [];
    var f = new SCFile(TABLE_PAYMENT_VENDOR, SCFILE_READONLY);
    var query = 'payment.id="' + escapeQueryValue(paymentId) + '"';
    var rc;

    if (vendorId) query += ' and vendor.id="' + escapeQueryValue(vendorId) + '"';

    try {
        rc = f.doSelect(query);
    } catch (e) {
        closeFile(f);
        return list;
    }

    while (rc === RC_SUCCESS) {
        list.push({
            vendor_id: readText(f, 'vendor.id'),
            vendor_site_id: readText(f, 'vendor.site.id'),
            approved_invoice_amount: readNumber(f, 'approved.invoice.amount'),
            amount: readNumber(f, 'amount'),
            refund_amount: readNumber(f, 'refund.amount'),
            vendor_type: readText(f, 'vendor.type'),
            currency: readText(f, 'currency'),
            payment_method: readText(f, 'payment.method'),
            bank_name: readText(f, 'bank.name'),
            beneficiary_account: readText(f, 'beneficiary.account'),
            beneficiary_name: readText(f, 'beneficiary.name'),
            beneficiary_bank: readText(f, 'beneficiary.bank'),
            transaction_description: readText(f, 'transaction.des'),
            exchange_rate: readText(f, 'exchange.rate'),
            payment_rate: readNumber(f, 'payment.rate'),
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

    var exact =
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
            );
    if (exact) return exact;

    // Fallback: mot so moi truong luu ID khong dong nhat so 0 o dau.
    var f = new SCFile(TABLE_VENDOR_SITE, SCFILE_READONLY);
    var query = vendorId
            ? 'vendor.id="' + escapeQueryValue(vendorId) + '"'
            : '';
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
    } catch (e) {
        // debugPaymentEntry('READ-VENDOR-SITE-ERROR', e.toString());
    }
    closeFile(f);
    if (candidateCount === 1) {
        // debugPaymentEntry('READ-VENDOR-SITE-FALLBACK',
        //         'vendor=' + vendorId + ', paymentVendor.site=' + vendorSiteId +
        //         ', dung Vendor Site duy nhat cua NCC');
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

/** Đọc entry cùng thông tin NCC bằng LEFT JOIN. */
function getSavedPaymentEntries(paymentId) {
    var fields = getPaymentEntryFields();
    var sql =
            'SELECT ' +
            selectFields(fields) +
            ' FROM ' +
            TABLE_PAYMENT_ENTRY +
            ' e LEFT JOIN ' +
            TABLE_PAYMENT_VENDOR +
            ' pv ON (e.payment.id = pv.payment.id AND e.vendor.id = pv.vendor.id)' +
            ' LEFT JOIN ' +
            TABLE_VENDOR +
            ' v ON (e.vendor.id = v.id)' +
            ' LEFT JOIN ' +
            TABLE_VENDOR_SITE +
            ' vs ON (pv.vendor.site.id = vs.id)' +
            ' WHERE e.payment.id="' +
            escapeQueryValue(paymentId) +
            '" ORDER BY e.order ASC';

    var entries = applyBeneficiaryByEntryType(selectList(TABLE_PAYMENT_ENTRY, sql, fields));
    enrichPaymentEntriesWithNames(entries);
    return entries;
}

function getPaymentEntryFields() {
    return [
        ['e.id', 'id', 'S'],
        ['e.payment.id', 'payment_id', 'S'],
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
        ['pv.bank.name', 'bank_name', 'S'],
    ];
}

/** Giữ description và tài khoản chi phí người dùng đã sửa khi sinh lại. */
function mergeEditableAutoEntryFields(savedEntries, expectedEntries) {
    var savedMap = {};
    var result = [];

    // Gom các dòng đã lưu theo NCC và loại bút toán; thứ tự trong nhóm phân biệt các dòng cùng loại.
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
            expected.description = safeString(matched.description).trim() || expected.description;

            // Giữ tài khoản chi phí (TT-BK-01) nếu người dùng đã sửa
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

    var key = safeString(row.vendor_id).trim() + '|' + entryType;

    // Chi phí và thuế có thể có nhiều dòng nên phân biệt thêm theo tài khoản.
    if (entryType === ENTRY_TYPE.COST || entryType === ENTRY_TYPE.TAX) {
        key += '|' + safeString(row.account_number).trim();
    }

    return key;
}

function isEditableDebitAccountEntry(row) {
    return normalizeEntryType(row.entry_type) === ENTRY_TYPE.COST;
}

/**
 * SAVE AUTO:
 * Chỉ xóa dòng tự động ban đầu của phiếu.
 * Giữ dòng GL bổ sung và dòng AP/PREPAYMENT phát sinh sau từ xử lý hoàn ứng.
 */
function replaceAutoPaymentEntries(paymentId, rows) {
    // debugPaymentEntry('DB-REPLACE', 'paymentId=' + paymentId + ', rows mới=' + rows.length);
    var deleted = deleteAutoPaymentEntries(paymentId);
    var inserted = insertPaymentEntries(rows);
    // debugPaymentEntry('DB-REPLACE', 'paymentId=' + paymentId + ', deleted=' + deleted + ', inserted=' + inserted);

    return {
        inserted: inserted,
        updated: 0,
        deleted: deleted
    };
}

/** SAVE INSERT: ghi danh sách dòng đã validate vào esdHTKTpaymentEntry. */
function insertPaymentEntries(rows) {
    var inserted = 0;
    // debugPaymentEntry('DB-INSERT', 'Bắt đầu insert ' + rows.length + ' dòng');
    var seenIds = {};

    for (var i = 0; i < rows.length; i++) {
        var rowId = safeString(rows[i].id).trim();
        if (!rowId || seenIds[rowId]) {
            // debugPaymentEntry('DB-INSERT-WARN', 'Phát hiện ID rỗng hoặc trùng lặp: ' + rowId + ', dòng=' + (i + 1));
        }
        seenIds[rowId] = true;
        var rc = insertRecord(TABLE_PAYMENT_ENTRY, toPaymentEntryRecord(rows[i]));
        // debugPaymentEntry('DB-INSERT-ROW', 'id=' + safeString(rows[i].id) + ', vendor=' + safeString(rows[i].vendor_id) + ', type=' + safeString(rows[i].entry_type) + ', rc=' + rc);
        if (rc === RC_SUCCESS) inserted++;
    }

    // debugPaymentEntry('DB-INSERT', 'Kết thúc inserted=' + inserted + '/' + rows.length);
    return inserted;
}

function toPaymentEntryRecord(row) {
    return {
        id: row.id,
        'payment.id': row.payment_id,
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

    for (var key in row) {
        if (row.hasOwnProperty(key)) f[key] = row[key];
    }

    var rc = f.doInsert();
    closeFile(f);
    return rc;
}

function deleteAutoPaymentEntries(paymentId) {
    var deleted = 0;
    // debugPaymentEntry('DB-DELETE-AUTO', 'Bắt đầu paymentId=' + paymentId);
    var f = new SCFile(TABLE_PAYMENT_ENTRY);
    var rc = f.doSelect('payment.id="' + escapeQueryValue(paymentId) + '"');

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
            // debugPaymentEntry('DB-DELETE-AUTO-ROW', 'id=' + safeString(f['id']) + ', rc=' + deleteRc);
            if (deleteRc === RC_SUCCESS) deleted++;
        }

        rc = f.getNext();
    }

    closeFile(f);
    // debugPaymentEntry('DB-DELETE-AUTO', 'Kết thúc deleted=' + deleted);
    return deleted;
}

/** SAVE EDIT: xóa toàn bộ dòng của phiếu trước khi lưu danh sách người dùng sửa. */
function deletePaymentEntries(paymentId) {
    var deleted = 0;
    var f = new SCFile(TABLE_PAYMENT_ENTRY);
    var rc = f.doSelect('payment.id="' + escapeQueryValue(paymentId) + '"');

    while (rc === RC_SUCCESS) {
        if (f.doDelete() === RC_SUCCESS) deleted++;
        rc = f.getNext();
    }

    closeFile(f);
    return deleted;
}

// =============================================================================
// SUPPORT - PHASE / PERMISSION: khóa sinh hoặc giới hạn quyền chỉnh sửa
// =============================================================================

function isGenerationPhaseLocked(currentPhase) {
    var phase = normalizeText(currentPhase);
    return phase !== GENERATION_PHASE.DMMS &&
            phase !== GENERATION_PHASE.KTTC;
}

function isAccountingEditablePhase(currentPhase) {
    var phase = normalizeText(currentPhase);
    return phase === GENERATION_PHASE.KTTC;
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
    // GL là bút toán bổ sung của người dùng, không thuộc bộ tự động ban đầu.
    if (normalizeText(row.type) === normalizeText(TYPE.GL)) return false;

    // Code tự động hiện không còn sinh Có TK tạm ứng. Vì vậy AP/PREPAYMENT là
    // dòng phát sinh sau từ xử lý hoàn ứng và phải được giữ khi sinh lại.
    if (normalizeEntryType(row.entry_type) === ENTRY_TYPE.PREPAYMENT) return false;

    // Dòng AP/PAYABLE có ref.id (mã YCTT cũ chọn từ tab Công nợ) phải được giữ lại.
    if (normalizeEntryType(row.entry_type) === ENTRY_TYPE.PAYABLE && safeString(row.ref_id || row['ref.id']).trim()) return false;

    // Dong AP do nguoi dung them co ID MANUAL va phai duoc giu khi dong bo lai.
    if (isUserAddedEntryId(row.id)) return false;

    return true;
}

function toHumanActionPaymentCase(baseCase) {
    if (baseCase === PAYMENT_CASE.TT08) return PAYMENT_CASE.TT14;
    if (baseCase === PAYMENT_CASE.TT09) return PAYMENT_CASE.TT15;
    if (baseCase === PAYMENT_CASE.TT10) return PAYMENT_CASE.TT16;
    return baseCase;
}

function isHumanActionPaymentCase(caseCode) {
    return caseCode === PAYMENT_CASE.TT14 ||
            caseCode === PAYMENT_CASE.TT15 ||
            caseCode === PAYMENT_CASE.TT16;
}

// =============================================================================
// SUPPORT - ID GENERATION: sinh ID tuần tự cho dòng mới
// =============================================================================

function assignNewEntryIds(paymentId, rows, savedEntries) {
    var list = rows || [];
    var combined = (savedEntries || []).concat(list);
    var usedIds = makeEntryIdSet(combined);
    var nextApSequence = getNextEntryIdSequence(paymentId, TYPE.AP, combined);
    var nextGlRowSequence = getNextGlRowSequence(paymentId, 1, combined);

    for (var i = 0; i < list.length; i++) {
        if (!safeString(list[i].id).trim() || usedIds[list[i].id] > 1) {
            var newId;
            if (isAdditionalEntryType(list[i].type)) {
                do {
                    newId = makeGlEntryId(paymentId, 1, nextGlRowSequence++);
                } while (usedIds[newId]);
            } else {
                do {
                    newId = makeSequentialEntryId(paymentId, TYPE.AP, nextApSequence++);
                } while (usedIds[newId]);
            }
            list[i].id = newId;
            usedIds[newId] = true;
        }
    }
}

function getNextEntryIdSequence(paymentId, entryType, rows) {
    if (entryType === TYPE.GL) {
        return getNextGlRowSequence(paymentId, 1, rows);
    }
    var prefix = getEntryIdPrefix(paymentId, entryType);
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

function makeSequentialEntryId(paymentId, entryType, sequence) {
    if (entryType === TYPE.GL) {
        return makeGlEntryId(paymentId, 1, sequence);
    }
    return getEntryIdPrefix(paymentId, entryType) + sequence;
}

function makeUserAddedEntryId(paymentId, sequence) {
    return safeString(paymentId).trim() + '.MANUAL.AP.' + sequence;
}

function isUserAddedEntryId(entryId) {
    return safeString(entryId).indexOf('.MANUAL.AP.') >= 0;
}

function getNextManualEntryIdSequence(paymentId, rows) {
    var prefix = safeString(paymentId).trim() + '.MANUAL.AP.';
    var maxSequence = 0;
    var list = rows || [];

    for (var i = 0; i < list.length; i++) {
        var id = safeString(list[i].id).trim();
        if (id.indexOf(prefix) !== 0) continue;
        var suffix = id.substring(prefix.length);
        if (/^\d+$/.test(suffix) && Number(suffix) > maxSequence) {
            maxSequence = Number(suffix);
        }
    }

    return maxSequence + 1;
}

function getEntryIdPrefix(paymentId, entryType) {
    var prefix = safeString(paymentId).trim() + '.';
    return entryType === TYPE.GL ? prefix + TYPE.GL + '.' : prefix;
}

function makeGlEntryId(paymentId, groupOrder, rowOrder) {
    return getEntryIdPrefix(paymentId, TYPE.GL) + groupOrder + '.' + rowOrder;
}

function isStructuredGlEntryId(paymentId, entryId) {
    var parts = getGlEntryIdParts(paymentId, entryId);
    return !!parts && !parts.legacy;
}

function getGlEntryIdParts(paymentId, entryId) {
    var prefix = getEntryIdPrefix(paymentId, TYPE.GL);
    var id = safeString(entryId).trim();
    if (id.indexOf(prefix) !== 0) return null;
    var parts = id.substring(prefix.length).split('.');

    if (parts.length === 2 &&
            /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]) &&
            Number(parts[0]) > 0 && Number(parts[1]) > 0) {
        return {
            groupOrder: Number(parts[0]),
            rowOrder: Number(parts[1]),
            legacy: false
        };
    }

    // Tương thích ID GL cũ: <paymentId>.GL.<dòng>, mặc định thuộc nhóm 1.
    if (parts.length === 1 &&
            /^\d+$/.test(parts[0]) &&
            Number(parts[0]) > 0) {
        return {
            groupOrder: 1,
            rowOrder: Number(parts[0]),
            legacy: true
        };
    }

    return null;
}

function getNextGlRowSequence(paymentId, groupOrder, rows) {
    var maxSequence = 0;
    var list = rows || [];
    for (var i = 0; i < list.length; i++) {
        var parts = getGlEntryIdParts(paymentId, list[i].id);
        if (parts && parts.groupOrder === groupOrder && parts.rowOrder > maxSequence) {
            maxSequence = parts.rowOrder;
        }
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


// =============================================================================
// SUPPORT - QUERY HELPERS: wrapper đọc SCFile / SQL
// =============================================================================

function isBankTransfer(value) {
    return normalizeBusinessText(value).replace(/\s+/g, '') === 'chuyenkhoan';
}

function isCashPayment(value) {
    return normalizeBusinessText(value).replace(/\s+/g, '') === 'tienmat';
}

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

// =============================================================================
// SUPPORT - UTILITIES: xử lý chuỗi, số, field và đóng file
// =============================================================================

function addMissingFieldsError(errors, subject, tableName, fields) {
    if (fields.length === 0) return;
    errors.push(subject + ': thiếu ' + fields.join(', ') + ' tại ' + tableName + '.');
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
 * Dạng mới: lấy đoạn giữa dấu phân cách thứ hai và thứ ba (hỗ trợ dấu chấm hoặc gạch ngang); dạng cũ giữ nguyên.
 */
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
        if (text.normalize) text =text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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

///////////Valid khi save////////////////////
///////////////////////////////
// Hàm kiểm tra tổng ghi Nợ của loại tài khoản Chi phí phải bằng giá trị hóa đơn của NCC (chính xác với 6 chữ số thập phân)
function validateCostDebitAgainstInvoice(paymentId, entries) {
    if (!paymentId || !entries || entries.length === 0) {
        return { success: true };
    }

    // 1. Gom nhóm entries theo vendor_id (Bỏ qua các dòng có type là GL)
    var vendorGroups = {};
    for (var i = 0; i < entries.length; i++) {
        var row = entries[i];
        var rowType = safeString(row.type).toUpperCase();

        // Nếu type là GL thì bỏ qua không đưa vào nhóm kiểm tra theo vendor
        if (rowType === 'GL') {
            continue;
        }

        var vendorId = row.vendor_id || row.vendorId || "";

        if (!vendorGroups[vendorId]) {
            vendorGroups[vendorId] = [];
        }
        vendorGroups[vendorId].push(row);
    }

    // --- HÀM HỖ TRỢ NỘI BỘ: Làm tròn 6 chữ số và xóa sạch đuôi .000000 ---
    function cleanAndFormatAmount(val) {
        var num = parseFloat(val);
        if (isNaN(num)) return "0";

        var fixedStr = num.toFixed(6);
        fixedStr = fixedStr.replace(/\.?0+$/, "");

        return fixedStr;
    }

    // --- HÀM HỖ TRỢ: Lấy tên nhà cung cấp từ bảng esdHTKTvendor ---
    function getVendorName(vendorId) {
        if (!vendorId) return "Không xác định";

        var fVendorInfo = new SCFile('esdHTKTvendor', SCFILE_READONLY);
        var qVendor = 'id="' + escapeQueryValue(vendorId) + '"';
        try {
            var rc = fVendorInfo.doSelect(qVendor);
            if (rc === RC_SUCCESS) {
                var vName = readText(fVendorInfo, 'vendor.name') || readText(fVendorInfo, 'name') || vendorId;
                closeFile(fVendorInfo);
                return vName;
            }
            closeFile(fVendorInfo);
        } catch (e) {
            if (fVendorInfo) closeFile(fVendorInfo);
        }
        return vendorId; // Fallback về ID nếu không tìm thấy tên
    }

    // 2. Duyệt qua từng nhà cung cấp để kiểm tra riêng biệt
    for (var vId in vendorGroups) {
        if (!vendorGroups.hasOwnProperty(vId)) continue;

        var vendorEntries = vendorGroups[vId];

        // Truy vấn giá trị hóa đơn đã phê duyệt của NCC này từ bảng esdHTKTpaymentVendor
        var fVendorPayment = new SCFile('esdHTKTpaymentVendor', SCFILE_READONLY);

        var query = 'payment.id="' + escapeQueryValue(paymentId) + '"';
        if (vId) {
            query += ' and vendor.id="' + escapeQueryValue(vId) + '"';
        }

        var targetInvoiceAmount = "0";
        try {
            var rc = fVendorPayment.doSelect(query);
            if (rc === RC_SUCCESS) {
                targetInvoiceAmount = String(readText(fVendorPayment, 'approved.invoice.amount') || "0");
            }
            closeFile(fVendorPayment);
        } catch (e) {
            if (fVendorPayment) closeFile(fVendorPayment);
            var displayName = getVendorName(vId);
            return makeError('Lỗi truy vấn thông tin hóa đơn nhà cung cấp [' + displayName + ']: ' + e.toString());
        }

        // Chuẩn hóa giá trị hóa đơn mục tiêu
        targetInvoiceAmount = cleanAndFormatAmount(targetInvoiceAmount);

        // Tính tổng ghi Nợ Chi phí + Thuế + Khác của NCC này.
        var totalCostDebit = "0";
        for (var j = 0; j < vendorEntries.length; j++) {
            var row = vendorEntries[j];

            var entryTypeCode = safeString(row.entry_type).trim().toUpperCase();
            var accountSide = getAccountingSide(row.account_type);

            var isCostType = (
                    entryTypeCode === 'COST' || entryTypeCode === 'TAX' || entryTypeCode === 'OTHER'
            );

            // Kiểm tra chiều Ghi Nợ (debit)
            if (isCostType && accountSide === 'debit') {
                var rowAmount = String(row.amount || "0");
                totalCostDebit = lib.ESD_HTKT_Utils.addStringsManual(totalCostDebit, rowAmount);
            }
        }

        // Chuẩn hóa tổng tiền Nợ sau khi cộng dồn
        totalCostDebit = cleanAndFormatAmount(totalCostDebit);

        // So sánh tổng ghi Nợ chi phí với giá trị hóa đơn của NCC này
        var compareResult = lib.ESD_HTKT_Utils.compareMoneyStrings(totalCostDebit, targetInvoiceAmount);

        if (compareResult !== 0) {
            var vendorName = getVendorName(vId);
            return makeError('Tổng ghi Nợ của loại tài khoản Chi phí, Thuế và Khác của nhà cung cấp [' + vendorName + '] (' + totalCostDebit + ') phải bằng giá trị hóa đơn chấp nhận (' + targetInvoiceAmount + ').');
        }
    }

    return { success: true };
}
// Hàm kiểm tra tổng chi phí theo từng tài khoản của từng nhà cung cấp 
// phải khớp với dữ liệu trong bảng phân chia chi phí (esdHTKTpaymentCostDivision)
function validateCostDivisionAgainstTable(paymentId, entries) {
    if (!paymentId || !entries || entries.length === 0) {
        return { success: true };
    }

    // --- HÀM HỖ TRỢ NỘI BỘ: Làm tròn 6 chữ số và xóa sạch đuôi .000000 hoặc các số 0 thừa ---
    function cleanAndFormatAmount(val) {
        var num = parseFloat(val);
        if (isNaN(num)) return "0";

        var fixedStr = num.toFixed(6);
        fixedStr = fixedStr.replace(/\.?0+$/, "");

        return fixedStr;
    }

    // --- HÀM HỖ TRỢ: Lấy tên nhà cung cấp từ bảng esdHTKTvendor ---
    function getVendorName(vendorId) {
        if (!vendorId) return "Không xác định";

        var fVendorInfo = new SCFile('esdHTKTvendor', SCFILE_READONLY);
        var qVendor = 'id="' + escapeQueryValue(vendorId) + '"';
        try {
            var rc = fVendorInfo.doSelect(qVendor);
            if (rc === RC_SUCCESS) {
                var vName = readText(fVendorInfo, 'vendor.name') || readText(fVendorInfo, 'name') || vendorId;
                closeFile(fVendorInfo);
                return vName;
            }
            closeFile(fVendorInfo);
        } catch (e) {
            if (fVendorInfo) closeFile(fVendorInfo);
        }
        return vendorId; // Fallback về ID nếu không tìm thấy tên
    }

    // 2. Truy vấn dữ liệu phân chia chi phí từ bảng esdHTKTpaymentCostDivision theo paymentId (Đưa lên trước để check xem có dữ liệu hay không)
    var divisionTotals = {};
    var hasCostDivisionData = false; // Biến cờ kiểm tra xem có bản ghi phân chia chi phí nào không
    var fCostDiv = new SCFile('esdHTKTpaymentCostDivision', SCFILE_READONLY);
    var query = 'payment.id="' + escapeQueryValue(paymentId) + '"';

    try {
        var rc = fCostDiv.doSelect(query);
        while (rc === RC_SUCCESS) {
            hasCostDivisionData = true; // Đã tìm thấy ít nhất 1 bản ghi phân chia chi phí

            var divVendorId = safeString(readText(fCostDiv, 'vendor.id')).trim();
            var divAccNum = safeString(readText(fCostDiv, 'account.number')).trim();
            var divAmount = parseFloat(readText(fCostDiv, 'amount')) || 0;

            var divKey = divVendorId + "_" + divAccNum;
            if (!divisionTotals[divKey]) {
                divisionTotals[divKey] = {
                    vendorId: divVendorId,
                    accountNumber: divAccNum,
                    totalAmount: 0
                };
            }
            divisionTotals[divKey].totalAmount += divAmount;

            rc = fCostDiv.getNext();
        }
        closeFile(fCostDiv);
    } catch (e) {
        if (fCostDiv) closeFile(fCostDiv);
        return makeError('Lỗi truy vấn bảng phân chia chi phí (esdHTKTpaymentCostDivision): ' + e.toString());
    }

    // NẾU BẢNG PHÂN CHIA CHI PHÍ KHÔNG CÓ BẢN GHI NÀO -> BỎ QUA KHÔNG KIỂM TRA NỮA
    if (!hasCostDivisionData) {
        return { success: true };
    }

    // 1. Tính tổng tiền từ entries, nhóm theo: vendor_id + account_number (chỉ xét loại COST và bỏ qua type GL)
    var entryTotals = {};
    for (var i = 0; i < entries.length; i++) {
        var row = entries[i];
        var rowType = safeString(row.type).toUpperCase();

        // Nếu type là GL thì bỏ qua không đưa vào nhóm kiểm tra
        if (rowType === 'GL') {
            continue;
        }

        var entryTypeCode = safeString(row.entry_type).toUpperCase();

        // Chỉ xét các dòng có entry_type là COST
        if (entryTypeCode !== 'COST') {
            continue;
        }
        // --- LOGIC KIỂM TRA CHIỀU NỢ (DEBIT) ---
        var accountSide = getAccountingSide(row.account_type);
        if (accountSide !== 'debit' && accountSide !== 'DEBIT' ) {
            continue; // Bỏ qua nếu không phải chiều ghi Nợ
        }
        var vendorId = row.vendor_id || row.vendorId || "";
        var accNum = safeString(row.account_number).trim();

        // Tạo key định danh duy nhất cho từng cặp (Nhà cung cấp + Số tài khoản)
        var key = vendorId + "_" + accNum;
        var amount = parseFloat(row.amount) || 0;

        if (!entryTotals[key]) {
            entryTotals[key] = {
                vendorId: vendorId,
                accountNumber: accNum,
                totalAmount: 0
            };
        }
        entryTotals[key].totalAmount += amount;
    }

    // 3. Đối chiếu giữa entries và bảng phân chia chi phí
    for (var key in entryTotals) {
        if (!entryTotals.hasOwnProperty(key)) continue;

        var entryItem = entryTotals[key];
        var divItem = divisionTotals[key];

        var divAmount = divItem ? divItem.totalAmount : 0;

        var cleanEntryAmt = cleanAndFormatAmount(entryItem.totalAmount);
        var cleanDivAmt = cleanAndFormatAmount(divAmount);

        if (lib.ESD_HTKT_Utils.compareMoneyStrings(cleanEntryAmt, cleanDivAmt) !== 0) {
            var vendorName = getVendorName(entryItem.vendorId);
            return makeError('Tổng tiền của tài khoản [' + entryItem.accountNumber + '] (Nhà cung cấp: ' + vendorName + ') trong hạch toán (' + cleanEntryAmt + ') không khớp với dữ liệu phân chia chi phí (' + cleanDivAmt + ').');
        }
    }

    // Kiểm tra xem có tài khoản phân chia nào bị thiếu ở entries không
    for (var divKey in divisionTotals) {
        if (!divisionTotals.hasOwnProperty(divKey)) continue;
        if (!entryTotals[divKey]) {
            var missingDiv = divisionTotals[divKey];
            var missingVendorName = getVendorName(missingDiv.vendorId);
            return makeError('Thiếu hạch toán cho tài khoản [' + missingDiv.accountNumber + '] của nhà cung cấp [' + missingVendorName + '] theo bảng phân chia chi phí.');
        }
    }

    return { success: true };
}
