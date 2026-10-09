/**
 * ScriptLibrary: ESD_HTKT_EXPENSES_EFORM_SERVICE
 *
 * Mapping dữ liệu phiếu Dự chi từ esdHTKTpayment sang template
 * ChungtuDuchi_mapped.docx. Service chỉ phụ thuộc thư viện common;
 * toàn bộ truy vấn, mapping và gọi Document Service được xử lý tại đây.
 */

var DC_COMMON = lib.ESD_HTKT_PAYMENT_COMMON;
var DC_TABLE = DC_COMMON.getTables();

/* Điền ID template đã upload hoặc truyền input.templateId khi gọi. */
var DC_TEMPLATE_ID = "7538c94c-c77e-4823-812b-50cf7e43af34";
var DC_TEMPLATE_CODE = "HTKT-CHUNG-TU-DU-CHI";
var DC_DOC_SERVICE_BASE_URL = DC_COMMON.trim(lib.ESD_ENV_CONFIG.gendocUrl()).replace(/\/$/, "");

var DC_DOC_GENERATE_PDF_BASE64_PATH = "/api/generate/pdf/base64";
var DC_DOC_HTTP_TIMEOUT = 300;
var DC_DOC_MAX_BASE64_LENGTH = 5000000;

function dcNormalize(value) {
    return DC_COMMON.toLower(DC_COMMON.trim(value));
}

function dcNormalizeCode(value) {
    return DC_COMMON.normalizeCode(value)
            .replace(/_/g, "")
            .replace(/\s+/g, "");
}

function dcFormatDateLong(value) {
    var dateValue = DC_COMMON.toDate(value);

    if (!dateValue) {
        return "";
    }

    return "Ngày " + dateValue.getDate() +
            " tháng " + (dateValue.getMonth() + 1) +
            " năm " + dateValue.getFullYear();
}

function dcFormatMoney(value) {
    var amount = Number(value || 0);

    if (isNaN(amount)) {
        return "0";
    }

    var isNegative = amount < 0;
    var parts = String(Math.abs(amount)).split(".");
    var integerPart = parts[0];
    var decimalPart = parts.length > 1 ? parts[1] : "";
    var result = "";

    while (integerPart.length > 3) {
        result = "." + integerPart.substr(integerPart.length - 3) + result;
        integerPart = integerPart.substr(0, integerPart.length - 3);
    }

    result = integerPart + result;
    if (decimalPart && Number(decimalPart) !== 0) {
        result += "," + decimalPart;
    }

    return (isNegative ? "-" : "") + result;
}

function dcReadThreeDigits(numberValue, readFull) {
    var digits = [
        "không", "một", "hai", "ba", "bốn",
        "năm", "sáu", "bảy", "tám", "chín"
    ];
    var hundreds = Math.floor(numberValue / 100);
    var tens = Math.floor((numberValue % 100) / 10);
    var units = numberValue % 10;
    var result = [];

    if (hundreds > 0 || readFull) {
        result.push(digits[hundreds] + " trăm");
    }

    if (tens > 1) {
        result.push(digits[tens] + " mươi");
        if (units === 1) result.push("mốt");
        else if (units === 4) result.push("tư");
        else if (units === 5) result.push("lăm");
        else if (units > 0) result.push(digits[units]);
    } else if (tens === 1) {
        result.push("mười");
        if (units === 5) result.push("lăm");
        else if (units > 0) result.push(digits[units]);
    } else if (units > 0) {
        if (hundreds > 0 || readFull) result.push("lẻ");
        result.push(digits[units]);
    }

    return result.join(" ");
}

function dcIntegerToVietnameseWords(numberValue) {
    var scales = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"];
    var number = Math.floor(Math.abs(Number(numberValue || 0)));
    var groups = [];
    var result = [];

    if (number === 0) return "không";

    while (number > 0) {
        groups.push(number % 1000);
        number = Math.floor(number / 1000);
    }

    for (var i = groups.length - 1; i >= 0; i--) {
        if (groups[i] === 0) continue;
        var groupText = dcReadThreeDigits(
                groups[i],
                i < groups.length - 1 && groups[i] < 100
        );
        result.push(groupText + (scales[i] ? " " + scales[i] : ""));
    }

    return result.join(" ").replace(/\s+/g, " ");
}

function dcAmountToVietnameseWords(value, currency) {
    var amount = Number(value || 0);
    var result = (amount < 0 ? "âm " : "") +
            dcIntegerToVietnameseWords(Math.abs(amount));
    var safeCurrency = DC_COMMON.trim(currency).toUpperCase();

    if (safeCurrency === "VND") result += " đồng";
    else if (safeCurrency === "USD") result += " đô la Mỹ";
    else if (safeCurrency) result += " " + safeCurrency;

    result = result.replace(/\s+/g, " ");
    return result.charAt(0).toUpperCase() + result.substr(1);
}

function dcGetOrgUnitName(unitId) {
    var safeUnitId = DC_COMMON.trim(unitId);
    var unitFile = null;
    var unitName = "";

    if (!safeUnitId) return "";

    try {
        unitFile = DC_COMMON.selectOne(
                DC_TABLE.ORG_UNIT,
                ["unit.id"],
                safeUnitId
        );
        if (unitFile) {
            unitName = DC_COMMON.readString(unitFile, ["unit.name"]);
        }
    } finally {
        DC_COMMON.closeFile(unitFile);
    }

    return unitName;
}

function dcGetContactContext(contactName) {
    var safeContactName = DC_COMMON.trim(contactName);
    var result = {
        displayName: safeContactName,
        unitName: ""
    };
    var contactFile = null;

    if (!safeContactName) return result;

    try {
        contactFile = DC_COMMON.selectOne(
                DC_TABLE.CONTACT,
                ["contact.name"],
                safeContactName
        );
        if (contactFile) {
            result.displayName = DC_COMMON.readString(
                    contactFile,
                    ["full.name", "contact.name"]
            ) || safeContactName;
            result.unitName = dcGetOrgUnitName(
                    DC_COMMON.readString(contactFile, ["lv1.id"])
            );
        }
    } finally {
        DC_COMMON.closeFile(contactFile);
    }

    return result;
}

function dcPushUnique(target, seen, value) {
    var safeValue = DC_COMMON.trim(value);

    if (safeValue && !seen[safeValue]) {
        seen[safeValue] = true;
        target.push(safeValue);
    }
}

function dcJoinInvoiceNumbers(invoiceNumbersByKey, key) {
    var safeKey = DC_COMMON.trim(key);
    var values = safeKey && invoiceNumbersByKey[safeKey]
            ? invoiceNumbersByKey[safeKey]
            : [];

    return values.join(", ");
}

function dcGetPaymentRecord(paymentId) {
    return DC_COMMON.getPaymentRecord(paymentId);
}

function dcGetVendorInfo(vendorId) {
    var safeVendorId = DC_COMMON.trim(vendorId);
    var result = {
        id: safeVendorId,
        name: "",
        taxCode: ""
    };
    var vendorFile = null;

    if (!safeVendorId) return result;

    try {
        vendorFile = DC_COMMON.newReadOnlyFile(DC_TABLE.VENDOR);
        if (!vendorFile) return result;

        var rc = vendorFile.doSelect(
                'id="' + DC_COMMON.escapeQueryValue(safeVendorId) + '"'
        );
        if (rc !== RC_SUCCESS) {
            rc = vendorFile.doSelect(
                    'vendor.number="' +
                    DC_COMMON.escapeQueryValue(safeVendorId) +
                    '"'
            );
        }

        if (rc === RC_SUCCESS) {
            result.name = DC_COMMON.readString(
                    vendorFile,
                    ["vendor.name"]
            );
            result.taxCode = DC_COMMON.readString(
                    vendorFile,
                    ["vendor.number"]
            );
        }
    } finally {
        DC_COMMON.closeFile(vendorFile);
    }

    return result;
}

function dcGetVendorSources(paymentId, currency) {
    var result = [];
    var vendorFile = null;

    try {
        vendorFile = DC_COMMON.newReadOnlyFile(DC_TABLE.PAYMENT_VENDOR);
        if (!vendorFile) return result;

        var rc = vendorFile.doSelect(
                'payment.id="' +
                DC_COMMON.escapeQueryValue(paymentId) +
                '"'
        );

        while (rc === RC_SUCCESS || rc === true || rc === 0) {
            var vendorId = DC_COMMON.readString(vendorFile, ["vendor.id"]);
            var vendorInfo = dcGetVendorInfo(vendorId);

            result.push({
                vendor_id: vendorId,
                vendor_name:
                        vendorInfo.name ||
                        DC_COMMON.readString(vendorFile, ["vendor.name"]) ||
                        vendorId,
                vendor_tax_code: vendorInfo.taxCode,
                contract_id: DC_COMMON.readString(
                        vendorFile,
                        ["contract.id"]
                ),
                amount_raw: DC_COMMON.readNumber(vendorFile, ["amount"]),
                currency:
                        DC_COMMON.readString(vendorFile, ["currency"]) ||
                        currency
            });

            rc = vendorFile.getNext();
        }
    } finally {
        DC_COMMON.closeFile(vendorFile);
    }

    return result;
}

function dcFindInvoiceVendorId(vendorSources, sellerTaxCode) {
    var normalizedTaxCode = dcNormalizeCode(sellerTaxCode);

    for (var i = 0; i < vendorSources.length; i++) {
        var source = vendorSources[i] || {};
        if (
                normalizedTaxCode &&
                (
                        dcNormalizeCode(source.vendor_tax_code) === normalizedTaxCode ||
                        dcNormalizeCode(source.vendor_id) === normalizedTaxCode
                )
        ) {
            return DC_COMMON.trim(source.vendor_id);
        }
    }

    // Không tự gán cho NCC duy nhất: hóa đơn phải khớp đúng mã NCC/MST.
    return "";
}

/**
 * Đọc số hóa đơn theo đúng liên kết esdHTKTpaymentInvoice -> esdHTKTinvoice.
 * Kết quả được lập chỉ mục theo vendor.id và tên NCC để map lại dòng tổng hợp.
 */
function dcGetInvoiceNumberContext(paymentId, vendorSources) {
    var result = {
        byVendorId: {},
        byVendorName: {},
        summaryByVendorId: {}
    };
    var seenByVendorId = {};
    var seenByVendorName = {};
    var invoiceLinkFile = null;

    try {
        invoiceLinkFile = DC_COMMON.newReadOnlyFile(DC_TABLE.PAYMENT_INVOICE);
        if (!invoiceLinkFile) {
            return result;
        }

        var rc = invoiceLinkFile.doSelect(
                'payment.id="' +
                DC_COMMON.escapeQueryValue(paymentId) +
                '"'
        );

        while (rc === RC_SUCCESS || rc === true || rc === 0) {
            var invoiceId = DC_COMMON.readString(
                    invoiceLinkFile,
                    ["invoice.id"]
            );
            var invoiceFile = DC_COMMON.selectOne(
                    DC_TABLE.INVOICE,
                    ["id"],
                    invoiceId
            );

            if (invoiceFile) {
                var invoiceNumber = DC_COMMON.readString(
                        invoiceFile,
                        ["invoice.number"]
                );
                var sellerTaxCode = DC_COMMON.readString(
                        invoiceFile,
                        ["seller.tax.code"]
                );
                var sellerName = DC_COMMON.readString(
                        invoiceFile,
                        ["seller.legal.name", "seller.name"]
                );
                var vendorId = dcFindInvoiceVendorId(
                        vendorSources,
                        sellerTaxCode
                );
                vendorId = DC_COMMON.trim(vendorId || sellerTaxCode);
                var normalizedSellerName = dcNormalize(sellerName);
                var lineTotalRaw = DC_COMMON.readNumber(invoiceFile, [
                    "grand.total"
                ]);
                var taxAmountRaw = DC_COMMON.readNumber(invoiceFile, [
                    "total.tax"
                ]);
                var amountBeforeTaxRaw = DC_COMMON.readNumber(invoiceFile, [
                    "total.amount.without.tax"
                ]);

                if (amountBeforeTaxRaw === 0 && lineTotalRaw !== 0) {
                    amountBeforeTaxRaw = lineTotalRaw - taxAmountRaw;
                }

                if (vendorId) {
                    if (!result.byVendorId[vendorId]) {
                        result.byVendorId[vendorId] = [];
                        seenByVendorId[vendorId] = {};
                    }
                    dcPushUnique(
                            result.byVendorId[vendorId],
                            seenByVendorId[vendorId],
                            invoiceNumber
                    );

                    if (!result.summaryByVendorId[vendorId]) {
                        result.summaryByVendorId[vendorId] = {
                            vendorName: sellerName,
                            amountBeforeTaxRaw: 0,
                            taxAmountRaw: 0,
                            lineTotalRaw: 0
                        };
                    }
                    result.summaryByVendorId[vendorId].amountBeforeTaxRaw +=
                            amountBeforeTaxRaw;
                    result.summaryByVendorId[vendorId].taxAmountRaw +=
                            taxAmountRaw;
                    result.summaryByVendorId[vendorId].lineTotalRaw +=
                            lineTotalRaw;
                }

                if (normalizedSellerName) {
                    if (!result.byVendorName[normalizedSellerName]) {
                        result.byVendorName[normalizedSellerName] = [];
                        seenByVendorName[normalizedSellerName] = {};
                    }
                    dcPushUnique(
                            result.byVendorName[normalizedSellerName],
                            seenByVendorName[normalizedSellerName],
                            invoiceNumber
                    );
                }
            }

            DC_COMMON.closeFile(invoiceFile);
            rc = invoiceLinkFile.getNext();
        }
    } finally {
        DC_COMMON.closeFile(invoiceLinkFile);
    }

    return result;
}

function dcBuildVendorContext(paymentId, currency) {
    var sources = dcGetVendorSources(paymentId, currency);
    var vendorByName = {};
    var vendorById = {};

    for (var i = 0; i < sources.length; i++) {
        var source = sources[i] || {};
        var vendorId = DC_COMMON.trim(source.vendor_id);
        var vendorName = DC_COMMON.trim(source.vendor_name);

        if (vendorId) {
            vendorById[vendorId] = source;
        }
        if (vendorName) {
            vendorByName[dcNormalize(vendorName)] = source;
        }
    }

    return {
        sources: sources,
        vendorById: vendorById,
        vendorByName: vendorByName,
        invoices: dcGetInvoiceNumberContext(paymentId, sources)
    };
}

function dcGetAccountSide(accountType, entryType) {
    var normalized = dcNormalizeCode(accountType);
    var normalizedEntryType = DC_COMMON.trim(entryType).toUpperCase();

    if (normalized === "NO" || normalized === "DEBIT") return "debit";
    if (
            normalized === "CO" ||
            normalized === "CREDIT" ||
            normalized === "TAISAN" ||
            normalized === "ASSET"
    ) {
        return "credit";
    }

    if (
            normalizedEntryType === "COST" ||
            normalizedEntryType === "TAX" ||
            normalizedEntryType === "OTHER"
    ) {
        return "debit";
    }
    if (
            normalizedEntryType === "PREPAYMENT" ||
            normalizedEntryType === "CUSTOMER"
    ) {
        return "credit";
    }

    return "";
}

function dcGetAccountingEntryOrder(entryType) {
    var safeType = DC_COMMON.trim(entryType).toUpperCase();

    if (safeType === "COST") return 1;
    if (safeType === "TAX") return 2;
    if (safeType === "OTHER") return 3;
    if (safeType === "PREPAYMENT") return 4;
    if (safeType === "PAYABLE") return 5;
    if (safeType === "CUSTOMER") return 6;
    return 0;
}

function dcGetAccountingGroupInfo(source) {
    /*
     * Dự chi chỉ có bảng AP. Mỗi nhóm AP được tách theo nhà cung cấp;
     * dữ liệu cũ thiếu vendor.id được gom vào một bảng AP mặc định.
     */
    var vendorId = DC_COMMON.trim(source.vendorId);
    return {
        key: "AP:" + (vendorId || "DEFAULT")
    };
}

function dcGetAccountingData(paymentId, currency) {
    var result = {
        rows: [],
        tables: [],
        totalDebitRaw: 0,
        totalCreditRaw: 0
    };
    var sourceRows = [];
    var groupsByKey = {};
    var groups = [];
    var entryFile = null;

    try {
        entryFile = DC_COMMON.newReadOnlyFile(DC_TABLE.PAYMENT_ENTRY);
        if (!entryFile) return result;

        var rc = entryFile.doSelect(
                'payment.id="' +
                DC_COMMON.escapeQueryValue(paymentId) +
                '"'
        );

        while (rc === RC_SUCCESS || rc === true || rc === 0) {
            var ledgerType = DC_COMMON.readString(
                    entryFile,
                    ["type"]
            ).toUpperCase();
            var entryType = DC_COMMON.readString(
                    entryFile,
                    ["entry.type"]
            ).toUpperCase();
            var displayOrder = dcGetAccountingEntryOrder(entryType);

            // Dự chi chỉ in bảng AP; giá trị rỗng dành cho dữ liệu cũ.
            if (
                    displayOrder > 0 &&
                    (ledgerType === "AP" || !ledgerType)
            ) sourceRows.push({
                id: DC_COMMON.readString(entryFile, ["id"]),
                entryType: entryType,
                displayOrder: displayOrder,
                accountType: DC_COMMON.readString(entryFile, ["account.type"]),
                accountNumber: DC_COMMON.readString(entryFile, ["account.number"]),
                accountName: DC_COMMON.readString(entryFile, ["account.name"]),
                description: DC_COMMON.readString(entryFile, ["description"]),
                amountRaw: DC_COMMON.readNumber(entryFile, ["amount"]),
                order: DC_COMMON.readNumber(entryFile, ["order"]),
                vendorId: DC_COMMON.readString(entryFile, ["vendor.id"])
            });
            rc = entryFile.getNext();
        }
    } finally {
        DC_COMMON.closeFile(entryFile);
    }

    for (var sourceIndex = 0; sourceIndex < sourceRows.length; sourceIndex++) {
        var sourceRow = sourceRows[sourceIndex];
        var groupInfo = dcGetAccountingGroupInfo(sourceRow);
        var group = groupsByKey[groupInfo.key];

        if (!group) {
            group = {
                key: groupInfo.key,
                firstIndex: sourceIndex,
                sourceRows: [],
                rows: [],
                totalDebitRaw: 0,
                totalCreditRaw: 0
            };
            groupsByKey[groupInfo.key] = group;
            groups.push(group);
        }

        group.sourceRows.push(sourceRow);
    }

    groups.sort(function(left, right) {
        return left.firstIndex - right.firstIndex;
    });

    for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        var currentGroup = groups[groupIndex];

        currentGroup.sourceRows.sort(function(left, right) {
            if (left.displayOrder !== right.displayOrder) {
                return left.displayOrder - right.displayOrder;
            }
            var orderDifference =
                    Number(left.order || 0) - Number(right.order || 0);
            if (orderDifference !== 0) return orderDifference;
            return DC_COMMON.toString(left.id) < DC_COMMON.toString(right.id)
                    ? -1
                    : 1;
        });

        for (var rowIndex = 0;
             rowIndex < currentGroup.sourceRows.length;
             rowIndex++
        ) {
            var source = currentGroup.sourceRows[rowIndex];
            var side = dcGetAccountSide(source.accountType, source.entryType);
            var amountRaw = Number(source.amountRaw || 0);
            var debitAmount = "";
            var creditAmount = "";

            if (side === "debit") {
                currentGroup.totalDebitRaw += amountRaw;
                result.totalDebitRaw += amountRaw;
                debitAmount = dcFormatMoney(amountRaw);
            } else if (side === "credit") {
                currentGroup.totalCreditRaw += amountRaw;
                result.totalCreditRaw += amountRaw;
                creditAmount = dcFormatMoney(amountRaw);
            }

            var mappedRow = {
                stt: rowIndex + 1,
                account_number: source.accountNumber,
                account_name: source.accountName,
                description: source.description,
                debit_amount: debitAmount,
                credit_amount: creditAmount
            };

            currentGroup.rows.push(mappedRow);
            result.rows.push(mappedRow);
        }

        result.tables.push({
            accounting_rows: currentGroup.rows,
            calc_total_debit_amount: dcFormatMoney(
                    currentGroup.totalDebitRaw
            ),
            calc_total_credit_amount: dcFormatMoney(
                    currentGroup.totalCreditRaw
            ),
            calc_amount_words_AP: dcAmountToVietnameseWords(
                    currentGroup.totalDebitRaw || currentGroup.totalCreditRaw,
                    currency
            ),
            /*
             * Đặt {table_separator} trong một paragraph riêng ngay sau bảng
             * và trước {/accounting_table}. NBSP giữ paragraph tồn tại để
             * Word không tự ghép hai bảng lặp liền nhau thành một bảng.
             */
            table_separator: "\u00A0"
        });
    }

    return result;
}

function dcBuildVendorRows(vendorContext) {
    var rows = vendorContext.sources || [];
    var result = [];
    var totalAmountBeforeTaxRaw = 0;
    var totalTaxAmountRaw = 0;
    var totalLineTotalRaw = 0;

    for (var i = 0; i < rows.length; i++) {
        var source = rows[i] || {};
        var vendorName = DC_COMMON.trim(source.vendor_name);
        var vendorId = DC_COMMON.trim(source.vendor_id);
        var invoiceSummary =
                vendorContext.invoices.summaryByVendorId[vendorId] || null;
        var amountBeforeTaxRaw = invoiceSummary
                ? Number(invoiceSummary.amountBeforeTaxRaw || 0)
                : Number(source.amount_raw || 0);
        var taxAmountRaw = invoiceSummary
                ? Number(invoiceSummary.taxAmountRaw || 0)
                : 0;
        var lineTotalRaw = invoiceSummary
                ? Number(invoiceSummary.lineTotalRaw || 0)
                : Number(source.amount_raw || 0);
        var invoiceNumber = dcJoinInvoiceNumbers(
                vendorContext.invoices.byVendorId,
                vendorId
        );

        result.push({
            stt: source.stt || (i + 1),
            vendor_code: vendorId,
            vendor_name: vendorName,
            contract_code: DC_COMMON.trim(source.contract_id),
            invoice_number: invoiceNumber,
            amount_before_tax: dcFormatMoney(amountBeforeTaxRaw),
            tax_amount: dcFormatMoney(taxAmountRaw),
            line_total: dcFormatMoney(lineTotalRaw)
        });

        totalAmountBeforeTaxRaw += amountBeforeTaxRaw;
        totalTaxAmountRaw += taxAmountRaw;
        totalLineTotalRaw += lineTotalRaw;
    }

    return {
        rows: result,
        totalAmountBeforeTaxRaw: totalAmountBeforeTaxRaw,
        totalTaxAmountRaw: totalTaxAmountRaw,
        totalLineTotalRaw: totalLineTotalRaw
    };
}

/**
 * Trả đúng các placeholder đang có trong ChungtuDuchi_mapped.docx.
 */
function htktBuildTemplateData(paymentId) {
    var safePaymentId = DC_COMMON.trim(paymentId);

    if (!safePaymentId) {
        return {
            success: false,
            message: "Không xác định được mã phiếu Dự chi."
        };
    }

    var paymentFile = null;

    try {
        paymentFile = dcGetPaymentRecord(safePaymentId);
        if (!paymentFile) {
            return {
                success: false,
                message: "Không tìm thấy phiếu Dự chi " + safePaymentId + "."
            };
        }

        var transactionType = DC_COMMON.readString(
                paymentFile,
                ["transaction.type"]
        );
        if (
                transactionType &&
                dcNormalize(transactionType) !== dcNormalize("Dự chi") &&
                safePaymentId.indexOf("DC.") !== 0
        ) {
            return {
                success: false,
                message: "Phiếu " + safePaymentId + " không phải loại Dự chi."
            };
        }

        var createdAt = DC_COMMON.readValue(paymentFile, ["created.at"]);
        var createdBy = DC_COMMON.readString(paymentFile, ["created.by"]);
        var departmentId = DC_COMMON.readString(paymentFile, ["department"]);
        var description = DC_COMMON.readString(paymentFile, ["description"]);
        var currency = DC_COMMON.readString(paymentFile, ["currency"]) || "VND";
        var contactContext = dcGetContactContext(createdBy);
        var vendorContext = dcBuildVendorContext(safePaymentId, currency);
        var vendorData = dcBuildVendorRows(vendorContext);
        var accountingData = dcGetAccountingData(safePaymentId, currency);
        var accountingAmountRaw = accountingData.totalDebitRaw ||
                accountingData.totalCreditRaw;

        if (!vendorContext.sources.length) {
            return {
                success: false,
                message:
                        "Phiếu Dự chi " + safePaymentId +
                        " chưa có thông tin nhà cung cấp."
            };
        }

        var departmentName = dcGetOrgUnitName(departmentId);
        var amountWords = dcAmountToVietnameseWords(
                vendorData.totalLineTotalRaw,
                currency
        );

        return {
            success: true,
            message: "",
            templateId: DC_TEMPLATE_ID,
            templateCode: DC_TEMPLATE_CODE,
            data: {
                unit_name: contactContext.unitName,
                created_at: dcFormatDateLong(createdAt),
                id: safePaymentId,
                created_by: contactContext.displayName,
                department_name: departmentName,
                description: description,
                currency: currency,

                vendor_rows: vendorData.rows,
                calc_total_amount_before_tax: dcFormatMoney(
                        vendorData.totalAmountBeforeTaxRaw
                ),
                calc_total_tax_amount: dcFormatMoney(
                        vendorData.totalTaxAmountRaw
                ),
                calc_total_line_total: dcFormatMoney(
                        vendorData.totalLineTotalRaw
                ),
                calc_amount_words: amountWords,

                /*
                 * Template fixed_width lặp accounting_table ở ngoài thẻ tbl,
                 * vì vậy mỗi phần tử bên dưới sinh ra một bảng Word riêng.
                 */
                accounting_table: accountingData.tables,
                accounting_rows: accountingData.rows,
                calc_total_debit_amount: dcFormatMoney(
                        accountingData.totalDebitRaw
                ),
                calc_total_credit_amount: dcFormatMoney(
                        accountingData.totalCreditRaw
                ),
                calc_amount_words_AP: dcAmountToVietnameseWords(
                        accountingAmountRaw,
                        currency
                ),

                output_file_name: DC_COMMON.sanitizeFileName(
                        "Chung-tu-Du-chi-" + safePaymentId
                ) + ".pdf"
            }
        };
    } catch (error) {
        return {
            success: false,
            message: DC_COMMON.exceptionToString(error)
        };
    } finally {
        DC_COMMON.closeFile(paymentFile);
    }
}

function dcHttpPost(url, body) {
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Accept", "application/json")
    ];

    try {
        return {
            ok: true,
            body: DC_COMMON.toString(
                    doHTTPRequest(
                            "POST",
                            DC_COMMON.toString(url),
                            headers,
                            DC_COMMON.toString(body),
                            DC_DOC_HTTP_TIMEOUT,
                            DC_DOC_HTTP_TIMEOUT,
                            DC_DOC_HTTP_TIMEOUT
                    )
            ),
            error: ""
        };
    } catch (error) {
        return {
            ok: false,
            body: "",
            error: DC_COMMON.exceptionToString(error)
        };
    }
}

function dcGeneratePdfBase64Response(templateId, templateData) {
    var response = dcHttpPost(
            DC_DOC_SERVICE_BASE_URL + DC_DOC_GENERATE_PDF_BASE64_PATH,
            DC_COMMON.safeStringify({
                templateId: templateId,
                data: templateData
            }, "")
    );

    if (!response.ok || !response.body) {
        return {
            success: false,
            message:
                    "Không gọi được Document Service. " +
                    DC_COMMON.toString(response.error),
            data: ""
        };
    }

    var result = DC_COMMON.safeParseJson(response.body, null);
    if (!result) {
        return {
            success: false,
            message: "Document Service trả về JSON không hợp lệ.",
            data: ""
        };
    }

    var responseTemplateId = DC_COMMON.trim(result.templateId);
    if (responseTemplateId && responseTemplateId !== templateId) {
        return {
            success: false,
            message:
                    "Document Service trả về sai templateId. Yêu cầu: " +
                    templateId + "; phản hồi: " + responseTemplateId + ".",
            data: ""
        };
    }

    var base64 = DC_COMMON.trim(result.data);
    if (!base64) {
        var serviceError =
                result.message ||
                result.error ||
                result.detail ||
                result.title ||
                "";
        var serviceMessage = "";

        if (serviceError && typeof serviceError === "object") {
            serviceMessage = DC_COMMON.trim(
                    serviceError.message ||
                    serviceError.detail ||
                    serviceError.error ||
                    serviceError.title ||
                    ""
            );

            if (!serviceMessage) {
                serviceMessage = DC_COMMON.safeStringify(serviceError, "");
            }
        } else {
            serviceMessage = DC_COMMON.trim(serviceError);
        }

        if (!serviceMessage) {
            serviceMessage = DC_COMMON.trim(response.body);
        }

        // Không đưa một response bất thường quá lớn lên Messages của SM.
        if (serviceMessage.length > 1500) {
            serviceMessage = serviceMessage.substr(0, 1500) + "...";
        }

        return {
            success: false,
            message:
                    "Document Service không sinh được PDF cho template " +
                    templateId +
                    (serviceMessage ? ". Chi tiết: " + serviceMessage : "."),
            data: ""
        };
    }

    if (
            result.mimeType &&
            DC_COMMON.toLower(result.mimeType) !== "application/pdf"
    ) {
        return {
            success: false,
            message:
                    "Document Service trả về mimeType không phải PDF: " +
                    DC_COMMON.toString(result.mimeType),
            data: ""
        };
    }

    if (
            result.encoding &&
            DC_COMMON.toLower(result.encoding) !== "base64"
    ) {
        return {
            success: false,
            message:
                    "Document Service trả về encoding không phải base64: " +
                    DC_COMMON.toString(result.encoding),
            data: ""
        };
    }

    if (base64.length > DC_DOC_MAX_BASE64_LENGTH) {
        return {
            success: false,
            message:
                    "PDF base64 vượt quá giới hạn " +
                    DC_DOC_MAX_BASE64_LENGTH + " ký tự.",
            data: ""
        };
    }

    return {
        success: true,
        message: "",
        data: base64,
        mimeType: result.mimeType || "application/pdf",
        encoding: result.encoding || "base64",
        templateId: templateId
    };
}

/*
 * Cache theo đúng cách EFORM_SERVICE đang dùng, nhưng tách namespace để
 * PDF Dự chi không dùng nhầm cache của phiếu Tạm ứng/Thanh toán.
 */
function dcBuildPdfCacheKey(templateId, templateData) {
    var serialized = DC_COMMON.safeStringify(templateData || {}, "{}");
    var hash = 0;

    for (var i = 0; i < serialized.length; i++) {
        hash = ((hash << 5) - hash) + serialized.charCodeAt(i);
        hash = hash | 0;
    }

    return [templateId, serialized.length, hash].join("|");
}

function dcGetPdfBase64Cached(templateId, templateData) {
    var cacheKey = dcBuildPdfCacheKey(templateId, templateData);
    var oldCacheKey = DC_COMMON.trim(vars["$L.dc.eform.cache.key"]);
    var oldBase64 = DC_COMMON.trim(vars["$L.dc.eform.pdf.base64"]);

    if (oldCacheKey === cacheKey && oldBase64) {
        return {
            success: true,
            message: "",
            data: oldBase64,
            mimeType: "application/pdf",
            encoding: "base64",
            templateId: templateId,
            fromCache: true
        };
    }

    var generated = dcGeneratePdfBase64Response(templateId, templateData);

    if (generated.success) {
        vars["$L.dc.eform.cache.key"] = cacheKey;
        vars["$L.dc.eform.pdf.base64"] = generated.data;
    }

    return generated;
}

function generatePresentationPdf(input) {
    input = input || {};

    var paymentId = DC_COMMON.getCurrentPaymentId(input);

    if (!paymentId) {
        return {
            success: false,
            message: "Không xác định được ID phiếu Dự chi hiện tại."
        };
    }

    var mapped = htktBuildTemplateData(paymentId);

    if (!mapped.success) {
        return mapped;
    }

    // Chỉ dùng template do mapper Dự chi trả về để không nhận nhầm template
    // Tạm ứng/Thanh toán từ input hoặc context của HTML Viewer.
    var templateId = DC_COMMON.trim(mapped.templateId);
    if (!templateId) {
        return {
            success: false,
            message:
                    "Chưa cấu hình templateId cho " +
                    DC_TEMPLATE_CODE + ".",
            data: {
                paymentId: paymentId,
                templateCode: DC_TEMPLATE_CODE,
                templateData: mapped.data
            }
        };
    }

    var useCache = DC_COMMON.readBoolean(
            input,
            ["useCache", "use_cache"],
            true
    );
    var generated = useCache ?
            dcGetPdfBase64Cached(templateId, mapped.data) :
            dcGeneratePdfBase64Response(templateId, mapped.data);
    if (!generated || generated.success !== true) {
        return generated || {
            success: false,
            message: "Không sinh được PDF Chứng từ Dự chi."
        };
    }

    return {
        success: true,
        message: "",
        data: {
            paymentId: paymentId,
            templateId: templateId,
            templateCode: DC_TEMPLATE_CODE,
            templateData: DC_COMMON.readBoolean(
                    input,
                    ["includeTemplateData", "include_template_data"],
                    true
            ) ? mapped.data : null,
            pdfBase64: generated.data,
            mimeType: generated.mimeType || "application/pdf",
            encoding: generated.encoding || "base64",
            fileName: mapped.data.output_file_name,
            fromCache: generated.fromCache === true
        }
    };
}

function dcEscapeForJavaScript(value) {
    return DC_COMMON.toString(value)
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "\\'")
            .replace(/\r/g, "")
            .replace(/\n/g, "");
}

function dcBuildErrorHtml(title, message) {
    return (
            "<div style='padding:20px;font-family:Arial,sans-serif;color:#b91c1c;'>" +
            "<div style='font-size:16px;font-weight:bold;margin-bottom:8px;'>" +
            DC_COMMON.escapeHtml(title || "Có lỗi xảy ra") +
            "</div>" +
            "<div>" +
            DC_COMMON.escapeHtml(message || "") +
            "</div>" +
            "</div>"
    );
}

function htktBuildPreviewContext(input) {
    var generated = generatePresentationPdf(input || {});

    if (!generated || generated.success !== true) {
        return generated || {
            success: false,
            message: "Không sinh được PDF Chứng từ Dự chi."
        };
    }

    var data = generated.data || {};

    return {
        success: true,
        message: "",
        paymentId: data.paymentId,
        templateId: data.templateId,
        templateCode: data.templateCode,
        templateData: data.templateData,
        pdfBase64: data.pdfBase64,
        mimeType: data.mimeType,
        encoding: data.encoding,
        fileName: data.fileName
    };
}

function RENDER_PRINT(showToolbar, errorTitle) {
    // HTML Viewer gọi trực tiếp hàm này mà không truyền tham số.
    // Mặc định hiển thị toolbar PDF để phục vụ thao tác in.
    if (typeof showToolbar !== "boolean") {
        showToolbar = true;
    }
    errorTitle = DC_COMMON.trim(errorTitle) || "In Chứng từ Dự chi";

    var generated = generatePresentationPdf({
        useCache: true,
        includeTemplateData: false
    });

    if (!generated || generated.success !== true) {
        return dcBuildErrorHtml(
                errorTitle,
                generated && generated.message
                        ? generated.message
                        : "Không sinh được PDF Chứng từ Dự chi."
        );
    }

    var base64PDF = dcEscapeForJavaScript(
            generated.data && generated.data.pdfBase64
    );
    if (!base64PDF) {
        return dcBuildErrorHtml(
                errorTitle,
                "Document Service không trả về dữ liệu PDF base64."
        );
    }

    var frameId = showToolbar ? "dcPrintFrame" : "dcPdfFrame";
    var toolbar = showToolbar ? "1" : "0";

    return (
            "<div style='margin:0;padding:0;width:100%;height:100%;font-family:Arial,sans-serif;'>" +
            "<iframe id='" + frameId + "' width='100%' height='100%' " +
            "style='min-height:700px;border:none;background:#e5e7eb;'></iframe>" +
            "<script>" +
            "(function(){" +
            "var base64='" + base64PDF + "';" +
            "function toBytes(value){" +
            "var binary=atob(value);" +
            "var bytes=new Uint8Array(binary.length);" +
            "for(var i=0;i<binary.length;i++){bytes[i]=binary.charCodeAt(i);}" +
            "return bytes;" +
            "}" +
            "try{" +
            "var blob=new Blob([toBytes(base64)],{type:'application/pdf'});" +
            "var url=URL.createObjectURL(blob);" +
            "var frame=document.getElementById('" + frameId + "');" +
            "frame.src=url+'#toolbar=" + toolbar + "&navpanes=0&view=FitH';" +
            "window.addEventListener('beforeunload',function(){URL.revokeObjectURL(url);});" +
            "}catch(e){" +
            "document.body.innerHTML='<div style=\"padding:16px;color:red;font-family:Arial;\">" +
            "Lỗi hiển thị PDF: '+e+'</div>';" +
            "}" +
            "})();" +
            "</script>" +
            "</div>"
    );
}
