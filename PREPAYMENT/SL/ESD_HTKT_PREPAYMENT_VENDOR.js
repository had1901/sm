function run() {
    try {
        var input = vars['$L.file'];
        if (!input) { return; }

        var name = input.name;
        if (!name) {
            input.queryReturn = JSON.stringify({ success: false, error: 'Missing action "name"' });
            return;
        }

        var result;
        switch (name) {
            //Danh sách Đề nghị theo nhà cung cấp
            case 'getListPrepaymentVendor':
                var data = getListPrepaymentVendor(input);
                result = { success: true, data: data };
                break;
            //tổng nhà cung cấp
            case 'totalContractSuppliers':
                var data = totalContractSuppliers(input);
                result = { success: true, data: data };
                break;
            //Thêm nhà cung cấp theo các PO đã chọn
            case 'addPrepaymentVendorsByPO':
                var data = addPrepaymentVendorsByPO(input);
                result = { success: data.success, data: data };
                break;
            //Gỡ hóa đơn vào nhà cung cấp
            case 'deletePrepaymentVendor':
                var data = deletePrepaymentVendor(input);
                result = { success: true, data: data };
                break;
            //Danh sách Hóa đơn có thể chọn theo nhà cung cấp
            case 'getListInvoinVendor':
                var data = getListInvoinVendor(input);
                result = { success: true, data: data };
                break;
            //Danh sách Hóa đơn đã được gán với nhà cung cấp
            case 'getInvoicesBySupplier':
                var data = getInvoicesBySupplier(input);
                result = { success: true, data: data };
                break;
            //Gán hóa đơn vào nhà cung cấp
            case 'createListInvoinVendor':
                var data = createListInvoinVendor(input);
                result = { success: true, data: data };
                break;
            //cập nhật Loại khấu trừ thuế 
            case 'updateListInvoinVendor':
                var data = updateListInvoinVendor(input);
                result = { success: true, data: data };
                break;

            default:
                result = { success: false, error: 'Hanh dong (name) khong hop le: ' + name };
        }

        input.queryReturn = JSON.stringify(result);
    } catch (e) {
        if (vars['$L.file']) {
            vars['$L.file'].queryReturn = JSON.stringify({ success: false, error: 'Gateway Error: ' + e.toString() });
        }
    }
}


function totalContractSuppliers(input) {
    var totalSuppliers = 0;
    var contractId = "";

    try {
        if (input.details) {
            var queryObj = JSON.parse(input.details);
            contractId = queryObj.contractId || "";
        } else if (input.queryString) {
            var queryObjOld = JSON.parse(input.queryString);
            contractId = queryObjOld.contractId || "";
        }
    } catch (ex) {
        return totalSuppliers;
    }

    // TU XDCB: đếm NCC từ HĐ/HS đã chọn, không query danh sách NCC của S2.
    var sourceParams = queryObj || queryObjOld || {};
    if (sourceParams.prepaymentId && lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb({
        "prepayment.id": sourceParams.prepaymentId
    })) {
        return lib.ESD_HTKT_PAYMENT_VENDOR.getPaymentXdcbSuppliers({
            "prepayment.id": sourceParams.prepaymentId
        }).length;
    }

    if (!contractId) return totalSuppliers;

    var vendorFile = new SCFile("esdHDcontractSupplier", SCFILE_READONLY);
    var sqlVendor = "contract.id=\"" + contractId + "\"";
    totalSuppliers = vendorFile.doCount(sqlVendor);

    return totalSuppliers;
}

function addPrepaymentVendorsByPO(input) {
    var params = {};
    var errors = [];
    var addedCount = 0;
    var skippedCount = 0;
    var prepaymentId = "";
    var contractId = "";

    try {
        params = JSON.parse(input.details || input.queryString || "{}");
        prepaymentId = String(params.prepaymentId || "").trim();
    } catch (eParse) {
        return { success: false, message: "Dữ liệu chọn PO không hợp lệ." };
    }

    var poIds = params.poIds || [];
    if (typeof poIds === "string") poIds = poIds.split(/[,;|]/);
    if (!Array.isArray(poIds)) poIds = [poIds];
    var normalizedPoIds = [];
    var seenPoIds = {};
    for (var i = 0; i < poIds.length; i++) {
        var poId = String(poIds[i] || "").replace(/^\s+|\s+$/g, "");
        if (poId && !seenPoIds[poId]) {
            seenPoIds[poId] = true;
            normalizedPoIds.push(poId);
        }
    }

    if (!prepaymentId || normalizedPoIds.length === 0) {
        return { success: false, message: "Thiếu mã phiếu tạm ứng hoặc PO được chọn." };
    }

    var prepaymentFile = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
    try {
        if (prepaymentFile.doSelect('id="' + escapePrepaymentVendorQueryValue(prepaymentId) + '"') !== RC_SUCCESS) {
            return { success: false, message: "Không tìm thấy phiếu tạm ứng." };
        }
        contractId = String(prepaymentFile["contract.id"] || "").replace(/^\s+|\s+$/g, "");
    } finally {
        try { prepaymentFile.doClose(); } catch (eClosePrepayment) { }
    }

    if (!contractId) return { success: false, message: "Phiếu tạm ứng chưa có mã hợp đồng gốc." };

    for (var poIndex = 0; poIndex < normalizedPoIds.length; poIndex++) {
        var currentPoId = normalizedPoIds[poIndex];
        var poFile = new SCFile("esdHDcontract", SCFILE_READONLY);
        var contractSupplierFile = null;

        try {
            var poQuery = 'id="' + escapePrepaymentVendorQueryValue(currentPoId) + '" and category="HD_PO"';
            if (poFile.doSelect(poQuery) !== RC_SUCCESS) {
                errors.push("Không tìm thấy PO " + currentPoId + " trong esdHDcontract.");
                continue;
            }

            var poContractId = String(poFile["item.id"] || poFile["contract.id"] || "").replace(/^\s+|\s+$/g, "");
            if (poContractId !== contractId) {
                errors.push("PO " + currentPoId + " thuộc hợp đồng " + (poContractId || "trống") +
                    ", không khớp hợp đồng " + contractId + " của phiếu.");
                continue;
            }

            contractSupplierFile = new SCFile("esdHDcontractSupplier", SCFILE_READONLY);
            var supplierRc = contractSupplierFile.doSelect(
                'contract.id="' + escapePrepaymentVendorQueryValue(currentPoId) + '"'
            );

            if (supplierRc !== RC_SUCCESS) {
                errors.push("PO " + currentPoId + " chưa có nhà cung cấp trong esdHDcontractSupplier.");
                continue;
            }

            while (supplierRc === RC_SUCCESS) {
                var supplierId = String(contractSupplierFile["supplier.id"] || "").replace(/^\s+|\s+$/g, "");
                var supplierData = null;
                var supplierFile = null;
                var vendorFile = null;
                var prepaymentVendorFile = null;

                try {
                    if (!supplierId) throw new Error("PO " + currentPoId + " thiếu supplier.id.");

                    supplierFile = new SCFile("esdDMSupplier", SCFILE_READONLY);
                    if (supplierFile.doSelect('id="' + escapePrepaymentVendorQueryValue(supplierId) + '"') !== RC_SUCCESS) {
                        throw new Error("Không tìm thấy NCC " + supplierId + " của PO " + currentPoId + ".");
                    }

                    supplierData = {
                        id: supplierId,
                        name: String(supplierFile["supplier.name"] || supplierFile["name"] || ""),
                        taxCode: String(supplierFile["tax.code"] || ""),
                        address: String(supplierFile["address"] || ""),
                        type: String(supplierFile["type"] || "")
                    };
                    if (!supplierData.taxCode) throw new Error("NCC " + supplierId + " chưa có mã số thuế.");

                    vendorFile = new SCFile("esdHTKTvendor");
                    var vendorQuery = 'vendor.number="' + escapePrepaymentVendorQueryValue(supplierData.taxCode) +
                        '" and supplier.id="' + escapePrepaymentVendorQueryValue(supplierId) + '"';
                    if (vendorFile.doSelect(vendorQuery) !== RC_SUCCESS) {
                        try { vendorFile.doClose(); } catch (eCloseMissingVendor) { }

                        var vendorId = new Datum();
                        var vendorNumberRc = new Datum();
                        system.functions.rtecall("getnumber", vendorNumberRc, vendorId, "esdHTKTvendor");

                        vendorFile = new SCFile("esdHTKTvendor");
                        vendorFile["id"] = vendorId;
                        vendorFile["vendor.name"] = supplierData.name;
                        vendorFile["vendor.number"] = supplierData.taxCode;
                        vendorFile["username"] = vars["$lo.contact.name"] || "";
                        vendorFile["ogl.country"] = "VN";
                        vendorFile["address"] = supplierData.address;
                        vendorFile["supplier.id"] = supplierId;
                        vendorFile["vendor.type"] = supplierData.type;
                        var addVendorRc = vendorFile.doAction("add");
                        if (addVendorRc !== RC_SUCCESS && addVendorRc !== true) {
                            throw new Error("Không tạo được vendor master cho NCC " + supplierId + ".");
                        }
                    }

                    var resolvedVendorId = String(vendorFile["id"] || "").replace(/^\s+|\s+$/g, "");
                    if (!resolvedVendorId) throw new Error("Không xác định được vendor.id cho NCC " + supplierId + ".");

                    prepaymentVendorFile = new SCFile("esdHTKTprepaymentVendor");
                    var duplicateQuery = 'prepayment.id="' + escapePrepaymentVendorQueryValue(prepaymentId) +
                        '" and po.id="' + escapePrepaymentVendorQueryValue(currentPoId) +
                        '" and vendor.id="' + escapePrepaymentVendorQueryValue(resolvedVendorId) + '"';
                    if (prepaymentVendorFile.doSelect(duplicateQuery) === RC_SUCCESS) {
                        skippedCount++;
                        supplierRc = contractSupplierFile.getNext();
                        continue;
                    }

                    // NCC đã có trên phiếu qua PO khác: bút toán sinh theo NCC, nên dòng PO mới
                    // dùng chung Site/hình thức thanh toán/TK thụ hưởng với dòng đã có.
                    var sameVendorInfo = getSamePrepaymentVendorAccountingInfo(prepaymentId, resolvedVendorId);

                    var numberRc = new SCDatum();
                    numberRc.setValue(-1);
                    var nextNumber = new SCDatum();
                    system.functions.rtecall("getnumber", numberRc, nextNumber, "esdHTKTprepaymentVendor");
                    var numberStatus = String(numberRc.getText()).replace(/^\s+|\s+$/g, "");
                    var rawNumber = String(nextNumber.getText()).replace(/^\s+|\s+$/g, "");
                    if (/^"[^\"]*"$/.test(rawNumber) || /^'[^']*'$/.test(rawNumber)) {
                        rawNumber = rawNumber.substring(1, rawNumber.length - 1);
                    }
                    if (numberStatus !== "0" || !/^\d+$/.test(rawNumber)) {
                        throw new Error("Không cấp được mã dòng NCC cho PO " + currentPoId + ".");
                    }

                    prepaymentVendorFile = new SCFile("esdHTKTprepaymentVendor");
                    prepaymentVendorFile["id"] = ("000000000000000" + Number(rawNumber)).slice(-15);
                    prepaymentVendorFile["prepayment.id"] = prepaymentId;
                    prepaymentVendorFile["vendor.id"] = resolvedVendorId;
                    prepaymentVendorFile["po.id"] = currentPoId;
                    prepaymentVendorFile["vendor.site.id"] = "";
                    prepaymentVendorFile["currency"] = String(contractSupplierFile["currency"] || "VND");
                    prepaymentVendorFile["payment.method"] = String(contractSupplierFile["payment.method"] || "CHUYENKHOAN");
                    if (sameVendorInfo) {
                        for (var sameField in sameVendorInfo) {
                            if (Object.prototype.hasOwnProperty.call(sameVendorInfo, sameField)) {
                                prepaymentVendorFile[sameField] = sameVendorInfo[sameField];
                            }
                        }
                    }

                    var addLinkRc = prepaymentVendorFile.doAction("add");
                    if (addLinkRc !== RC_SUCCESS && addLinkRc !== true) {
                        throw new Error("Không tạo được dòng NCC " + supplierId + " cho PO " + currentPoId + ".");
                    }
                    addedCount++;
                } catch (eSupplier) {
                    errors.push(String(eSupplier.message || eSupplier));
                } finally {
                    try { if (supplierFile) supplierFile.doClose(); } catch (eCloseSupplier) { }
                    try { if (vendorFile) vendorFile.doClose(); } catch (eCloseVendor) { }
                    try { if (prepaymentVendorFile) prepaymentVendorFile.doClose(); } catch (eClosePrepaymentVendor) { }
                }

                supplierRc = contractSupplierFile.getNext();
            }
        } catch (ePo) {
            errors.push(String(ePo.message || ePo));
        } finally {
            try { if (poFile) poFile.doClose(); } catch (eClosePo) { }
            try { if (contractSupplierFile) contractSupplierFile.doClose(); } catch (eCloseContractSupplier) { }
        }
    }

    return {
        success: errors.length === 0,
        addedCount: addedCount,
        skippedCount: skippedCount,
        message: errors.length > 0 ? errors.join("; ") : "Đã thêm PO và nhà cung cấp vào phiếu tạm ứng.",
        errors: errors
    };
}


/* Trường hạch toán dùng chung giữa các dòng PO của cùng NCC trên một phiếu tạm ứng. */
var PREPAYMENT_VENDOR_SHARED_ACCOUNTING_FIELDS = [
    "vendor.site.id", "payment.method", "beneficiary.account", "beneficiary.name",
    "beneficiary.bank", "bank.branch.code", "transaction.des", "ogl.sync.status"
];

/**
 * Lấy thông tin hạch toán của dòng NCC đã có trên phiếu (PO khác) để chép sang dòng PO mới.
 * Chỉ trả các trường có giá trị; null nếu NCC chưa có trên phiếu.
 */
function getSamePrepaymentVendorAccountingInfo(prepaymentId, vendorId) {
    var file = null;
    try {
        file = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
        var rc = file.doSelect('prepayment.id="' + escapePrepaymentVendorQueryValue(prepaymentId) +
            '" and vendor.id="' + escapePrepaymentVendorQueryValue(vendorId) + '"');
        var best = null;
        var bestScore = -1;
        while (rc === RC_SUCCESS) {
            var info = {};
            var score = 0;
            for (var i = 0; i < PREPAYMENT_VENDOR_SHARED_ACCOUNTING_FIELDS.length; i++) {
                var name = PREPAYMENT_VENDOR_SHARED_ACCOUNTING_FIELDS[i];
                var value = file[name];
                if (value === null || value === undefined || String(value) === "") continue;
                info[name] = value;
                score++;
            }
            // Ưu tiên dòng đã điền đủ nhất (thường là dòng KTTC đã cập nhật Site/TK).
            if (score > bestScore) {
                best = info;
                bestScore = score;
            }
            rc = file.getNext();
        }
        return bestScore > 0 ? best : null;
    } finally {
        try { if (file) file.doClose(); } catch (eCloseSame) { }
    }
}

function getListPrepaymentVendor(input) {
    var invoiceList = [];
    var prepaymentId = "";

    try {
        if (input.details) {
            var queryObj = JSON.parse(input.details);
            prepaymentId = queryObj.prepaymentId || "";
        } else if (input.queryString) {
            var queryObjOld = JSON.parse(input.queryString);
            prepaymentId = queryObjOld.prepaymentId || "";
        }
    } catch (ex) {
        return invoiceList;
    }

    if (!prepaymentId) return invoiceList;

    var fieldMappings = [
        ['v.id', 'vendorId', 'S'],
        ['pv.id', 'id', 'S'],
        ['pv.prepayment.id', 'prepayment_id', 'S'],
        ['pv.po.id', 'po_id', 'S'],
        ['p.contract.id', 'contract_id', 'S'],
        ['pv.vendor.id', 'vendor_id', 'S'],
        ['v.vendor.name', 'vendor_name', 'S'],
        ['v.vendor.number', 'vendor_number', 'S'],
        ['pv.amount', 'amount', 'S'],
        ['pv.currency', 'currency', 'S'],
        ['pv.payment.method', 'payment_method', 'S'],
        ['v.supplier.id', 'supplier_id', 'S'],
        ['pv.ogl.sync.status', 'ogl_sync_status', 'S'],
        ['v.ogl.vendor.id', 'ogl_vendor_id', 'S']
    ];

    var sqlFields = fieldMappings.map(function (item) { return item[0]; });
    var select = " SELECT " + sqlFields.join(", ");
    var mapping = ' FROM esdHTKTprepaymentVendor pv ' +
        ' JOIN esdHTKTprepayment p ON (pv.prepayment.id = p.id) ' +
        ' JOIN esdHTKTvendor v ON (pv.vendor.id = v.id) ' +
        ' LEFT JOIN esdHTKTvendorSite vs ON (pv.vendor.site.id = vs.id) ';
    var control = ' WHERE p.id = "' + prepaymentId + '"';

    var f = new SCFile('esdHTKTprepaymentVendor', SCFILE_READONLY);
    var rc = f.doSelect(select + mapping + control);

    while (rc == RC_SUCCESS) {
        var item = mapRowToObject(f, fieldMappings);

        var vendorId = item.vendorId || "";
        var countInvoiceId = 0;

        if (vendorId) {

            var countFile = new SCFile('esdHTKTinvoice', SCFILE_READONLY);

            var countSelect = "SELECT count(*)";
            var countMapping = " FROM esdHTKTinvoice i LEFT JOIN esdHTKTvendor v ON (i.seller.tax.code = v.vendor.number) ";
            var countControl = ' WHERE i.request.id = "' + prepaymentId + '" AND v.id = "' + vendorId + '"';

            var countSql = countSelect + countMapping + countControl;

            if (countFile.doSelect(countSql) == RC_SUCCESS) {
                countInvoiceId = countFile[0] || 0;
            }
        }
        item.count = countInvoiceId;
        invoiceList.push(item);

        rc = f.getNext();
    }

    try { if (f) f.doClose(); } catch (e) { }

    return invoiceList;
}


/**
 * Dòng NCC + PO nhận hóa đơn. Tab hóa đơn mở từ dòng esdHTKTprepaymentVendor nên gửi id dòng;
 * client cũ chỉ gửi vendorId thì lấy dòng đầu tiên của NCC (đúng khi NCC chỉ có một PO).
 * Trả { id, poId, vendorPoCount } hoặc null nếu không tìm thấy.
 */
function resolvePrepaymentVendorRowForInvoice(prepaymentId, vendorId, prepaymentVendorId) {
    var file = null;
    var row = null;
    var count = 0;
    try {
        file = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
        var rc = file.doSelect('prepayment.id="' + escapePrepaymentVendorQueryValue(prepaymentId) +
            '" and vendor.id="' + escapePrepaymentVendorQueryValue(vendorId) + '"');
        while (rc === RC_SUCCESS) {
            count++;
            var currentId = String(file["id"] || "");
            if (!row && (!prepaymentVendorId || currentId === String(prepaymentVendorId))) {
                row = { id: currentId, poId: String(file["po.id"] || "").replace(/^\s+|\s+$/g, "") };
            }
            rc = file.getNext();
        }
    } finally {
        try { if (file) file.doClose(); } catch (eCloseRow) { }
    }
    if (!row) return null;
    row.vendorPoCount = count;
    return row;
}

/**
 * Hóa đơn đi theo PO: liên kết esdHTKTprepaymentInvoice có po.id của dòng NCC + PO.
 * Liên kết cũ chưa có po.id chỉ thuộc dòng khi NCC có đúng một PO trên phiếu.
 */
function isPrepaymentInvoiceLinkForPo(linkPoId, poId, vendorPoCount) {
    var linkPo = String(linkPoId || "").replace(/^\s+|\s+$/g, "");
    if (linkPo) return linkPo === String(poId || "");
    return vendorPoCount <= 1;
}

/** Đọc lại liên kết vừa lưu để chắc po.id đã được ghi xuống DB. */
function isPrepaymentInvoiceLinkSavedWithPo(prepaymentId, invoiceId, poId) {
    var file = null;
    try {
        file = new SCFile("esdHTKTprepaymentInvoice", SCFILE_READONLY);
        if (file.doSelect('prepayment.id="' + escapePrepaymentVendorQueryValue(prepaymentId) +
            '" and invoice.id="' + escapePrepaymentVendorQueryValue(invoiceId) + '"') !== RC_SUCCESS) return false;
        return String(file["po.id"] || "") === String(poId);
    } finally {
        try { if (file) file.doClose(); } catch (eCloseSaved) { }
    }
}

/** Tập invoice.id đã gán cho dòng NCC + PO (key '$' + invoice.id). */
function getPrepaymentInvoiceIdsForPo(prepaymentId, poId, vendorPoCount) {
    var ids = {};
    var file = null;
    try {
        file = new SCFile("esdHTKTprepaymentInvoice", SCFILE_READONLY);
        var rc = file.doSelect('prepayment.id="' + escapePrepaymentVendorQueryValue(prepaymentId) + '"');
        while (rc === RC_SUCCESS) {
            if (isPrepaymentInvoiceLinkForPo(file["po.id"], poId, vendorPoCount)) {
                ids["$" + String(file["invoice.id"] || "")] = true;
            }
            rc = file.getNext();
        }
    } finally {
        try { if (file) file.doClose(); } catch (eCloseLinks) { }
    }
    return ids;
}
/**
 * Tính động số tiền còn lại của PO:
 * Giá trị PO sau thuế (esdHDcontract) - (Tổng đã TT + Tổng đã TU trong esdHTKTreportVendorDebt)
 */
function calculatePoRemainingAmount(poId) {
    var cleanPoId = String(poId || "").replace(/^\s+|\s+$/g, "");
    if (!cleanPoId) return "0";

    var originalPoValue = "0";
    var poFile = new SCFile("esdHDcontract", SCFILE_READONLY);
    try {
        if (poFile.doSelect('id="' + escapePrepaymentVendorQueryValue(cleanPoId) + '"') === RC_SUCCESS) {
            originalPoValue = String(poFile["contract.value.after.tax"] || "0").replace(/,/g, "").trim();
            if (originalPoValue === "") originalPoValue = "0";
        }
    } finally {
        try { poFile.doClose(); } catch (e) { }
    }

    var totalPaidAmt = "0";
    var totalAdvanceAmt = "0";
    var debtFile = new SCFile("esdHTKTreportVendorDebt", SCFILE_READONLY);
    try {
        var debtQuery = 'contract.id="' + escapePrepaymentVendorQueryValue(cleanPoId) + '"';
        if (debtFile.doSelect(debtQuery) === RC_SUCCESS) {
            totalPaidAmt = String(debtFile["total.paid.amount"] || "0").replace(/,/g, "").trim();
            totalAdvanceAmt = String(debtFile["total.advance.amount"] || "0").replace(/,/g, "").trim();
            if (totalPaidAmt === "") totalPaidAmt = "0";
            if (totalAdvanceAmt === "") totalAdvanceAmt = "0";
        }
    } finally {
        try { debtFile.doClose(); } catch (e) { }
    }

    try {
        var totalUsedAmt = lib.ESD_HTKT_Utils.addStringsManual(totalPaidAmt, totalAdvanceAmt);
        if (lib.ESD_HTKT_Utils.compareMoneyStrings(originalPoValue, totalUsedAmt) <= 0) {
            return "0";
        }
        return lib.ESD_HTKT_Utils.subtractStringsManual(originalPoValue, totalUsedAmt);
    } catch (mathErr) {
        var fOriginal = parseFloat(originalPoValue) || 0;
        var fPaid = parseFloat(totalPaidAmt) || 0;
        var fAdvance = parseFloat(totalAdvanceAmt) || 0;
        var fRem = fOriginal - fPaid - fAdvance;
        return fRem > 0 ? fRem.toString() : "0";
    }
}

function getPrepaymentRemainingAmount(prepaymentId, vendorId, poId) {
    var resultList = [];

    if (!prepaymentId) {
        return resultList;
    }

    // TU XDCB: lấy số dư đúng NCC và HS; giữ cấu trúc dữ liệu hóa đơn TU đang dùng.
    if (lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb({ "prepayment.id": prepaymentId })) {
        var rows = lib.ESD_HTKT_PAYMENT_VENDOR.getPaymentXdcbRemainingAmounts(prepaymentId);
        return vendorId ? rows.filter(function (row) {
            return String(row.vendor_id) === String(vendorId);
        }) : rows;
    }

    var cleanPoId = String(poId || "").replace(/^\s+|\s+$/g, "");
    var joinContractIdField = (cleanPoId !== "") ? "hpv.po.id" : "hp.contract.id";

    var fieldMappings = [
        ['hpv.id', 'prepayment_vendor_id', 'S'],
        ['hpv.po.id', 'po_id', 'S'],
        ['hdVendor.supplier.id', 'supplier_id', 'S'],
        ['hdVendor.supplier.name', 'supplier_name', 'S'],
        ['hpv.payment.method', 'payment_method', 'S'],
        ['hpv.amount', 'amount', 'S'],
        ['hdVendor.unpaid.amount', 'remaining_amount', 'S'],
        ['hv.vendor.number', 'tax_code', 'S'],
        ['hv.ogl.sync.status', 'ogl_sync_status', 'S'],
        ['hvs.ogl.site.code', 'ogl_site_code', 'S'],
        ['hvs.ogl.sync.status', 'hvs_ogl_sync_status', 'S'],
        ['hpv.vendor.site.id', 'vendor_site_id', 'S'],
        ['hpv.currency', 'currency', 'S'],
        ['hp.unit.lv1', 'unit_lv1', 'S'],
        ['hp.unit.lv2', 'unit_lv2', 'S'],
        ['hp.current.phase', 'current_phase', 'S'],
        ['hp.created.by', 'created_by', 'S'],
        ['hp.initial.role', 'initial_role', 'S'],
        ['hp.user.checker.kttc', 'user_checker_kttc', 'S']
    ];

    var sqlSelect = "SELECT " + fieldMappings.map(function (item) { return item[0]; }).join(", ");

    var sqlFrom = ' FROM esdHTKTprepaymentVendor hpv' +
        ' LEFT JOIN esdHTKTvendor hv ON (hpv.vendor.id = hv.id)' +
        ' LEFT JOIN esdHTKTprepayment hp ON (hpv.prepayment.id = hp.id)' +
        ' LEFT JOIN esdHTKTvendorSite hvs ON (hvs.id = hpv.vendor.site.id)' +
        ' LEFT JOIN esdHDcontractSupplier hdVendor ON (' + joinContractIdField + ' = hdVendor.contract.id AND hv.supplier.id = hdVendor.supplier.id)';

    var sqlWhere = ' WHERE hp.id = "' + escapePrepaymentVendorQueryValue(prepaymentId) + '"';
    if (vendorId) {
        sqlWhere += ' AND hpv.vendor.id = "' + escapePrepaymentVendorQueryValue(vendorId) + '"';
    }
    if (cleanPoId !== "") {
        sqlWhere += ' AND hpv.po.id = "' + escapePrepaymentVendorQueryValue(cleanPoId) + '"';
    }

    var itemQuery = sqlSelect + sqlFrom + sqlWhere;
    var f = new SCFile('esdHTKTprepaymentVendor', SCFILE_READONLY);

    try {
        var rc = f.doSelect(itemQuery);

        while (rc == RC_SUCCESS) {
            var item = mapRowToObject(f, fieldMappings);
            var rowPoId = String(item.po_id || "").replace(/^\s+|\s+$/g, "");

            // Nếu dòng gắn PO -> tính động số tiền còn lại theo PO
            if (rowPoId !== "") {
                item.remaining_amount = calculatePoRemainingAmount(rowPoId);
            }

            resultList.push(item);
            rc = f.getNext();
        }
    } catch (e) {
        print("[ERROR getPrepaymentRemainingAmount] Lỗi doSelect: " + e);
    } finally {
        try { if (f) f.doClose(); } catch (e) { }
    }

    return resultList;
}
//

function getListInvoinVendor(input) {
    var invoiceList = [];
    var prepaymentId = "";
    var vendorId = "";

    var tempObj = {};

    try {
        if (input.details) {
            tempObj = JSON.parse(input.details);
        } else if (input.queryString) {
            tempObj = JSON.parse(input.queryString);
        }

        prepaymentId = tempObj.prepaymentId || "";
        vendorId = tempObj.vendorId || "";

    } catch (ex) {
        print("[DEBUG run] Error parsing JSON: " + ex);
        return invoiceList;
    }

    if (!prepaymentId) return invoiceList;

    var fieldMappings = [
        ['i.id', 'id', 'S'], // Số hoá đơn
        ['i.invoice.number', 'invoice_number', 'S'], // Số hoá đơn
        ['i.invoice.serial', 'invoice_serial', 'S'], // Ký hiệu (hoặc dùng 'invoice_pattern')
        ['i.invoice.type', 'invoice_type', 'S'], // Phân loại HĐ
        ['i.process.type', 'process_type', 'S'], // Tính chất HĐ
        ['i.seller.tax.code', 'seller_tax_code', 'S'], // Mã số thuế người bán (Nhà cung cấp)
        ['i.seller.name', 'seller_name', 'S'], // Tên Nhà cung cấp
        ['i.total.tax', 'total_tax', 'N'], // Tiền thuế VAT (Kiểu số 'N' hoặc 'S')
        ['i.grand.total', 'grand_total', 'N'], // Tổng tiền sau thuế (Kiểu số 'N' hoặc dùng 'S' nếu hệ thống đích nhận chuỗi)
        ['i.currency', 'currency', 'S'], // Loại tiền (VNĐ, USD...)
        ['i.invoice.date', 'invoice_date', 'D'], // Ngày hoá đơn (Kiểu Date 'D')
        ['i.check.status.detail', 'check_status_detail', 'S'], // Chi tiết trạng thái kiểm tra
        ['i.last.check.date', 'lastCheckDate', 'S'],
        ['i.request.id', 'request_id', 'S'],
        ['i.parent.invoice.number', 'parentInvoiceNumber', 'S']
    ];

    var sqlFields = [];
    for (var i = 0; i < fieldMappings.length; i++) {
        sqlFields.push(fieldMappings[i][0]);
    }

    var select = " SELECT " + sqlFields.join(", ");
    var mapping = ' FROM esdHTKTinvoice i ' +
        'JOIN esdHTKTvendor v ON (i.seller.tax.code = v.vendor.number) ';

    var control = ' WHERE v.id = "' + vendorId + '" AND (i.check.status <> "CHECKING")';
    var querySQL = select + mapping + control;


    var f = new SCFile('esdHTKTinvoice', SCFILE_READONLY);
    var rc = f.doSelect(querySQL);
    while (rc == RC_SUCCESS) {

        var currentRequestId = f["request.id"];

        if (currentRequestId == null || currentRequestId == "") {
            var item = mapRowToObject(f, fieldMappings);

            var parentInvNumber = f["parent.invoice.number"];
            if (parentInvNumber == null || parentInvNumber == "") {
                item.process_type = "Hóa đơn gốc";
            } else {
                item.process_type = "Hóa đơn thay thế";
            }

            item.dateChecker = checkInvoiceStatus(f["last.check.date"]);
            invoiceList.push(item);
        }
        rc = f.getNext();
    }

    try { if (f) f.doClose(); } catch (e) { }

    return invoiceList;
}


function getInvoicesBySupplier(input) {
    var invoiceList = [];
    var prepaymentId = "";
    var vendorId = "";

    var tempObj = {};

    try {
        if (input.details) {
            tempObj = JSON.parse(input.details);
        } else if (input.queryString) {
            tempObj = JSON.parse(input.queryString);
        }

        prepaymentId = tempObj.prepaymentId || "";
        vendorId = tempObj.vendorId || "";
        var prepaymentVendorId = tempObj.prepaymentVendorId || "";

    } catch (ex) {
        print("[DEBUG run] Error parsing JSON: " + ex);
        return invoiceList;
    }

    if (!prepaymentId) return invoiceList;

    // Hóa đơn đi theo PO: chỉ trả hóa đơn đã gán cho đúng dòng NCC + PO đang mở.
    var poRow = resolvePrepaymentVendorRowForInvoice(prepaymentId, vendorId, prepaymentVendorId);
    var poInvoiceIds = poRow ? getPrepaymentInvoiceIdsForPo(prepaymentId, poRow.poId, poRow.vendorPoCount) : null;

    var fieldMappings = [
        ['i.id', 'id', 'S'], // Số hoá đơn
        ['i.invoice.number', 'invoiceNumber', 'S'], // Số hoá đơn
        ['i.seller.tax.code', 'sellerTaxCode', 'S'], // Mã số thuế người bán (Nhà cung cấp)
        ['i.invoice.type', 'invoiceType', 'S'], // Phân loại HĐ
        ['i.invoice.date', 'invoiceDate', 'D'], // Ngày hoá đơn (Kiểu Date 'D')
        ['i.check.status.detail', 'checkStatusDetail', 'S'], // Chi tiết trạng thái kiểm tra
        ['i.total.tax', 'totalTax', 'N'], // Tiền thuế VAT (Kiểu số 'N' hoặc 'S')
        ['i.grand.total', 'grandTotal', 'N'], // Tổng tiền sau thuế (Kiểu số 'N' hoặc dùng 'S' nếu hệ thống đích nhận chuỗi)
        ['i.currency', 'currency', 'S'], // Loại tiền (VNĐ, USD...)
        ['i.last.check.date', 'lastCheckDate', 'S'],
        ['i.request.id', 'requestId', 'S']
    ];

    var sqlFields = [];
    for (var i = 0; i < fieldMappings.length; i++) {
        sqlFields.push(fieldMappings[i][0]);
    }


    var select = " SELECT " + sqlFields.join(", ");
    var mapping = ' FROM esdHTKTinvoice i ' +
        'JOIN esdHTKTvendor v ON (i.seller.tax.code = v.vendor.number) ';

    var control = ' WHERE i.request.id = "' + prepaymentId + '" AND v.id = "' + vendorId + '"';
    var querySQL = select + mapping + control;

    var f = new SCFile('esdHTKTinvoice', SCFILE_READONLY);
    var rc = f.doSelect(querySQL);
    while (rc == RC_SUCCESS) {

        var item = mapRowToObject(f, fieldMappings);

        if (!poInvoiceIds || poInvoiceIds["$" + item.id]) {
            item.dateChecker = checkInvoiceStatus(f["last.check.date"]);
            invoiceList.push(item);
        }

        rc = f.getNext();
    }

    try { if (f) f.doClose(); } catch (e) { }

    return invoiceList;
}


function shouldCheckPrepaymentInvoice(lastCheckDate) {
    if (!lastCheckDate) return true;

    try {
        var checkDate = lastCheckDate instanceof Date ?
            lastCheckDate :
            new Date(lastCheckDate);
        var checkTime = checkDate.getTime();
        if (isNaN(checkTime)) return true;

        var twoDaysInMilliseconds = 2 * 24 * 60 * 60 * 1000;
        return new Date().getTime() - checkTime > twoDaysInMilliseconds;
    } catch (e) {
        return true;
    }
}

function createListInvoinVendor(input) {
    var rawDetails = "";

    // 1. Phân tích dữ liệu đầu vào (Input Parsing)
    if (input.esdHTKTlistPrepaymentVendor && input.esdHTKTlistPrepaymentVendor.details) {
        rawDetails = input.esdHTKTlistPrepaymentVendor.details;
    } else if (input.details) {
        rawDetails = input.details;
    } else if (input.queryString) {
        try {
            var parsedQuery = JSON.parse(input.queryString);
            if (parsedQuery.esdHTKTlistPrepaymentVendor && parsedQuery.esdHTKTlistPrepaymentVendor.details) {
                rawDetails = parsedQuery.esdHTKTlistPrepaymentVendor.details;
            } else {
                rawDetails = parsedQuery.details || input.queryString;
            }
        } catch (e) {
            rawDetails = input.queryString;
        }
    }

    if (!rawDetails) {
        return {
            success: false,
            message: "Thiếu dữ liệu chi tiết hóa đơn",
            checkStatus: []
        };
    }

    try {
        var parsedData = JSON.parse(rawDetails);

        var dataObj = [];

        if (parsedData.updatedSelectedRows && Array.isArray(parsedData.updatedSelectedRows)) {
            dataObj = parsedData.updatedSelectedRows;
        } else if (Array.isArray(parsedData)) {
            dataObj = parsedData;
        } else {
            return {
                success: false,
                message: "Dữ liệu không đúng định dạng",
                checkStatus: []
            };
        }

        if (dataObj.length === 0) {
            return {
                success: false,
                message: "Danh sách hóa đơn trống",
                checkStatus: []
            };
        }

        // =========================================================================
        // 2. KIỂM TRA TỒN TẠI VÀ TỔNG GRANDTOTAL TÍCH LŨY (CŨ + MỚI) (FAIL-FAST)
        // =========================================================================
        var totalGrandTotal = "0";
        var prepaymentId = dataObj[0]['transactionId'] || "";
        var vendorId = dataObj[0]['vendorId'] || "";

        if (prepaymentId === "" || vendorId === "") {
            return {
                success: false,
                message: "Thiếu thông tin mã giao dịch (transactionId) hoặc mã nhà cung cấp (vendorId).",
                checkStatus: []
            };
        }

        // Bước 2.1: Xác định dòng NCC + PO nhận hóa đơn (hóa đơn đi theo PO).
        var invoicePoRow = resolvePrepaymentVendorRowForInvoice(
            prepaymentId, vendorId, dataObj[0]['prepaymentVendorId'] || ""
        );

        if (!invoicePoRow) {
            return {
                success: false,
                message: "Không tìm thấy thông tin khoản tạm ứng của nhà cung cấp trong hệ thống. Thao tác đã bị hủy.",
                checkStatus: []
            };
        }
        // NCC có nhiều PO mà client không gửi dòng PO: không đoán PO cho hóa đơn.
        if (invoicePoRow.vendorPoCount > 1 && !dataObj[0]['prepaymentVendorId']) {
            return {
                success: false,
                message: "Nhà cung cấp có nhiều PO trên đề nghị; vui lòng mở đúng dòng PO để gán hóa đơn.",
                checkStatus: []
            };
        }
        var invoicePoInvoiceIds = getPrepaymentInvoiceIdsForPo(
            prepaymentId, invoicePoRow.poId, invoicePoRow.vendorPoCount
        );
        print("test 123")

        // Bước 2.2: Tính tổng grandTotal của tất cả hóa đơn MỚI được chọn
        for (var k = 0; k < dataObj.length; k++) {
            var gTotal = String(dataObj[k]['grandTotal'] || "0");
            totalGrandTotal = lib.ESD_HTKT_Utils.addStringsManual(totalGrandTotal, gTotal);
        }

        // Bước 2.3: Lấy tổng tiền của các hóa đơn CŨ đã liên kết
        var sumExistingGrandTotal = "0";
        var existingInvoiceFile = new SCFile("esdHTKTinvoice", SCFILE_READONLY);
        var mappingExist = " FROM esdHTKTinvoice i JOIN esdHTKTvendor v ON (i.seller.tax.code = v.vendor.number) ";
        var controlExist = " WHERE i.request.id = \"" + prepaymentId + "\" AND v.id = \"" + vendorId + "\"";
        var queryExistingSQL = "SELECT i.id, i.grand.total " + mappingExist + controlExist;

        var rcExisting = existingInvoiceFile.doSelect(queryExistingSQL);
        while (rcExisting === RC_SUCCESS) {
            // Chỉ cộng hóa đơn đã gán cho cùng PO.
            if (invoicePoInvoiceIds["$" + String(existingInvoiceFile["id"] || existingInvoiceFile[0] || "")]) {
                var existAmt = String(existingInvoiceFile["grand.total"] || existingInvoiceFile["grandTotal"] || "0");
                sumExistingGrandTotal = lib.ESD_HTKT_Utils.addStringsManual(sumExistingGrandTotal, existAmt);
            }
            rcExisting = existingInvoiceFile.getNext();
        }

        // Bước 2.4: Tổng tiền Tích lũy (Cũ + Mới)
        var totalAccumulatedGrandTotal = lib.ESD_HTKT_Utils.addStringsManual(sumExistingGrandTotal, totalGrandTotal);

        if (lib.ESD_HTKT_Utils.compareMoneyStrings(totalAccumulatedGrandTotal, "0") <= 0) {
            return {
                success: false,
                message: "Tổng số tiền các hoá đơn sau khi tích lũy phải lớn hơn 0 để gắn vào nhà cung cấp. Thao tác đã bị hủy.",
                checkStatus: []
            };
        }

        // Bước 2.4.1: Kiểm tra tổng tiền hóa đơn <= giá trị bảo lãnh
        var contractId = "";
        var parentPrepCheck = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
        try {
            if (parentPrepCheck.doSelect('id="' + escapePrepaymentVendorQueryValue(prepaymentId) + '"') == RC_SUCCESS) {
                contractId = String(parentPrepCheck["contract.id"] || "").trim();
            }
        } finally {
            try { parentPrepCheck.doClose(); } catch (e) { }
        }

        var currentPoId = String(invoicePoRow.poId || "").replace(/^\s+|\s+$/g, "");

        if (contractId) {
            var guaranteeAmountStr = null;
            var isCheckByPoGuarantee = false;

            // XDCB đọc bảo lãnh của HĐ S4; HHDV ưu tiên bảo lãnh theo PO (nếu có), ngược lại theo HĐ gốc.
            if (lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb({ "prepayment.id": prepaymentId })) {
                var xdcbGuarantee = getPrepaymentGuaranteeInfo(contractId);
                guaranteeAmountStr = xdcbGuarantee ? xdcbGuarantee.value : null;
            } else {
                var docInfoFile = new SCFile("esdHDcontractDocInfo", SCFILE_READONLY);
                try {
                    if (currentPoId !== "") {
                        var poDocQuery = 'contract.id="' + escapePrepaymentVendorQueryValue(currentPoId) + '" and doc.type="BAOLANHTU" and status="Co hieu luc"';
                        if (docInfoFile.doSelect(poDocQuery) == RC_SUCCESS) {
                            guaranteeAmountStr = docInfoFile["guarantee.amount"];
                            isCheckByPoGuarantee = true;
                        }
                    }
                    if (!guaranteeAmountStr) {
                        var docQuery = 'contract.id="' + escapePrepaymentVendorQueryValue(contractId) + '" and doc.type="BAOLANHTU" and status="Co hieu luc"';
                        if (docInfoFile.doSelect(docQuery) == RC_SUCCESS) {
                            guaranteeAmountStr = docInfoFile["guarantee.amount"];
                        }
                    }
                } finally {
                    try { docInfoFile.doClose(); } catch (e) { }
                }
            }

            var cleanGuaranteeStr = String(guaranteeAmountStr || "").replace(/,/g, "").trim();

            if (cleanGuaranteeStr !== "" && cleanGuaranteeStr !== "null" && lib.ESD_HTKT_Utils.compareMoneyStrings(cleanGuaranteeStr, "0") === 1) {
                var totalAccountedAmountStr = "0";
                var otherRowsCurrentPrepStr = "0";

                // Cộng các dòng PO / NCC khác trên CÙNG phiếu tạm ứng hiện tại (trừ dòng invoicePoRow.id đang sửa)
                var otherVendorFile = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
                try {
                    var otherVendorQuery = 'prepayment.id="' + escapePrepaymentVendorQueryValue(prepaymentId) + '"';
                    if (isCheckByPoGuarantee && currentPoId !== "") {
                        otherVendorQuery += ' and po.id="' + escapePrepaymentVendorQueryValue(currentPoId) + '"';
                    }
                    var rcOther = otherVendorFile.doSelect(otherVendorQuery);
                    while (rcOther === RC_SUCCESS) {
                        if (String(otherVendorFile["id"] || "") !== String(invoicePoRow.id || "")) {
                            var otherAmt = String(otherVendorFile["amount"] || "0").replace(/,/g, "").trim();
                            if (otherAmt !== "" && otherAmt !== "0") {
                                otherRowsCurrentPrepStr = lib.ESD_HTKT_Utils.addStringsManual(otherRowsCurrentPrepStr, otherAmt);
                            }
                        }
                        rcOther = otherVendorFile.getNext();
                    }
                } finally {
                    try { otherVendorFile.doClose(); } catch (e) { }
                }

                if (isCheckByPoGuarantee && currentPoId !== "") {
                    // Bảo lãnh gắn trực tiếp theo PO -> cộng các khoản đã duyệt/hạch toán của riêng PO này ở các phiếu khác
                    var poPrepFile = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
                    try {
                        var poPrepQuery =
                            'select pv.amount as amount ' +
                            'from esdHTKTprepaymentVendor pv ' +
                            'join esdHTKTprepayment p on (pv.prepayment.id = p.id) ' +
                            'where pv.po.id="' + escapePrepaymentVendorQueryValue(currentPoId) + '" ' +
                            'and (p.status="approved" or p.status="accounted") ' +
                            'and p.id ~= "' + escapePrepaymentVendorQueryValue(prepaymentId) + '"';
                        var rcPoPrep = poPrepFile.doSelect(poPrepQuery);
                        while (rcPoPrep == RC_SUCCESS) {
                            var poAccountedAmtStr = String(poPrepFile["amount"] || "0").replace(/,/g, "").trim();
                            if (poAccountedAmtStr !== "") {
                                totalAccountedAmountStr = lib.ESD_HTKT_Utils.addStringsManual(totalAccountedAmountStr, poAccountedAmtStr);
                            }
                            rcPoPrep = poPrepFile.getNext();
                        }
                    } finally {
                        try { poPrepFile.doClose(); } catch (e) { }
                    }
                } else {
                    // Bảo lãnh gắn theo HĐ gốc -> cộng các phiếu đã duyệt/hạch toán của HĐ gốc (loại trừ phiếu hiện tại)
                    var prepFile = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
                    try {
                        var query = 'contract.id="' + escapePrepaymentVendorQueryValue(contractId) + '" and (status="approved" or status="accounted")';
                        var rcPrep = prepFile.doSelect(query);

                        while (rcPrep == RC_SUCCESS) {
                            if (prepFile["id"] !== prepaymentId) {
                                var accountedAmtStr = String(prepFile["amount"] || "0").replace(/,/g, "").trim();
                                if (accountedAmtStr !== "") {
                                    totalAccountedAmountStr = lib.ESD_HTKT_Utils.addStringsManual(totalAccountedAmountStr, accountedAmtStr);
                                }
                            }
                            rcPrep = prepFile.getNext();
                        }
                    } finally {
                        try { prepFile.doClose(); } catch (e) { }
                    }
                }

                // Tổng dự kiến = Các phiếu đã duyệt/hạch toán + Các dòng khác trong phiếu này + Tổng hóa đơn tích lũy của dòng đang gắn
                var projectedCurrentPrepTotal = lib.ESD_HTKT_Utils.addStringsManual(otherRowsCurrentPrepStr, totalAccumulatedGrandTotal);
                var totalAmountStr = lib.ESD_HTKT_Utils.addStringsManual(totalAccountedAmountStr, projectedCurrentPrepTotal);

                if (lib.ESD_HTKT_Utils.compareMoneyStrings(totalAmountStr, cleanGuaranteeStr) === 1) {
                    return {
                        success: false,
                        message: "Tổng số tiền tạm ứng hiện tại vượt quá Giá trị bảo lãnh. Thao tác đã bị hủy.",
                        checkStatus: []
                    };
                }
            }
        }

        // =========================================================================
        // Bước 2.5: Kiểm tra vượt quá số tiền còn lại của khoản tạm ứng (PO hoặc HĐ)
        // =========================================================================
        var remainingData = getPrepaymentRemainingAmount(prepaymentId, vendorId, currentPoId);
        var totalRemainingAmount = "0";

        if (Array.isArray(remainingData) && remainingData.length > 0) {
            for (var m = 0; m < remainingData.length; m++) {
                var rowId = String(remainingData[m].prepayment_vendor_id || remainingData[m].id || "");
                // Chỉ lấy đúng dòng NCC + PO đang gắn hóa đơn, không cộng dồn sang dòng PO khác
                if (invoicePoRow.id && rowId !== "" && rowId !== String(invoicePoRow.id)) continue;

                var rAmt = String(remainingData[m].remaining_amount || "0").replace(/,/g, "").trim();
                if (rAmt !== "") {
                    totalRemainingAmount = lib.ESD_HTKT_Utils.addStringsManual(totalRemainingAmount, rAmt);
                }
            }
        } else if (typeof remainingData === "object" && remainingData !== null && !Array.isArray(remainingData)) {
            totalRemainingAmount = String(remainingData.remaining_amount || remainingData.remainingAmount || "0").replace(/,/g, "").trim() || "0";
        }

        if (lib.ESD_HTKT_Utils.compareMoneyStrings(totalAccumulatedGrandTotal, totalRemainingAmount) > 0) {
            return {
                success: false,
                message: "Tổng tiền các hóa đơn sau khi tích lũy vượt quá số tiền còn lại của khoản tạm ứng. Thao tác đã bị hủy.",
                checkStatus: []
            };
        }

        // =========================================================================
        // 3. PHA 1: KIỂM TRA DB & GỌI API CHECK HÓA ĐƠN (CHƯA GHI VÀO DB)
        // =========================================================================
        var validInvoicesToSave = [];
        var failedInvoiceDetails = [];
        print("start");

        for (var i = 0; i < dataObj.length; i++) {
            var feeData = dataObj[i];
            var invoiceId = feeData['id'] || "";
            var invoiceNumber = feeData['invoiceNumber'] || feeData['id'] || "";

            if (!invoiceId) {
                failedInvoiceDetails.push("Dữ liệu thiếu mã hóa đơn");
                continue;
            }

            // 1. Kiểm tra hóa đơn tồn tại trong DB
            var invFile = new SCFile("esdHTKTinvoice");
            var rcInv = invFile.doSelect('id="' + escapePrepaymentVendorQueryValue(invoiceId) + '"');

            if (rcInv !== RC_SUCCESS) {
                failedInvoiceDetails.push("Hóa đơn " + invoiceNumber + " (Không tìm thấy trong DB)");
                continue;
            }

            // 2. Chỉ gọi API khi chưa kiểm tra hoặc lần kiểm tra gần nhất đã quá 2 ngày
            var needCheckInvoice = shouldCheckPrepaymentInvoice(invFile["last.check.date"]);
            var apiSuccess = !needCheckInvoice;
            var apiErrorReason = "Kiểm tra API thất bại";

            if (needCheckInvoice) {
                try {
                    var apiResponse = lib.ESD_HTKT_SCHEDULE_OGL.callCheckInvoiceAPI(invFile);

                    // Chặn cả trường hợp API mới nhận request / đang chờ xử lý
                    var isPendingStatus = apiResponse && (
                        apiResponse.status === "DangKiemTra" ||
                        apiResponse.checkStatus === "DangKiemTra" ||
                        apiResponse.isPending === true
                    );

                    if (apiResponse && apiResponse.success === true && !isPendingStatus) {
                        apiSuccess = true;
                    } else if (isPendingStatus) {
                        apiSuccess = false;
                        apiErrorReason = "Hệ thống đang kiểm tra hóa đơn, vui lòng thử lại sau";
                    } else if (apiResponse && apiResponse.message) {
                        apiErrorReason = apiResponse.message;
                    }
                } catch (apiErr) {
                    apiErrorReason = apiErr.toString();
                }
            }

            if (!apiSuccess) {
                failedInvoiceDetails.push("Hóa đơn " + invoiceNumber + " (" + apiErrorReason + ")");
                continue;
            }

            validInvoicesToSave.push({
                feeData: feeData,
                invFile: invFile,
                invoiceId: invoiceId,
                invoiceNumber: invoiceNumber,
                needCheckInvoice: needCheckInvoice
            });
        }

        // Nếu không có hóa đơn nào đạt chuẩn (hoặc đổi thành failedInvoiceDetails.length > 0 nếu muốn chặn toàn bộ khi có 1 lỗi)
        if (validInvoicesToSave.length === 0) {
            return {
                success: false,
                message: "Thực hiện thất bại: " + failedInvoiceDetails.join("; "),
                checkStatus: []
            };
        }

        // =========================================================================
        // 3.1. PHA 2: LƯU DB & CHECK HẠN MỨC 5 TRIỆU CHO CÁC HÓA ĐƠN HỢP LỆ
        // =========================================================================
        var successInvoiceIds = [];
        var actualSavedNewTotal = "0";
        var affectedTaxPrepaymentIds = {};
        var checkStatusList = [];
        var isRequireBankTransfer = false;

        for (var v = 0; v < validInvoicesToSave.length; v++) {
            var validItem = validInvoicesToSave[v];
            var feeData = validItem.feeData;
            var invFile = validItem.invFile;
            var invoiceId = validItem.invoiceId;
            var invoiceNumber = validItem.invoiceNumber;
            var currentPrepaymentId = feeData['transactionId'] || "";

            // 3. Tạo bản ghi liên kết (gắn PO của dòng NCC đang mở)
            var itemRec = new SCFile("esdHTKTprepaymentInvoice");
            mapPrepaymentAttachment(itemRec, feeData);
            itemRec['po.id'] = invoicePoRow.poId;

            var rc = itemRec.doInsert();

            if ((rc === true || rc == RC_SUCCESS) && invoicePoRow.poId && invoicePoRow.vendorPoCount > 1 &&
                !isPrepaymentInvoiceLinkSavedWithPo(itemRec["prepayment.id"], invoiceId, invoicePoRow.poId)) {
                try { itemRec.doDelete(); } catch (eRollbackLink) { }
                failedInvoiceDetails.push("Hóa đơn " + invoiceNumber +
                    " (không lưu được PO cho liên kết; kiểm tra field po.id của esdHTKTprepaymentInvoice)");
                continue;
            }

            if (rc === true || rc == RC_SUCCESS) {
                // Cập nhật thông tin hóa đơn gốc
                invFile["request.id"] = itemRec["prepayment.id"];
                if (itemRec["deduction.type"]) {
                    invFile["deduction.type"] = itemRec["deduction.type"];
                }
                if (validItem.needCheckInvoice) {
                    invFile['last.check.date'] = new Date();
                }

                var rcUpdateInv = invFile.doUpdate();
                if (rcUpdateInv !== RC_SUCCESS && rcUpdateInv !== true) {
                    try { itemRec.doDelete(); } catch (eRollbackInv) { }
                    failedInvoiceDetails.push("Hóa đơn " + invoiceNumber + " (Cập nhật hóa đơn gốc thất bại)");
                    continue;
                }

                successInvoiceIds.push(invoiceId);
                actualSavedNewTotal = lib.ESD_HTKT_Utils.addStringsManual(
                    actualSavedNewTotal,
                    String(feeData['grandTotal'] || "0")
                );

                // --- KIỂM TRA HẠN MỨC 5 TRIỆU ---
                try {
                    var queryObj = {
                        "id": feeData["id"],
                        "seller.tax.code": feeData["sellerTaxCode"] || "",
                        "grand.total": feeData["grandTotal"] || 0,
                        "invoice.date": feeData["invoiceDate"] || null,
                        "currency": feeData["currency"] || "VND"
                    };

                    var limitResult = lib.ESD_HTKT_INVOICE_INTEGRATION.get5MillionLimitStatus(queryObj);

                    if (limitResult && typeof limitResult === "object") {
                        if (limitResult.code === "E06" || limitResult.checkStatus === "E06" || limitResult.errorCode === "E06") {
                            isRequireBankTransfer = true;
                        }

                        var invoiceDateStr = formatDateToDDMMYYYY(feeData["invoiceDate"]);
                        var targetVendorId = feeData["vendorId"] || "";
                        var vendorNameStr = "Không xác định";

                        if (targetVendorId !== "") {
                            var vendorRec = new SCFile("esdHTKTvendor");
                            if (vendorRec.doSelect("id=\"" + targetVendorId + "\"") === RC_SUCCESS) {
                                vendorNameStr = vendorRec["vendor.name"] || targetVendorId;
                            }
                        }

                        var warningMsg = "Hóa đơn " + invoiceNumber + " của nhà cung cấp " + vendorNameStr + " có tổng trong ngày " + invoiceDateStr + " từ 5 triệu đồng trở lên phải có chứng từ thanh toán không dùng tiền mặt";

                        checkStatusList.push({
                            id: feeData["id"],
                            checkStatus: limitResult.checkStatus || 'DangKiemTra',
                            warningMsg: warningMsg
                        });
                    }
                } catch (limitErr) {
                    print("Lỗi kiểm tra hạn mức 5 triệu: " + limitErr.toString());
                }

                // Kiểm tra thuế
                var feeTax = String(feeData['totalTax'] || "0");
                if (currentPrepaymentId !== "" && lib.ESD_HTKT_Utils.compareMoneyStrings(feeTax, "0") > 0) {
                    affectedTaxPrepaymentIds[currentPrepaymentId] = true;
                }
            } else {
                failedInvoiceDetails.push("Hóa đơn " + invoiceNumber + " (Thêm bản ghi liên kết thất bại)");
            }
        }

        // Đồng bộ dữ liệu thuế
        syncPrepaymentEntries(affectedTaxPrepaymentIds);

        // =========================================================================
        // 3.2 CẬP NHẬT AMOUNT (STRING) DÀNH CHO BẢN GHI THÀNH CÔNG
        // =========================================================================
        if (successInvoiceIds.length > 0) {
            // Tính lại tổng tiền thực tế (Cũ + Mới lưu thành công)
            var finalAccumulatedGrandTotal = lib.ESD_HTKT_Utils.addStringsManual(sumExistingGrandTotal, actualSavedNewTotal);
            var processedPrepaymentItems = {};
            var uniquePrepaymentIds = {};

            for (var j = 0; j < dataObj.length; j++) {
                var pId = dataObj[j]['transactionId'] || "";
                var vdId = dataObj[j]['vendorId'] || "";

                if (pId !== "") {
                    var uniqueKey = pId + "_" + vdId;
                    processedPrepaymentItems[uniqueKey] = { prepaymentId: pId, vendorId: vdId };
                    uniquePrepaymentIds[pId] = true;
                }
            }

            // Cập nhật esdHTKTprepaymentVendor
            for (var key in processedPrepaymentItems) {
                if (processedPrepaymentItems.hasOwnProperty(key)) {
                    var itemInfo = processedPrepaymentItems[key];
                    var vendorFile = new SCFile("esdHTKTprepaymentVendor");
                    var vendorQuery = invoicePoRow.id ?
                        "id=\"" + escapePrepaymentVendorQueryValue(invoicePoRow.id) + "\"" :
                        "prepayment.id=\"" + itemInfo.prepaymentId + "\" and vendor.id=\"" + itemInfo.vendorId + "\"";

                    if (vendorFile.doSelect(vendorQuery) == RC_SUCCESS) {
                        vendorFile["amount"] = finalAccumulatedGrandTotal;
                        if (isRequireBankTransfer && vendorFile["payment.method"] !== "CHUYENKHOAN") {
                            vendorFile["payment.method"] = "CHUYENKHOAN";
                            vendorFile["beneficiary.account"] = null;
                            vendorFile["beneficiary.bank"] = null;
                            vendorFile["beneficiary.name"] = null;
                            vendorFile["identity.number"] = null;
                            vendorFile["issued.date"] = null;
                            vendorFile["issued.place"] = null;
                        }
                        vendorFile.doUpdate();
                    }
                }
            }

            // Cập nhật esdHTKTprepayment
            for (var prepId in uniquePrepaymentIds) {
                if (uniquePrepaymentIds.hasOwnProperty(prepId)) {
                    var sumPrepaymentAmount = "0";
                    var sumVendorFile = new SCFile("esdHTKTprepaymentVendor");

                    if (sumVendorFile.doSelect("prepayment.id=\"" + prepId + "\"") == RC_SUCCESS) {
                        do {
                            var vAmount = String(sumVendorFile["amount"] || "0");
                            sumPrepaymentAmount = lib.ESD_HTKT_Utils.addStringsManual(sumPrepaymentAmount, vAmount);
                        } while (sumVendorFile.getNext() == RC_SUCCESS);
                    }

                    var prepaymentFile = new SCFile("esdHTKTprepayment");
                    if (prepaymentFile.doSelect("id=\"" + prepId + "\"") == RC_SUCCESS) {
                        prepaymentFile["amount"] = sumPrepaymentAmount;
                        prepaymentFile.doUpdate();
                    }
                }
            }
        }


        // =========================================================================
        // 4. KẾT QUẢ TRẢ VỀ
        // =========================================================================
        if (successInvoiceIds.length === dataObj.length) {
            return {
                success: true,
                message: "Thao tác thành công",
                checkStatus: checkStatusList
            };
        } else if (successInvoiceIds.length > 0) {
            return {
                success: true,
                message: "Thành công: " + successInvoiceIds.length + " hóa đơn. Thất bại " + failedInvoiceDetails.length + " hóa đơn: " + failedInvoiceDetails.join("; "),
                checkStatus: checkStatusList
            };
        } else {
            return {
                success: false,
                message: "Thực hiện thất bại: " + failedInvoiceDetails.join("; "),
                checkStatus: checkStatusList
            };
        }

    } catch (parseError) {
        return {
            success: false,
            message: "Xảy ra lỗi hệ thống: " + parseError.toString(),
            checkStatus: []
        };
    }
}

function updateListInvoinVendor(input) {
    var rawDetails = "";

    if (input.esdHTKTlistPrepaymentVendor && input.esdHTKTlistPrepaymentVendor.details) {
        rawDetails = input.esdHTKTlistPrepaymentVendor.details;
    } else if (input.details) {
        rawDetails = input.details;
    } else if (input.queryString) {
        try {
            var parsedQuery = JSON.parse(input.queryString);
            if (parsedQuery.esdHTKTlistPrepaymentVendor && parsedQuery.esdHTKTlistPrepaymentVendor.details) {
                rawDetails = parsedQuery.esdHTKTlistPrepaymentVendor.details;
            } else {
                rawDetails = parsedQuery.details || input.queryString;
            }
        } catch (e) {
            rawDetails = input.queryString;
        }
    }

    if (!rawDetails) {
        return { success: false, message: "Thiếu dữ liệu chi tiết hóa đơn" };
    }

    try {
        var parsedData = JSON.parse(rawDetails);
        var dataObj = [];

        if (parsedData.updatedSelectedRows && Array.isArray(parsedData.updatedSelectedRows)) {
            dataObj = parsedData.updatedSelectedRows;
        } else if (Array.isArray(parsedData)) {
            dataObj = parsedData;
        } else {
            return { success: false, message: "Dữ liệu hóa đơn không đúng định dạng danh sách (Array)" };
        }

        if (dataObj.length === 0) {
            return { success: false, message: "Danh sách hóa đơn trống" };
        }

        var successInvoiceIds = [];
        // trưởng thêm
        var affectedPrepaymentIds = {};

        // 3. Vòng lặp duyệt qua từng hóa đơn trong mảng (Dù có 1 hay nhiều hóa đơn)
        for (var i = 0; i < dataObj.length; i++) {
            var feeData = dataObj[i];

            // Map chính xác các trường từ dữ liệu JSON thực tế của bạn
            var invoiceId = feeData['id'] || "";
            var prepaymentId = feeData['transactionId'] || "";
            var deductionType = feeData['deductionType'] || "";

            if (invoiceId !== "" && prepaymentId !== "") {
                var invFile = new SCFile("esdHTKTprepaymentInvoice");
                try {
                    // Tạo câu lệnh tìm kiếm bản ghi đã tồn tại dựa trên cặp ID
                    var query = "invoice.id=\"" + escapePrepaymentVendorQueryValue(invoiceId) + "\" AND prepayment.id=\"" + escapePrepaymentVendorQueryValue(prepaymentId) + "\"";
                    var rcInv = invFile.doSelect(query);

                    // Nếu tìm thấy bản ghi liên kết trong Database
                    if (rcInv == RC_SUCCESS) {

                        // Thực hiện cập nhật loại khấu trừ
                        invFile["deduction.type"] = deductionType;

                        var rcUpdate = invFile.doUpdate();

                        if (rcUpdate == RC_SUCCESS) {
                            updateInvoiceDeductionType(invoiceId, deductionType);
                            successInvoiceIds.push(invoiceId);
                            // trưởng thêm
                            affectedPrepaymentIds[prepaymentId] = true;
                        }
                    }
                } finally {
                    try { invFile.doClose(); } catch (e) { }
                }
            }
        }

        // trưởng thêm
        syncPrepaymentEntries(affectedPrepaymentIds);

        if (successInvoiceIds.length === dataObj.length) {
            return {
                success: true,
                message: "Đã cập nhật thành công tất cả các hóa đơn: " + successInvoiceIds.join(", ")
            };
        } else if (successInvoiceIds.length > 0) {
            return {
                success: true,
                message: "Cập nhật thành công các hóa đơn: " + successInvoiceIds.join(", ") + " (Thất bại " + (dataObj.length - successInvoiceIds.length) + " hóa đơn)"
            };
        } else {
            return {
                success: false,
                message: "Cập nhật thất bại. Không có hóa đơn nào tìm thấy hoặc cập nhật thành công trong hệ thống."
            };
        }

    } catch (parseError) {
        return { success: false, message: "Xảy ra lỗi trong quá trình xử lý dữ liệu: " + parseError.toString() };
    }
}

function escapePrepaymentVendorQueryValue(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function updateInvoiceDeductionType(invoiceId, deductionType) {
    if (!invoiceId) return false;
    var invoiceRec = new SCFile("esdHTKTinvoice");
    try {
        var query = "id=\"" + escapePrepaymentVendorQueryValue(invoiceId) + "\"";
        if (invoiceRec.doSelect(query) === RC_SUCCESS) {
            invoiceRec["deduction.type"] = deductionType;
            return invoiceRec.doUpdate() === RC_SUCCESS;
        }
        return false;
    } finally {
        try { invoiceRec.doClose(); } catch (e) { }
    }
}

function mapPrepaymentAttachment(itemRec, feeData) {
    itemRec['prepayment.id'] = feeData['transactionId'];
    itemRec['invoice.id'] = feeData['id'];

    if (feeData['totalTax'] === 0) {
        itemRec['deduction.type'] = "KHAUTRU_003"; // Không khấu trừ
    } else if (feeData['totalTax'] > 0) {
        itemRec['deduction.type'] = "KHAUTRU_001"; // Khấu trừ toàn bộ
    }
}


function deletePrepaymentVendor(input) {
    var prepaymentId = "";
    var vendorId = "";
    var prepaymentVendorId = "";
    var poId = "";

    try {
        var rawData = input.details || input.queryString;
        if (rawData) {
            var queryObj = JSON.parse(rawData);
            prepaymentId = queryObj.prepaymentId || "";
            vendorId = queryObj.vendorId || "";
            prepaymentVendorId = queryObj.prepaymentVendorId || "";
            poId = queryObj.poId || "";
        }
    } catch (ex) {
        return { status: "error", message: "Invalid input" };
    }

    if (!vendorId || !prepaymentId) {
        return { status: "error", message: "Thiếu vendorId hoặc prepaymentId" };
    }

    var remainingPoIds = {};
    var hasPurchaseOrderRows = false;
    var remainingPoFile = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
    var remainingPoRc = remainingPoFile.doSelect('prepayment.id="' + escapePrepaymentVendorQueryValue(prepaymentId) + '"');
    while (remainingPoRc === RC_SUCCESS) {
        var currentPoId = String(remainingPoFile["po.id"] || "").replace(/^\s+|\s+$/g, "");
        var currentVendorId = String(remainingPoFile["vendor.id"] || "").replace(/^\s+|\s+$/g, "");
        if (currentPoId) hasPurchaseOrderRows = true;
        var isDeletedRow = prepaymentVendorId ?
            String(remainingPoFile["id"] || "") === String(prepaymentVendorId) :
            currentVendorId === String(vendorId);
        if (currentPoId && !isDeletedRow) {
            remainingPoIds[currentPoId] = true;
        }
        remainingPoRc = remainingPoFile.getNext();
    }
    try { remainingPoFile.doClose(); } catch (eCloseRemainingPo) { }

    var hasRemainingPo = false;
    for (var remainingPoId in remainingPoIds) {
        if (remainingPoIds.hasOwnProperty(remainingPoId)) {
            hasRemainingPo = true;
            break;
        }
    }
    if (hasPurchaseOrderRows && !hasRemainingPo) {
        return { status: "error", message: "Phiếu tạm ứng bắt buộc phải có ít nhất một PO; không thể xóa PO cuối cùng." };
    }

    // Xóa đúng PO-vendor row khi có ID; giữ nguyên xóa theo NCC cho phiếu cũ không có PO.
    var vendorFile = new SCFile("esdHTKTprepaymentVendor");
    var vendorQuery = prepaymentVendorId ?
        'id="' + escapePrepaymentVendorQueryValue(prepaymentVendorId) + '" and vendor.id="' + escapePrepaymentVendorQueryValue(vendorId) + '" and prepayment.id="' + escapePrepaymentVendorQueryValue(prepaymentId) + '" and po.id="' + escapePrepaymentVendorQueryValue(poId) + '"' :
        'vendor.id="' + escapePrepaymentVendorQueryValue(vendorId) + '" and prepayment.id="' + escapePrepaymentVendorQueryValue(prepaymentId) + '"';

    if (vendorFile.doSelect(vendorQuery) === RC_SUCCESS) {
        var rcDeleteVendor = vendorFile.doDelete();
        if (rcDeleteVendor !== RC_SUCCESS) {
            return { status: "error", message: "Xóa prepayment vendor thất bại" };
        }
    }

    // Giữ hóa đơn khi NCC vẫn còn gắn với PO khác trong cùng phiếu.
    var shouldDeleteVendorInvoices = true;
    if (prepaymentVendorId) {
        var remainingVendorRow = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
        shouldDeleteVendorInvoices = remainingVendorRow.doSelect(
            'prepayment.id="' + escapePrepaymentVendorQueryValue(prepaymentId) + '" and vendor.id="' + escapePrepaymentVendorQueryValue(vendorId) + '"'
        ) !== RC_SUCCESS;
        try { remainingVendorRow.doClose(); } catch (eCloseRemainingVendor) { }
    }

    // XÓA HÓA ĐƠN LIÊN KẾT: hóa đơn đi theo PO nên luôn gỡ hóa đơn của PO bị xóa;
    // hóa đơn cũ chưa có po.id chỉ gỡ khi NCC không còn PO/dòng vendor nào trong phiếu.
    var deletedPoId = String(poId || "").replace(/^\s+|\s+$/g, "");
    if (shouldDeleteVendorInvoices || deletedPoId) {
        try {
            // 2.1. Lấy mã số thuế của Vendor đang bị xóa
            var taxId = "";
            var vFile = new SCFile("esdHTKTvendor", SCFILE_READONLY);
            if (vFile.doSelect('id="' + vendorId + '"') === RC_SUCCESS) {
                taxId = vFile["vendor.number"]; // Lưu ý: Đảm bảo "tax.id" là trường lưu MST trong bảng vendor
            }

            if (taxId) {
                // 2.2. Lấy tất cả các dòng hóa đơn của Phiếu tạm ứng này trong bảng trung gian
                var prepInvFile = new SCFile("esdHTKTprepaymentInvoice");
                var prepInvQuery = 'prepayment.id="' + prepaymentId + '"';

                if (prepInvFile.doSelect(prepInvQuery) === RC_SUCCESS) {
                    do {
                        var invoiceId = prepInvFile["invoice.id"];

                        if (invoiceId) {
                            // 2.3. Dùng invoice.id tra cứu bảng hóa đơn gốc để xem MST của ai
                            var invFile = new SCFile("esdHTKTinvoice");
                            var invQuery = 'id="' + invoiceId + '"';

                            if (invFile.doSelect(invQuery) === RC_SUCCESS) {
                                var invoiceTaxId = invFile["seller.tax.code"];

                                var linkPoId = String(prepInvFile["po.id"] || "").replace(/^\s+|\s+$/g, "");
                                // NCC không còn dòng nào: gỡ mọi hóa đơn của NCC; còn PO khác: chỉ gỡ hóa đơn của PO bị xóa.
                                var linkBelongsToDeletedRow = shouldDeleteVendorInvoices ||
                                    (linkPoId !== "" && linkPoId === deletedPoId);
                                // Nếu hóa đơn này thuộc về Nhà cung cấp/PO vừa bị xóa (trùng MST)
                                if (invoiceTaxId === taxId && linkBelongsToDeletedRow) {
                                    // Xóa khỏi bảng trung gian
                                    prepInvFile.doDelete();

                                    // (Tùy chọn) Xóa liên kết ở bảng hóa đơn gốc để hóa đơn đó có thể được dùng lại
                                    invFile["request.id"] = null;
                                    invFile["deduction.type"] = null;
                                    invFile.doUpdate();
                                }
                            }
                        }
                    } while (prepInvFile.getNext() === RC_SUCCESS);
                }
            }
        } catch (e) {
            print("Lỗi khi xử lý xóa Invoice qua invoice.id: " + e);
        }
    }

    // 3. TÍNH TOÁN LẠI TỔNG TIỀN CỦA CÁC NHÀ CUNG CẤP CÒN LẠI
    var totalAmount = 0;
    try {
        var remainingVendorFile = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
        var remainingQuery = 'prepayment.id="' + prepaymentId + '"';

        if (remainingVendorFile.doSelect(remainingQuery) === RC_SUCCESS) {
            do {
                var rawAmt = remainingVendorFile["amount"];
                var numAmt = 0;

                if (rawAmt !== null && rawAmt !== undefined && rawAmt !== "") {
                    var cleanAmt = String(rawAmt).replace(/,/g, '').trim();
                    numAmt = parseFloat(cleanAmt);
                    if (isNaN(numAmt)) numAmt = 0;
                }

                totalAmount += numAmt;
            } while (remainingVendorFile.getNext() === RC_SUCCESS);
        }
    } catch (e) {
        print("Lỗi khi tính lại tổng tiền: " + e);
    }

    // 4. CẬP NHẬT TỔNG TIỀN MỚI VÀO PHIẾU TẠM ỨNG
    var prepaymentFile = new SCFile("esdHTKTprepayment");
    var prepaymentQuery = "id=\"" + prepaymentId + "\"";

    if (prepaymentFile.doSelect(prepaymentQuery) === RC_SUCCESS) {

        if (totalAmount === 0) {
            prepaymentFile["amount"] = null;
        } else {
            prepaymentFile["amount"] = totalAmount.toString();
        }

        var rcUpdatePrepayment = prepaymentFile.doUpdate();
    }

    return {
        status: "success",
        message: "Xóa và cập nhật dữ liệu thành công. Tổng tiền mới: " + totalAmount
    };
}

/**
 * Giải phóng liên kết hóa đơn gốc (set request.id = null)
 *
 * @param {string} invoiceId - Mã hóa đơn cần reset
 * @returns {boolean} true nếu cập nhật thành công hoặc không tìm thấy, false nếu có lỗi
 */
function resetInvoiceRequestId(invoiceId) {
    if (!invoiceId) return false;

    var invFile = null;
    try {
        invFile = new SCFile("esdHTKTinvoice");
        var queryInv = 'id="' + invoiceId + '"';
        var rcInv = invFile.doSelect(queryInv);

        if (rcInv === RC_SUCCESS) {
            invFile["request.id"] = null;
            invFile["deduction.type"] = null;
            var rcUpdate = invFile.doUpdate();
            return (rcUpdate === RC_SUCCESS);
        }
        return false;
    } catch (e) {
        // Có thể log lỗi nếu cần: print("[RESET_INVOICE_REQUEST_ID_ERROR] " + e);
        return false;
    } finally {
        try {
            if (invFile) invFile.doClose();
        } catch (ignore) { }
    }
}

function mapRowToObject(scFileRecord, fieldMappings) {
    var item = {};
    for (var j = 0; j < fieldMappings.length; j++) {
        var jsonKey = fieldMappings[j][1];
        var dataType = fieldMappings[j][2];
        var dbValue = scFileRecord[j];

        if (dataType === "N") {
            item[jsonKey] = dbValue ? Number(dbValue) : 0;
        } else if (dataType === "D") {
            item[jsonKey] = dbValue ? (dbValue.toISOString ? dbValue.toISOString() : String(dbValue)) : "";
        } else {
            item[jsonKey] = dbValue ? String(dbValue) : "";
        }
    }
    return item;
}

// trưởng thêm
function syncPrepaymentEntries(prepaymentIds) {
    for (var prepaymentId in prepaymentIds) {
        if (!prepaymentIds.hasOwnProperty(prepaymentId)) continue;

        try {
            lib.ESD_HTKT_PREPAYMENT_ENTRY.syncPrepaymentEntryBySourceChange(
                "esdHTKTprepaymentInvoice", { "prepayment.id": prepaymentId }
            );
        } catch (syncError) {
            console.error("Khong the sinh lai but toan cho " + prepaymentId + ": " + syncError.toString());
        }
    }
}


function checkInvoiceStatus(lastCheckDate) {
    if (!lastCheckDate) {
        return "Chưa kiểm tra";
    }

    try {
        var checkDate = (lastCheckDate instanceof Date) ? lastCheckDate : new Date(lastCheckDate);
        var currentDate = new Date();

        // Tính khoảng cách ngày
        var diffTime = currentDate.getTime() - checkDate.getTime();
        var diffDays = diffTime / (1000 * 60 * 60 * 24);

        var maxAllowedDays = lib.ESD_HTKT_Utils.getItemNameFromConfig({
            categoryId: "htkt_thoi_gia",
            defaultValue: "2"
        });

        return (diffDays > maxAllowedDays) ? "Quá hạn" : "Còn hạn";
    } catch (e) {
        return "Chưa kiểm tra";
    }
}


///**
// * Lấy số ngày cấu hình từ bảng esdDMcategoryItems trong Service Manager
// * @param {string} categoryId - ID của danh mục (Mặc định: "htkt_thoi_gia")
// * @returns {number} Số ngày cấu hình
// */
//function getMaxAllowedDaysFromConfig(categoryId) {
//    if (!categoryId) categoryId = "htkt_thoi_gia";
//
//    var categoryFile = new SCFile("esdDMcategoryItems");
//    var query = "category.id=\"" + categoryId + "\"";
//
//    try {
//        if (categoryFile.doSelect(query) === RC_SUCCESS) {
//
//            var configValue = categoryFile["item.id"];
//            var parsedDays = parseFloat(configValue);
//
//            if (!isNaN(parsedDays)) {
//                return parsedDays;
//            }
//        }
//    } catch (e) {
//
//    }
//
//    return 2; // Giá trị mặc định nếu không tìm thấy cấu hình
//}


/**
 * Đồng bộ OGL tất cả thông tin NCC/site theo đề nghị tạm ứng cb dmms
 * @param record
 */
//function syncVendorOglFromPrepayment(record) {
//    var entityInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(record['unit.lv1']);
//    if (entityInfo && entityInfo.entity && entityInfo.oglBranchCode) {
//        var entityCode = entityInfo.entity;
//        var branchCode = entityInfo.oglBranchCode.length == 4 ?
//            entityInfo.oglBranchCode.substr(1, 4) :
//            entityInfo.oglBranchCode;
//                    var defaultVendorSiteInfo =
//            lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo();
//
//        var itemPrepaymentVendor = new SCFile("esdHTKTprepaymentVendor");
//        var prepaymentVendorRc = itemPrepaymentVendor.doSelect(`prepayment.id = "${record.id}"`);
//        while (prepaymentVendorRc == RC_SUCCESS) {
//            if (!itemPrepaymentVendor['ogl.sync.status']) {
//                var result = syncVendorToOgl(itemPrepaymentVendor,
//                    branchCode,
//                    entityCode,
//                    record['user.checker.kttc'] || vars.$lo_operator["contact.name"]);
//                if (result && result.success == true) {
//                    itemPrepaymentVendor['ogl.sync.status'] = true;
//                    itemPrepaymentVendor.doUpdate();
//                }
//            }
//            prepaymentVendorRc = itemPrepaymentVendor.getNext();
//        }
//        try { if (prepaymentVendorRc) prepaymentVendorRc.doClose(); } catch (e) {}
//    }
//}
function syncVendorOglFromPrepayment(record) {
    // TU XDCB: dùng hàm sync chung với TT để chọn site XDCB; HHDV giữ luồng cũ bên dưới.
    if (lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb(record)) {
        var file = new SCFile("esdHTKTprepaymentVendor");
        try {
            var rc = file.doSelect('prepayment.id="' + escapePrepaymentVendorQueryValue(record.id) + '"');
            while (rc === RC_SUCCESS) {
                var sync = lib.ESD_HTKT_PAYMENT_VENDOR.syncPaymentXdcbVendorToOgl(file);
                if (sync.success) file.doUpdate();
                else print("Đồng bộ NCC/Site TU XDCB chưa thành công: " + sync.message);
                rc = file.getNext();
            }
        } finally {
            file.doClose();
        }
        return;
    }
    var entityInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(record['unit.lv1']);

    if (entityInfo && entityInfo.entity && entityInfo.oglBranchCode) {
        var entityCode = entityInfo.entity;
        var branchCode = entityInfo.oglBranchCode.length == 4 ?
            entityInfo.oglBranchCode.substr(1, 4) :
            entityInfo.oglBranchCode;

        var defaultVendorSiteInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo();

        var itemPrepaymentVendor = new SCFile("esdHTKTprepaymentVendor");
        var prepaymentVendorRc = itemPrepaymentVendor.doSelect(`prepayment.id = "${record.id}"`);

        while (prepaymentVendorRc == RC_SUCCESS) {
            if (!itemPrepaymentVendor['ogl.sync.status']) {

                var result = syncVendorToOgl(
                    itemPrepaymentVendor,
                    branchCode,
                    entityCode,
                    record['user.checker.kttc'] || vars.$lo_operator["contact.name"]
                );

                if (result && result.success == true) {
                    itemPrepaymentVendor['ogl.sync.status'] = true;

                    // =========================================================================
                    // BỔ SUNG: AUTO-FILL SITE NCC NGAY SAU KHI ĐỒNG BỘ THÀNH CÔNG (CÁCH 2)
                    // =========================================================================
                    var vendorId = itemPrepaymentVendor['vendor.id'];

                    if (vendorId && (!itemPrepaymentVendor['vendor.site.id'] || itemPrepaymentVendor['vendor.site.id'] == "")) {
                        var siteFile = new SCFile("esdHTKTvendorSite", SCFILE_READONLY);
                        var siteQuery = 'vendor.id="' + vendorId + '"'; // Lấy tất cả site của NCC này

                        var siteList = [];
                        var rcSite = siteFile.doSelect(siteQuery);

                        while (rcSite == RC_SUCCESS) {
                            siteList.push({
                                id: siteFile['id'],
                                siteCode: siteFile['ogl.site.code']
                            });
                            rcSite = siteFile.getNext();
                        }
                        try { siteFile.doClose(); } catch (e) { }

                        // Áp dụng Cách 2: Tìm site mặc định, nếu không có lấy site đầu tiên
                        if (siteList.length > 0) {
                            var matchedSiteId = null;

                            // 1. Thử tìm xem có site nào khớp với cấu hình Default không
                            if (defaultVendorSiteInfo && defaultVendorSiteInfo.siteCode) {
                                for (var i = 0; i < siteList.length; i++) {
                                    if (siteList[i].siteCode == defaultVendorSiteInfo.siteCode) {
                                        matchedSiteId = siteList[i].id;
                                        break;
                                    }
                                }
                            }

                            // 2. Nếu khớp thì gán site đó, nếu KHÔNG khớp thì lấy site ĐẦU TIÊN
                            if (matchedSiteId) {
                                itemPrepaymentVendor['vendor.site.id'] = matchedSiteId;
                            } else {
                                itemPrepaymentVendor['vendor.site.id'] = siteList[0].id;
                            }
                        }
                    }

                    itemPrepaymentVendor.doUpdate();
                }
            }
            prepaymentVendorRc = itemPrepaymentVendor.getNext();
        }

        // Sửa lỗi: Gọi doClose trên đối tượng SCFile thay vì biến RC
        try { if (itemPrepaymentVendor) itemPrepaymentVendor.doClose(); } catch (e) { }
    }
}
///**
// * Đồng bộ từng NCC
// * @param prepaymentVendor 
// * @param branchCode 
// * @param entityCode 
// */
//function syncVendorToOgl(prepaymentVendor, branchCode, entityCode, username = vars.$lo_operator["contact.name"]) {
//    var itemVendor = new SCFile("esdHTKTvendor");
//    var rcItem = itemVendor.doSelect(`id="${prepaymentVendor['vendor.id']}"`);
//    var defaultVendorSiteInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo();
//    var vendorExist = false;
//    var vendorNameFromOGL = null;
//    if (rcItem == RC_SUCCESS) {
//
//        // Lấy giá trị supplier.id
//        var supplierId = itemVendor['supplier.id'];
//
//        if (itemVendor['vendor.name'] && itemVendor['vendor.number']) {
//            var checkVendorReponse = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.getVendorSiteInfo({
//                "vendorNumber": itemVendor['vendor.number'],
//                //                "vendorName": itemVendor['vendor.name'],
//                "entity": branchCode,
//            });
//            if (checkVendorReponse && checkVendorReponse['success'] === true &&
//                checkVendorReponse['data'] &&
//                checkVendorReponse['data'].length > 0) {
//                var allSites = [];
//                if (checkVendorReponse['data'][0].vendorName) {
//                    vendorNameFromOGL = checkVendorReponse['data'][0].vendorName;
//                }
//                checkVendorReponse['data'].forEach(item => {
//                    if (item.sites && item.sites.length > 0) {
//                        allSites = allSites.concat(item.sites);
//                    }
//                });
//
//                // Lấy ra tất cả site đang lưu theo entity - đơn vị
//                var arrVendorSiteCodeExit = [];
//                var itemVendorSite = new SCFile('esdHTKTvendorSite');
//                var vendorSiteRC = itemVendorSite.doSelect(`vendor.id = "${itemVendor.id}" and ogl.entity = "${branchCode}"`);
//                while (vendorSiteRC == RC_SUCCESS) {
//                    // trong các site trả về kiểm tra để cập nhật/set inactive cho các site đang có(set inactive cho site khác site mặc định)
//                    var findVendorSite = allSites.find(x => x.entity == itemVendorSite['ogl.entity'] &&
//                        x.vendorSiteCode == itemVendorSite['ogl.site.code']);
//                    if (findVendorSite) {
//                        if (itemVendorSite['credit.account'] != findVendorSite.debitAccount ||
//                            itemVendorSite['debit.account'] != findVendorSite.debitAccount) {
//                            itemVendorSite['credit.account'] = findVendorSite.debitAccount;
//                            itemVendorSite['debit.account'] = findVendorSite.debitAccount;
//                            itemVendorSite.doUpdate();
//                        }
//                        arrVendorSiteCodeExit.push(findVendorSite.vendorSiteCode);
//                    } else {
//                        itemVendorSite.active = false;
//                        itemVendorSite.doUpdate();
//                    }
//                    vendorSiteRC = itemVendorSite.getNext();
//                }
//
//                if (allSites.length > 0) {
//                    vendorExist = allSites.find(x => x.vendorSiteCode == defaultVendorSiteInfo.siteCode) != null;
//                    var newSiteArr = [];
//                    if (arrVendorSiteCodeExit.length != allSites.length) {
//                        // tìm ra và tạo các site mới
//                        if (arrVendorSiteCodeExit.length == 0) newSiteArr = allSites;
//                        else newSiteArr = allSites.filter(x => !arrVendorSiteCodeExit.includes(x.vendorSiteCode)) || [];
//                    }
//                    newSiteArr.forEach(item => {
//                        item['vendor.id'] = itemVendor.id;
//                        saveVendorSite(item);
//                    });
//                }
//            }
//            if (!vendorExist) {
//                var vendorInfo = buildVendorAndSiteInfo(itemVendor, defaultVendorSiteInfo, branchCode, entityCode, username, vendorNameFromOGL);
//                print(`buildVendorAndSiteInfo: ${JSON.stringify(vendorInfo)}`);
//                var response = createVendor(vendorInfo, itemVendor.id);
//                //                print('createVendor 1= ', JSON.stringify(response));
//                if (response) {
//                    if (response['success'] === true) {
//                        vendorExist = true;
//                    } else {
//                        return response;
//                    }
//                }
//            }
//
//            if (vendorExist) {
//                if (!itemVendor['ogl.sync.status']) {
//                    itemVendor['ogl.sync.status'] = true;
//                    itemVendor.doUpdate();
//                }
//                //                if (!prepaymentVendor['ogl.sync.status']) {
//                //                    prepaymentVendor['ogl.sync.status'] = true;
//                //                    prepaymentVendor.doUpdate();
//                //                }
//
//                // 2. Chỉ CẬP NHẬT TRẠNG THÁI TRÊN MEMORY cho prepaymentVendor ($L_file)
//                // KHÔNG gọi prepaymentVendor.doUpdate() ở đây
//                // Vì nếu là bản ghi mới tạo, doSave/doInsert ở bước sau sẽ tự lưu trạng thái này xuống DB.
//                prepaymentVendor['ogl.sync.status'] = true;
//
//                //cap nhat esdDMSupplier
//                if (supplierId) {
//                    var itemSupplier = new SCFile("esdDMSupplier");
//                    var rcSupplier = itemSupplier.doSelect(`id="${supplierId}"`);
//
//                    if (rcSupplier == RC_SUCCESS) {
//                        if (!itemSupplier['isAccounted']) {
//                            itemSupplier['isAccounted'] = true;
//                            itemSupplier.doUpdate();
//                        }
//                    }
//                }
//            }
//        }
//    }
//    return {
//        success: true
//    };
//}
/**
 * Đồng bộ từng NCC (Logic MỚI: Query QLTS -> Sync OGL -> Create OGL)
 * @param prepaymentVendor
 * @param branchCode
 * @param entityCode
 * @param username
 */
function escapeSyncVendorQueryValue(value) {
    return String(value == null ? "" : value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function markVendorOglSyncedIfNeeded(vendorId, currentSyncedFlag) {
    if (currentSyncedFlag) return;
    var writeVendor = new SCFile("esdHTKTvendor");
    try {
        if (writeVendor.doSelect('id="' + escapeSyncVendorQueryValue(vendorId) + '"') == RC_SUCCESS) {
            if (!writeVendor['ogl.sync.status']) {
                writeVendor['ogl.sync.status'] = true;
                writeVendor.doUpdate();
            }
        }
    } finally {
        try { writeVendor.doClose(); } catch (e) { }
    }
}

function updateVendorNumberIfMissing(vendorId, oglVendorNumber) {
    var trimmedNumber = String(oglVendorNumber || "").trim();
    if (!trimmedNumber) return "";
    var writeVendor = new SCFile("esdHTKTvendor");
    try {
        if (writeVendor.doSelect('id="' + escapeSyncVendorQueryValue(vendorId) + '"') == RC_SUCCESS) {
            if (!writeVendor['vendor.number'] || writeVendor['vendor.number'] == "") {
                writeVendor['vendor.number'] = trimmedNumber;
                writeVendor.doUpdate();
            }
        }
    } finally {
        try { writeVendor.doClose(); } catch (e) { }
    }
    return trimmedNumber;
}

function markSupplierAccountedIfNeeded(supplierId, isXdcb, vendorTaxCode) {
    if (!supplierId) return;
    var escapedSupplierId = escapeSyncVendorQueryValue(supplierId);
    var needUpdate = false;
    var checkSupplier = new SCFile("esdDMSupplier", SCFILE_READONLY);
    try {
        checkSupplier.setFields(isXdcb ? ["isAccounted", "tax.code"] : ["isAccounted"]);
        if (checkSupplier.doSelect('id="' + escapedSupplierId + '"') == RC_SUCCESS) {
            if ((!isXdcb || String(checkSupplier["tax.code"] || "") === vendorTaxCode) && !checkSupplier['isAccounted']) {
                needUpdate = true;
            }
        }
    } finally {
        try { checkSupplier.doClose(); } catch (e) { }
    }
    if (!needUpdate) return;
    var writeSupplier = new SCFile("esdDMSupplier");
    try {
        if (writeSupplier.doSelect('id="' + escapedSupplierId + '"') == RC_SUCCESS) {
            if ((!isXdcb || String(writeSupplier["tax.code"] || "") === vendorTaxCode) && !writeSupplier['isAccounted']) {
                writeSupplier['isAccounted'] = true;
                writeSupplier.doUpdate();
            }
        }
    } finally {
        try { writeSupplier.doClose(); } catch (e) { }
    }
}

function syncVendorToOgl(prepaymentVendor, branchCode, entityCode, username, contractCategory) {
    // Hạng mục chỉ chọn cấu hình site; không truyền thì giữ HHDV cho mọi caller cũ.
    var isXdcb = String(contractCategory || "HHDV").trim().toUpperCase() === "XDCB";
    if (isXdcb) {
        prepaymentVendor['ogl.sync.status'] = false;
        if (!branchCode || !entityCode) {
            return {
                success: false,
                message: "Chưa có entity/chi nhánh OGL để đồng bộ site XDCB."
            };
        }

        branchCode = String(branchCode).trim();
        if (branchCode.length === 4) {
            branchCode = branchCode.substr(1);
        }
    }

    if (!username) username = vars.$lo_operator["contact.name"];

    var itemVendor = new SCFile("esdHTKTvendor", SCFILE_READONLY);
    var defaultVendorSiteInfo = isXdcb
        ? lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo("XDCB")
        : lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo();

    var vendorExistInOGL = false;
    var vendorNameFromOGL = null;
    var vendorId = "";
    var vendorData = null;

    try {
        itemVendor.setFields(["id", "supplier.id", "vendor.name", "vendor.number", "address", "ogl.sync.status"]);
        var rcItem = itemVendor.doSelect('id="' + escapeSyncVendorQueryValue(prepaymentVendor['vendor.id']) + '"');
        if (rcItem == RC_SUCCESS) {
            vendorData = {
                'id': itemVendor['id'],
                'supplier.id': itemVendor['supplier.id'],
                'vendor.name': itemVendor['vendor.name'],
                'vendor.number': itemVendor['vendor.number'],
                'address': itemVendor['address'],
                'ogl.sync.status': itemVendor['ogl.sync.status']
            };
        }
    } finally {
        try { itemVendor.doClose(); } catch (e) { }
    }

    if (vendorData) {
        var supplierId = vendorData['supplier.id'];
        vendorId = vendorData['id'];

        // XDCB chỉ cập nhật NCC S2 khi ID và MST cùng khớp; không suy nguồn từ định dạng mã.
        var vendorTaxCode = String(vendorData["vendor.number"] || "");

        if (vendorData['vendor.name'] || vendorData['vendor.number']) {

            // =====================================================================
            // BƯỚC 1: Query site tại danh mục QLTS (esdHTKTvendorSite) - read-only
            // =====================================================================
            var hasSiteInQLTS = false;
            var localSiteId = "";
            var itemVendorSiteCheck = new SCFile('esdHTKTvendorSite', SCFILE_READONLY);
            try {
                itemVendorSiteCheck.setFields(["id"]);
                var queryLocalSite = 'vendor.id = "' + escapeSyncVendorQueryValue(vendorId) +
                    '" and ogl.entity = "' + escapeSyncVendorQueryValue(branchCode) + '" and active = true';

                // XDCB tìm đúng mã site của hạng mục XDCB, ko dùng site HHDV cùng NCC.
                if (isXdcb) {
                    queryLocalSite += ' and ogl.site.code = "' + escapeSyncVendorQueryValue(defaultVendorSiteInfo.siteCode) + '"';
                }

                if (itemVendorSiteCheck.doSelect(queryLocalSite) == RC_SUCCESS) {
                    hasSiteInQLTS = true; // Đã tồn tại site hợp lệ trên QLTS
                    if (isXdcb) {
                        localSiteId = String(itemVendorSiteCheck['id'] || "");
                    }
                }
            } finally {
                try { itemVendorSiteCheck.doClose(); } catch (e) { }
            }

            // Nếu đã có site trên QLTS và đã có vendor.number => Bỏ qua gọi API OGL, chỉ cập nhật khi cờ chưa bật và return
            if (hasSiteInQLTS && vendorData['vendor.number']) {
                markVendorOglSyncedIfNeeded(vendorId, vendorData['ogl.sync.status']);
                prepaymentVendor['ogl.sync.status'] = true;

                // Chỉ mở ghi esdDMSupplier nếu isAccounted chưa được bật (và khớp MST với XDCB)
                markSupplierAccountedIfNeeded(supplierId, isXdcb, vendorTaxCode);
                if (isXdcb) {
                    prepaymentVendor['vendor.site.id'] = localSiteId;
                    return {
                        success: true,
                        siteId: localSiteId,
                        vendorNumber: vendorData['vendor.number'] || ""
                    };
                }
                return {
                    success: true,
                    vendorNumber: vendorData['vendor.number'] || ""
                };
            }

            // =====================================================================
            // BƯỚC 2: Đồng bộ OGL NẾU CHƯA CÓ site trên QLTS (hoặc chưa có vendor.number)
            // =====================================================================
            var checkVendorReponse = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.getVendorSiteInfo({
                "vendorNumber": vendorData['vendor.number'] || null,
                "vendorName": vendorData['vendor.name'] || null,
                "entity": branchCode
            });

            if (checkVendorReponse && checkVendorReponse['success'] === true &&
                checkVendorReponse['data'] && checkVendorReponse['data'].length > 0) {

                var allSites = [];
                if (checkVendorReponse['data'][0].vendorName) {
                    vendorNameFromOGL = checkVendorReponse['data'][0].vendorName;
                }

                // Cập nhật vendor.number vào esdHTKTvendor nếu đang null/rỗng
                var oglVendorNumber = checkVendorReponse['data'][0].vendorNumber;
                if (oglVendorNumber && (!vendorData['vendor.number'] || vendorData['vendor.number'] == "")) {
                    var updatedNumber = updateVendorNumberIfMissing(vendorId, oglVendorNumber);
                    if (updatedNumber) {
                        vendorData['vendor.number'] = updatedNumber;
                        vendorTaxCode = updatedNumber;
                    }
                }

                checkVendorReponse['data'].forEach(function (item) {
                    if (item.sites && item.sites.length > 0) {
                        allSites = allSites.concat(item.sites);
                    }
                });

                // Xử lý lưu các site trả về từ OGL vào QLTS
                if (allSites.length > 0) {
                    vendorExistInOGL = allSites.find(function (x) { return x.vendorSiteCode == defaultVendorSiteInfo.siteCode; }) != null;

                    // XDCB cùng mã site nhưng khác chi nhánh thì vẫn cần tạo cho chi nhánh phiếu.
                    if (isXdcb && vendorExistInOGL) {
                        vendorExistInOGL = allSites.some(function (x) {
                            return x.vendorSiteCode == defaultVendorSiteInfo.siteCode && String(x.entity).trim() === branchCode;
                        });
                    }

                    allSites.forEach(function (item) {
                        item['vendor.id'] = vendorId;
                        item['source'] = lib.ESD_HTKT_PREPAYMENT_WF.VENDOR_SITE_SOURCE.OGL;
                        saveVendorSite(item); // Hàm này tự động add/update vào esdHTKTvendorSite
                    });
                }
            }

            // =====================================================================
            // BƯỚC 3: Tạo site NẾU CHƯA CÓ trên OGL
            // =====================================================================
            if (!vendorExistInOGL) {
                var vendorInfo = buildVendorAndSiteInfo(vendorData, defaultVendorSiteInfo, branchCode, entityCode, username, vendorNameFromOGL);
                var response = createVendor(vendorInfo, vendorId);

                if (response) {
                    if (response['success'] === true) {
                        vendorExistInOGL = true;
                    } else {
                        return response; // Trả về lỗi ra ngoài nếu tạo OGL thất bại
                    }
                }
            }

            // =====================================================================
            // Cập nhật trạng thái sau khi Đồng bộ (B2) hoặc Tạo mới (B3) thành công
            // =====================================================================
            if (vendorExistInOGL) {
                markVendorOglSyncedIfNeeded(vendorId, vendorData['ogl.sync.status']);
                prepaymentVendor['ogl.sync.status'] = true;
                markSupplierAccountedIfNeeded(supplierId, isXdcb, vendorTaxCode);
            }
        }
    }

    // HHDV vẫn tự gán site như trước; XDCB cần trả ID site cho cả TT và từng món DC.
    if (isXdcb) {
        if (prepaymentVendor['ogl.sync.status']) {
            var vendorSites = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorSiteList(vendorId, branchCode);
            for (var i = 0; i < vendorSites.length; i++) {
                if (String(vendorSites[i]['ogl.site.code']) === String(defaultVendorSiteInfo.siteCode)) {
                    prepaymentVendor['vendor.site.id'] = String(vendorSites[i]['id']);
                    return {
                        success: true,
                        siteId: prepaymentVendor['vendor.site.id']
                    };
                }
            }
        }
        prepaymentVendor['ogl.sync.status'] = false;
        return {
            success: false,
            message: "Chưa lưu/gán được site XDCB cho NCC trong S6."
        };
    }

    return {
        success: true,
        vendorNumber: (vendorData && vendorData['vendor.number']) || ""
    };
}
/**
 * Tạo payload gọi Tạo NCC/site sang OGL
 * @param esdHTKTvendor
 * @param defaultVendorSiteInfo
 * @param branchCode
 * @param entityCode
 * @returns
 */
function buildVendorAndSiteInfo(esdHTKTvendor, defaultVendorSiteInfo, branchCode, entityCode, username, vendorNameFromOGL) {
    return {
        entity: branchCode,
        username: username,
        vendorNumber: esdHTKTvendor['vendor.number'],
        vendorName: vendorNameFromOGL || esdHTKTvendor['vendor.name'],
        vendorSiteCode: defaultVendorSiteInfo.siteCode,
        country: "VN",
        address: esdHTKTvendor['address'],
        drSegment1: entityCode,
        drSegment2: "000000",
        drSegment3: defaultVendorSiteInfo.debitAccount,
        drSegment4: "0000000",
        drSegment5: "0000000",
        drSegment6: "0000000",
        drSegment7: "0000000",
        crSegment1: entityCode,
        crSegment2: "000000",
        crSegment3: defaultVendorSiteInfo.creditAccount,
        crSegment4: "0000000",
        crSegment5: "0000000",
        crSegment6: "0000000",
        crSegment7: "0000000"
    };
}

/**
 * Tạo NCC/site sang OGL
 * @param request
 * @param vendor.Id
 * @returns
 */
function createVendor(request, vendorId) {
    var response = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.createVendorSiteInfo(request);
    //    print('save - create = ', JSON.stringify(response));
    if (response && response['success'] === true) {
        saveVendorSite({
            'vendor.id': vendorId,
            entity: request.entity,
            vendorSiteCode: request.vendorSiteCode,
            creditAccount: lib.ESD_HTKT_ACCOUNTING_UTILS.buildAccountSegment(request.crSegment3, request.crSegment1),
            debitAccount: lib.ESD_HTKT_ACCOUNTING_UTILS.buildAccountSegment(request.drSegment3, request.drSegment1),
            source: lib.ESD_HTKT_PREPAYMENT_WF.VENDOR_SITE_SOURCE.QLTS
        });
    }
    return response;
}

/**
 * Lưu thông tin vendorSite vào esdHTKTvendorSite
 * @param item
 * @returns
 */
function saveVendorSite(item) {
    var vendorSite = new SCFile('esdHTKTvendorSite');
    var rs = vendorSite.doSelect(`vendor.id = "${item['vendor.id']}" and ogl.site.code = "${item.vendorSiteCode}" and ogl.entity = "${item.entity}"`);
    if (rs == RC_SUCCESS) {
        vendorSite['ogl.sync.status'] = true;
        vendorSite['credit.account'] = item.creditAccount;
        vendorSite['debit.account'] = item.debitAccount;
        if (item.source) vendorSite['source'] = item.source;
        vendorSite.active = true;
        vendorSite.doAction('update');
    } else {
        var vendorId = new Datum();
        var rcode = new Datum();
        rcode = system.functions.rtecall("getnumber", rcode, vendorId, "esdHTKTvendorSite");

        vendorSite.id = vendorId;
        vendorSite['vendor.id'] = item['vendor.id'];
        vendorSite['ogl.entity'] = item.entity;
        vendorSite['ogl.sync.status'] = true;
        vendorSite['ogl.site.code'] = item.vendorSiteCode;
        vendorSite['credit.account'] = item.creditAccount;
        vendorSite['debit.account'] = item.debitAccount;
        if (item.source) vendorSite['source'] = item.source;
        vendorSite.active = true;
        vendorSite.doAction('add');
    }

    return vendorSite;
}

function loadPrepaymentVendorInfo(record) {
    // TU XDCB dùng loader HĐ/HS/NCC chung của TT; không chạy JOIN HĐ S2/PO bên dưới.
    if (lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb(record)) {
        var rows = lib.ESD_HTKT_PAYMENT_VENDOR.loadPaymentXdcbVendorInfoSafe(record);
        var context = lib.ESD_HTKT_PAYMENT_VENDOR.getPaymentXdcbContext(record, false);
        // Phiếu đã duyệt/hạch toán giữ bảo lãnh đã lưu; phiếu đang nhập đọc bảo lãnh từ S4.
        var locked = context.payment.status === "approved" || context.payment.status === "accounted";
        var guarantee = locked ? null : getPrepaymentGuaranteeInfo(context.payment["contract.id"]);
        vars.$guaranteeNo = locked ? context.payment["guarantee.no"] || "" : "";
        vars.$issuingBank = locked ? context.payment["issuing.bank"] || "" : "";
        vars.$guaranteeAmount = locked ? context.payment["guarantee.amount"] : guarantee ? guarantee.value : "";
        vars.$expireDate = locked ? context.payment["guarantee.expiry.date"] : guarantee ? guarantee["expire.date"] : null;
        return rows;
    }
    try {
        // 1. LẤY CHÍNH XÁC CẶP ID TỪ RECORD ĐỂ KHÔNG BỊ LẪN LỘN DỮ LIỆU
        var prepaymentId = record["prepayment.id"] || record["id"] || "";
        var vendorId = record["vendor.id"] || "";
        var poIdInput = record["po.id"] || "";
        if (!prepaymentId) {
            return;
        }
        var joinContractIdField = (poIdInput !== "") ? "hpv.po.id" : "hp.contract.id";
        var itemFile = new SCFile("esdHTKTprepaymentVendor");

        var itemQuery =
            'select hv.supplier.id as supplier.id,' +
            ' hv.vendor.name as supplier.name,' +
            ' hpv.payment.method as payment.method,' +
            ' hpv.amount as amount,' +
            ' hpv.po.id as po.id,' + // <-- Đã lấy mã PO
            ' hpv.contract.amount as contract.amount,' +
            ' hdVendor.unpaid.amount as unpaid.amount,' +
            ' hv.vendor.number as tax.code,' +
            ' hpv.ogl.sync.status as ogl.sync.status,' +
            ' hvs.ogl.site.code as ogl.site.code,' +
            ' hvs.ogl.sync.status as hvs.ogl.sync.status,' +
            ' hpv.vendor.site.id as vendor.site.id,' +
            ' hpv.currency as currency,' +
            ' hp.unit.lv1 as unit.lv1,' +
            ' hp.unit.lv2 as unit.lv2,' +
            ' hp.current.phase as current.phase,' +
            ' hp.status as status,' +
            ' hp.created.by as created.by,' +
            ' hp.initial.role as initial.role,' +
            ' hp.user.checker.kttc as user.checker.kttc,' +
            ' hp.contract.id as contract.id,' +
            ' hp.guarantee.no as guarantee.no,' +
            ' hp.issuing.bank as issuing.bank,' +
            ' hp.guarantee.amount as guarantee.amount,' +
            ' hp.guarantee.expiry.date as guarantee.expiry.date' +
            ' from esdHTKTprepaymentVendor hpv' +
            ' LEFT JOIN esdHTKTvendor hv ON (hpv.vendor.id = hv.id)' +
            ' LEFT JOIN esdHTKTprepayment hp ON (hpv.prepayment.id = hp.id)' +
            ' LEFT JOIN esdHTKTvendorSite hvs ON (hvs.id = hpv.vendor.site.id)' +
            //                ' LEFT JOIN esdHDcontractSupplier hdVendor ON (hp.contract.id = hdVendor.contract.id AND hv.supplier.id = hdVendor.supplier.id)' +
            ' LEFT JOIN esdHDcontractSupplier hdVendor ON (' + joinContractIdField + ' = hdVendor.contract.id AND hv.supplier.id = hdVendor.supplier.id)' +
            ' where hpv.prepayment.id = "' + prepaymentId + '" and hpv.vendor.id = "' + vendorId + '"';
        if (poIdInput !== "") {
            itemQuery += ' and hpv.po.id = "' + poIdInput + '"';
        }
        var rcMain = itemFile.doSelect(itemQuery);

        if (rcMain == RC_SUCCESS) {
            vars.$currency = itemFile["currency"];
            vars.$supplierId = itemFile["supplier.id"];
            vars.$supplierCode = vars.$supplierId || "";

            // =========================================================
            // BỔ SUNG CỤM THÔNG TIN PO/PHIẾU ĐẶT HÀNG LÊN MÀN HÌNH VIEW
            // =========================================================
            vars.$poId = itemFile["po.id"];
            vars.$poContractName = "";
            vars.$poContractValueAfterTax = "";
            vars.$poContractCreatedAt = null;

            var rawPoValue = null; // Biến tạm để giữ giá trị thô của PO

            if (vars.$poId !== "") {
                var poFile = new SCFile("esdHDcontract", SCFILE_READONLY);
                // Tìm kiếm PO trong bảng hợp đồng dựa theo mã po.id
                if (poFile.doSelect('id="' + vars.$poId + '"') == RC_SUCCESS) {
                    vars.$poContractName = poFile["name"];

                    // Lấy giá trị tổng gốc để hiển thị trên UI
                    var originalPoValue = String(poFile["contract.value.after.tax"] || "0").replace(/,/g, '').trim();
                    if (originalPoValue === "") originalPoValue = "0";

                    // Gán vào biến UI (có fomat phân cách hàng nghìn)
                    vars.$poContractValueAfterTax = originalPoValue.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

                    vars.$poContractCreatedAt = poFile["created.at"];

                    // ---------------------------------------------------------
                    // [TÍNH ĐỘNG] - LẤY SỐ TIỀN CÒN LẠI TỪ BẢNG CÔNG NỢ
                    // ---------------------------------------------------------
                    var totalPaidAmt = "0";
                    var totalAdvanceAmt = "0";

                    var debtFile = new SCFile("esdHTKTreportVendorDebt", SCFILE_READONLY);

                    // CHÚ Ý: Giả định PO ID được lưu tại trường "contract.id" trong bảng báo cáo công nợ. 
                    // Nếu bên bạn lưu PO ID ở trường tên khác (vd: po.id), hãy thay chữ "contract.id" thành tên tương ứng.
                    var debtQuery = 'contract.id="' + vars.$poId + '"';

                    if (debtFile.doSelect(debtQuery) == RC_SUCCESS) {
                        totalPaidAmt = String(debtFile["total.paid.amount"] || "0").replace(/,/g, '').trim();
                        totalAdvanceAmt = String(debtFile["total.advance.amount"] || "0").replace(/,/g, '').trim();

                        if (totalPaidAmt === "") totalPaidAmt = "0";
                        if (totalAdvanceAmt === "") totalAdvanceAmt = "0";
                    }
                    try { debtFile.doClose(); } catch (e) { }

                    // Thực hiện phép trừ: rawPoValue = (Tổng PO) - (Tổng ĐNTT) - (Tổng ĐNTU)
                    try {
                        var tempRemaining = lib.ESD_HTKT_Utils.subtractStringsManual(originalPoValue, totalPaidAmt);
                        rawPoValue = lib.ESD_HTKT_Utils.subtractStringsManual(tempRemaining, totalAdvanceAmt);
                    } catch (mathErr) {
                        // Fallback an toàn nếu hàm thư viện báo lỗi ép kiểu
                        var fOriginal = parseFloat(originalPoValue) || 0;
                        var fPaid = parseFloat(totalPaidAmt) || 0;
                        var fAdvance = parseFloat(totalAdvanceAmt) || 0;
                        rawPoValue = (fOriginal - fPaid - fAdvance).toString();
                    }
                }
                try { poFile.doClose(); } catch (e) { }
            }
            // =========================================================

            if (vars.$L_file) {
                vars.$L_file["payment.method"] = itemFile["payment.method"];
            }

            vars.$taxCode = itemFile["tax.code"];
            vars.$supplierdisplays = [itemFile["supplier.name"]];
            vars.$suppliervalues = [itemFile["supplier.id"]];
            vars.$oglSiteCode = itemFile["ogl.site.code"];

            // ----------------- XỬ LÝ LOGIC STATUS (BẢO LÃNH & REMAINING AMOUNT) -----------------
            var prepaymentStatus = itemFile["status"];
            var isApprovedOrAccounted = (prepaymentStatus === "approved" || prepaymentStatus === "accounted");
            var bankCode = "";

            if (isApprovedOrAccounted) {
                // ƯU TIÊN 1: PHIẾU ĐÃ CHỐT -> LẤY TỪ BẢNG PREPAYMENT VENDOR BẤT KỂ LÀ PO HAY HĐ
                vars.$remainingAmt = itemFile["contract.amount"];
            } else {
                // ƯU TIÊN 2: NẾU LÀ PHIẾU ĐẶT HÀNG (CÓ PO) ĐANG XỬ LÝ -> LẤY VALUE.AFTER.TAX CỦA PO
                if (vars.$poId != null && vars.$poId !== "") {
                    vars.$remainingAmt = rawPoValue;
                }
                // ƯU TIÊN 3: LÀ HỢP ĐỒNG ĐANG XỬ LÝ -> LẤY UNPAID.AMOUNT TỪ HỢP ĐỒNG GỐC
                else {
                    vars.$remainingAmt = itemFile["unpaid.amount"];
                }
            }

            // XỬ LÝ BẢO LÃNH
            if (isApprovedOrAccounted) {
                vars.$guaranteeNo = itemFile["guarantee.no"];
                bankCode = itemFile["issuing.bank"];
                vars.$guaranteeAmount = itemFile["guarantee.amount"];
                vars.$expireDate = itemFile["guarantee.expiry.date"];
            } else {
                vars.$guaranteeNo = "";
                bankCode = "";
                vars.$guaranteeAmount = "";
                vars.$expireDate = "";

                var contractId = itemFile["contract.id"];
                if (contractId != null && contractId !== "") {
                    var docInfoFile = new SCFile("esdHDcontractDocInfo");
                    var docQuery = 'contract.id="' + contractId + '" and doc.type="BAOLANHTU" and status="Co hieu luc"';
                    var rcDoc = docInfoFile.doSelect(docQuery);

                    if (rcDoc == RC_SUCCESS) {
                        vars.$guaranteeNo = docInfoFile["doc.no"];
                        bankCode = docInfoFile["issuing.bank"];
                        vars.$guaranteeAmount = docInfoFile["guarantee.amount"];
                        vars.$expireDate = docInfoFile["expire.date"];
                    }
                    try { docInfoFile.doClose(); } catch (e) { }
                }
            }

            // =========================================================
            // MAP MÃ NGÂN HÀNG -> TÊN NGÂN HÀNG
            // =========================================================
            var bankNameDisplay = bankCode;
            if (bankCode) {
                try {
                    var bankMapFile = new SCFile("esdDMcategoryItems", SCFILE_READONLY);
                    var rcBankMap = bankMapFile.doSelect('category.id="dmhd_ngan_hang" and item.id="' + bankCode + '"');

                    if (rcBankMap == RC_SUCCESS) {
                        bankNameDisplay = bankMapFile["item.name"];
                    }
                    try { bankMapFile.doClose(); } catch (e) { }
                } catch (e) { }
            }
            vars.$issuingBank = bankNameDisplay;

            // --------------------------------------------------------------------
            var rawAmount = itemFile["amount"];
            if (rawAmount != null && rawAmount !== "") {
                vars.$isAmount = rawAmount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
            } else {
                vars.$isAmount = "";
            }

            vars.$unitLv1 = itemFile["unit.lv1"];
            vars.$unitLv2 = itemFile["unit.lv2"];

            vars.$showSyncVendorOgl =
                itemFile["current.phase"] == "initial_kttc" &&
                (
                    itemFile["user.checker.kttc"] == vars.$lo_operator["contact.name"] ||
                    (
                        itemFile["created.by"] == vars.$lo_operator["contact.name"] &&
                        itemFile["initial.role"] == "kttc"
                    )
                );

            vars.$canEditSite = vars.$showSyncVendorOgl && itemFile["ogl.sync.status"] == true;

            vars.$canEditObj =
                (
                    itemFile["current.phase"] == "initial_dmms" &&
                    itemFile["created.by"] == vars.$lo_operator["contact.name"] &&
                    itemFile["initial.role"] == "dmms"
                ) ||
                (
                    itemFile["current.phase"] == "initial_kttc" &&
                    (
                        itemFile["user.checker.kttc"] == vars.$lo_operator["contact.name"] ||
                        (
                            itemFile["created.by"] == vars.$lo_operator["contact.name"] &&
                            itemFile["initial.role"] == "kttc"
                        )
                    )
                );
        }

        try { itemFile.doClose(); } catch (e) { }

    } catch (ex) { }
}

function formatDateToDDMMYYYY(rawDate) {
    if (!rawDate) return "";

    try {
        // Cắt lấy phần YYYY-MM-DD từ chuỗi ISO
        var datePart = rawDate.toString().substring(0, 10);
        var parts = datePart.split("-"); // [YYYY, MM, DD]

        if (parts.length === 3) {
            var year = parts[0];
            var month = parts[1];
            var day = parts[2];

            return day + "/" + month + "/" + year;
        }
    } catch (e) {
        print("Lỗi định dạng ngày: " + e.toString());
    }

    return rawDate;
}

function queryVendorData(record) {
    // Lấy giá trị prepaymentId và vendorTaxCode từ record hiện tại trên form
    var prepaymentId = record.prepaymentId; // Hoặc vars.$prepaymentId tùy theo cách bạn đặt tên biến
    var vendorTaxCode = record.vendorTaxCode; // Hoặc vars.$vendorTaxCode

    // Kiểm tra nếu đủ điều kiện thì mới thực hiện query
    if (prepaymentId && vendorTaxCode) {
        var sqlVendor = "prepayment.id=\"" + prepaymentId + "\" and vendor.id=\"" + vendorTaxCode + "\"";

        // Khởi tạo đối tượng SCFile trỏ đến bảng cần query (ví dụ: esdHTKTprepaymentVendor hoặc bảng chứa dữ liệu vendor)
        var vendorFile = new SCFile("esdHTKTprepaymentVendor");
        var rc = vendorFile.doSelect(sqlVendor);

        if (rc == RC_SUCCESS) {
            // Gán dữ liệu tìm được từ DB vào các trường/biến trên màn hình
            record.totalBeforeTax = vendorFile.totalBeforeTax;
            record.vendorName = vendorFile.vendorName;

            // Nếu muốn bật/tắt trạng thái readonly của trường
            vars.$isAmountReadonly = true;
        } else {
            // Xử lý khi không tìm thấy dữ liệu phù hợp
            print("Không tìm thấy bản ghi phù hợp với điều kiện: " + sqlVendor);
        }
    }
}

/**
 * Cập nhật số tiền còn lại từ sq2 vào trường contract.amount của bảng prepaymentVendor
 * @param {SCFile} record - Bản ghi ticket hiện tại đang được phê duyệt
 */
/**
 * Lấy số tiền unpaid.amount từ hợp đồng truyền vào contract.amount của prepaymentVendor
 * @param {SCFile} record - Bản ghi ticket hiện tại đang được phê duyệt (esdHTKTprepayment)
 */
function updateVendorContractAmount(record) {
    // TU XDCB: lưu số dư từng NCC/HS từ reader chung, không JOIN supplier.id của S2.
    if (lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb(record)) {
        var sourceRows = lib.ESD_HTKT_PAYMENT_VENDOR.getPaymentXdcbRemainingAmounts(record.id);
        var item = new SCFile("esdHTKTprepaymentVendor");
        try {
            for (var i = 0; i < sourceRows.length; i++) {
                if (item.doSelect('id="' + escapePrepaymentVendorQueryValue(sourceRows[i].id) + '"') === RC_SUCCESS) {
                    item["contract.amount"] = sourceRows[i].remaining_amount;
                    item.doUpdate();
                }
            }
        } finally {
            item.doClose();
        }
        return true;
    }

    var prepaymentId = String(record.id || record["id"] || "");
    if (!prepaymentId) {
        return false;
    }

    var prepVendorFile = new SCFile("esdHTKTprepaymentVendor");

    // Tìm TẤT CẢ nhà cung cấp thuộc phiếu này
    var rc = prepVendorFile.doSelect('prepayment.id="' + prepaymentId + '"');

    // VÒNG LẶP: Xử lý cho từng nhà cung cấp
    while (rc == RC_SUCCESS) {
        var currentContractId = String(prepVendorFile["contract.id"] || record.contract_id || record["contract.id"] || "");
        var vendorId = prepVendorFile["vendor.id"];
        var poId = String(prepVendorFile["po.id"] || "").trim(); // Lấy mã PO của dòng hiện tại
        var currentSupplierId = "";

        if (vendorId) {
            var vendorFile = new SCFile("esdHTKTvendor", SCFILE_READONLY);
            if (vendorFile.doSelect('id="' + vendorId + '"') == RC_SUCCESS) {
                currentSupplierId = String(vendorFile["supplier.id"] || "");
            }
            try { vendorFile.doClose(); } catch (e) { }
        }

        if (currentSupplierId) {
            var unpaidAmount = "0";

            // ====================================================================================
            // TRƯỜNG HỢP 1: CÓ PO -> TÍNH TOÁN DỰA TRÊN TỔNG PO TRỪ ĐI ĐÃ THANH TOÁN / TẠM ỨNG
            // ====================================================================================
            if (poId !== "") {
                var originalPoValue = "0";

                // Lấy giá trị gốc của PO
                var poFile = new SCFile("esdHDcontract", SCFILE_READONLY);
                if (poFile.doSelect('id="' + poId + '"') == RC_SUCCESS) {
                    originalPoValue = String(poFile["contract.value.after.tax"] || "0").replace(/,/g, '').trim();
                    if (originalPoValue === "") originalPoValue = "0";
                }
                try { poFile.doClose(); } catch (e) { }

                // Lấy công nợ của PO
                var totalPaidAmt = "0";
                var totalAdvanceAmt = "0";
                var debtFile = new SCFile("esdHTKTreportVendorDebt", SCFILE_READONLY);
                var debtQuery = 'contract.id="' + poId + '"'; // Chú ý: Trường hợp này giả định PO lưu ở contract.id

                if (debtFile.doSelect(debtQuery) == RC_SUCCESS) {
                    totalPaidAmt = String(debtFile["total.paid.amount"] || "0").replace(/,/g, '').trim();
                    totalAdvanceAmt = String(debtFile["total.advance.amount"] || "0").replace(/,/g, '').trim();

                    if (totalPaidAmt === "") totalPaidAmt = "0";
                    if (totalAdvanceAmt === "") totalAdvanceAmt = "0";
                }
                try { debtFile.doClose(); } catch (e) { }

                // Thực hiện phép trừ: Giá trị PO - Thanh toán - Tạm ứng
                try {
                    var tempRemaining = lib.ESD_HTKT_Utils.subtractStringsManual(originalPoValue, totalPaidAmt);
                    unpaidAmount = lib.ESD_HTKT_Utils.subtractStringsManual(tempRemaining, totalAdvanceAmt);
                } catch (mathErr) {
                    // Fallback
                    var fOriginal = parseFloat(originalPoValue) || 0;
                    var fPaid = parseFloat(totalPaidAmt) || 0;
                    var fAdvance = parseFloat(totalAdvanceAmt) || 0;
                    unpaidAmount = (fOriginal - fPaid - fAdvance).toString();
                }
            }
            // ====================================================================================
            // TRƯỜNG HỢP 2: KHÔNG CÓ PO -> LẤY TỪ HỢP ĐỒNG GỐC THEO SUPPLIER
            // ====================================================================================
            else if (currentContractId) {
                var contractSupplierFile = new SCFile("esdHDcontractSupplier", SCFILE_READONLY);
                if (contractSupplierFile.doSelect('contract.id="' + currentContractId + '" and supplier.id="' + currentSupplierId + '"') == RC_SUCCESS) {
                    unpaidAmount = String(contractSupplierFile["unpaid.amount"] || "0.00");
                }
                try { contractSupplierFile.doClose(); } catch (e) { }
            }

            // Gán lại số tiền đã tính toán
            prepVendorFile["contract.amount"] = unpaidAmount;
            prepVendorFile.doUpdate();
        }

        // Chuyển sang nhà cung cấp tiếp theo trong phiếu
        rc = prepVendorFile.getNext();
    }

    try { prepVendorFile.doClose(); } catch (e) { }

    return true;
}

function updateRemainingAmountForPendingTickets(record) {
    // XDCB dùng lại hàm cập nhật số dư TU ở trên; HHDV giữ phần xử lý phiếu chờ bên dưới.
    if (lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb(record)) {
        return updateVendorContractAmount(record);
    }
    var prepaymentId =
        String(record.id || record["id"] || "");

    if (!prepaymentId) {
        return;
    }

    var currentContractId =
        String(
            record.contract_id ||
            record["contract.id"] ||
            ""
        );

    var currentRequestAmount = "0.00";
    var currentSupplierId = "";

    // =========================================================
    // 1. Lấy thông tin phiếu vừa được duyệt
    // =========================================================
    var prepVendorFile =
        new SCFile(
            "esdHTKTprepaymentVendor",
            SCFILE_READONLY
        );

    if (
        prepVendorFile.doSelect(
            'prepayment.id="' + prepaymentId + '"'
        ) == RC_SUCCESS
    ) {

        currentRequestAmount =
            String(
                prepVendorFile["amount"] || "0.00"
            );

        if (!currentContractId) {
            currentContractId =
                String(
                    prepVendorFile["contract.id"] || ""
                );
        }

        var vendorId =
            prepVendorFile["vendor.id"];

        if (vendorId) {

            var vendorFile =
                new SCFile(
                    "esdHTKTvendor",
                    SCFILE_READONLY
                );

            if (
                vendorFile.doSelect(
                    'id="' + vendorId + '"'
                ) == RC_SUCCESS
            ) {
                currentSupplierId =
                    String(
                        vendorFile["supplier.id"] || ""
                    );
            }

            try {
                vendorFile.doClose();
            } catch (e) { }
        }
    }

    try {
        prepVendorFile.doClose();
    } catch (e) { }

    if (!currentContractId || !currentSupplierId) {
        return;
    }


    // =========================================================
    // 2. Lấy giá trị gốc của NCC trong hợp đồng
    // =========================================================
    var contractSupplierFile =
        new SCFile(
            "esdHDcontractSupplier",
            SCFILE_READONLY
        );

    if (
        contractSupplierFile.doSelect(
            'contract.id="' +
            currentContractId +
            '" and supplier.id="' +
            currentSupplierId +
            '"'
        ) == RC_SUCCESS
    ) {

        var initialAmount =
            String(
                contractSupplierFile["remaining.amount"] ||
                "0.00"
            );


        // =====================================================
        // 2.1 Tổng các phiếu đã duyệt trước đó
        //     Không lấy phiếu hiện tại
        // =====================================================
        var totalOtherApprovedAmount =
            "0.00";

        var checkFile =
            new SCFile(
                "esdHTKTprepaymentVendor",
                SCFILE_READONLY
            );

        var checkQuery =
            'select pv.amount as amount ' +
            'from esdHTKTprepaymentVendor pv ' +
            'join esdHTKTprepayment p ' +
            'on (pv.prepayment.id = p.id) ' +
            'join esdHTKTvendor v ' +
            'on (pv.vendor.id = v.id) ' +
            'where p.contract.id="' +
            currentContractId +
            '" ' +
            'and v.supplier.id="' +
            currentSupplierId +
            '" ' +
            'and (p.status="approved" or p.status="accounted") ' +
            'and p.id ~= "' +
            prepaymentId +
            '"';

        var rcCheck =
            checkFile.doSelect(checkQuery);

        while (rcCheck == RC_SUCCESS) {

            totalOtherApprovedAmount =
                lib.ESD_HTKT_Utils.addStringsManual(
                    totalOtherApprovedAmount,
                    String(
                        checkFile["amount"] || "0.00"
                    )
                );

            rcCheck =
                checkFile.getNext();
        }

        try {
            checkFile.doClose();
        } catch (e) { }


        // =====================================================
        // 2.2 Tính số tiền còn lại

        var newRemainingAmount =
            lib.ESD_HTKT_Utils.subtractStringsManual(
                initialAmount,
                totalOtherApprovedAmount
            );

        newRemainingAmount =
            lib.ESD_HTKT_Utils.subtractStringsManual(
                newRemainingAmount,
                currentRequestAmount
            );


        // =====================================================
        // 3. Cập nhật số dư cho tất cả phiếu đang chờ duyệt
        // =====================================================
        var pendingFile =
            new SCFile(
                "esdHTKTprepaymentVendor"
            );

        var pendingQuery =
            'select pv.id as id ' +
            'from esdHTKTprepaymentVendor pv ' +
            'join esdHTKTprepayment p ' +
            'on (pv.prepayment.id = p.id) ' +
            'join esdHTKTvendor v ' +
            'on (pv.vendor.id = v.id) ' +
            'where p.contract.id="' +
            currentContractId +
            '" ' +
            'and v.supplier.id="' +
            currentSupplierId +
            '" ' +
            'and p.id ~= "' +
            prepaymentId +
            '" ' +
            'and p.status ~= "approved" ' +
            'and p.status ~= "accounted" ' +
            'and p.status ~= "cancelled"';

        var rcPending =
            pendingFile.doSelect(pendingQuery);

        while (rcPending == RC_SUCCESS) {

            var pvId =
                pendingFile["id"];

            var updateFile =
                new SCFile(
                    "esdHTKTprepaymentVendor"
                );

            if (
                updateFile.doSelect(
                    'id="' + pvId + '"'
                ) == RC_SUCCESS
            ) {

                updateFile["contract.amount"] =
                    newRemainingAmount;

                updateFile.doUpdate();
            }

            try {
                updateFile.doClose();
            } catch (e) { }

            rcPending =
                pendingFile.getNext();
        }

        try {
            pendingFile.doClose();
        } catch (e) { }
    }

    try {
        contractSupplierFile.doClose();
    } catch (e) { }
}


/**
 * Đọc bảo lãnh tạm ứng S4 theo contract.id của HĐ gốc, dùng cho màn NCC và kiểm tra hóa đơn.
 * Chỉ lấy value/expire.date; S4 chưa có số bảo lãnh và ngân hàng nên không tự suy ra từ ID.
 */
function getPrepaymentGuaranteeInfo(contractId) {
    if (!contractId) return null;
    return lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.expenseSupplierReadOne(
        "esdXDCBrepairProjectCtrGuarantee",
        'contract.id="' + escapePrepaymentVendorQueryValue(contractId) + '" and name="Bảo lãnh tạm ứng"',
        ["id", "name", "contract.id", "value", "expire.date", "currency"],
        false
    );
}