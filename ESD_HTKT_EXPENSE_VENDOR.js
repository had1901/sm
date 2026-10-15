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
            // Gắn danh sách hóa đơn vào món Dự chi theo nhà cung cấp.
            case "createListInvoinVendor":
                result = createListInvoinVendor(input);
                break;
            // Xóa món Dự chi theo ID esdHTKTpaymentVendor.
            case "deleteExpenseVendor":
                result = deleteExpenseVendor(input);
                break;
            case "syncExpenseVendorsToOgl":
                result = syncExpenseVendorsToOgl(input);
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

/**
 * Gắn hóa đơn vào món Dự chi.
 *
 * Luồng Dự chi chỉ cập nhật amount của esdHTKTpaymentVendor, không cập nhật
 * trường tổng tiền hóa đơn đã duyệt của luồng Thanh toán.
 */
function createListInvoinVendor(input) {
    var params = getExpenseVendorInputDetails(input);
    var rows = params.updatedSelectedRows instanceof Array
        ? params.updatedSelectedRows
        : (params instanceof Array ? params : []);

    if (rows.length === 0) {
        return {
            success: false,
            message: "Danh sách hóa đơn trống",
            checkStatus: []
        };
    }

    var paymentId = normalizeExpenseVendorValue(
        rows[0].transactionId || rows[0].paymentId || params.paymentId
    );
    var paymentVendorId = normalizeExpenseVendorValue(
        rows[0].paymentVendorId || rows[0]["payment.vendor.id"] || params.paymentVendorId || params.id
    );
    var vendorId = normalizeExpenseVendorValue(rows[0].vendorId || params.vendorId);

    if (!paymentId || !paymentVendorId) {
        return {
            success: false,
            message: "Thiếu thông tin mã phiếu Dự chi hoặc mã món Dự chi.",
            checkStatus: []
        };
    }

    var vendorFile = new SCFile("esdHTKTpaymentVendor");
    try {
        var vendorQuery = 'id="' + escapeExpenseVendorQueryValue(paymentVendorId) + '"';
        if (vendorFile.doSelect(vendorQuery) !== RC_SUCCESS) {
            return {
                success: false,
                message: "Không tìm thấy món Dự chi của nhà cung cấp trong hệ thống.",
                checkStatus: []
            };
        }

        var successInvoiceIds = [];
        var checkStatusList = [];

        for (var i = 0; i < rows.length; i++) {
            var invoice = rows[i] || {};
            var invoiceId = normalizeExpenseVendorValue(invoice.id || invoice.invoiceId);
            if (!invoiceId) continue;

            var relationFile = new SCFile("esdHTKTpaymentInvoice");
            try {
                relationFile["payment.id"] = paymentId;
                relationFile["invoice.id"] = invoiceId;
                relationFile["vendor.id"] = normalizeExpenseVendorValue(invoice.vendorId) || vendorId;
                relationFile["contract.id"] = normalizeExpenseVendorValue(invoice.contractId);
                relationFile["ref.id"] = paymentVendorId;

                var totalTax = Number(invoice.totalTax || 0);
                relationFile["deduction.type"] = totalTax > 0 ? "KHAUTRU_001" : "KHAUTRU_003";

                var insertRc = relationFile.doInsert();
                if (insertRc !== true && insertRc !== RC_SUCCESS) continue;

                successInvoiceIds.push(invoiceId);

                var checkStatus = "DangKiemTra";
                var warningMsg = "";
                var invoiceFile = new SCFile("esdHTKTinvoice");
                try {
                    if (invoiceFile.doSelect('id="' + escapeExpenseVendorQueryValue(invoiceId) + '"') === RC_SUCCESS) {
                        invoiceFile["request.id"] = paymentId;
                        invoiceFile.doUpdate();

                        try {
                            var apiResponse = lib.ESD_HTKT_SCHEDULE_OGL.callCheckInvoiceAPI(invoiceFile);
                            if (apiResponse !== null && apiResponse.success === true) {
                                invoiceFile["last.check.date"] = new Date();
                                invoiceFile.doUpdate();
                            }
                        } catch (apiError) {}

                        checkStatus = String(invoiceFile["check.status.detail"] || checkStatus);
                    }
                } finally {
                    closeExpenseVendorFile(invoiceFile);
                }

                checkStatusList.push({
                    invoiceId: invoiceId,
                    invoiceNumber: invoice.invoiceNumber || "",
                    status: checkStatus,
                    warningMsg: warningMsg
                });
            } finally {
                closeExpenseVendorFile(relationFile);
            }
        }

        if (successInvoiceIds.length > 0) {
            var totalInvoiceAmount = "0";
            var totalInvoiceCount = 0;
            var invoiceSumFile = new SCFile("esdHTKTinvoice", SCFILE_READONLY);
            try {
                var sumSql = 'SELECT i.grand.total FROM esdHTKTinvoice i ' +
                    'JOIN esdHTKTpaymentInvoice pi ON (pi.invoice.id = i.id) ' +
                    'WHERE pi.ref.id="' + escapeExpenseVendorQueryValue(paymentVendorId) + '"';
                var sumRc = invoiceSumFile.doSelect(sumSql);
                while (sumRc === RC_SUCCESS) {
                    totalInvoiceAmount = lib.ESD_HTKT_Utils.addStringsManual(
                        totalInvoiceAmount,
                        String(invoiceSumFile["grand.total"] || "0")
                    );
                    totalInvoiceCount++;
                    sumRc = invoiceSumFile.getNext();
                }
            } finally {
                closeExpenseVendorFile(invoiceSumFile);
            }

            // Dự chi chỉ lưu tổng hóa đơn vào amount.
            vendorFile["amount"] = totalInvoiceAmount;
            vendorFile["total.invoice"] = totalInvoiceCount;
            var updateRc = vendorFile.doUpdate();
            if (updateRc !== RC_SUCCESS) {
                return {
                    success: false,
                    message: "Đã gắn hóa đơn nhưng không cập nhật được số tiền món Dự chi.",
                    checkStatus: checkStatusList
                };
            }
            syncExpenseTotalAmount(paymentId);
        }

        if (successInvoiceIds.length === rows.length) {
            return {
                success: true,
                message: "Đã liên kết thành công tất cả các hóa đơn: " + successInvoiceIds.join(", "),
                checkStatus: checkStatusList
            };
        }
        if (successInvoiceIds.length > 0) {
            return {
                success: true,
                message: "Liên kết thành công các hóa đơn: " + successInvoiceIds.join(", ") +
                    " (Thất bại " + (rows.length - successInvoiceIds.length) + " hóa đơn)",
                checkStatus: checkStatusList
            };
        }
        return {
            success: false,
            message: "Lưu thông tin hóa đơn liên kết thất bại.",
            checkStatus: []
        };
    } catch (error) {
        return {
            success: false,
            message: "Lỗi khi gắn hóa đơn vào Dự chi: " + error.toString(),
            checkStatus: []
        };
    } finally {
        closeExpenseVendorFile(vendorFile);
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
    var paymentFile = null;
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
        
        paymentFile = new SCFile("esdHTKTpayment");
        if (paymentFile.doSelect('id="' + escapeExpenseVendorQueryValue(paymentId) + '"') !== RC_SUCCESS) {
            throw new Error("Không tìm thấy phiếu Dự chi " + paymentId + ".");
        }
        paymentFile["total.transaction"] = Math.max(
            0, Number(paymentFile["total.transaction"] || 0) - 1
        );
        paymentFile["total.amount.paid"] = getExpenseTotalAmount(paymentId);
        var updateRc = paymentFile.doUpdate();
        if (updateRc !== RC_SUCCESS) {
            throw new Error("Đã xóa món nhưng không cập nhật được tổng số món Dự chi. Code: " + updateRc);
        }

        return { success: true, status: "success", message: "Xóa món Dự chi thành công." };
    } catch (error) {
        return { success: false, status: "error", message: "Lỗi xóa món Dự chi: " + error.toString() };
    } finally {
        closeExpenseVendorFile(paymentFile);
        closeExpenseVendorFile(relationFile);
    }
}


/**
 * Đồng bộ tuần tự NCC/site OGL cho các món chưa đồng bộ của một phiếu Dự chi.
 * Kiểm tra phiếu/người thao tác, duyệt từng món, gọi đồng bộ OGL, lưu kết quả và tổng hợp số thành công/thất bại
 */
function syncExpenseVendorsToOgl(input) {
    var params = getExpenseVendorInputDetails(input);
    var paymentId = normalizeExpenseVendorValue(params.paymentId || params.expenseId);
    var currentUser = normalizeExpenseVendorValue(params.currentUser);
    var paymentFile = null;
    var itemFile = null;
    var data = { total: 0, synced: 0, skipped: 0, failed: 0, items: [] };

    if (!paymentId || !currentUser) {
        return { success: false, message: "Thiếu mã phiếu Dự chi hoặc người thực hiện." };
    }

    try {
        paymentFile = new SCFile("esdHTKTpayment", SCFILE_READONLY);
        if (paymentFile.doSelect('id="' + escapeExpenseVendorQueryValue(paymentId) + '"') !== RC_SUCCESS ||
                normalizeExpenseVendorValue(paymentFile["transaction.type"]) !== "Dự chi" ||
                paymentId.indexOf("DC.") !== 0) {
            return { success: false, message: "Không tìm thấy phiếu Dự chi hợp lệ." };
        }

        // Cùng điều kiện showSyncVendorOgl tại màn NCC Thanh toán.
        var actor = currentUser.toLowerCase();
        var creator = normalizeExpenseVendorValue(paymentFile["created.by"]).toLowerCase();
        var checker = normalizeExpenseVendorValue(paymentFile["user.checker.kttc"]).toLowerCase();
        var phase = normalizeExpenseVendorValue(paymentFile["current.phase"]);
        var role = normalizeExpenseVendorValue(paymentFile["initial.role"]);
        var canSync = phase === "initial_kttc" &&
                (checker === actor || (role === "kttc" && creator === actor));
        if (!canSync) {
            return { success: false, message: "Không có quyền đồng bộ OGL tại bước hiện tại của phiếu Dự chi." };
        }

        var entityInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(paymentFile["unit.lv1"]);
        if (!entityInfo || !entityInfo.entity || !entityInfo.oglBranchCode) {
            return { success: false, message: "Không xác định được entity/mã chi nhánh OGL của phiếu Dự chi." };
        }
        var branchCode = String(entityInfo.oglBranchCode);
        if (branchCode.length === 4) branchCode = branchCode.substr(1);
        var syncUser = normalizeExpenseVendorValue(paymentFile["user.checker.kttc"]) || currentUser;

        itemFile = new SCFile("esdHTKTpaymentVendor");
        var itemRc = itemFile.doSelect('payment.id="' + escapeExpenseVendorQueryValue(paymentId) + '"');
        while (itemRc === RC_SUCCESS) {
            var itemId = normalizeExpenseVendorValue(itemFile["id"]);
            var wasSynced = isExpenseVendorOglSynced(itemFile["ogl.sync.status"]);
            var attemptedSync = false;
            data.total++;
            try {
                var vendorId = normalizeExpenseVendorValue(itemFile["vendor.id"]);
                var siteId = normalizeExpenseVendorValue(itemFile["vendor.site.id"]);
                getExpenseVendorOglStatus(vendorId);
                var hasSelectedSite = siteId && lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorSiteList(vendorId, branchCode)
                        .some(function(site) { return normalizeExpenseVendorValue(site["id"]) === siteId; });
                // Chỉ bỏ qua khi đã đồng bộ và site vẫn tồn tại cho NCC/chi nhánh này.
                if (wasSynced && hasSelectedSite) {
                    data.skipped++;
                    data.items.push({ id: itemId, status: "skipped", message: "Món đã đồng bộ OGL." });
                } else {
                    attemptedSync = true;
                    // Site chưa có hoặc đã bị xóa: đồng bộ lại rồi tự gán site mặc định của NCC.
                    if (!hasSelectedSite) {
                        siteId = "";
                        itemFile["vendor.site.id"] = "";
                    }
                    // Hàm dùng chung có thể trả success=true dù không tìm thấy NCC.
                    // Chỉ tin khi nó thực sự xác nhận đồng bộ trên record và master NCC.
                    itemFile["ogl.sync.status"] = false;
                    // Gọi tuần tự cùng hàm đồng bộ NCC/site mà Thanh toán đang dùng.
                    var syncResult = lib.ESD_HTKT_PREPAYMENT_VENDOR.syncVendorToOgl(
                        itemFile, branchCode, entityInfo.entity, syncUser
                    );
                    if (!syncResult || syncResult.success !== true) {
                        throw new Error(syncResult && (syncResult.message || syncResult.error) || "Đồng bộ NCC/site OGL thất bại.");
                    }
                    if (!isExpenseVendorOglSynced(itemFile["ogl.sync.status"]) || !getExpenseVendorOglStatus(vendorId)) {
                        throw new Error("Hàm đồng bộ chưa xác nhận NCC đã đồng bộ OGL.");
                    }
                    siteId = getExpenseVendorOglSite(vendorId, siteId, branchCode);
                    itemFile["vendor.site.id"] = siteId;
                    itemFile["ogl.sync.status"] = true;
                    var updateRc = itemFile.doUpdate();
                    if (updateRc !== RC_SUCCESS) {
                        throw new Error("OGL đã đồng bộ nhưng không lưu được trạng thái món. Code: " + updateRc);
                    }
                    verifyExpenseVendorOglSaved(itemId, paymentId, vendorId, siteId);
                    data.synced++;
                    data.items.push({ id: itemId, status: "synced", message: "Đã đồng bộ OGL." });
                }
            } catch (itemError) {
                var itemMessage = String(itemError.message || itemError);
                // Gỡ cờ nếu lần đồng bộ này chưa lưu được đầy đủ kết quả.
                if (attemptedSync && (wasSynced || isExpenseVendorOglSynced(itemFile["ogl.sync.status"]))) {
                    itemFile["ogl.sync.status"] = false;
                    try {
                        var resetRc = itemFile.doUpdate();
                        if (resetRc !== RC_SUCCESS) itemMessage += " Không gỡ được cờ đồng bộ sai. Code: " + resetRc;
                    } catch (resetError) {
                        itemMessage += " Không gỡ được cờ đồng bộ sai: " + String(resetError.message || resetError);
                    }
                }
                data.failed++;
                data.items.push({ id: itemId, status: "failed", message: itemMessage });
            }
            itemRc = itemFile.getNext();
        }
        if (itemRc !== RC_NO_MORE) {
            throw new Error("Không đọc được đầy đủ danh sách món Dự chi. Code: " + itemRc);
        }
        return {
            success: data.failed === 0,
            message: data.total === 0 ? "Phiếu chưa có món Dự chi để đồng bộ OGL." :
                "Đồng bộ OGL: thành công " + data.synced + " món, đã đồng bộ " + data.skipped +
                " món, thất bại " + data.failed + " món.",
            data: data
        };
    } catch (error) {
        return { success: false, message: "Lỗi đồng bộ OGL Dự chi: " + String(error.message || error), data: data };
    } finally {
        closeExpenseVendorFile(itemFile);
        closeExpenseVendorFile(paymentFile);
    }
}

/**
 * Chuẩn hóa cờ đồng bộ: nhận cả true, "true", 1, "1"
 */
function isExpenseVendorOglSynced(value) {
    var status = normalizeExpenseVendorValue(value).toLowerCase();
    return status === "true" || status === "1";
}

/**
 * Kiểm tra NCC đã tồn tại, có tên/mã số thuế và đọc trạng thái đồng bộ của NCC
 */
function getExpenseVendorOglStatus(vendorId) {
    if (!vendorId) throw new Error("Chưa chọn/lưu Nhà cung cấp cho món Dự chi. Cần mở món và lưu NCC trước khi đồng bộ OGL.");
    var vendor = new SCFile("esdHTKTvendor", SCFILE_READONLY);
    try {
        if (vendor.doSelect('id="' + escapeExpenseVendorQueryValue(vendorId) + '"') !== RC_SUCCESS) {
            throw new Error("Không tìm thấy NCC " + vendorId + ".");
        }
        if (!normalizeExpenseVendorValue(vendor["vendor.name"]) || !normalizeExpenseVendorValue(vendor["vendor.number"])) {
            throw new Error("NCC " + vendorId + " thiếu tên hoặc mã số thuế để đồng bộ OGL.");
        }
        return isExpenseVendorOglSynced(vendor["ogl.sync.status"]);
    } finally {
        closeExpenseVendorFile(vendor);
    }
}

/**
 * Giữ site đã kiểm tra tồn tại; nếu chưa có thì tìm site mặc định theo cùng danh sách của Save.
 */
function getExpenseVendorOglSite(vendorId, siteId, branchCode) {
    if (siteId) return siteId;

    var defaultSite = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo();
    if (!defaultSite || !defaultSite.siteCode) throw new Error("Chưa cấu hình site OGL mặc định.");
    var vendorSites = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorSiteList(vendorId, branchCode);
    for (var i = 0; vendorSites && i < vendorSites.length; i++) {
        var vendorSite = vendorSites[i];
        if (normalizeExpenseVendorValue(vendorSite["ogl.site.code"]) === normalizeExpenseVendorValue(defaultSite.siteCode)) {
            var selectedId = normalizeExpenseVendorValue(vendorSite["id"]);
            if (selectedId) return selectedId;
        }
    }
    throw new Error("Không tìm thấy site OGL mặc định của NCC " + vendorId + " tại chi nhánh " + branchCode + ".");
}

/**
 * Sau khi lưu món, đọc lại để chắc chắn vendor.id, vendor.site.id và cờ đồng bộ đã được lưu đúng
 */
function verifyExpenseVendorOglSaved(itemId, paymentId, vendorId, siteId) {
    var saved = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
    try {
        var query = 'id="' + escapeExpenseVendorQueryValue(itemId) +
                '" and payment.id="' + escapeExpenseVendorQueryValue(paymentId) + '"';
        if (saved.doSelect(query) !== RC_SUCCESS ||
                normalizeExpenseVendorValue(saved["vendor.id"]) !== vendorId ||
                normalizeExpenseVendorValue(saved["vendor.site.id"]) !== siteId ||
                !isExpenseVendorOglSynced(saved["ogl.sync.status"])) {
            throw new Error("Chưa lưu đủ vendor.id/vendor.site.id và trạng thái đồng bộ cho món " + itemId + ".");
        }
    } finally {
        closeExpenseVendorFile(saved);
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

            // paymentFile["total.contract"] =
            //     Number(paymentFile["total.contract"] || 0) + createdItems.length;
            paymentFile["total.transaction"] =
                Number(paymentFile["total.transaction"] || 0) + createdItems.length;
            paymentFile["total.amount.paid"] = getExpenseTotalAmount(paymentId);
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
 * Tổng giá trị đề nghị Dự chi lấy từ amount của tất cả món đã lưu trên phiếu.
 * Cộng bằng chuỗi tiền để giữ chính xác phần thập phân và số tiền lớn.
 */
function getExpenseTotalAmount(paymentId) {
    var normalizedId = normalizeExpenseVendorValue(paymentId);
    if (!normalizedId) throw new Error("Thiếu mã phiếu Dự chi để tính tổng giá trị.");

    var itemFile = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
    try {
        itemFile.setFields(["amount"]);
        var itemRc = itemFile.doSelect(
            'payment.id="' + escapeExpenseVendorQueryValue(normalizedId) + '"'
        );
        var totalAmount = "0";
        while (itemRc === RC_SUCCESS) {
            totalAmount = lib.ESD_HTKT_Utils.addStringsManual(
                totalAmount, String(itemFile["amount"] || "0")
            );
            itemRc = itemFile.getNext();
        }
        if (itemRc !== RC_NO_MORE) {
            throw new Error("Không đọc được đầy đủ số tiền các món Dự chi. Code: " + itemRc);
        }
        return totalAmount;
    } finally {
        closeExpenseVendorFile(itemFile);
    }
}

/**
 * Cập nhật tổng trong DB sau khi số tiền các món Dự chi thay đổi.
 * Chỉ cập nhật total.amount.paid của phiếu Dự chi.
 */
function syncExpenseTotalAmount(paymentId) {
    var normalizedId = normalizeExpenseVendorValue(paymentId);
    if (!normalizedId) throw new Error("Thiếu mã phiếu Dự chi để cập nhật tổng giá trị.");

    var paymentFile = new SCFile("esdHTKTpayment");
    try {
        var paymentRc = paymentFile.doSelect(
            'id="' + escapeExpenseVendorQueryValue(normalizedId) + '"'
        );
        if (paymentRc !== RC_SUCCESS) {
            throw new Error("Không tìm thấy phiếu Dự chi " + normalizedId + ". Code: " + paymentRc);
        }
        if (normalizeExpenseVendorValue(paymentFile["transaction.type"]) !== "Dự chi") return;

        var totalAmount = getExpenseTotalAmount(normalizedId);
        var storedAmount = normalizeExpenseVendorValue(paymentFile["total.amount.paid"]);
        if (!storedAmount || lib.ESD_HTKT_Utils.compareMoneyStrings(storedAmount, totalAmount) !== 0) {
            paymentFile["total.amount.paid"] = totalAmount;
            var updateRc = paymentFile.doUpdate();
            if (updateRc !== RC_SUCCESS) {
                throw new Error("Không cập nhật được tổng giá trị đề nghị Dự chi. Code: " + updateRc);
            }
        }
        return totalAmount;
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
                " pv.total.invoice, pv.ogl.sync.status, v.ogl.vendor.id, pv.vendor.id, pv.vendor.site.id" +
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
        ogl_sync_status: isExpenseVendorOglSynced(paymentVendorFile[8]),
        ogl_vendor_id: String(paymentVendorFile[9] || ""),
        vendor_id: normalizeExpenseVendorValue(paymentVendorFile[10]),
        vendor_site_id: normalizeExpenseVendorValue(paymentVendorFile[11])
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

/**
 * Số tiền món Dự chi lấy từ hóa đơn thì không cho nhập tay.
 * Kiểm tra liên kết theo mã món, không theo NCC hoặc tổng tiền/count lưu sẵn.
 */
function hasExpenseVendorInvoices(record) {
    var itemId = normalizeExpenseVendorValue(record && record["id"]);
    var paymentId = normalizeExpenseVendorValue(record && (record["payment.id"] || record.payment_id));
    if (!itemId || !paymentId) return false;

    var invoiceFile = new SCFile("esdHTKTpaymentInvoice", SCFILE_READONLY);
    try {
        var rc = invoiceFile.doSelect(
            'payment.id="' + escapeExpenseVendorQueryValue(paymentId) +
            '" and ref.id="' + escapeExpenseVendorQueryValue(itemId) + '"'
        );
        if (rc === RC_SUCCESS) return true;
        if (rc === RC_NO_MORE) return false;
        // Không mở nhập tay nếu chưa xác định được dữ liệu hóa đơn.
        print("Không kiểm tra được hóa đơn của món Dự chi " + itemId + ". Code: " + rc);
        return true;
    } finally {
        closeExpenseVendorFile(invoiceFile);
    }
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
