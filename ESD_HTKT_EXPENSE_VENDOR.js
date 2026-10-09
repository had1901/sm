/**
 * ScriptLibrary : ESD_HTKT_EXPENSE_VENDOR
 * Chức năng      : Cung cấp danh sách nhà cung cấp cho màn Dự chi.
 * Nguồn dữ liệu  : esdHTKTpaymentVendor kết hợp esdHTKTvendor.
 * Tối ưu         : Lấy thông tin NCC và tổng số hóa đơn trong một truy vấn,
 *                  không truy vấn bổ sung theo từng NCC.
 */

function run() {
    try {
        var input = vars["$L.file"];
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
            // Danh sách món Dự chi theo nhà cung cấp.
            case "getListExpenseVendor":
                result = { success: true, data: getListExpenseVendor(input) };
                break;
            // Tạo esdHTKTpaymentVendor từ Hợp đồng/Khoản mua sắm được chọn.
            case "createPaymentVendor":
                result = createPaymentVendor(input);
                break;
            // Xóa món Dự chi theo ID esdHTKTpaymentVendor.
            case "deleteExpenseVendor":
                result = deleteExpenseVendor(input);
                break;
            default:
                result = {
                    success: false,
                    error: "Hanh dong (name) khong hop le: " + name
                };
        }

        input.queryReturn = JSON.stringify(result);
    } catch (e) {
        if (vars["$L.file"]) {
            vars["$L.file"].queryReturn = JSON.stringify({
                success: false,
                error: "Gateway Error: " + e.toString()
            });
        }
    }
}

function deleteExpenseVendor(input) {
    var params = getExpenseVendorInputDetails(input);
    var paymentId = normalizeExpenseVendorValue(params.paymentId || params.expenseId);
    var paymentVendorId = normalizeExpenseVendorValue(params.paymentVendorId || params.itemId || params.id);

    if (!paymentId || !paymentVendorId) {
        return { success: false, status: "error", message: "Thiếu paymentId hoặc paymentVendorId." };
    }

    var relationFile = new SCFile("esdHTKTpaymentVendor");
    try {
        var query = 'id="' + escapeExpenseVendorQueryValue(paymentVendorId) +
            '" and payment.id="' + escapeExpenseVendorQueryValue(paymentId) + '"';
        if (relationFile.doSelect(query) !== RC_SUCCESS) {
            return { success: false, status: "error", message: "Không tìm thấy món Dự chi cần xóa." };
        }

        var deleteRc = relationFile.doDelete();
        if (deleteRc !== RC_SUCCESS) {
            return { success: false, status: "error", message: "Xóa món Dự chi thất bại. Code: " + deleteRc };
        }

        return { success: true, status: "success", message: "Xóa món Dự chi thành công." };
    } finally {
        closeExpenseVendorFile(relationFile);
    }
}

/**
 * Tạo món Dự chi theo hợp đồng được chọn và trả về đúng ID bản ghi vừa tạo.
 */
function createPaymentVendor(input) {
    var paymentFile = null;
    try {
        var params = getExpenseVendorInputDetails(input);
        var paymentId = normalizeExpenseVendorValue(params.paymentId || params.expenseId);
        var currentUser = normalizeExpenseVendorValue(params.currentUser);
        var contracts = params.contracts instanceof Array ? params.contracts : [];

        if (!paymentId) return { success: false, message: "Thiếu mã phiếu Dự chi." };
        if (!currentUser) return { success: false, message: "Không xác định được người thực hiện." };
        if (contracts.length === 0) return { success: false, message: "Chưa chọn hợp đồng." };

        var createdItems = [];
        var seen = {};
        for (var i = 0; i < contracts.length; i++) {
            var contract = contracts[i] || {};
            var contractId = normalizeExpenseVendorValue(contract.id || contract["contract.id"]);
            if (!contractId || seen[contractId]) continue;
            seen[contractId] = true;

            var paymentVendorId = generateExpensePaymentVendorId();
            var relationFile = new SCFile("esdHTKTpaymentVendor");
            try {
                relationFile["id"] = paymentVendorId;
                relationFile["payment.id"] = paymentId;
                relationFile["contract.id"] = contractId;
                relationFile["currency"] = contract.currency || "VND";
                relationFile["amount"] = 0;

                var addRc = relationFile.doAction("add");
                if (addRc !== RC_SUCCESS) {
                    throw new Error(
                        "Không ghi được hợp đồng " + contractId +
                        " vào esdHTKTpaymentVendor. Code: " + addRc +
                        " reason " + relationFile.getMessages()
                    );
                }

                // Ghi nhớ đúng bản ghi vừa tạo trong session SM để menu/wizard
                // kế tiếp select trực tiếp món Dự chi này.
                if (createdItems.length === 0) {
                    vars.$G_payment_vendor_id = paymentVendorId;
                    vars["$G.payment.vendor.id"] = paymentVendorId;
                    vars.$G_payment_id = paymentId;
                    vars["$G.payment.id"] = paymentId;
                    vars.$G_contract_id = contractId;
                    vars["$G.contract.id"] = contractId;
                }

                createdItems.push({ id: paymentVendorId, contractId: contractId });
            } finally {
                closeExpenseVendorFile(relationFile);
            }
        }

        if (createdItems.length > 0) {
            paymentFile = new SCFile("esdHTKTpayment");
            var paymentRc = paymentFile.doSelect(
                'id="' + escapeExpenseVendorQueryValue(paymentId) + '"'
            );
            if (paymentRc !== RC_SUCCESS) {
                throw new Error("Không tìm thấy phiếu Dự chi " + paymentId + ".");
            }

            paymentFile["total.contract"] =
                Number(paymentFile["total.contract"] || 0) + createdItems.length;
            var updateRc = paymentFile.doUpdate();
            if (updateRc !== RC_SUCCESS) {
                throw new Error(
                    "Đã thêm hợp đồng nhưng không cập nhật được tổng số hợp đồng trên phiếu. Code: " +
                    updateRc
                );
            }
        }

        var firstItem = createdItems.length > 0 ? createdItems[0] : null;
        return {
            success: true,
            message: firstItem
                ? "Thêm hợp đồng vào phiếu Dự chi thành công."
                : "Không có hợp đồng hợp lệ để thêm vào phiếu Dự chi.",
            id: firstItem ? firstItem.id : "",
            paymentVendorId: firstItem ? firstItem.id : "",
            paymentId: paymentId,
            contractId: firstItem ? firstItem.contractId : "",
            createdItems: createdItems,
            addedCount: createdItems.length
        };
    } catch (error) {
        return {
            success: false,
            message: "Lỗi thêm hợp đồng vào phiếu Dự chi: " + error.toString()
        };
    } finally {
        closeExpenseVendorFile(paymentFile);
    }
}

/**
 * Lấy danh sách nhà cung cấp theo paymentId/expenseId nhận từ request.
 *
 */
function getListExpenseVendor(input) {
    var resultList = [];
    var paymentId = getExpenseVendorPaymentId(input);
    if (!paymentId) return resultList;

    var paymentVendorFile = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
    try {
        var vendorQuery =
                "SELECT pv.id, pv.payment.id, pv.contract.id," +
                " v.vendor.number, v.vendor.name, pv.amount, pv.currency," +
                " pv.total.invoice, pv.ogl.sync.status, v.ogl.vendor.id" +
                " FROM esdHTKTpaymentVendor pv" +
                " LEFT JOIN esdHTKTvendor v ON (pv.vendor.id = v.id)" +
                ' WHERE pv.payment.id="' + escapeExpenseVendorQueryValue(paymentId) + '"';
        var vendorRc = paymentVendorFile.doSelect(vendorQuery);
        while (vendorRc == RC_SUCCESS) {
            resultList.push(buildExpenseVendorItem(paymentVendorFile));
            vendorRc = paymentVendorFile.getNext();
        }
    } finally {
        closeExpenseVendorFile(paymentVendorFile);
    }
    print("resultList" + JSON.stringify(resultList))
    return resultList;
}

function buildExpenseVendorItem(paymentVendorFile) {
    // Kết quả cross-table được đọc theo đúng thứ tự SELECT.
    var paymentVendorId = String(paymentVendorFile[0] || "");
    var paymentId = String(paymentVendorFile[1] || "");
    var contractId = String(paymentVendorFile[2] || "");
    return {
        id: paymentVendorId,
        payment_id: paymentId,
        contract_id: contractId,
        vendor_number: String(paymentVendorFile[3] || ""),
        vendor_name: String(paymentVendorFile[4] || ""),
        amount: Number(paymentVendorFile[5] || 0),
        currency: String(paymentVendorFile[6] || "VND"),
        count: Number(paymentVendorFile[7] || 0),
        ogl_sync_status: paymentVendorFile[8],
        ogl_vendor_id: String(paymentVendorFile[9] || "")
    };
}

function getExpenseVendorPaymentId(input) {
    try {
        var rawDetails = input ? (input.details || input.queryString) : null;
        if (!rawDetails) return "";
        var details = typeof rawDetails === "string" ? JSON.parse(rawDetails) : rawDetails;
        if (details instanceof Array) details = details[0] || {};
        return String(details.paymentId || details.expenseId || "").replace(/^\s+|\s+$/g, "");
    } catch (e) {
        return "";
    }
}

function getExpenseVendorInputDetails(input) {
    try {
        var rawDetails = input ? (input.details || input.queryString) : null;
        if (!rawDetails) return {};
        var details = typeof rawDetails === "string" ? JSON.parse(rawDetails) : rawDetails;
        if (details instanceof Array) details = details[0] || {};
        return details || {};
    } catch (e) {
        return {};
    }
}

function normalizeExpenseVendorValue(value) {
    return String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
}

function generateExpensePaymentVendorId() {
    var numberClass = "esdHTKTexpenseVendor";
    var numberRc = new SCDatum();
    numberRc.setValue(-1);
    var nextNumber = new SCDatum();

    system.functions.rtecall("getnumber", numberRc, nextNumber, numberClass);

    var rcText = String(numberRc.getText()).replace(/^\s+|\s+$/g, "");
    var rawNumber = String(nextNumber.getText()).replace(/^\s+|\s+$/g, "");
    if (rcText !== "0" || !rawNumber) {
        throw new Error(
            "Không cấp được ID từ Sequential Numbers " + numberClass +
            ". rc=" + rcText + ", number=" + rawNumber
        );
    }

    return rawNumber;
}

function escapeExpenseVendorQueryValue(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function closeExpenseVendorFile(file) {
    if (!file) return;
    try { file.doClose(); } catch (e) {}
}

function loadPaymentVendorInfo(record) {
    var itemFile = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
    vars.$arrVendors = [];
    vars.$supplierdisplays = [];
    vars.$suppliervalues = [];

    var itemQuery =
            'select hpv.contract.id as contract.id,' +
            ' hv.supplier.id as current.supplier.id,' +
            ' hv.vendor.name as current.supplier.name,' +
            ' hv.vendor.number as current.tax.code,' +
            ' hdVendor.supplier.id as supplier.id,' +
            ' hdVendor.supplier.name as supplier.name,' +
            ' dmVendor.tax.code as tax.code,' +
            ' hpv.amount as amount,' +
            ' hpv.ogl.sync.status as ogl.sync.status,' +
            ' hvs.ogl.site.code as ogl.site.code,' +
            ' hpv.currency as currency,' +
            ' hp.unit.lv1 as unit.lv1,' +
            ' hp.unit.lv2 as unit.lv2,' +
            ' hp.description as description,' +
            ' hp.current.phase as current.phase,' +
            ' hp.created.by as created.by,' +
            ' hp.initial.role as initial.role,' +
            ' hp.user.checker.kttc as user.checker.kttc' +
            ' from esdHTKTpaymentVendor hpv' +
            ' LEFT JOIN esdHTKTvendor hv ON (hpv.vendor.id = hv.id)' +
            ' LEFT JOIN esdHTKTpayment hp ON (hpv.payment.id = hp.id)' +
            ' LEFT JOIN esdHTKTvendorSite hvs ON (hvs.id = hpv.vendor.site.id)' +
            ' LEFT JOIN esdHDcontractSupplier hdVendor ON (hpv.contract.id = hdVendor.contract.id)' +
            ' LEFT JOIN esdDMSupplier dmVendor ON (hdVendor.supplier.id = dmVendor.id)' +
            ' where hpv.id = "' + escapeExpenseVendorQueryValue(record.id) + '"';

    arrVendors = [];
    var supplierIds = {};
    var itemRc = itemFile.doSelect(itemQuery);
    var hasItem = itemRc == RC_SUCCESS;
    var isFirstItem = true;
    var currentPhase = "";
    var createdBy = "";
    var initialRole = "";
    var checkerKttc = "";
    var oglSyncStatus = false;

    while (itemRc == RC_SUCCESS) {
        if (isFirstItem) {
            vars.$currency = itemFile["currency"];
            vars.$supplierId = itemFile["current.supplier.id"];
            vars.$supplierName = itemFile["current.supplier.name"];
            vars.$taxCode = itemFile["current.tax.code"];
            vars.$oglSiteCode = itemFile["ogl.site.code"];
            vars.$amount = itemFile["amount"];
            vars.$unitLv1 = itemFile["unit.lv1"];
            vars.$unitLv2 = itemFile["unit.lv2"];
            currentPhase = itemFile["current.phase"];
            createdBy = itemFile["created.by"];
            initialRole = itemFile["initial.role"];
            checkerKttc = itemFile["user.checker.kttc"];
            oglSyncStatus = itemFile["ogl.sync.status"];
            isFirstItem = false;
        }

        var supplierId = normalizeExpenseVendorValue(itemFile["supplier.id"]);
        if (supplierId && !supplierIds[supplierId]) {
            arrVendors.push({
                "supplier.id": supplierId,
                "supplier.name": itemFile["supplier.name"],
                "tax.code": itemFile["tax.code"],
                "description": itemFile["description"]
            });
            supplierIds[supplierId] = true;
        }
        itemRc = itemFile.getNext();
    }

    if (hasItem) {

        vars.$supplierdisplays = arrVendors.map(function (vendor) {
            return vendor["supplier.name"];
        });
        vars.$suppliervalues = arrVendors.map(function (vendor) {
            return vendor["supplier.id"];
        });
        vars.$arrVendors = arrVendors;

        vars.$showSyncVendorOgl =
                currentPhase == "initial_kttc" &&
                (
                        checkerKttc == vars.$lo_operator["contact.name"] ||
                        (
                                createdBy == vars.$lo_operator["contact.name"] &&
                                initialRole == "kttc"
                        )
                );

        vars.$canEditSite = vars.$showSyncVendorOgl && oglSyncStatus == true

        vars.$canEditObj =
                (
                        currentPhase == "initial_dmms" &&
                        createdBy == vars.$lo_operator["contact.name"] &&
                        initialRole == "dmms"
                ) ||
                (
                        currentPhase == "initial_kttc" &&
                        (
                                checkerKttc == vars.$lo_operator["contact.name"] ||
                                (
                                        createdBy == vars.$lo_operator["contact.name"] &&
                                        initialRole == "kttc"
                                )
                        )
                );
    }

    closeExpenseVendorFile(itemFile);
}

/**
 * Validate thông tin món Dự chi theo NCC trước khi lưu.
 * Không kiểm tra hóa đơn, hoàn ứng, số tiền còn lại hoặc công nợ phải trả.
 */
function validateVendorAndPaymentDetails(record) {
    var errorMss = [];

    function checkMaxLength(value, maxLength, fieldName) {
        if (value && String(value).length > maxLength) {
            errorMss.push(fieldName + " không được vượt quá " + maxLength + " ký tự.");
        }
    }

    function parseAmount(value) {
        if (value === null || value === undefined) return NaN;
        var normalizedValue = String(value).replace(/,/g, "").trim();
        if (!normalizedValue) return NaN;
        var numberValue = Number(normalizedValue);
        return isFinite(numberValue) ? numberValue : NaN;
    }

    var vendorName = vars.$supplierId;
    if (!vendorName) {
        errorMss.push("Tên Nhà cung cấp là bắt buộc.");
    } else {
        checkMaxLength(vendorName, 255, "Tên Nhà cung cấp");
    }

    var taxCode = vars.$taxCode;
    if (!taxCode) {
        errorMss.push("Thông tin Mã số thuế là bắt buộc.");
    } else {
        checkMaxLength(taxCode, 255, "Thông tin Mã số thuế");
    }

    var amountField = parseAmount(vars.$amount);
    if (isNaN(amountField)) {
        errorMss.push("Số tiền dự chi là bắt buộc.");
    } else if (amountField <= 0) {
        errorMss.push("Số tiền dự chi phải lớn hơn 0.");
    }

    var transactionDescription = String(record["transaction.des"] || "").trim();
    if (!transactionDescription) {
        errorMss.push("Nội dung đề nghị không được để trống.");
    } else {
        checkMaxLength(transactionDescription, 255, "Nội dung đề nghị");
    }
    
    return errorMss;
}
