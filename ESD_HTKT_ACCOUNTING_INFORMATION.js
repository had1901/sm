/**
 * Sinh dữ liệu esdHTKTaccountingInformation cho đề nghị tạm ứng.
 * Trường data lưu toàn bộ JSON payload PREPAYMENT, STANDARD, GL hoặc CORE.
 *
 * TODO CORE - TẠM FIX CỨNG, cần xác nhận lại trước khi triển khai chính thức:
 * 1. Tài khoản nguồn: nội bộ = 1111, ngoài hệ thống = 224420600.
 *
 * Quy tắc CORE hiện tại:
 * - Chỉ sinh CORE từ dòng ghi Có TU-BT-03 khi payment.method = Chuyển khoản.
 * - napas.code = 970415: chuyển tiền trong hệ thống; mã khác: ngoài hệ thống.
 * - notes/trnDesc lấy từ description của chính dòng ghi Có TU-BT-03.
 */

function run() {
    try {
        var input = vars['$L.file'];
        if (!input) return;

        var action = safeString(input.name).trim();
        var details = getInputDetails(input);
        var result;

        if (action === 'generateAccountingInformation') {
            result = generateAccountingInformationByInputDetails(details);
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

var TABLE_ACCOUNTING_INFORMATION = 'esdHTKTaccountingInformation';
var TABLE_PREPAYMENT_ENTRY = 'esdHTKTprepaymentEntry';
var TABLE_PREPAYMENT = 'esdHTKTprepayment';
var TABLE_PREPAYMENT_VENDOR = 'esdHTKTprepaymentVendor';
var TABLE_PREPAYMENT_INVOICE = 'esdHTKTprepaymentInvoice';
var TABLE_INVOICE = 'esdHTKTinvoice';
var TABLE_VENDOR = 'esdHTKTvendor';
var TABLE_VENDOR_SITE = 'esdHTKTvendorSite';
var TABLE_CONTACT = 'contacts';
var TABLE_ENTITY = 'esdDMentity';
var TABLE_CATEGORY_ITEM = 'esdDMcategoryItems';

var ACCOUNTING_TYPE = {
    AP: 'AP',
    GL: 'GL',
    CORE: 'CORE'
};

var ACCOUNTING_SUB_TYPE = {
    TAM_UNG: 'TAM_UNG',
    THUE: 'THUE',
    INHOUSE: 'INHOUSE',
    CITAD: 'CITAD'
};

var ACCOUNTING_STATUS = {
    CREATED: 'CREATED',
    INITIAL: 'NEW',
    PROCESSING: 'PROCESSING',
    COMPLETED: 'COMPLETED',
    ERROR: 'ERROR',
    NOT_FOUND: 'NOT_FOUND'
};

var ACCOUNTING_API_STATUS_MAP = {
    N: ACCOUNTING_STATUS.INITIAL,
    P: ACCOUNTING_STATUS.PROCESSING,
    C: ACCOUNTING_STATUS.COMPLETED,
    E: ACCOUNTING_STATUS.ERROR,
    PROCESSING: ACCOUNTING_STATUS.PROCESSING,
    COMPLETED: ACCOUNTING_STATUS.COMPLETED,
    ERROR: ACCOUNTING_STATUS.ERROR,
    NOT_FOUND: ACCOUNTING_STATUS.NOT_FOUND
};

var LEDGER_TYPE_PREPAYMENT = 'Prepayment';
var LEDGER_TYPE_STANDARD = 'Standard';
var CURRENT_PHASE_END = 'end';
var GL_SOURCE = 'QLTS';
var GL_UNIT_TRANSACTION_CODE = '98';
var GL_DEFAULT_BRANCH_CODE = '000';

var INVOICE_TYPE_PREPAYMENT = 'PREPAYMENT';
var INVOICE_TYPE_STANDARD = 'STANDARD';
var CASHOUT_YES = 'Y';
var CASHOUT_NO = 'N';

var CORE_PAYMENT_ENTRY_CODE = 'TU-BT-03';
var CORE_VIETINBANK_NAPAS_CODE = '970415';
var CORE_CHANNEL = 'A414_QLTS';
var CORE_INTERNAL_SP_NAME = 'com.xesapi.xferadd20.FunsTransferAdd';
var CORE_EXTERNAL_SP_NAME = 'com.fnf.xes.PRF';
var CORE_EXTERNAL_REFERENCE_TYPE = 'A414_QLTS';
var CORE_CITAD_DESCRIPTION_MAX_LENGTH = 269;
var CORE_EXTERNAL_TO_ACCOUNT_NAME_MAX_LENGTH = 150;
var CORE_INTERNAL_SOURCE_ACCOUNT = '1111';

var SEGMENT_1_DEFAULT = '0000000';
var SEGMENT_2_DEFAULT = '000000';
var SEGMENT_4_DEFAULT = '0000000';
var SEGMENT_5_DEFAULT = '0000000';
var SEGMENT_6_DEFAULT = '0000000';
var SEGMENT_7_DEFAULT = '0000000';

var DEDUCTION_FULL = 'KHAUTRU_001';
var DEDUCTION_RATE = 'KHAUTRU_002';
var DEDUCTION_NONE = 'KHAUTRU_003';
var CATEGORY_TAX_ACCOUNT_NUMBER = 'dmhtkt_stk_loai_khau_tru';
var DISCOUNT_FULL = 'KHAU_TRU_TOAN_BO';
var DISCOUNT_RATE = 'KHAU_TRU_TY_LE';
var DISCOUNT_NONE = 'KHONG_KHAU_TRU';

function generateAccountingInformationByInputDetails(details) {
    var prepaymentId =
        safeString(details.prepaymentId).trim() ||
        safeString(details.prepayment_id).trim() ||
        safeString(details.id).trim();

    return generateAccountingInformationByPrepaymentId(prepaymentId);
}

function generateAccountingInformationByPrepaymentId(prepaymentId) {
    prepaymentId = safeString(prepaymentId).trim();
    if (!prepaymentId) return makeError('Missing prepaymentId.');

    var prepayment = getPrepayment(prepaymentId);
    if (!prepayment.id) return makeError('Khong tim thay de nghi tam ung: ' + prepaymentId + '.');
    if (safeString(prepayment.current_phase).trim() !== CURRENT_PHASE_END) {
        return {
            success: true,
            mode: 'skipped',
            prepaymentId: prepaymentId,
            currentPhase: prepayment.current_phase,
            message: 'Chi sinh accounting information khi current.phase = end.',
            deleted: 0,
            inserted: 0,
            updatedEntries: 0,
            data: []
        };
    }

    var entries = getPrepaymentEntries(prepaymentId);

    if (entries.length === 0) {
        var deletedEmpty = deleteAccountingInformation(prepaymentId);
        clearEntryAccountingRequestIds(prepaymentId);

        return {
            success: true,
            mode: 'generated',
            prepaymentId: prepaymentId,
            deleted: deletedEmpty,
            inserted: 0,
            updatedEntries: 0,
            data: []
        };
    }

    var contextResult = mapPrepaymentApiContext(prepayment);
    if (!contextResult.success) return contextResult;

    // Chốt một lần để invoiceDate của AP luôn trùng accountingDate của GL.
    var accountingDate = mapDateToYmd(new Date());
    var glEntryGroups = groupGlEntries(entries, prepaymentId);
    // Trưởng sửa: gom toàn bộ dòng TU-BT-02 vào một payload STANDARD.
    var standardEntryDiscountTypes = getStandardApEntryDiscountTypes(entries);
    var standardEntries = getStandardApEntries(
        entries,
        standardEntryDiscountTypes
    );
    var preparedGlGroups = {};
    var preparedStandardGroup = false;
    var preparedStandardGroups = {};
    var preparedCoreTransfer = false;
    var preparedRows = [];
    for (var prepareIndex = 0; prepareIndex < entries.length; prepareIndex++) {
        var preparedEntry = entries[prepareIndex];
        var preparedEntryType = safeString(preparedEntry.type)
            .trim()
            .toUpperCase();
        var isPreparedGl = preparedEntryType === ACCOUNTING_TYPE.GL;
        var preparedDiscountType = standardEntryDiscountTypes[prepareIndex];
        var isPreparedStandard = isDeductibleDiscountType(
            preparedDiscountType
        );
        var preparedEntries = [preparedEntry];

        // KHAUTRU_003 thuộc PREPAYMENT, không sinh line/record STANDARD riêng.
        if (preparedDiscountType === DISCOUNT_NONE) continue;

        if (isPreparedGl) {
            var glPosition = getGlEntryPosition(
                prepaymentId,
                preparedEntry,
                prepareIndex + 1
            );
            var glGroupKey = safeString(glPosition.groupOrder);

            if (preparedGlGroups[glGroupKey]) continue;

            preparedGlGroups[glGroupKey] = true;
            preparedEntries = glEntryGroups[glGroupKey] || preparedEntries;
        }

        // PHUONG AN 1: gom tat ca loai thue vao mot ban ghi STANDARD.
        if (isPreparedStandard) {
            if (preparedStandardGroup) continue;

            preparedStandardGroup = true;
            preparedEntries = standardEntries;
        }

        // PHUONG AN 2: tach moi loai thue thanh mot ban ghi STANDARD.
        /*
        if (isPreparedStandard) {
            if (preparedStandardGroups[preparedDiscountType]) continue;

            preparedStandardGroups[preparedDiscountType] = true;
            var separatedStandardEntries = [];
            for (
                var standardEntryIndex = 0;
                standardEntryIndex < entries.length;
                standardEntryIndex++
            ) {
                if (
                    standardEntryDiscountTypes[standardEntryIndex] ===
                    preparedDiscountType
                ) {
                    separatedStandardEntries.push(entries[standardEntryIndex]);
                }
            }
            preparedEntries = separatedStandardEntries;
        }
        */

        var isPreparedApCredit =
            preparedEntryType === ACCOUNTING_TYPE.AP &&
            isCreditAccountType(preparedEntry.account_type);
        var isPreparedCoreTransfer = isCoreTransferEntry(
            preparedEntry,
            contextResult.data
        );

        // map TU-BT-03 chuyển khoản thành CORE; các dòng ghi Có AP khác vẫn không sinh accountingInformation.
        if (isPreparedApCredit && !isPreparedCoreTransfer) {
            continue;
        }

        if (isPreparedCoreTransfer) preparedCoreTransfer = true;

        var requestId = safeString(lib.UUID.generateUUID())
            .trim()
            .toLowerCase();
        if (!requestId) return makeError('Khong the sinh requestId bang UUID.');

        var payloadResult = mapAccountingApiPayloadForEntries(
            requestId,
            prepayment,
            preparedEntries,
            contextResult.data,
            accountingDate
        );
        if (!payloadResult.success) return payloadResult;

        preparedRows.push({
            entry: preparedEntry,
            entries: preparedEntries,
            requestId: requestId,
            payloadResult: payloadResult
        });
    }

    if (
        isBankTransferPaymentMethod(contextResult.data.paymentMethod) &&
        !preparedCoreTransfer
    ) {
        return mapError(
            'CORE_PAYMENT_ENTRY_NOT_FOUND',
            'Khong tim thay dong AP TU-BT-03 de sinh accounting CORE cho phuong thuc Chuyen khoan.'
        );
    }

    var deleted = deleteAccountingInformation(prepaymentId);
    clearEntryAccountingRequestIds(prepaymentId);

    var createdTime = system.functions.tod();
    var inserted = 0;
    var updatedEntries = 0;
    var rows = [];

    for (var i = 0; i < preparedRows.length; i++) {
        var prepared = preparedRows[i];
        var row = buildAccountingInformationRecord(
            prepared.requestId,
            prepayment,
            prepared.entry,
            prepared.payloadResult,
            createdTime
        );

        if (insertRecord(TABLE_ACCOUNTING_INFORMATION, row) !== RC_SUCCESS) {
            deleteAccountingInformation(prepaymentId);
            clearEntryAccountingRequestIds(prepaymentId);

            return {
                success: false,
                error:
                    'Khong the tao accounting information cho entry ' +
                    prepared.entry.id +
                    '.',
                prepaymentId: prepaymentId,
                deleted: deleted,
                inserted: inserted,
                updatedEntries: updatedEntries
            };
        }

        inserted++;
        rows.push(row);

        var preparedEntriesToUpdate = prepared.entries || [prepared.entry];
        for (
            var entryUpdateIndex = 0;
            entryUpdateIndex < preparedEntriesToUpdate.length;
            entryUpdateIndex++
        ) {
            if (
                updateEntryAccountingRequestId(
                    preparedEntriesToUpdate[entryUpdateIndex].id,
                    prepaymentId,
                    prepared.requestId
                ) === RC_SUCCESS
            ) {
                updatedEntries++;
            }
        }
    }

    return {
        success: true,
        mode: 'generated',
        prepaymentId: prepaymentId,
        deleted: deleted,
        inserted: inserted,
        updatedEntries: updatedEntries,
        readyToSend: true,
        pendingFields: [],
        data: rows
    };
}

/**
 * map payload API vào một bản ghi esdHTKTaccountingInformation.
 */
function buildAccountingInformationRecord(
    requestId,
    prepayment,
    entry,
    payloadResult,
    createdTime
) {
    var payload = payloadResult.data;
    var accountingType = safeString(payloadResult.accountingType)
        .trim()
        .toUpperCase();

    if (!accountingType) {
        accountingType =
            safeString(entry.type).trim().toUpperCase() === ACCOUNTING_TYPE.GL
                ? ACCOUNTING_TYPE.GL
                : ACCOUNTING_TYPE.AP;
    }

    var accountingSubType = getAccountingSubType(entry.ledger_type);
    if (accountingType === ACCOUNTING_TYPE.CORE) {
        accountingSubType = safeString(payloadResult.coreTransferType)
            .trim()
            .toUpperCase();
    }

    return {
        'request.id': requestId,
        'prepayment.id': prepayment.id,
        'vendor.id': payloadResult.vendorId,
        type: accountingType,
        data: JSON.stringify(payload),
        status: ACCOUNTING_STATUS.CREATED,
        message: '',
        response: '',
        'transaction.id': '',
        'host.res.num': '',
        'ref.id': '',
        'ap.code': '',
        'batch.name': '',
        'created.time': createdTime,
        'checked.time': null,
        'sub.type': accountingSubType,
        amount:
            payloadResult.accountingAmount === undefined
                ? entry.amount
                : payloadResult.accountingAmount,
        'contract.id': prepayment.contract_id
    };
}

function getAccountingSubType(ledgerType) {
    var value = safeString(ledgerType).trim();

    if (value === LEDGER_TYPE_PREPAYMENT) {
        return ACCOUNTING_SUB_TYPE.TAM_UNG;
    }
    if (value === LEDGER_TYPE_STANDARD) {
        return ACCOUNTING_SUB_TYPE.THUE;
    }

    return '';
}

/**
 * map trạng thái nhận từ API sang trạng thái chuẩn lưu trong accountingInformation.status.
 */
function mapAccountingApiStatus(apiStatus) {
    var status = safeString(apiStatus).trim().toUpperCase();
    return ACCOUNTING_API_STATUS_MAP[status] || '';
}

/**
 * Kiểm tra trạng thái giao dịch AP/GL và cập nhật kết quả vào accountingInformation.
 */
function checkAccountingInfo(requestId) {
    requestId = safeString(requestId).trim();
    if (!requestId) {
        return mapError(
            'MISSING_ACCOUNTING_REQUEST_ID',
            'Thieu request.id de kiem tra ket qua giao dich.'
        );
    }

    var accountingInfo = selectOne(
        TABLE_ACCOUNTING_INFORMATION,
        'request.id="' + escapeQueryValue(requestId) + '"',
        function (record) {
            return {
                requestId: readText(record, 'request.id').trim(),
                type: readText(record, 'type').trim().toUpperCase(),
                transactionId: readText(record, 'transaction.id').trim()
            };
        }
    );

    if (!accountingInfo) {
        return mapError(
            'ACCOUNTING_INFORMATION_NOT_FOUND',
            'Khong tim thay accounting information voi request.id="' +
                requestId +
                '".'
        );
    }

    var apiResponse;

    try {
        if (accountingInfo.type === ACCOUNTING_TYPE.AP) {
            apiResponse = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.checkAP({
                transactionId: accountingInfo.transactionId,
                requestId: accountingInfo.requestId
            });
        } else if (accountingInfo.type === ACCOUNTING_TYPE.GL) {
            apiResponse = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.checkBatchGl(
                accountingInfo.transactionId
            );
        } else {
            return mapError(
                'ACCOUNTING_CHECK_TYPE_NOT_SUPPORTED',
                'Chua ho tro kiem tra ket qua cho accounting type="' +
                    accountingInfo.type +
                    '".'
            );
        }
    } catch (e) {
        return mapError(
            'ACCOUNTING_CHECK_API_ERROR',
            'Loi khi goi API kiem tra ket qua: ' + e.toString()
        );
    }

    if (!apiResponse) {
        return mapError(
            'EMPTY_ACCOUNTING_API_RESPONSE',
            'API kiem tra ket qua khong tra ve du lieu.'
        );
    }

    return updateAccountingInformationByApiResponse(requestId, apiResponse);
}

/**
 * Nhận response API và cập nhật đúng bản ghi theo request.id.
 */
function updateAccountingInformationByApiResponse(requestId, apiResponse) {
    requestId = safeString(requestId).trim();
    var response = parseJsonObject(apiResponse);

    if (!requestId) {
        return mapError(
            'MISSING_ACCOUNTING_REQUEST_ID',
            'Thieu request.id de cap nhat ket qua giao dich.'
        );
    }
    if (!response) {
        return mapError(
            'INVALID_ACCOUNTING_API_RESPONSE',
            'Response API khong hop le.'
        );
    }

    var f;
    var rc;

    try {
        f = new SCFile(TABLE_ACCOUNTING_INFORMATION);
        rc = f.doSelect(
            'request.id="' + escapeQueryValue(requestId) + '"'
        );
    } catch (e) {
        // closeFile(f);
        // trưởng thêm: query lỗi vẫn phải gọi doClose
        try {
            if (f) f.doClose();
        } catch (eClose) {}
        return mapError(
            'ACCOUNTING_INFORMATION_QUERY_ERROR',
            'Khong the doc accounting information: ' + e.toString()
        );
    }

    // trưởng thêm: luôn đóng SCFile kể cả khi map hoặc update phát sinh lỗi
    try {
        if (rc !== RC_SUCCESS) {
            // closeFile(f);
            return mapError(
                'ACCOUNTING_INFORMATION_NOT_FOUND',
                'Khong tim thay accounting information voi request.id="' +
                    requestId +
                    '".'
            );
        }

        // Luu response API vao record, sau do map cac field tu chinh JSON nay.
        f.response = JSON.stringify(response);
        var updateResult = mapAccountingResponseToRecord(f);
        // closeFile(f);
        return updateResult;
    } finally {
        // closeFile(f);
        // trưởng thêm: gọi trực tiếp doClose để đóng SCFile
        try {
            if (f) f.doClose();
        } catch (eClose) {}
    }
}

/**
 * Map response.data vào các field kết quả đã có trong dbdict.
 */
function mapAccountingResponseToRecord(record) {
    var storedResponse = parseJsonObject(readText(record, 'response'));
    if (!storedResponse) {
        return mapError(
            'INVALID_ACCOUNTING_STORED_RESPONSE',
            'Field response cua accounting information khong phai JSON hop le.'
        );
    }

    var responseData = storedResponse.data || {};
    var mappedStatus = mapAccountingApiStatus(responseData.status);

    if (!mappedStatus && storedResponse.success === false) {
        mappedStatus = ACCOUNTING_STATUS.ERROR;
    }
    if (!mappedStatus) {
        return mapError(
            'INVALID_ACCOUNTING_API_STATUS',
            'Khong map duoc response.data.status="' +
                safeString(responseData.status) +
                '".'
        );
    }

    var transactionId = safeString(responseData.transactionId).trim();
    var hostRefNum = safeString(responseData.hostRefNum).trim();
    var referenceId = safeString(responseData.referenceId).trim();
    var batchName = safeString(responseData.batchName).trim();
    var invoiceNumber = safeString(responseData.invoiceNumber).trim();
    var paymentNumber = safeString(
        responseData.trnRefNum ||
        responseData.chanRefNum ||
        responseData.paymentNumber
    ).trim();
    var errorCode = safeString(responseData.errorCode).trim();
    var message = safeString(storedResponse.message).trim() || errorCode;

    record.status = mappedStatus;
    record.message = message;
    record['checked.time'] = system.functions.tod();

    if (transactionId) record['transaction.id'] = transactionId;
    if (hostRefNum) record['host.res.num'] = hostRefNum;
    if (referenceId) record['ref.id'] = referenceId;
    if (batchName) record['batch.name'] = batchName;
    if (invoiceNumber) record['ap.code'] = invoiceNumber;

    if (record.doUpdate() !== RC_SUCCESS) {
        return mapError(
            'ACCOUNTING_INFORMATION_UPDATE_ERROR',
            'Khong the cap nhat ket qua accounting information.'
        );
    }

    return {
        success: true,
        apiSuccess: storedResponse.success === true,
        requestId: readText(record, 'request.id').trim(),
        status: mappedStatus,
        transactionId: transactionId,
        hostRefNum: hostRefNum,
        referenceId: referenceId,
        batchName: batchName,
        invoiceNumber: invoiceNumber,
        paymentNumber: paymentNumber,
        errorCode: errorCode,
        message: message
    };
}

function getPrepayment(prepaymentId) {
    return (
        selectOne(TABLE_PREPAYMENT, 'id="' + escapeQueryValue(prepaymentId) + '"', function (record) {
            return {
                id: readText(record, 'id'),
                contract_id: readText(record, 'contract.id'),
                current_phase: readText(record, 'current.phase'),
                description: readText(record, 'description'),
                created_by: readText(record, 'created.by'),
                initial_role: readText(record, 'initial.role'),
                user_checker_kttc: readText(record, 'user.checker.kttc'),
                user_approver_kttc: readText(record, 'user.approver.kttc')
            };
        }) || {}
    );
}

/**
 * map dữ liệu dùng chung của đề nghị: NCC, site NCC, đơn vị theo LV1,
 * cán bộ KTTC tạo/tiếp nhận, cán bộ KTTC phê duyệt và vatList.
 */
function mapPrepaymentApiContext(prepayment) {
    var prepaymentVendorResult = mapSinglePrepaymentVendor(prepayment.id);
    if (!prepaymentVendorResult.success) return prepaymentVendorResult;

    var prepaymentVendor = prepaymentVendorResult.data;
    var vendor = mapVendor(prepaymentVendor.vendor_id);
    if (!vendor) {
        return mapError(
            'VENDOR_NOT_FOUND',
            'Khong tim thay NCC id=' + prepaymentVendor.vendor_id + '.'
        );
    }

    var vendorSite = mapVendorSite(prepaymentVendor.vendor_site_id);
    if (!vendorSite) {
        return mapError(
            'VENDOR_SITE_NOT_FOUND',
            'Khong tim thay site NCC id=' + prepaymentVendor.vendor_site_id + '.'
        );
    }

    var segment1Result = mapEntityCodeByCreatorLv1(prepayment.created_by);
    if (!segment1Result.success) return segment1Result;

    var initialRole = safeString(prepayment.initial_role).trim().toLowerCase();
    var accountingCreator = '';

    if (initialRole === 'kttc') {
        accountingCreator = safeString(prepayment.created_by).trim();
    } else if (initialRole === 'dmms') {
        accountingCreator = safeString(
            prepayment.user_checker_kttc
        ).trim();
    } else {
        return mapError(
            'INVALID_PREPAYMENT_INITIAL_ROLE',
            'Khong map duoc initial.role="' +
                prepayment.initial_role +
                '" sang can bo KTTC tao/tiep nhan.'
        );
    }

    if (!accountingCreator) {
        return mapError(
            'MISSING_ACCOUNTING_CREATOR',
            initialRole === 'kttc'
                ? 'Thieu ' + TABLE_PREPAYMENT + '.created.by cua KTTC khoi tao.'
                : 'Thieu ' +
                    TABLE_PREPAYMENT +
                    '.user.checker.kttc cua KTTC tiep nhan.'
        );
    }

    var accountingApprover = safeString(
        prepayment.user_approver_kttc
    ).trim();
    if (!accountingApprover) {
        return mapError(
            'MISSING_ACCOUNTING_APPROVER',
            'Thieu ' +
                TABLE_PREPAYMENT +
                '.user.approver.kttc cua KTTC phe duyet.'
        );
    }

    var vatListResult = mapVatList(prepayment.id);
    if (!vatListResult.success) return vatListResult;

    var cashout = mapPaymentMethodToCashout(prepaymentVendor.payment_method);
    if (!cashout) {
        return mapError(
            'INVALID_PAYMENT_METHOD',
            'Khong map duoc payment.method="' +
                prepaymentVendor.payment_method +
                '" sang cashout.'
        );
    }

    return {
        success: true,
        data: {
            vendorId: prepaymentVendor.vendor_id,
            vendorNumber: vendor.vendor_number,
            vendorSiteCode: vendorSite.vendor_site_code,
            entity: vendorSite.ogl_entity,
            segment1: segment1Result.data,
            accountingCreator: accountingCreator,
            accountingApprover: accountingApprover,
            paymentMethod: prepaymentVendor.payment_method,
            beneficiaryBank: prepaymentVendor.beneficiary_bank,
            bankBranchCode: prepaymentVendor.bank_branch_code,
            cashout: cashout,
            vatList: vatListResult.data
        }
    };
}

/**
 * Phân nhánh một nhóm Entry thành payload PREPAYMENT, STANDARD, GL hoặc CORE.
 * STANDARD và GL nhận cả nhóm; PREPAYMENT và CORE nhận một Entry.
 */
function mapAccountingApiPayloadForEntries(
    requestId,
    prepayment,
    entries,
    context,
    accountingDate
) {
    var list = entries || [];
    if (list.length === 0) {
        return mapError(
            'EMPTY_ACCOUNTING_ENTRY_GROUP',
            'Khong co entry de map accounting information.'
        );
    }

    var entry = list[0];

    if (
        safeString(entry.type).trim().toUpperCase() ===
        ACCOUNTING_TYPE.GL
    ) {
        return mapGlApiPayloadForEntries(
            requestId,
            prepayment,
            list,
            context,
            accountingDate
        );
    }

    if (isCoreTransferEntry(entry, context)) {
        return mapCoreTransferPayloadForEntry(
            requestId,
            entry,
            context
        );
    }

    return mapInvoiceApiPayloadForEntries(
        requestId,
        prepayment,
        list,
        context,
        accountingDate
    );
}

/**
 * Trưởng sửa: map một hoặc nhiều AP entry vào cùng một payload PREPAYMENT/STANDARD.
 * STANDARD gom vatList khấu trừ toàn bộ và khấu trừ một phần;
 * PREPAYMENT chỉ giữ vatList không khấu trừ.
 */
function mapInvoiceApiPayloadForEntries(
    requestId,
    prepayment,
    entries,
    context,
    accountingDate
) {
    var list = entries || [];
    if (list.length === 0) {
        return mapError(
            'EMPTY_INVOICE_ENTRY_GROUP',
            'Payload PREPAYMENT/STANDARD khong co entry.'
        );
    }

    var firstEntry = list[0];
    var isStandardInvoice =
        safeString(firstEntry.ledger_type).trim() === LEDGER_TYPE_STANDARD;
    var invoiceType = isStandardInvoice
        ? INVOICE_TYPE_STANDARD
        : INVOICE_TYPE_PREPAYMENT;
    var totalAmount = 0;
    var standardEntriesByDiscountType = {};

    for (var entryIndex = 0; entryIndex < list.length; entryIndex++) {
        var currentEntry = list[entryIndex];
        var currentIsStandard =
            safeString(currentEntry.ledger_type).trim() === LEDGER_TYPE_STANDARD;

        if (currentIsStandard !== isStandardInvoice) {
            return mapError(
                'MIXED_INVOICE_ENTRY_GROUP',
                'Khong duoc gom entry PREPAYMENT va STANDARD trong cung payload.'
            );
        }

        if (
            safeString(currentEntry.currency).trim() !==
            safeString(firstEntry.currency).trim()
        ) {
            return mapError(
                'MIXED_INVOICE_ENTRY_CURRENCY',
                'Cac entry trong cung payload phai co cung loai tien.'
            );
        }

        if (isStandardInvoice) {
            var discountTypeResult = mapStandardEntryDiscountType(currentEntry);
            if (!discountTypeResult.success) return discountTypeResult;

            standardEntriesByDiscountType[discountTypeResult.data] =
                currentEntry;
        }

        totalAmount += toNumber(currentEntry.amount);
    }

    var vatList = filterVatListByInvoiceType(
        context.vatList,
        invoiceType,
        isStandardInvoice ? standardEntriesByDiscountType : null
    );
    var invoiceLineList;

    if (isStandardInvoice) {
        var standardInvoiceLineResult = buildStandardInvoiceLineList(
            standardEntriesByDiscountType,
            context.vatList,
            context.segment1
        );
        if (!standardInvoiceLineResult.success) {
            return standardInvoiceLineResult;
        }

        invoiceLineList = standardInvoiceLineResult.data;
        if (
            Math.abs(
                totalAmount - standardInvoiceLineResult.totalAmount
            ) > 0.000001
        ) {
            return {
                success: false,
                code: 'STANDARD_INVOICE_AMOUNT_MISMATCH',
                error:
                    'Tong tien TU-BT-02 khong khop tong thue cua cac hoa don trong payload STANDARD.',
                entryAmount: totalAmount,
                invoiceTaxAmount: standardInvoiceLineResult.totalAmount
            };
        }
    } else {
        invoiceLineList = buildInvoiceLineList(
            list,
            context.segment1
        );
    }

    var payload = {
        requestId: requestId,
        referenceId: prepayment.id,
        vendorNumber: context.vendorNumber,
        vendorSiteCode: context.vendorSiteCode,
        entity: context.entity,
        invoiceType: invoiceType,
        invoiceDate: accountingDate,
        currency: firstEntry.currency,
        amount: totalAmount,
        amountPay: totalAmount,
        description: prepayment.description,
        maker: context.accountingCreator,
        checker: context.accountingApprover,
        cashout: context.cashout,
        contractId: prepayment.contract_id,
        invoiceLineList: invoiceLineList,
        applyList: [],
        vatList: vatList
    };

    var validation = mapValidatePrepaymentPayload(payload);
    if (!validation.success) {
        return {
            success: false,
            code: 'INVALID_OUTBOUND_PAYLOAD',
            error:
                'Payload ' +
                invoiceType +
                ' cua nhom entry ' +
                safeString(firstEntry.id).trim() +
                ' thieu hoac sai du lieu.',
            entryId: firstEntry.id,
            missingFields: validation.missingFields,
            invalidFields: validation.invalidFields,
            data: payload
        };
    }

    return {
        success: true,
        readyToSend: true,
        pendingFields: [],
        vendorId: context.vendorId,
        accountingAmount: totalAmount,
        data: payload
    };
}

function mapStandardEntryDiscountType(entry) {
    var taxAccountNumber = safeString(entry.account_number).trim();
    var discountType = getTaxEntryDiscountType(entry);

    if (
        discountType !== DISCOUNT_FULL &&
        discountType !== DISCOUNT_RATE
    ) {
        return {
            success: false,
            code: 'TAX_ENTRY_DEDUCTION_TYPE_NOT_FOUND',
            error:
                'Khong tim thay loai khau tru theo tai khoan ' +
                taxAccountNumber +
                ' cua entry ' +
                entry.id +
                '.',
            entryId: entry.id,
            accountNumber: taxAccountNumber
        };
    }

    return { success: true, data: discountType };
}

/** Lấy loại khấu trừ của dòng thuế theo tài khoản hạch toán. */
function getTaxEntryDiscountType(entry) {
    var taxAccountNumber = safeString(entry.account_number).trim();
    var entryDeductionType = selectOne(
        TABLE_CATEGORY_ITEM,
        'category.id="' +
            escapeQueryValue(CATEGORY_TAX_ACCOUNT_NUMBER) +
            '" and item.name="' +
            escapeQueryValue(taxAccountNumber) +
            '"',
        function (record) {
            return readText(record, 'item.id').trim();
        }
    );

    return mapDiscountType(entryDeductionType);
}

function isDeductibleDiscountType(discountType) {
    return discountType === DISCOUNT_FULL || discountType === DISCOUNT_RATE;
}

function filterVatListByInvoiceType(
    sourceVatList,
    invoiceType,
    standardEntriesByDiscountType
) {
    var result = [];
    var list = sourceVatList || [];

    for (var i = 0; i < list.length; i++) {
        var discountType = safeString(list[i].discountType).trim();
        var includeVat =
            invoiceType === INVOICE_TYPE_STANDARD
                ? discountType === DISCOUNT_FULL || discountType === DISCOUNT_RATE
                : discountType === DISCOUNT_NONE;
        var belongsToStandardEntryGroup =
            invoiceType !== INVOICE_TYPE_STANDARD ||
            !standardEntriesByDiscountType ||
            !!standardEntriesByDiscountType[discountType];

        if (includeVat && belongsToStandardEntryGroup) {
            result.push({
                id: list[i].id,
                discountType: discountType
            });
        }
    }

    return result;
}

/**
 * Map mỗi hóa đơn thuế thành một invoiceLineList; entry TU-BT-02 cùng loại
 * được dùng làm mẫu tài khoản, segment và diễn giải cho line tương ứng.
 */
function buildStandardInvoiceLineList(
    entriesByDiscountType,
    sourceVatList,
    segment1
) {
    var lines = [];
    var invalidFields = [];
    var totalAmount = 0;
    var list = sourceVatList || [];

    for (var i = 0; i < list.length; i++) {
        var discountType = safeString(list[i].discountType).trim();
        var entry = entriesByDiscountType[discountType];
        if (!entry) continue;

        var taxAmount = toNumber(list[i].taxAmount);
        if (taxAmount <= 0) {
            invalidFields.push('vatList[' + i + '].taxAmount');
            continue;
        }

        lines.push(
            mapInvoiceLineFromEntry(
                entry,
                segment1,
                lines.length + 1,
                taxAmount
            )
        );
        totalAmount += taxAmount;
    }

    if (invalidFields.length > 0) {
        return {
            success: false,
            code: 'INVALID_STANDARD_INVOICE_TAX_AMOUNT',
            error:
                'Hoa don khau tru co total.tax rong, bang 0 hoac khong hop le.',
            invalidFields: invalidFields
        };
    }

    return {
        success: true,
        data: lines,
        totalAmount: totalAmount
    };
}

/**
 * map danh sách entry thành invoiceLineList và đánh lineNum cục bộ từ 1.
 * Mỗi lần gọi hàm tương ứng với một payload mới nên lineNum luôn được reset.
 */
function buildInvoiceLineList(entries, segment1) {
    var lines = [];
    var list = entries || [];
    var nextLineNum = 1;

    for (var i = 0; i < list.length; i++) {
        // Trưởng sửa: mỗi payload bắt đầu từ 1 và tăng dần 1, 2, 3... theo từng bộ segment.
        lines.push(mapInvoiceLineFromEntry(list[i], segment1, nextLineNum));
        nextLineNum++;
    }

    return lines;
}

/** map một entry thành một phần tử invoiceLineList. */
function mapInvoiceLineFromEntry(entry, segment1, lineNum, amount) {
    var lineAmount =
        amount === undefined || amount === null ? entry.amount : amount;

    return {
        lineNum: lineNum,
        amount: lineAmount,
        segment1: segment1,
        segment2: SEGMENT_2_DEFAULT,
        segment3: entry.account_number,
        segment4: SEGMENT_4_DEFAULT,
        segment5: SEGMENT_5_DEFAULT,
        segment6: SEGMENT_6_DEFAULT,
        segment7: SEGMENT_7_DEFAULT,
        description: entry.description
    };
}

/**
 * map xác định account.type của entry có phải bên ghi Có hay không.
 */
function isCreditAccountType(value) {
    var accountSide = normalizeBusinessText(value).replace(/\s+/g, '');

    return (
        accountSide === 'co' ||
        accountSide === 'credit' ||
        accountSide === 'asset' ||
        accountSide === 'taisan'
    );
}

/**
 * map xác định payment.method có phải Chuyển khoản hay không.
 */
function isBankTransferPaymentMethod(value) {
    return normalizeBusinessText(value).replace(/\s+/g, '') === 'chuyenkhoan';
}

/**
 * Nhận cả mã chuẩn TU-BT-03 và tên nghiệp vụ cũ "Chuyển tiền".
 */
function isCorePaymentEntryType(value) {
    var entryType = safeString(value).trim().toUpperCase();

    if (entryType === CORE_PAYMENT_ENTRY_CODE) return true;

    return normalizeBusinessText(value).replace(/\s+/g, '') === 'chuyentien';
}

/**
 * map xác định đúng dòng ghi Có TU-BT-03 được phép sinh bản ghi CORE.
 */
function isCoreTransferEntry(entry, context) {
    return (
        safeString(entry.type).trim().toUpperCase() === ACCOUNTING_TYPE.AP &&
        isCorePaymentEntryType(entry.entry_type) &&
        isBankTransferPaymentMethod(context.paymentMethod)
    );
}

/**
 * map beneficiary.bank theo cấu trúc citad.branch.code|citad.code|napas.code.
 */
function mapCoreBeneficiaryBank(value) {
    var parts = safeString(value).split('|');

    return {
        citadBranchCode: safeString(parts[0]).trim(),
        citadCode: safeString(parts[1]).trim(),
        napasCode: safeString(parts[2]).trim()
    };
}

/**
 * Chuẩn hóa nội dung chuyển tiền CORE thành chữ Latin không dấu, viết hoa.
 */
function normalizeCoreTransferDescription(value) {
    return normalizeBusinessText(value).toUpperCase();
}

/**
 * Cắt trường chữ tự do theo giới hạn API mà không làm thay đổi mã nghiệp vụ.
 */
function truncateCoreText(value, maxLength) {
    var text = safeString(value).trim();

    if (text.length > maxLength) {
        text = text.substring(0, maxLength).trim();
    }

    return text;
}

/**
 * map dòng ghi Có TU-BT-03 thành payload CORE trong hoặc ngoài hệ thống.
 */
function mapCoreTransferPayloadForEntry(requestId, entry, context) {
    var branchCode = String(entry.branch);
    if (branchCode === '007') branchCode = '107';
    var maker = safeString(context.accountingCreator).trim().toLowerCase();
    var checker = safeString(context.accountingApprover).trim().toLowerCase();
    var bank = mapCoreBeneficiaryBank(context.beneficiaryBank);
    var isInternal = bank.napasCode === CORE_VIETINBANK_NAPAS_CODE;
    var accountNumber = safeString(entry.account_number).trim();
    var accountName = safeString(entry.account_name).trim();
    var bankBranchCode = safeString(context.bankBranchCode).trim();

    if (isInternal && !bankBranchCode) {
        return mapError(
            'MISSING_PREPAYMENT_VENDOR_BANK_BRANCH_CODE',
            'Thieu ' +
                TABLE_PREPAYMENT_VENDOR +
                '.bank.branch.code cua tai khoan thu huong.'
        );
    }

    var externalAccountName = truncateCoreText(
        accountName,
        CORE_EXTERNAL_TO_ACCOUNT_NAME_MAX_LENGTH
    );
    var currency = safeString(entry.currency).trim();
    var description = normalizeCoreTransferDescription(entry.description);
    if (!isInternal) {
        description = truncateCoreText(
            description,
            CORE_CITAD_DESCRIPTION_MAX_LENGTH
        );
    }
    var amount = toNumber(entry.amount);
    var clientDate = safeString(
        lib.ESD_HTKT_Utils.formatDateToISOWithOffset()
    ).trim();

    var amountText = safeString(amount).trim();
    var payload;

    if (isInternal) {
        payload = {
            requestId: requestId,
            clientDt: clientDate,
            channel: CORE_CHANNEL,
            spname: CORE_INTERNAL_SP_NAME,
            data: {
                depAcctIdFrom: {
                    acctId: CORE_INTERNAL_SOURCE_ACCOUNT,
                    acctCur: currency,
                    branchId: branchCode + '98',
                },
                depAcctIdTo: {
                    acctId: accountNumber,
                    acctCur: currency,
                },
                fromCostCentre: branchCode + '98',
                toCostCentre: bankBranchCode,
                amount: amountText,
                curCode: currency,
                reversedInd: 'N',
                trnRefNum: requestId,
                maker: maker,
                checker: checker,
                notes: description
            }
        };
    } else {
        payload = {
            requestId: requestId,
            clientDt: clientDate,
            channel: CORE_CHANNEL,
            reftype: CORE_EXTERNAL_REFERENCE_TYPE,
            spname: CORE_EXTERNAL_SP_NAME,
            data: {
                pmtType: 'Outgoing IBPS_Bilateral',
                pmtMethod: 'GL Account',
                approveId: checker,
                trnType: 'Transaction Internet Banking',
                fromAcctId: '224420600',
                toAcctId: accountNumber,
                toBankId: bank.citadCode,
                toBranchId: bank.citadBranchCode,
                toAcctName: externalAccountName,
                serviceBranch: branchCode + '98',
                amount: [
                    {
                        amount: amountText,
                        crcd: currency,
                        amountType: 'TRAN_AMOUNT'
                    }
                ],
                makerId: maker,
                trnDesc: description,
                chanRefNum: requestId.substring(0,16)
            }
        };
    }

    return {
        success: true,
        readyToSend: true,
        pendingFields: [],
        accountingType: ACCOUNTING_TYPE.CORE,
        coreTransferType: isInternal
            ? ACCOUNTING_SUB_TYPE.INHOUSE
            : ACCOUNTING_SUB_TYPE.CITAD,
        vendorId: context.vendorId,
        data: payload
    };
}

/**
 * map một entry GL thành payload hạch toán bổ sung gửi API OGL.
 */
function mapGlApiPayloadForEntry(requestId, prepayment, entry, context, accountingDate) {
    return mapGlApiPayloadForEntries(
        requestId,
        prepayment,
        [entry],
        context,
        accountingDate
    );
}

/**
 * map toàn bộ dòng của một bảng hạch toán bổ sung thành một payload GL;
 * mỗi entry trở thành một phần tử trong line và dùng chung một requestId.
 */
function mapGlApiPayloadForEntries(
    requestId,
    prepayment,
    entries,
    context,
    accountingDate
) {
    var list = entries || [];
    if (list.length === 0) {
        return {
            success: false,
            code: 'EMPTY_GL_ENTRY_GROUP',
            error: 'Bang hach toan bo sung khong co dong du lieu.'
        };
    }

    var firstEntry = list[0];
    var transactionDescription =
        'Hach toan cho de nghi ' + safeString(prepayment.id).trim();
    var lines = [];
    var totalDebit = 0;

    for (var entryIndex = 0; entryIndex < list.length; entryIndex++) {
        var lineResult = mapGlLineResultFromEntry(list[entryIndex]);
        if (!lineResult.success) return lineResult;

        lines.push(lineResult.data);
        totalDebit += lineResult.debitAmount;
    }

    var payload = {
        requestId: requestId,
        referenceId: prepayment.id,
        accountingDate: accountingDate,
        currencyCode: firstEntry.currency,
        transactionDesc: transactionDescription,
        branchCode: firstEntry.branch,
        source: GL_SOURCE,
        category: GL_SOURCE,
        createdby: context.accountingCreator,
        approvedby: context.accountingApprover,
        line: lines,
        text1: '',
        text2: '',
        text3: '',
        text4: '',
        text5: ''
    };

    return {
        success: true,
        readyToSend: true,
        pendingFields: [],
        vendorId: context.vendorId,
        accountingAmount: totalDebit,
        data: payload
    };
}

/**
 * map một entry GL thành một phần tử line kèm số tiền ghi Nợ của dòng.
 */
function mapGlLineResultFromEntry(entry) {
    var accountSide = normalizeBusinessText(entry.account_type).replace(/\s+/g, '');
    var isDebit = accountSide === 'no' || accountSide === 'debit';
    var isCredit =
        accountSide === 'co' ||
        accountSide === 'credit' ||
        accountSide === 'asset' ||
        accountSide === 'taisan';

    if (!isDebit && !isCredit) {
        return {
            success: false,
            code: 'INVALID_GL_ACCOUNT_TYPE',
            error:
                'Khong map duoc account.type="' +
                entry.account_type +
                '" cua entry GL ' +
                entry.id +
                ' sang No/Co.',
            entryId: entry.id
        };
    }

    var segment1 = SEGMENT_1_DEFAULT;
    if (safeString(entry.branch).trim() !== GL_DEFAULT_BRANCH_CODE) {
        var segment1Result = mapEntityCodeByTransactionCode(
            GL_UNIT_TRANSACTION_CODE,
            entry.branch
        );
        if (!segment1Result.success) return segment1Result;

        segment1 = segment1Result.data;
    }

    var segment6 = SEGMENT_6_DEFAULT;
    var transactionCode = safeString(entry.transaction_code).trim();
    if (transactionCode && transactionCode !== SEGMENT_6_DEFAULT) {
        var segment6Result = mapEntityCodeByTransactionCode(
            transactionCode,
            entry.branch
        );
        if (!segment6Result.success) return segment6Result;

        segment6 = segment6Result.data;
    }

    return {
        success: true,
        debitAmount: isDebit ? toNumber(entry.amount) : 0,
        data: mapGlLineFromEntry(
            entry,
            isDebit,
            segment1,
            safeString(entry.department).trim() || SEGMENT_2_DEFAULT,
            segment6
        )
    };
}

/**
 * map các segment và số tiền Nợ/Có của một entry GL vào một phần tử Line;
 * SEGMENT1 lấy entity.code theo entry.branch của Đơn vị người dùng đã chọn;
 * SEGMENT2 lấy cost.center đã lưu tại entry.department;
 * SEGMENT6 lấy entity.code theo entry.transaction.code và entry.branch của PGD đã chọn.
 */
function mapGlLineFromEntry(
    entry,
    isDebit,
    segment1,
    segment2,
    segment6
) {
    var debitAmount = isDebit ? entry.amount : 0;
    var creditAmount = isDebit ? 0 : entry.amount;

    return {
        segment1: segment1,
        segment2: segment2,
        segment3: entry.account_number,
        segment4: SEGMENT_4_DEFAULT,
        segment5: SEGMENT_5_DEFAULT,
        segment6: segment6,
        segment7: SEGMENT_7_DEFAULT,
        enteredDR: debitAmount,
        enteredCR: creditAmount,
        accountedDR: debitAmount,
        accountedCR: creditAmount,
        lineDesc: entry.description
    };
}

/** Xác định dòng AP thuế cần phân loại theo tài khoản khấu trừ. */
function isStandardApTaxCandidate(entry) {
    return (
        safeString(entry.type).trim().toUpperCase() === ACCOUNTING_TYPE.AP &&
        safeString(entry.ledger_type).trim() === LEDGER_TYPE_STANDARD &&
        !isCreditAccountType(entry.account_type)
    );
}

/** Phân loại từng dòng thuế; KHAUTRU_003 sẽ được giữ ngoài STANDARD. */
function getStandardApEntryDiscountTypes(entries) {
    var result = [];
    var list = entries || [];

    for (var i = 0; i < list.length; i++) {
        result.push(
            isStandardApTaxCandidate(list[i])
                ? getTaxEntryDiscountType(list[i])
                : ''
        );
    }

    return result;
}

/** Lấy các dòng khấu trừ toàn bộ/một phần theo đúng thứ tự đã đọc. */
function getStandardApEntries(entries, discountTypes) {
    var result = [];
    var list = entries || [];
    var mappedDiscountTypes = discountTypes ||
        getStandardApEntryDiscountTypes(list);

    for (var i = 0; i < list.length; i++) {
        if (isDeductibleDiscountType(mappedDiscountTypes[i])) {
            result.push(list[i]);
        }
    }

    return result;
}

/**
 * Gom entry GL theo số bảng hạch toán bổ sung trong ID.
 */
function groupGlEntries(entries, prepaymentId) {
    var groups = {};
    var list = entries || [];

    for (var i = 0; i < list.length; i++) {
        var entry = list[i];
        if (
            safeString(entry.type).trim().toUpperCase() !==
            ACCOUNTING_TYPE.GL
        ) {
            continue;
        }

        var position = getGlEntryPosition(prepaymentId, entry, i + 1);
        var groupKey = safeString(position.groupOrder);

        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(entry);
    }

    for (var groupKey in groups) {
        if (!groups.hasOwnProperty(groupKey)) continue;

        groups[groupKey].sort(function (left, right) {
            return (
                getGlEntryPosition(prepaymentId, left, 1).rowOrder -
                getGlEntryPosition(prepaymentId, right, 1).rowOrder
            );
        });
    }

    return groups;
}

function getGlEntryPosition(prepaymentId, entry, fallbackOrder) {
    var prefix = safeString(prepaymentId).trim() + '.GL.';
    var entryId = safeString(entry.id).trim();

    if (entryId.indexOf(prefix) === 0) {
        var parts = entryId.substring(prefix.length).split('.');

        if (
            parts.length === 2 &&
            /^\d+$/.test(parts[0]) &&
            /^\d+$/.test(parts[1]) &&
            Number(parts[0]) > 0 &&
            Number(parts[1]) > 0
        ) {
            return {
                groupOrder: Number(parts[0]),
                rowOrder: Number(parts[1])
            };
        }

        if (
            parts.length === 1 &&
            /^\d+$/.test(parts[0]) &&
            Number(parts[0]) > 0
        ) {
            return {
                groupOrder: 1,
                rowOrder: Number(parts[0])
            };
        }
    }

    var storedOrder = toNumber(entry.order);
    return {
        groupOrder: 1,
        rowOrder: storedOrder > 0 ? storedOrder : fallbackOrder
    };
}

/**
 * map một giá trị Date sang định dạng YYYY-MM-DD dùng cho API.
 */
function mapDateToYmd(value) {
    if (!value) return '';

    var date = value;
    if (typeof date.getFullYear !== 'function') {
        date = new Date(value);
    }
    if (
        !date ||
        typeof date.getFullYear !== 'function'
    ) {
        return '';
    }
    if (typeof date.getTime === 'function' && isNaN(date.getTime())) return '';

    var month = date.getMonth() + 1;
    var day = date.getDate();

    return (
        date.getFullYear() +
        '-' +
        (month < 10 ? '0' + month : String(month)) +
        '-' +
        (day < 10 ? '0' + day : String(day))
    );
}

/**
 * map đúng một quan hệ đề nghị - NCC để lấy thông tin NCC, hình thức thanh toán và ngân hàng thụ hưởng.
 */
function mapSinglePrepaymentVendor(prepaymentId) {
    var f;
    var rc;

    try {
        f = new SCFile(TABLE_PREPAYMENT_VENDOR, SCFILE_READONLY);
        rc = f.doSelect(
            'prepayment.id="' + escapeQueryValue(prepaymentId) + '"'
        );
    } catch (e) {
        // closeFile(f);
        // trưởng thêm: query lỗi vẫn phải gọi doClose
        try {
            if (f) f.doClose();
        } catch (eClose) {}
        return mapError(
            'PREPAYMENT_VENDOR_QUERY_ERROR',
            'Khong the doc ' + TABLE_PREPAYMENT_VENDOR + ': ' + e.toString()
        );
    }

    // trưởng thêm: luôn đóng SCFile kể cả khi đọc field hoặc getNext phát sinh lỗi
    try {
        if (rc !== RC_SUCCESS) {
            // closeFile(f);
            return mapError(
                'PREPAYMENT_VENDOR_NOT_FOUND',
                'Khong tim thay NCC cua de nghi ' + prepaymentId + '.'
            );
        }

        var data = {
            vendor_id: readText(f, 'vendor.id').trim(),
            vendor_site_id: readText(f, 'vendor.site.id').trim(),
            payment_method: readText(f, 'payment.method').trim(),
            beneficiary_bank: readText(f, 'beneficiary.bank').trim(),
            bank_branch_code: readText(f, 'bank.branch.code').trim()
        };
        var nextRc = f.getNext();
        // closeFile(f);

        if (nextRc === RC_SUCCESS) {
            return mapError(
                'MULTIPLE_PREPAYMENT_VENDORS',
                'De nghi ' + prepaymentId + ' co nhieu hon mot NCC.'
            );
        }

        return { success: true, data: data };
    } finally {
        // closeFile(f);
        // trưởng thêm: gọi trực tiếp doClose để đóng SCFile
        try {
            if (f) f.doClose();
        } catch (eClose) {}
    }
}

/**
 * map vendor.number từ danh mục NCC vào vendorNumber của API.
 */
function mapVendor(vendorId) {
    if (!vendorId) return null;

    return selectOne(
        TABLE_VENDOR,
        'id="' + escapeQueryValue(vendorId) + '"',
        function (record) {
            return {
                vendor_number: readText(record, 'vendor.number').trim()
            };
        }
    );
}

/**
 * map ogl.site.code và ogl.entity của site NCC vào payload API.
 */
function mapVendorSite(vendorSiteId) {
    if (!vendorSiteId) return null;

    return selectOne(
        TABLE_VENDOR_SITE,
        'id="' + escapeQueryValue(vendorSiteId) + '"',
        function (record) {
            return {
                vendor_site_code: readText(record, 'ogl.site.code').trim(),
                ogl_entity: readText(record, 'ogl.entity').trim()
            };
        }
    );
}

/**
 * map created.by -> contacts.lv1.id -> esdDMentity.ps.code -> entity.code
 * để lấy segment1.
 */
function mapEntityCodeByCreatorLv1(createdBy) {
    var creator = safeString(createdBy).trim();
    if (!creator) {
        return mapError(
            'MISSING_PREPAYMENT_CREATOR',
            'Thieu ' + TABLE_PREPAYMENT + '.created.by.'
        );
    }

    var lv1Id = selectOne(
        TABLE_CONTACT,
        'contact.name="' + escapeQueryValue(creator) + '"',
        function (record) {
            return readText(record, 'lv1.id').trim();
        }
    );

    if (!lv1Id) {
        return mapError(
            'CREATOR_LV1_NOT_FOUND',
            'Khong tim thay contacts.lv1.id cua contact.name="' + creator + '".'
        );
    }

    var psCode = lv1Id;
    var f;
    var rc;
    var entityCodes = [];
    var entityCodeMap = {};

    try {
        f = new SCFile(TABLE_ENTITY, SCFILE_READONLY);
        rc = f.doSelect(
            'ps.code="' + escapeQueryValue(psCode) + '"'
        );
    } catch (e) {
        // closeFile(f);
        // trưởng thêm: query lỗi vẫn phải gọi doClose
        try {
            if (f) f.doClose();
        } catch (eClose) {}
        return mapError(
            'ENTITY_PS_CODE_QUERY_ERROR',
            'Khong the doc ' + TABLE_ENTITY + ': ' + e.toString()
        );
    }

    // trưởng thêm: đảm bảo đóng SCFile nếu vòng lặp hoặc getNext phát sinh lỗi
    try {
        while (rc === RC_SUCCESS) {
            var entityCode = readText(f, 'entity.code').trim();

            if (entityCode && !entityCodeMap[entityCode]) {
                entityCodeMap[entityCode] = true;
                entityCodes.push(entityCode);
            }

            rc = f.getNext();
        }
    } finally {
        // closeFile(f);
        // trưởng thêm: gọi trực tiếp doClose để đóng SCFile
        try {
            if (f) f.doClose();
        } catch (eClose) {}
    }

    if (entityCodes.length === 0) {
        return mapError(
            'ENTITY_CODE_NOT_FOUND',
            'Khong tim thay entity.code voi ps.code="' + psCode + '".'
        );
    }
    if (entityCodes.length > 1) {
        return mapError(
            'MULTIPLE_ENTITY_CODES',
            'Tim thay nhieu entity.code voi ps.code="' + psCode + '".'
        );
    }

    return { success: true, data: entityCodes[0] };
}

/**
 * map mã giao dịch + entry.branch vào đúng esdDMentity;
 * phục hồi số 0 đầu của branch để khớp ogl.branch.code và lấy entity.code cho segment GL.
 */
function mapEntityCodeByTransactionCode(transactionCode, branchCode) {
    var code = safeString(transactionCode).trim();
    if (!code) {
        return mapError(
            'MISSING_TRANSACTION_CODE',
            'Thieu ' + TABLE_PREPAYMENT_ENTRY + '.transaction.code.'
        );
    }

    var branch = safeString(branchCode).trim();
    if (!branch) {
        return mapError(
            'MISSING_ENTRY_BRANCH',
            'Thieu ' + TABLE_PREPAYMENT_ENTRY + '.branch de map entity.code.'
        );
    }

    var oglBranchCode = '0' + branch;
    var f;
    var rc;
    var entityCodes = [];
    var entityCodeMap = {};

    try {
        f = new SCFile(TABLE_ENTITY, SCFILE_READONLY);
        rc = f.doSelect(
            'org.transaction.code="' +
                escapeQueryValue(code) +
                '" and ogl.branch.code="' +
                escapeQueryValue(oglBranchCode) +
                '"'
        );
    } catch (e) {
        // closeFile(f);
        // trưởng thêm: query lỗi vẫn phải gọi doClose
        try {
            if (f) f.doClose();
        } catch (eClose) {}
        return mapError(
            'ENTITY_TRANSACTION_CODE_QUERY_ERROR',
            'Khong the doc ' + TABLE_ENTITY + ': ' + e.toString()
        );
    }

    // trưởng thêm: đảm bảo đóng SCFile nếu vòng lặp hoặc getNext phát sinh lỗi
    try {
        while (rc === RC_SUCCESS) {
            var entityCode = readText(f, 'entity.code').trim();

            if (entityCode && !entityCodeMap[entityCode]) {
                entityCodeMap[entityCode] = true;
                entityCodes.push(entityCode);
            }

            rc = f.getNext();
        }
    } finally {
        // closeFile(f);
        // trưởng thêm: gọi trực tiếp doClose để đóng SCFile
        try {
            if (f) f.doClose();
        } catch (eClose) {}
    }

    if (entityCodes.length === 0) {
        return mapError(
            'TRANSACTION_ENTITY_CODE_NOT_FOUND',
            'Khong tim thay entity.code voi org.transaction.code="' +
                code +
                '" va ogl.branch.code="' +
                oglBranchCode +
                '".'
        );
    }
    if (entityCodes.length > 1) {
        return mapError(
            'MULTIPLE_TRANSACTION_ENTITY_CODES',
            'Tim thay nhieu entity.code voi org.transaction.code="' +
                code +
                '" va ogl.branch.code="' +
                oglBranchCode +
                '".'
        );
    }

    return { success: true, data: entityCodes[0] };
}

/**
 * map các hóa đơn của đề nghị vào vatList.
 */
function mapVatList(prepaymentId) {
    var f;
    var rc;
    var rows = [];
    var invalidFields = [];

    try {
        f = new SCFile(TABLE_PREPAYMENT_INVOICE, SCFILE_READONLY);
        rc = f.doSelect(
            'prepayment.id="' + escapeQueryValue(prepaymentId) + '"'
        );
    } catch (e) {
        // closeFile(f);
        // trưởng thêm: query lỗi vẫn phải gọi doClose
        try {
            if (f) f.doClose();
        } catch (eClose) {}
        return mapError(
            'VAT_LIST_QUERY_ERROR',
            'Khong the doc ' + TABLE_PREPAYMENT_INVOICE + ': ' + e.toString()
        );
    }

    // trưởng thêm: đảm bảo đóng SCFile nếu vòng lặp hoặc getNext phát sinh lỗi
    try {
        while (rc === RC_SUCCESS) {
            var index = rows.length;
            var invoiceId = readText(f, 'invoice.id').trim();
            var invoiceData = invoiceId
                ? selectOne(
                      TABLE_INVOICE,
                      'id="' + escapeQueryValue(invoiceId) + '"',
                      function (invoiceRecord) {
                          return {
                              oglId: readText(invoiceRecord, 'ogl.id').trim(),
                              taxAmount: readNumber(invoiceRecord, 'total.tax')
                          };
                      }
                  )
                : null;
            var invoiceOglId = invoiceData ? invoiceData.oglId : '';
            var invoiceTaxAmount = invoiceData
                ? invoiceData.taxAmount
                : 0;
            var discountType = mapDiscountType(
                readText(f, 'deduction.type')
            );

            rows.push({
                id: invoiceOglId,
                discountType: discountType,
                taxAmount: invoiceTaxAmount
            });

            if (!invoiceOglId) invalidFields.push('vatList[' + index + '].id');
            if (!discountType) {
                invalidFields.push('vatList[' + index + '].discountType');
            }

            rc = f.getNext();
        }
    } finally {
        // closeFile(f);
        // trưởng thêm: gọi trực tiếp doClose để đóng SCFile
        try {
            if (f) f.doClose();
        } catch (eClose) {}
    }

    if (invalidFields.length > 0) {
        return {
            success: false,
            code: 'INVALID_VAT_LIST_SOURCE',
            error:
                'vatList co esdHTKTinvoice.ogl.id rong hoac deduction.type khong hop le.',
            invalidFields: invalidFields,
            data: rows
        };
    }

    return { success: true, data: rows };
}

/**
 * map deduction.type nội bộ sang discountType của API.
 */
function mapDiscountType(deductionType) {
    var value = safeString(deductionType).trim().toUpperCase();

    if (value === DEDUCTION_FULL) return DISCOUNT_FULL;
    if (value === DEDUCTION_RATE) return DISCOUNT_RATE;
    if (value === DEDUCTION_NONE) return DISCOUNT_NONE;

    return '';
}

/**
 * map payment.method sang cashout: Tiền mặt = Y, Chuyển khoản = N.
 */
function mapPaymentMethodToCashout(paymentMethod) {
    var normalized = normalizeBusinessText(paymentMethod).replace(/\s+/g, '');

    if (normalized === 'tienmat') return CASHOUT_YES;
    if (normalized === 'chuyenkhoan') return CASHOUT_NO;

    return '';
}

/**
 * map kết quả kiểm tra payload GL trước khi lưu vào accountingInformation.data.
 */
function mapValidateGlPayload(payload) {
    var missingFields = [];
    var invalidFields = [];
    var requiredTextFields = [
        'requestId',
        'accountingDate',
        'currencyCode',
        'transactionDesc',
        'branchCode',
        'source',
        'category',
        'createdby',
        'approvedby'
    ];

    for (var i = 0; i < requiredTextFields.length; i++) {
        var fieldName = requiredTextFields[i];
        if (!safeString(payload[fieldName]).trim()) {
            missingFields.push(fieldName);
        }
    }

    if (
        payload.requestId &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
            safeString(payload.requestId).trim()
        )
    ) {
        invalidFields.push('requestId');
    }
    if (
        payload.accountingDate &&
        !/^\d{4}-\d{2}-\d{2}$/.test(
            safeString(payload.accountingDate).trim()
        )
    ) {
        invalidFields.push('accountingDate');
    }
    if (
        payload.currencyCode &&
        safeString(payload.currencyCode).trim().length !== 3
    ) {
        invalidFields.push('currencyCode');
    }
    if (
        payload.branchCode &&
        safeString(payload.branchCode).trim().length !== 3
    ) {
        invalidFields.push('branchCode');
    }
    if (payload.source && safeString(payload.source).trim() !== GL_SOURCE) {
        invalidFields.push('source');
    }
    if (
        payload.category &&
        safeString(payload.category).trim().toUpperCase() !== GL_SOURCE
    ) {
        invalidFields.push('category');
    }

    mapValidateGlLine(payload.line, invalidFields);

    return {
        success: missingFields.length === 0 && invalidFields.length === 0,
        missingFields: missingFields,
        invalidFields: invalidFields
    };
}

/**
 * map lỗi cấu trúc và dữ liệu của một phần tử trong Line của payload GL.
 */
function mapValidateGlLine(rows, errors) {
    if (!isArray(rows) || rows.length === 0) {
        errors.push('line');
        return;
    }

    for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        var row = rows[rowIndex] || {};
        var rowPath = 'line[' + rowIndex + ']';
        var amountFields = [
            'enteredDR',
            'enteredCR',
            'accountedDR',
            'accountedCR'
        ];

        mapValidateGlSegment(errors, row, 'segment1', 7, rowPath);
        mapValidateGlSegment(errors, row, 'segment2', 6, rowPath);
        mapValidateGlSegment(errors, row, 'segment3', 9, rowPath);
        mapValidateGlSegment(errors, row, 'segment4', 7, rowPath);
        mapValidateGlSegment(errors, row, 'segment5', 7, rowPath);
        mapValidateGlSegment(errors, row, 'segment6', 7, rowPath);
        mapValidateGlSegment(errors, row, 'segment7', 7, rowPath);

        for (var amountIndex = 0; amountIndex < amountFields.length; amountIndex++) {
            var fieldName = amountFields[amountIndex];
            if (!isFiniteNumber(row[fieldName]) || row[fieldName] < 0) {
                errors.push(rowPath + '.' + fieldName);
            }
        }

        if (
            (row.enteredDR > 0 && row.enteredCR > 0) ||
            (row.enteredDR <= 0 && row.enteredCR <= 0)
        ) {
            errors.push(rowPath + '.enteredDR/enteredCR');
        }
        if (
            row.enteredDR !== row.accountedDR ||
            row.enteredCR !== row.accountedCR
        ) {
            errors.push(rowPath + '.accountedDR/accountedCR');
        }
        if (!safeString(row.lineDesc).trim()) {
            errors.push(rowPath + '.lineDesc');
        }
    }
}

/**
 * map lỗi segment bắt buộc của Line trong payload GL.
 */
function mapValidateGlSegment(errors, row, fieldName, length, rowPath) {
    var value = safeString(row[fieldName]).trim();
    if (!value || value.length !== length) {
        errors.push(rowPath + '.' + fieldName);
    }
}

/**
 * map kết quả kiểm tra payload trước khi lưu vào accountingInformation.data.
 */
function mapValidatePrepaymentPayload(payload) {
    var missingFields = [];
    var invalidFields = [];
    var requiredTextFields = [
        'requestId',
        'referenceId',
        'vendorNumber',
        'vendorSiteCode',
        'entity',
        'invoiceType',
        'invoiceDate',
        'currency',
        'maker',
        'checker',
        'cashout'
    ];

    for (var i = 0; i < requiredTextFields.length; i++) {
        var fieldName = requiredTextFields[i];
        if (!safeString(payload[fieldName]).trim()) {
            missingFields.push(fieldName);
        }
    }

    if (!isFiniteNumber(payload.amount) || payload.amount <= 0) {
        invalidFields.push('amount');
    }
    if (!isFiniteNumber(payload.amountPay) || payload.amountPay <= 0) {
        invalidFields.push('amountPay');
    }
    if (
        payload.invoiceType !== INVOICE_TYPE_PREPAYMENT &&
        payload.invoiceType !== INVOICE_TYPE_STANDARD
    ) {
        invalidFields.push('invoiceType');
    }
    if (
        payload.cashout !== CASHOUT_YES &&
        payload.cashout !== CASHOUT_NO
    ) {
        invalidFields.push('cashout');
    }
    if (
        payload.currency &&
        safeString(payload.currency).trim().length !== 3
    ) {
        invalidFields.push('currency');
    }
    if (
        payload.invoiceDate &&
        !/^\d{4}-\d{2}-\d{2}$/.test(
            safeString(payload.invoiceDate).trim()
        )
    ) {
        invalidFields.push('invoiceDate');
    }

    mapValidateInvoiceLineList(payload.invoiceLineList, invalidFields);
    mapValidateVatList(
        payload.vatList,
        payload.invoiceType,
        invalidFields
    );

    if (!isArray(payload.applyList) || payload.applyList.length !== 0) {
        invalidFields.push('applyList');
    }

    return {
        success: missingFields.length === 0 && invalidFields.length === 0,
        missingFields: missingFields,
        invalidFields: invalidFields
    };
}

/**
 * map lỗi cấu trúc và dữ liệu của invoiceLineList.
 */
function mapValidateInvoiceLineList(rows, errors) {
    if (!isArray(rows) || rows.length === 0) {
        errors.push('invoiceLineList');
        return;
    }

    for (var i = 0; i < rows.length; i++) {
        var row = rows[i] || {};
        var rowPath = 'invoiceLineList[' + i + ']';
        var expectedLineNum = i + 1;

        // Trưởng sửa: kiểm tra lineNum phải khớp vị trí cục bộ trong chính payload.
        if (row.lineNum !== expectedLineNum) {
            errors.push(rowPath + '.lineNum');
        }
        if (!isFiniteNumber(row.amount) || row.amount <= 0) {
            errors.push(rowPath + '.amount');
        }

        mapValidateSegment(errors, row, rowPath, 'segment1', 7);
        mapValidateSegment(errors, row, rowPath, 'segment2', 6);
        mapValidateSegment(errors, row, rowPath, 'segment3', 9);
        mapValidateSegment(errors, row, rowPath, 'segment4', 7);
        mapValidateSegment(errors, row, rowPath, 'segment5', 7);
        mapValidateSegment(errors, row, rowPath, 'segment6', 7);
        mapValidateSegment(errors, row, rowPath, 'segment7', 7);
    }
}

/**
 * map lỗi khi segment bắt buộc bị rỗng hoặc sai độ dài.
 */
function mapValidateSegment(errors, row, rowPath, fieldName, length) {
    var value = safeString(row[fieldName]).trim();
    if (!value || value.length !== length) {
        errors.push(rowPath + '.' + fieldName);
    }
}

/**
 * map lỗi cấu trúc và dữ liệu của vatList.
 */
function mapValidateVatList(rows, invoiceType, errors) {
    if (!isArray(rows)) {
        errors.push('vatList');
        return;
    }

    for (var i = 0; i < rows.length; i++) {
        var discountType = safeString(rows[i].discountType).trim();

        if (!safeString(rows[i].id).trim()) {
            errors.push('vatList[' + i + '].id');
        }
        if (
            discountType !== DISCOUNT_FULL &&
            discountType !== DISCOUNT_RATE &&
            discountType !== DISCOUNT_NONE
        ) {
            errors.push('vatList[' + i + '].discountType');
        }
        if (
            invoiceType === INVOICE_TYPE_PREPAYMENT &&
            discountType !== DISCOUNT_NONE
        ) {
            errors.push('vatList[' + i + '].discountType');
        }
        if (
            invoiceType === INVOICE_TYPE_STANDARD &&
            discountType === DISCOUNT_NONE
        ) {
            errors.push('vatList[' + i + '].discountType');
        }
    }
}

/**
 * map object lỗi thống nhất cho các hàm mapping.
 */
function mapError(code, message) {
    return {
        success: false,
        code: code,
        error: message
    };
}

function getPrepaymentEntries(prepaymentId) {
    var rows = [];
    var f;

    // trưởng thêm: bao toàn bộ vòng đời SCFile để luôn gọi doClose
    try {
        f = new SCFile(TABLE_PREPAYMENT_ENTRY, SCFILE_READONLY);
        var rc = f.doSelect('prepayment.id="' + escapeQueryValue(prepaymentId) + '"');

        while (rc === RC_SUCCESS) {
            rows.push({
                id: readText(f, 'id'),
                prepayment_id: readText(f, 'prepayment.id'),
                entry_type: readText(f, 'entry.type'),
                ledger_type: readText(f, 'ledger.type'),
                account_type: readText(f, 'account.type'),
                account_number: readText(f, 'account.number'),
                account_name: readText(f, 'account.name'),
                branch: readText(f, 'branch'),
                department: readText(f, 'department'),
                transaction_code: readText(f, 'transaction.code'),
                amount: readNumber(f, 'amount'),
                currency: readText(f, 'currency'),
                description: readText(f, 'description'),
                vendor_id: readText(f, 'vendor.id'),
                type: readText(f, 'type'),
                order: readNumber(f, 'order')
            });

            rc = f.getNext();
        }
    } finally {
        // closeFile(f);
        // trưởng thêm: gọi trực tiếp doClose để đóng SCFile
        try {
            if (f) f.doClose();
        } catch (eClose) {}
    }

    rows.sort(compareEntryRows);
    return rows;
}

function compareEntryRows(left, right) {
    var leftOrder = toNumber(left.order);
    var rightOrder = toNumber(right.order);

    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    var leftId = safeString(left.id);
    var rightId = safeString(right.id);

    if (leftId < rightId) return -1;
    if (leftId > rightId) return 1;
    return 0;
}

function updateEntryAccountingRequestId(entryId, prepaymentId, requestId) {
    var f;

    // trưởng thêm: bao toàn bộ vòng đời SCFile để luôn gọi doClose
    try {
        f = new SCFile(TABLE_PREPAYMENT_ENTRY);
        var query =
            'id="' +
            escapeQueryValue(entryId) +
            '" and prepayment.id="' +
            escapeQueryValue(prepaymentId) +
            '"';
        var rc = f.doSelect(query);

        if (rc === RC_SUCCESS) {
            f['accounting.request.id'] = requestId;
            rc = f.doUpdate();
        }

        // closeFile(f);
        return rc;
    } finally {
        try {
            if (f) f.doClose();
        } catch (eClose) {}
    }
}

function clearEntryAccountingRequestIds(prepaymentId) {
    var updated = 0;
    var f;

    // trưởng thêm: bao toàn bộ vòng đời SCFile để luôn gọi doClose
    try {
        f = new SCFile(TABLE_PREPAYMENT_ENTRY);
        var rc = f.doSelect('prepayment.id="' + escapeQueryValue(prepaymentId) + '"');

        while (rc === RC_SUCCESS) {
            f['accounting.request.id'] = '';
            if (f.doUpdate() === RC_SUCCESS) updated++;
            rc = f.getNext();
        }
    } finally {
        // closeFile(f);
        // trưởng thêm: gọi trực tiếp doClose để đóng SCFile
        try {
            if (f) f.doClose();
        } catch (eClose) {}
    }

    return updated;
}

function deleteAccountingInformation(prepaymentId) {
    var deleted = 0;
    var f;

    // trưởng thêm: bao toàn bộ vòng đời SCFile để luôn gọi doClose
    try {
        f = new SCFile(TABLE_ACCOUNTING_INFORMATION);
        var rc = f.doSelect('prepayment.id="' + escapeQueryValue(prepaymentId) + '"');

        while (rc === RC_SUCCESS) {
            if (f.doDelete() === RC_SUCCESS) deleted++;
            rc = f.getNext();
        }
    } finally {
        // closeFile(f);
        // trưởng thêm: gọi trực tiếp doClose để đóng SCFile
        try {
            if (f) f.doClose();
        } catch (eClose) {}
    }

    return deleted;
}

function insertRecord(tableName, row) {
    var f;

    // trưởng thêm: bao toàn bộ vòng đời SCFile để luôn gọi doClose
    try {
        f = new SCFile(tableName);

        for (var key in row) {
            if (row.hasOwnProperty(key)) f[key] = row[key];
        }

        var rc = f.doInsert();
        // closeFile(f);
        return rc;
    } finally {
        try {
            if (f) f.doClose();
        } catch (eClose) {}
    }
}

function getInputDetails(input) {
    var details = {};

    copyObject(details, parseJsonObject(input.queryString));
    copyObject(details, parseJsonObject(input.details));

    if (!details.id) details.id = readText(input, 'id');
    if (!details.prepaymentId) details.prepaymentId = readText(input, 'prepayment.id');

    return details;
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

function copyObject(target, source) {
    if (!source) return target;

    for (var key in source) {
        if (source.hasOwnProperty(key)) target[key] = source[key];
    }

    return target;
}

function selectOne(tableName, query, mapper) {
    var f;
    var rc;

    try {
        f = new SCFile(tableName, SCFILE_READONLY);
        rc = f.doSelect(query);
    } catch (e) {
        // closeFile(f);
        // trưởng thêm: query lỗi vẫn phải gọi doClose
        try {
            if (f) f.doClose();
        } catch (eClose) {}
        return null;
    }

    // trưởng thêm: mapper cũng nằm trong try/finally để luôn gọi doClose
    try {
        var result = rc === RC_SUCCESS ? mapper(f) : null;
        // closeFile(f);
        return result;
    } finally {
        try {
            if (f) f.doClose();
        } catch (eClose) {}
    }
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
    var number = Number(String(value).replace(/,/g, '').replace(/%/g, '').trim());
    return isNaN(number) ? 0 : number;
}

/**
 * map kết quả kiểm tra kiểu Array tương thích với JavaScript engine của SM.
 */
function isArray(value) {
    return Object.prototype.toString.call(value) === '[object Array]';
}

/**
 * map kết quả kiểm tra một giá trị Number hữu hạn.
 */
function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
}

/**
 * map chuỗi nghiệp vụ về chữ/số Latin để so khớp ổn định.
 */
function normalizeBusinessText(value) {
    var text = safeString(value).toLowerCase();

    try {
        if (text.normalize) {
            text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        }
    } catch (e) {}

    return text
        .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, 'a')
        .replace(/[èéẹẻẽêềếệểễ]/g, 'e')
        .replace(/[ìíịỉĩ]/g, 'i')
        .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, 'o')
        .replace(/[ùúụủũưừứựửữ]/g, 'u')
        .replace(/[ỳýỵỷỹ]/g, 'y')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function safeString(value) {
    if (value === null || value === undefined) return '';
    return String(value);
}

function escapeQueryValue(value) {
    return safeString(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function makeError(message) {
    return {
        success: false,
        error: message
    };
}

function closeFile(file) {
    try {
        if (file) file.doClose();
    } catch (e) {}
}
