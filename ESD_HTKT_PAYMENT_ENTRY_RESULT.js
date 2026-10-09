/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_ENTRY_RESULT
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Tiếp nhận và xử lý kết quả phản hồi từ API hạch toán OGL / Core Banking.
 * - Cập nhật mã chứng từ kế toán, trạng thái thành công/thất bại vào esdHTKTaccountingInformation.
 * - Cập nhật trạng thái phiếu đề nghị và các dòng bút toán chi tiết tương ứng.
 * - Ghi nhận thông tin lỗi chi tiết khi hạch toán thất bại để phục vụ tra cứu và xử lý lại.
 * -----------------------------------------------------------------------------
 */

var ACCOUNTING_INFORMATION_TABLE = 'esdHTKTaccountingInformation';
var PAYMENT_ENTRY_TABLE = 'esdHTKTpaymentEntry';
var DEBIT_ACCOUNT_TYPE = '\u006e\u1ee3';
var AP_ENTRY_TYPE = 'AP';
var GL_ENTRY_TYPE = 'GL';
var CORE_ENTRY_TYPE = 'CORE';
var SUB_TYPE_PREPAYMENT = 'TAM_UNG';
var SUB_TYPE_STANDARD = 'THUE';
var SUB_TYPE_PAYMENT = 'THANH_TOAN';
var SUB_TYPE_TAT_TOAN = 'TAT_TOAN';
var ACCOUNTING_STATUS = {
    CREATED: 'CREATED',
    // INITIAL: 'INITIAL',
    INITIAL: 'NEW',
    IN_QUEUE: 'IN_QUEUE',
    PROCESSING: 'PROCESSING',
    PENDING_APPROVAL: 'PENDING_APPROVAL',
    COMPLETED: 'COMPLETED',
    ERROR: 'ERROR',
    NOT_FOUND: 'NOT_FOUND'
};
var ACCOUNTING_STATUS_MAP = {
    CREATED: 'Đang xử lý',
    // INITIAL: 'Đang xử lý hạch toán',
    NEW: 'Đang xử lý',
    IN_QUEUE: 'Đang xử lý',
    PROCESSING: 'Đang xử lý',
    PENDING_APPROVAL: 'Chờ phê duyệt khai báo',
    COMPLETED: 'Thành Công',
    ERROR: 'Gửi Thất Bại',
    NOT_FOUND: 'Không tìm thấy giao dịch với transactionId'
};

function renderTabAccountingResults() {
    var currentRecord = vars['$L.file'];
    var paymentId = textValue(vars['$G.payment.id']).trim() ||
            textValue(vars['$G.prepayment.id']).trim();
    if (!paymentId && currentRecord) {
        paymentId = textValue(currentRecord['id']).trim();
    }

    var result = loadAccountingResults(paymentId);

    return buildAccountingResultsHtml(result.rows, result.error);
}

function loadAccountingResults(paymentId) {
    var result = { rows: [], error: '' };
    var groupMap = {};
    var groups = [];
    var f;

    if (!paymentId) {
        result.error = 'Kh&#244;ng nh&#7853;n &#273;&#432;&#7907;c m&#227; &#273;&#7873; ngh&#7883; thanh to&#225;n.';
        return result;
    }

    try {
        f = new SCFile(ACCOUNTING_INFORMATION_TABLE, SCFILE_READONLY);
        var query = 'prepayment.id="' + escapeQueryValue(paymentId) + '"';
        var rc = f.doSelect(query);

        while (rc === RC_SUCCESS) {
            addAccountingResultGroup(groupMap, groups, f);

            rc = f.getNext();
        }
        
        result.rows = buildGroupedResultRows(groups);
//        print('result.rows = ', JSON.stringify(result.rows));
    } catch (e) {
        result.error = 'Kh&#244;ng th&#7875; t&#7843;i k&#7871;t qu&#7843; h&#7841;ch to&#225;n.';
    } finally {
        try {
            if (f) f.doClose();
        } catch (eClose) {}
    }

    return result;
}

function addAccountingResultGroup(groupMap, groups, record) {
//    print('record = ', JSON.stringify(record));
    var response = parseAccountingPayload(record['response']);
    var responseData = response.data && typeof response.data === 'object'
            ? response.data
            : {};
    var info = {
        requestId: textValue(record['request.id']),
        vendorId: textValue(record['vendor.id']),
        accountingType: textValue(record['type']),
        subType: textValue(record['sub.type']),
        amount: numberValue(record['amount']),
        batchName: textValue(record['batch.name']),
        invoiceNumber: textValue(record['ap.code']),
        paymentNumber: textValue(response.paymentNumber).trim() ||
                textValue(responseData.paymentNumber).trim(),
        hostRefNum: textValue(record['host.res.num']).trim(),
        status: textValue(record['status']),
        transactionId: record['transaction.id'] || record['transactionId'],
        message: textValue(record['message']),
        checkedTime: record['checked.time'],
        payload: parseAccountingPayload(record['data'])
    };
    var entrySummary = getEntrySummary(info.requestId, info.vendorId, info.accountingType);
    var payloadSummary = getAccountingPayloadSummary(
            info.accountingType,
            info.payload
    );
    var accountingTypeCode = textValue(info.accountingType)
            .trim()
            .toUpperCase();

    if (
            accountingTypeCode === GL_ENTRY_TYPE &&
            hasContentValue(payloadSummary.contentLines)
    ) {
        entrySummary.contentLines = payloadSummary.contentLines;
    } else if (!hasContentValue(entrySummary.contentLines)) {
        entrySummary.contentLines = payloadSummary.contentLines;
    }
    if (!entrySummary.currency) {
        entrySummary.currency = payloadSummary.currency;
    }
    if (!entrySummary.beneficiaryAccount) {
        entrySummary.beneficiaryAccount = payloadSummary.beneficiaryAccount;
    }

    info.glGroupOrder = entrySummary.glGroupOrder;
    var key = makeAccountingResultGroupKey(info);
    var group = groupMap[key];

    if (!group) {
        group = {
            key: key,
            accountingTypeCode: textValue(info.accountingType).trim().toUpperCase(),
            accountingType: mapAccountingTypeLabel(
                    info.accountingType,
                    info.subType
            ),
            contentLines: [],
            amount: 0,
            currency: '',
            beneficiaryAccount: '',
            batchName: '',
            invoiceNumber: '',
            paymentNumber: '',
            hostRefNum: '',
            status: '',
            message: '',
            checkedTime: null,
            transactionId: ''
        };
        groupMap[key] = group;
        groups.push(group);
    }

    appendFirstContentLine(group.contentLines, entrySummary.contentLines);
    group.beneficiaryAccount = mergeTextValue(
            group.beneficiaryAccount,
            entrySummary.beneficiaryAccount
    );

    var itemAmount = 0;
    if (textValue(info.accountingType).trim().toUpperCase() === CORE_ENTRY_TYPE) {
        itemAmount = info.amount || numberValue(entrySummary.debitAmount);
    } else {
        itemAmount = numberValue(entrySummary.debitAmount) > 0
                ? numberValue(entrySummary.debitAmount)
                : info.amount;
    }
    group.amount += itemAmount;

    if (!group.currency && entrySummary.currency) group.currency = entrySummary.currency;
    group.batchName = info.batchName ? info.batchName : mergeTextValue(group.batchName, info.batchName);
    group.invoiceNumber = mergeTextValue(group.invoiceNumber, info.invoiceNumber);
    group.paymentNumber = mergeTextValue(group.paymentNumber, info.paymentNumber);
    group.hostRefNum = mergeTextValue(group.hostRefNum, info.hostRefNum);
    group.status = mergeStatus(group.status, info.status);
    group.message = mergeTextValue(group.message, info.message);
    group.checkedTime = getLatestDateValue(group.checkedTime, info.checkedTime);
    group.transactionId = info.transactionId ? info.transactionId : mergeTextValue(group.transactionId, info.transactionId);
}

function makeAccountingResultGroupKey(info) {
    var accountingType = textValue(info.accountingType).trim().toUpperCase();
    var glGroupOrder =
            accountingType === GL_ENTRY_TYPE
                    ? textValue(info.glGroupOrder).trim() || '1'
                    : '';

    return [
        accountingType,
        textValue(info.vendorId).trim(),
        textValue(info.subType).trim(),
        glGroupOrder
    ].join('|');
}

/**
 * map type và sub.type thành 3 loại bút toán hiển thị trên giao diện:
 * AP-Standard, GL, AP-Payment.
 */
function mapAccountingTypeLabel(accountingType, subType) {
    var type = textValue(accountingType).trim().toUpperCase();
    var sub = textValue(subType).trim().toUpperCase();

    if (type === GL_ENTRY_TYPE) return 'GL';
    if (type === AP_ENTRY_TYPE) {
        if (sub === SUB_TYPE_TAT_TOAN || sub === 'AP_PAYMENT' || sub === 'AP-PAYMENT' || sub === 'PAYMENT_OUT') {
            return 'AP-Payment';
        }
        return 'AP-Standard';
    }

    return type;
}

function buildGroupedResultRows(groups) {
    var rows = [];
//    print("groups = ", JSON.stringify(groups))
    for (var i = 0; i < groups.length; i++) {
        rows.push({
            index: i + 1,
            accountingTypeCode: groups[i].accountingTypeCode,
            accountingType: groups[i].accountingType,
            contentLines: groups[i].contentLines,
            amount: groups[i].amount,
            currency: groups[i].currency,
            beneficiaryAccount: groups[i].beneficiaryAccount,
            batchName: groups[i].batchName,
            invoiceNumber: groups[i].invoiceNumber,
            paymentNumber: groups[i].paymentNumber,
            hostRefNum: groups[i].hostRefNum,
            status: groups[i].status,
            message: groups[i].message,
            checkedTime: groups[i].checkedTime,
            transactionId: groups[i].transactionId
        });
    }

    return rows;
}

function appendFirstContentLine(target, lines) {
    if (target.length > 0) return;
    var values = lines || [];

    for (var i = 0; i < values.length; i++) {
        var content = textValue(values[i]).trim();
        if (content) {
            target.push(content);
            return;
        }
    }
}

function parseAccountingPayload(value) {
    try {
        var payload = typeof value === 'string' ? JSON.parse(value) : value;
        return payload && typeof payload === 'object' ? payload : {};
    } catch (e) {
        return {};
    }
}

function getAccountingPayloadSummary(accountingType, payload) {
    var type = textValue(accountingType).trim().toUpperCase();
    var data = payload && typeof payload === 'object' ? payload : {};
    var summary = {
        contentLines: [],
        currency: '',
        beneficiaryAccount: ''
    };

    if (type === GL_ENTRY_TYPE) {
        var glLines = isArrayValue(data.line) ? data.line : [];
        summary.contentLines = [
            textValue(
                    (glLines.length > 0 ? glLines[0].lineDesc : '') ||
                    data.transactionDesc
            ).trim()
        ];
        summary.currency = textValue(data.currencyCode).trim();
        return summary;
    }

    if (type === AP_ENTRY_TYPE) {
        var invoiceLines = isArrayValue(data.invoiceLineList)
                ? data.invoiceLineList
                : [];
        summary.contentLines = [
            textValue(
                    data.description ||
                    (invoiceLines.length > 0
                            ? invoiceLines[0].description
                            : '')
            ).trim()
        ];
        summary.currency = textValue(data.currency).trim();
        return summary;
    }

    if (type === CORE_ENTRY_TYPE) {
        var coreData =
                data.data && typeof data.data === 'object' ? data.data : {};
        var internalAccount =
                coreData.depAcctIdTo && typeof coreData.depAcctIdTo === 'object'
                        ? coreData.depAcctIdTo
                        : {};
        var coreAmounts = isArrayValue(coreData.amount)
                ? coreData.amount
                : [];

        summary.contentLines = [
            textValue(coreData.notes || coreData.trnDesc).trim()
        ];
        summary.currency = textValue(
                internalAccount.acctCur ||
                (coreAmounts.length > 0 ? coreAmounts[0].crcd : '')
        ).trim();
        summary.beneficiaryAccount = textValue(
                internalAccount.acctId || coreData.toAcctId
        ).trim();
    }

    return summary;
}

function isArrayValue(value) {
    return Object.prototype.toString.call(value) === '[object Array]';
}

function hasContentValue(lines) {
    var values = lines || [];

    for (var i = 0; i < values.length; i++) {
        if (textValue(values[i]).trim()) return true;
    }

    return false;
}

//function mergeTextValue(currentValue, nextValue) {
//    currentValue = textValue(currentValue).trim();
//    nextValue = textValue(nextValue).trim();
//
//    if (!nextValue) return currentValue;
//    if (!currentValue) return nextValue;
//    if (currentValue === nextValue) return currentValue;
//
//    return currentValue + '; ' + nextValue;
//}


function mergeTextValue(currentValue, nextValue) {
    var cur = textValue(currentValue).trim();
    var next = textValue(nextValue).trim();

    if (!next) return cur;
    if (!cur) return next;

    // Tách chuỗi hiện tại thành mảng các giá trị (phân tách bởi dấu ;)
    var parts = cur.split(/\s*;\s*/);
    
    // Nếu giá trị mới chưa có trong mảng thì mới push vào
    if (parts.indexOf(next) === -1) {
        parts.push(next);
    }

    return parts.join('; ');
}



function mergeStatus(currentStatus, nextStatus) {
    var currentCode = textValue(currentStatus).trim().toUpperCase();
    var nextCode = textValue(nextStatus).trim().toUpperCase();
    var currentFailed =
            currentCode === ACCOUNTING_STATUS.ERROR ||
            currentCode === ACCOUNTING_STATUS.NOT_FOUND;
    var nextFailed =
            nextCode === ACCOUNTING_STATUS.ERROR ||
            nextCode === ACCOUNTING_STATUS.NOT_FOUND;
    var currentProcessing =
            currentCode === ACCOUNTING_STATUS.PROCESSING ||
            currentCode === ACCOUNTING_STATUS.IN_QUEUE ||
            currentCode === ACCOUNTING_STATUS.CREATED ||
            currentCode === ACCOUNTING_STATUS.PENDING_APPROVAL ||
            currentCode === ACCOUNTING_STATUS.INITIAL;
    var nextProcessing =
            nextCode === ACCOUNTING_STATUS.PROCESSING ||
            nextCode === ACCOUNTING_STATUS.IN_QUEUE ||
            nextCode === ACCOUNTING_STATUS.CREATED ||
            nextCode === ACCOUNTING_STATUS.PENDING_APPROVAL ||
            nextCode === ACCOUNTING_STATUS.INITIAL;

    if (!currentCode) return nextCode;
    if (!nextCode) return currentCode;
    if (currentFailed) return currentCode;
    if (nextFailed) return nextCode;
    if (currentProcessing) return currentCode;
    if (nextProcessing) return nextCode;
    if (
            currentCode === ACCOUNTING_STATUS.COMPLETED &&
            nextCode === ACCOUNTING_STATUS.COMPLETED
    ) {
        return ACCOUNTING_STATUS.COMPLETED;
    }

    return currentCode;
}

function getLatestDateValue(currentValue, nextValue) {
    if (!currentValue) return nextValue;
    if (!nextValue) return currentValue;

    return getDateSortValue(nextValue) > getDateSortValue(currentValue) ? nextValue : currentValue;
}

function getEntrySummary(requestId, vendorId, accountingType) {
    var summary = {
        contentLines: [],
        debitAmount: 0,
        currency: '',
        beneficiaryAccount: '',
        glGroupOrder: ''
    };
    var f;

    if (!requestId) return summary;

    try {
        f = new SCFile(PAYMENT_ENTRY_TABLE, SCFILE_READONLY);
        var query = 'accounting.request.id="' + escapeQueryValue(requestId) + '"';
        var accountingTypeCode = textValue(accountingType).trim().toUpperCase();
        var entryType = getEntryTypeFilter(accountingType);

        if (entryType === GL_ENTRY_TYPE) {
            query += ' and type="' + GL_ENTRY_TYPE + '"';
        }

        var rc = f.doSelect(query);

        while (rc === RC_SUCCESS) {
            var desc = textValue(f['description']).trim();
            if (desc) {
                summary.contentLines.push(desc);
            }

            if (entryType === GL_ENTRY_TYPE && !summary.glGroupOrder) {
                var paymentId = textValue(f['payment.id']).trim() || textValue(f['prepayment.id']).trim();
                summary.glGroupOrder = getGlEntryGroupOrder(
                        paymentId,
                        textValue(f['id'])
                );
            }

            if (!summary.currency) {
                summary.currency = textValue(f['currency']).trim();
            }

            // Bút toán CORE (chuyển tiền): tài khoản thụ hưởng lấy từ account.number
            if (
                    accountingTypeCode === CORE_ENTRY_TYPE &&
                    !summary.beneficiaryAccount
            ) {
                summary.beneficiaryAccount = textValue(f['account.number']).trim();
            }

            if (isDebitAccountType(f['account.type'])) {
                summary.debitAmount += numberValue(f['amount']);
            }

            rc = f.getNext();
        }
    } finally {
        try {
            if (f) f.doClose();
        } catch (eClose) {}
    }

    return summary;
}

/**
 * Đọc số bút toán từ ID GL <paymentId>.GL.<số bút toán>.<số dòng>.
 * ID GL cũ <paymentId>.GL.<số dòng> được xem là bút toán số 1.
 */
function getGlEntryGroupOrder(paymentId, entryId) {
    var pid = textValue(paymentId).trim();
    var id = textValue(entryId).trim();

    if (!pid) return '';
    var prefix = pid + '.' + GL_ENTRY_TYPE + '.';
    if (id.indexOf(prefix) !== 0) return '';

    var parts = id.substring(prefix.length).split('.');

    if (
            parts.length === 2 &&
            /^\d+$/.test(parts[0]) &&
            /^\d+$/.test(parts[1]) &&
            Number(parts[0]) > 0 &&
            Number(parts[1]) > 0
    ) {
        return String(Number(parts[0]));
    }

    if (
            parts.length === 1 &&
            /^\d+$/.test(parts[0]) &&
            Number(parts[0]) > 0
    ) {
        return '1';
    }

    return '';
}

function getEntryTypeFilter(value) {
    var type = textValue(value).trim().toUpperCase();
    if (type === AP_ENTRY_TYPE) return AP_ENTRY_TYPE;
    if (type === GL_ENTRY_TYPE) return GL_ENTRY_TYPE;
    return '';
}

function isDebitAccountType(value) {
    var accountType = normalizeIdentity(value);
    return accountType === 'no' || accountType === 'debit';
}

function buildAccountingResultsHtml(rows, error) {
    var accountingRows = [];
    var transferRows = [];

    for (var i = 0; i < rows.length; i++) {
        if (
                textValue(rows[i].accountingTypeCode).trim().toUpperCase() ===
                CORE_ENTRY_TYPE
        ) {
            transferRows.push(rows[i]);
        } else {
            accountingRows.push(rows[i]);
        }
    }

    return [
        '<!DOCTYPE html>',
        '<html lang="vi"><head><meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1.0">',
        '<style>',
        'html,body{margin:0;padding:0;background:#fff;font-family:Arial,sans-serif;color:#111827}',
        '*{box-sizing:border-box}',
        '.result{width:100%;padding:20px}',
        '.result-section+.result-section{margin-top:24px}',
        '.result-head{display:flex;align-items:center;gap:10px;margin-bottom:16px}',
        '.title{color:#173b7a;font-size:15px;font-weight:700}',
        '.counter{padding:6px 12px;border-radius:6px;background:#ebf0ff;color:#173b7a;font-size:13px;font-weight:700}',
        '.table-wrap{width:100%;overflow-x:auto;border:1px solid #d9e0eb;border-radius:8px}',
        'table{width:100%;min-width:1240px;border-collapse:collapse;table-layout:fixed;font-size:13px}',
        'th,td{padding:10px 12px;text-align:left;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        'th{height:44px;background:#dce8fb;font-weight:600}',
        'td{height:50px;border-top:1px solid #d9e0eb}',
        'th[data-column]{cursor:pointer;user-select:none}',
        'th[data-column]:hover{background:#cfdff8}',
        'th[data-column]:focus{outline:2px solid #2563eb;outline-offset:-2px}',
        '.sort{margin-left:7px;color:#64748b;font-size:14px;font-weight:400}',
        '.amount{font-variant-numeric:tabular-nums}',
        '.content{overflow:visible;white-space:normal}',
        '.content-line{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.45}',
        '.content-line+.content-line{margin-top:4px}',
        '.accounting-cell-tooltip{display:none;position:fixed;z-index:2147483647;max-width:360px;padding:7px 10px;border-radius:4px;background:#202124;color:#fff;font-size:13px;font-weight:400;line-height:1.4;white-space:normal;word-break:break-word;box-shadow:0 2px 8px rgba(0,0,0,.28);pointer-events:none}',
        '.accounting-cell-tooltip:after{content:"";position:absolute;left:50%;margin-left:-5px;border-style:solid;border-width:5px}',
        '.accounting-cell-tooltip[data-placement="top"]:after{top:100%;border-color:#202124 transparent transparent transparent}',
        '.accounting-cell-tooltip[data-placement="bottom"]:after{bottom:100%;border-color:transparent transparent #202124 transparent}',
        '.status{display:block;width:100%;padding:7px 12px;border-radius:8px;text-align:center;font-weight:600;white-space:nowrap}',
        '.status-success{background:#dff6e5;color:#166534}',
        '.status-failed{background:#fcebe8;color:#dc2626}',
        '.status-processing{background:#fef3c7;color:#d97706}',
        '.status-default{background:#eef2f7;color:#475569}',
        '.empty{text-align:center;color:#64748b}',
        '.c-index{width:4%}.c-type{width:9%}.c-content{width:14%}.c-amount{width:9%}.c-currency{width:7%}',
        '.c-batch{width:11%}.c-invoice{width:11%}.c-payment{width:10%}.c-status{width:13%}.c-time{width:12%}',
        '#transfer-results-table{min-width:900px}',
        // Thêm cột Mã tham chiếu: chia lại độ rộng cho 8 cột của bảng kết quả chuyển tiền
        '.c-transfer-index{width:5%}.c-transfer-content{width:15%}.c-transfer-reference{width:12%}.c-transfer-amount{width:12%}.c-transfer-currency{width:9%}',
        '.c-beneficiary-account{width:17%}.c-transfer-status{width:15%}.c-transfer-time{width:15%}',
        '@media(max-width:768px){.result{padding:12px}.result-head{align-items:flex-start;flex-direction:column}}',
        '</style></head><body>',
        '<main class="result">',
        buildAccountingResultSection(
                'Kết quả hạch toán',
                'Số bút toán đồng bộ thành công',
                accountingRows,
                error,
                'accounting-results-table',
                false
        ),
        buildTransferResultSection(
                'Kết quả chuyển tiền',
                'Số giao dịch đồng bộ thành công',
                transferRows,
                error,
                'transfer-results-table'
        ),
        '</main>',
        '<div id="accounting-cell-tooltip" class="accounting-cell-tooltip" role="tooltip" aria-hidden="true"></div>',
        buildSortingScript('accounting-results-table'),
        buildSortingScript('transfer-results-table'),
        buildAccountingTooltipScript(),
        '</body></html>'
    ].join('');
}

function buildAccountingResultSection(
        title,
        counterLabel,
        rows,
        error,
        tableId,
        isTransferSection
) {
    var successCount = 0;
    var bodyRows = [];

    for (var i = 0; i < rows.length; i++) {
        var status = getStatusView(rows[i].status);
        var accountingTypeLabel = isTransferSection
                ? 'Hạch toán thanh toán - AP'
                : rows[i].accountingType;

        if (status.code === 'success') successCount++;
        bodyRows.push(
                buildAccountingResultRow(
                        rows[i],
                        status,
                        i + 1,
                        accountingTypeLabel
                )
        );
    }

    if (!bodyRows.length) {
        bodyRows.push(
                '<tr><td class="empty" colspan="10">' +
                (error || 'Kh&#244;ng c&#243; d&#7919; li&#7879;u') +
                '</td></tr>'
        );
    }

    return [
        '<section class="result-section">',
        '<div class="result-head">',
        '<span class="title">', htmlValue(title), '</span>',
        '<span class="counter">', htmlValue(counterLabel), ': ',
        successCount, '/', rows.length, '</span>',
        '</div>',
        '<div class="table-wrap"><table id="', attributeValue(tableId), '">',
        '<colgroup>',
        '<col class="c-index"><col class="c-type"><col class="c-content"><col class="c-amount"><col class="c-currency">',
        '<col class="c-batch"><col class="c-invoice"><col class="c-payment"><col class="c-status"><col class="c-time">',
        '</colgroup>',
        '<thead><tr>',
        buildHeader('c-index', 'STT', 0, 'number'),
        buildHeader('c-type', 'Lo&#7841;i b&#250;t to&#225;n', 1, 'text'),
        buildHeader('c-content', 'N&#7897;i dung h&#7841;ch to&#225;n', 2, 'text'),
        buildHeader('c-amount', 'S&#7889; ti&#7873;n', 3, 'number'),
        buildHeader('c-currency', 'Lo&#7841;i ti&#7873;n', 4, 'text'),
        buildHeader('c-batch', 'Batch name (OGL)', 5, 'text'),
        buildHeader('c-invoice', 'S&#7889; Invoice (OGL)', 6, 'text'),
        buildHeader('c-payment', 'S&#7889; Payment (OGL)', 7, 'text'),
        buildHeader('c-status', 'Tr&#7841;ng th&#225;i x&#7917; l&#253; OGL', 8, 'text'),
        buildHeader('c-time', 'Th&#7901;i gian c&#7853;p nh&#7853;t', 9, 'number'),
        '</tr></thead><tbody>',
        bodyRows.join(''),
        '</tbody></table></div>',
        '</section>'
    ].join('');
}

function buildTransferResultSection(title, counterLabel, rows, error, tableId) {
//    print('rows = ', JSON.stringify(rows));
    var successCount = 0;
    var bodyRows = [];

    for (var i = 0; i < rows.length; i++) {
        var status = getStatusView(rows[i].status);

        if (status.code === 'success') successCount++;
        bodyRows.push(buildTransferResultRow(rows[i], status, i + 1));
    }

    if (!bodyRows.length) {
        bodyRows.push(
                '<tr><td class="empty" colspan="8">' +
                (error || 'Kh&#244;ng c&#243; d&#7919; li&#7879;u') +
                '</td></tr>'
        );
    }

    return [
        '<section class="result-section">',
        '<div class="result-head">',
        '<span class="title">', htmlValue(title), '</span>',
        '<span class="counter">', htmlValue(counterLabel), ': ',
        successCount, '/', rows.length, '</span>',
        '</div>',
        '<div class="table-wrap"><table id="', attributeValue(tableId), '">',
        '<colgroup>',
        '<col class="c-transfer-index"><col class="c-transfer-content"><col class="c-transfer-amount">',
        '<col class="c-transfer-currency"><col class="c-beneficiary-account"><col class="c-transfer-reference">',
        '<col class="c-transfer-status"><col class="c-transfer-time">',
        '</colgroup>',
        '<thead><tr>',
        buildHeader('c-transfer-index', 'STT', 0, 'number'),
        buildHeader('c-transfer-content', 'N&#7897;i dung h&#7841;ch to&#225;n', 1, 'text'),
        buildHeader('c-transfer-amount', 'S&#7889; ti&#7873;n', 2, 'number'),
        buildHeader('c-transfer-currency', 'Lo&#7841;i ti&#7873;n', 3, 'text'),
        buildHeader('c-beneficiary-account', 'T&#224;i kho&#7843;n th&#7909; h&#432;&#7903;ng', 4, 'text'),
        buildHeader('c-transfer-reference', 'M&#227; tham chi&#7871;u', 5, 'text'),
        buildHeader('c-transfer-status', 'Tr&#7841;ng th&#225;i x&#7917; l&#253;', 6, 'text'),
        buildHeader('c-transfer-time', 'Th&#7901;i gian c&#7853;p nh&#7853;t', 7, 'number'),
        '</tr></thead><tbody>',
        bodyRows.join(''),
        '</tbody></table></div>',
        '</section>'
    ].join('');
}

function buildHeader(className, label, columnIndex, sortType) {
    return '<th class="' + className + '" data-column="' + columnIndex + '" data-sort-type="' + sortType +
            '" tabindex="0" role="button" aria-sort="none">' + label + '<span class="sort">&#8597;</span></th>';
}

function buildAccountingResultRow(row, status, displayIndex, accountingTypeLabel) {
    var firstLineContent = textValue((row.contentLines && row.contentLines.length > 0) ? row.contentLines[0] : '').trim();
    var contentSortValue = firstLineContent;
    var content = buildAccountingContent(row.contentLines);
    var rowIndex = Number(displayIndex) || 1;
    var typeLabel = textValue(accountingTypeLabel).trim();
    var amountLabel = formatAmount(row.amount);
    var checkedTimeLabel = formatCheckedTime(row.checkedTime);
    var statusTooltip = textValue(row.message).trim() || status.tooltip;
    var transactionId = textValue(row.transactionId).trim() || status.transactionId;
    var paymentNumber = textValue(row.paymentNumber).trim();
    var paymentNumberLabel = paymentNumber || '-';
    
    return [
        '<tr data-result-row="true" data-original-index="', rowIndex, '">',
        '<td class="accounting-tooltip-target" data-sort="', rowIndex, '"', buildTooltipAttributes(rowIndex), '>', rowIndex, '</td>',
        '<td class="accounting-tooltip-target" data-sort="', attributeValue(typeLabel), '"', buildTooltipAttributes(typeLabel), '>', htmlValue(typeLabel), '</td>',
        '<td class="content" data-sort="', attributeValue(contentSortValue), '">', content, '</td>',
        '<td class="amount accounting-tooltip-target" data-sort="', numberValue(row.amount), '"', buildTooltipAttributes(amountLabel), '>', amountLabel, '</td>',
        '<td class="accounting-tooltip-target" data-sort="', attributeValue(row.currency), '"', buildTooltipAttributes(row.currency), '>', htmlValue(row.currency), '</td>',
        '<td class="accounting-tooltip-target" data-sort="', attributeValue(row.batchName), '"', buildTooltipAttributes(row.batchName), '>', htmlValue(row.batchName), '</td>',
        '<td class="accounting-tooltip-target" data-sort="', attributeValue(row.invoiceNumber), '"', buildTooltipAttributes(row.invoiceNumber), '>', htmlValue(row.invoiceNumber), '</td>',
        '<td class="accounting-tooltip-target" data-sort="', attributeValue(paymentNumber), '"', buildTooltipAttributes(paymentNumberLabel), '>', escapeHtml(paymentNumberLabel), '</td>',
        '<td class="accounting-tooltip-target" data-sort="', attributeValue(row.status), '"', buildTooltipAttributes(statusTooltip), '><span class="status status-', status.code, '">', status.label, '</span></td>',
        '<td class="accounting-tooltip-target" data-sort="', getDateSortValue(row.checkedTime), '"', buildTooltipAttributes(checkedTimeLabel), '>', htmlValue(checkedTimeLabel), '</td>',
        '</tr>'
    ].join('');
}

function buildTransferResultRow(row, status, displayIndex) {
//print('buildTransferResultRow - row = ', JSON.stringify(row))
    var firstLineContent = textValue((row.contentLines && row.contentLines.length > 0) ? row.contentLines[0] : '').trim();
    var contentSortValue = firstLineContent;
    var content = buildAccountingContent(row.contentLines);
    var rowIndex = Number(displayIndex) || 1;
    var amountLabel = formatAmount(row.amount);
    var checkedTimeLabel = formatCheckedTime(row.checkedTime);
    var statusTooltip = textValue(row.message).trim() || status.tooltip;
    var hostRefNum = textValue(row.hostRefNum).trim();
    var hostRefNumLabel = hostRefNum || '-';
    
    return [
        '<tr data-result-row="true" data-original-index="', rowIndex, '">',
        '<td class="accounting-tooltip-target" data-sort="', rowIndex, '"', buildTooltipAttributes(rowIndex), '>', rowIndex, '</td>',
        '<td class="content" data-sort="', attributeValue(contentSortValue), '">', content, '</td>',
        '<td class="amount accounting-tooltip-target" data-sort="', numberValue(row.amount), '"', buildTooltipAttributes(amountLabel), '>', amountLabel, '</td>',
        '<td class="accounting-tooltip-target" data-sort="', attributeValue(row.currency), '"', buildTooltipAttributes(row.currency), '>', htmlValue(row.currency), '</td>',
        '<td class="accounting-tooltip-target" data-sort="', attributeValue(row.beneficiaryAccount), '"', buildTooltipAttributes(row.beneficiaryAccount), '>', htmlValue(row.beneficiaryAccount), '</td>',
        '<td class="accounting-tooltip-target" data-sort="', attributeValue(hostRefNum), '"', buildTooltipAttributes(hostRefNumLabel), '>', escapeHtml(hostRefNumLabel), '</td>',
        '<td class="accounting-tooltip-target" data-sort="', attributeValue(row.status), '"', buildTooltipAttributes(statusTooltip), '><span class="status status-', status.code, '">', status.label, '</span></td>',
        '<td class="accounting-tooltip-target" data-sort="', getDateSortValue(row.checkedTime), '"', buildTooltipAttributes(checkedTimeLabel), '>', htmlValue(checkedTimeLabel), '</td>',
        '</tr>'
    ].join('');
}

function buildAccountingContent(contentLines) {
    var lines = contentLines || [];
    var content = textValue(lines.length > 0 ? lines[0] : '').trim();

    if (!content) {
        return '<div class="content-line accounting-tooltip-target"' + buildTooltipAttributes('-') + '>-</div>';
    }

    return '<div class="content-line accounting-tooltip-target"' +
            buildTooltipAttributes(content) +
            '>' +
            htmlValue(content) +
            '</div>';
}

function buildTooltipAttributes(value) {
    var tooltip = textValue(value).trim() || '-';

    return ' data-tooltip="' + attributeValue(tooltip) +
            '" aria-label="' + attributeValue(tooltip) + '"';
}

function buildAccountingTooltipScript() {
    return [
        '<script>(function(){',
        'var tooltip=document.getElementById("accounting-cell-tooltip");if(!tooltip)return;',
        'var targets=document.querySelectorAll(".accounting-tooltip-target");',
        'function positionTooltip(target){',
        'var rect=target.getBoundingClientRect();var gap=8;',
        'var left=rect.left+(rect.width-tooltip.offsetWidth)/2;',
        'left=Math.max(gap,Math.min(left,window.innerWidth-tooltip.offsetWidth-gap));',
        'var top=rect.top-tooltip.offsetHeight-gap;var placement="top";',
        'if(top<gap){top=rect.bottom+gap;placement="bottom";}',
        'tooltip.style.left=Math.round(left)+"px";tooltip.style.top=Math.round(top)+"px";',
        'tooltip.setAttribute("data-placement",placement);',
        '}',
        'function showTooltip(){',
        'var content=this.getAttribute("data-tooltip")||"";if(!content)return;',
        'tooltip.textContent=content;tooltip.style.display="block";tooltip.setAttribute("aria-hidden","false");',
        'positionTooltip(this);',
        '}',
        'function hideTooltip(){tooltip.style.display="none";tooltip.setAttribute("aria-hidden","true");}',
        'for(var i=0;i<targets.length;i++){',
        'targets[i].onmouseenter=showTooltip;targets[i].onmouseleave=hideTooltip;',
        'targets[i].onfocus=showTooltip;targets[i].onblur=hideTooltip;',
        '}',
        'if(window.addEventListener){window.addEventListener("scroll",hideTooltip,true);window.addEventListener("resize",hideTooltip);}',
        '})();</script>'
    ].join('');
}

function buildSortingScript(tableId) {
    return [
        '<script>(function(){',
        'var table=document.getElementById("', attributeValue(tableId), '");if(!table||!table.tBodies.length)return;',
        'var headers=table.querySelectorAll("th[data-column]");var body=table.tBodies[0];',
        'function sortTable(header){',
        'var column=Number(header.getAttribute("data-column"));var type=header.getAttribute("data-sort-type");',
        'var direction=header.getAttribute("data-direction")==="asc"?"desc":"asc";',
        'var rows=Array.prototype.slice.call(body.querySelectorAll("tr[data-result-row]"));',
        'for(var i=0;i<headers.length;i++){headers[i].removeAttribute("data-direction");headers[i].setAttribute("aria-sort","none");headers[i].querySelector(".sort").innerHTML="&#8597;";}',
        'header.setAttribute("data-direction",direction);header.setAttribute("aria-sort",direction==="asc"?"ascending":"descending");',
        'header.querySelector(".sort").innerHTML=direction==="asc"?"&#8593;":"&#8595;";',
        'rows.sort(function(a,b){',
        'var left=a.cells[column].getAttribute("data-sort")||"";var right=b.cells[column].getAttribute("data-sort")||"";',
        'var compared=0;if(type==="number"){left=Number(left)||0;right=Number(right)||0;compared=left-right;}',
        'else{left=left.toLocaleLowerCase();right=right.toLocaleLowerCase();compared=left<right?-1:left>right?1:0;}',
        'if(!compared)compared=Number(a.getAttribute("data-original-index"))-Number(b.getAttribute("data-original-index"));',
        'return direction==="asc"?compared:-compared;',
        '});',
        'for(var j=0;j<rows.length;j++)body.appendChild(rows[j]);',
        '}',
        'for(var k=0;k<headers.length;k++){headers[k].onclick=function(){sortTable(this);};headers[k].onkeydown=function(event){event=event||window.event;if(event.keyCode===13||event.keyCode===32){if(event.preventDefault)event.preventDefault();sortTable(this);}};}',
        '})();</script>'
    ].join('');
}

function getStatusView(value) {
    var status = textValue(value).trim().toUpperCase();
    var label =
            ACCOUNTING_STATUS_MAP[status] ||
            status;

    if (
            status === ACCOUNTING_STATUS.INITIAL ||
            status === ACCOUNTING_STATUS.IN_QUEUE ||
            status === ACCOUNTING_STATUS.CREATED ||
            status === ACCOUNTING_STATUS.PENDING_APPROVAL ||
            status === ACCOUNTING_STATUS.PROCESSING
    ) {
        return { code: 'processing', label: htmlValue(label), tooltip: label };
    }
    if (status === ACCOUNTING_STATUS.COMPLETED) {
        return { code: 'success', label: htmlValue(label), tooltip: label };
    }
    if (
            status === ACCOUNTING_STATUS.ERROR ||
            status === ACCOUNTING_STATUS.NOT_FOUND
    ) {
        return { code: 'failed', label: htmlValue(label), tooltip: label };
    }

    return { code: 'default', label: htmlValue(label), tooltip: label };
}

function formatAmount(value) {
    var number = numberValue(value);
    var parts = String(number).split('.');
    var integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return parts.length > 1 ? integerPart + ',' + parts[1] : integerPart;
}

function formatCheckedTime(value) {
    if (!value) return '';

    if (typeof value.getFullYear === 'function') {
        return padNumber(value.getHours()) + ':' + padNumber(value.getMinutes()) + ' ' +
                padNumber(value.getDate()) + '/' + padNumber(value.getMonth() + 1) + '/' + value.getFullYear();
    }

    return textValue(value);
}

function getDateSortValue(value) {
    if (!value) return 0;
    if (typeof value.getTime === 'function') return value.getTime();

    var timestamp = Date.parse(textValue(value));
    return isNaN(timestamp) ? 0 : timestamp;
}

function padNumber(value) {
    return value < 10 ? '0' + value : String(value);
}

function htmlValue(value) {
    var text = textValue(value);
    if (!text) return '-';

    return escapeHtml(text);
}

function attributeValue(value) {
    return escapeHtml(textValue(value));
}

function escapeHtml(value) {
    return textValue(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
}

function escapeQueryValue(value) {
    return textValue(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeValue(value) {
    return textValue(value).trim().toLowerCase();
}

function normalizeIdentity(value) {
    var s = textValue(value).toLowerCase();
    try {
        if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) {}
    return s.replace(/\u0111/g, 'd').replace(/[^a-z0-9]/g, '');
}

function numberValue(value) {
    var number = Number(value);
    return isNaN(number) ? 0 : number;
}

function textValue(value) {
    return value === null || value === undefined ? '' : String(value);
}

function closeFile(file) {
    try {
        if (file) file.doClose();
    } catch (e) {}
}

