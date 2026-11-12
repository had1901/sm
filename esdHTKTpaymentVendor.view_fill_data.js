// Hàm tiện ích thực hiện lưu bản ghi món dự chi vào bảng esdHTKTpaymentVendor
function savePaymentVendorRecord(record) {
    if (!record) return false;
    var isSaved = false;

    // Cách 1: Cập nhật trực tiếp qua đối tượng $L.file để giữ đồng bộ sysmodcount trên form SM
    try {
        if (typeof record.doUpdate === "function") {
            var updateRc = record.doUpdate();
            if (updateRc === RC_SUCCESS) {
                isSaved = true;
            }
        }
    } catch (eUpd) {
        isSaved = false;
    }

    // Cách 2 (Fallback an toàn): Nếu $L.file là bảng Join hoặc doUpdate() lỗi,
    // mở đối tượng Write trực tiếp vào bảng esdHTKTpaymentVendor để cập nhật
    if (!isSaved) {
        try {
            var currentItemId = record["id"] || (typeof vars !== "undefined" && vars.$G_payment_vendor_id);
            if (currentItemId) {
                var pvFile = new SCFile("esdHTKTpaymentVendor");
                var escapedId = String(currentItemId).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
                if (pvFile.doSelect('id="' + escapedId + '"') === RC_SUCCESS) {
                    if (record["vendor.id"]) pvFile["vendor.id"] = record["vendor.id"];
                    if (record["transaction.des"]) pvFile["transaction.des"] = record["transaction.des"];
                    if (record["currency"]) pvFile["currency"] = record["currency"];
                    if (record["vendor.type"]) pvFile["vendor.type"] = record["vendor.type"];
                    pvFile["ogl.sync.status"] = false;
                    pvFile["vendor.site.id"] = "";
                    var rcDirect = pvFile.doUpdate();
                    if (rcDirect === RC_SUCCESS) {
                        isSaved = true;
                    }
                }
                try { if (pvFile) pvFile.doClose(); } catch (eClose) {}
            }
        } catch (eDirect) {
            isSaved = false;
        }
    }
    return isSaved;
}

// DO dùng chung: chỉ phiếu DC mới kiểm tra context Dự chi; TT XDCB có guard nguồn/quyền riêng.
var supplierPaymentId = String(
    vars.$L_file["payment.id"] || vars.$L_file.payment_id || vars.$G_payment_id || ""
).trim();
var isXDCB = supplierPaymentId.indexOf("DC.") === 0 &&
    lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseSupplierContext(vars.$L_file, "", false).category === "XDCB";

if (lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb(vars.$L_file)) {
    // TT XDCB: điền NCC S4 và giữ lựa chọn nháp; master/site được xử lý sau validate ở DO Lưu.
    // Không gọi hàm lưu ngay bên dưới để tránh ghi DB khi TT chưa qua kiểm tra tiền/tài khoản.
    try {
        lib.ESD_HTKT_PAYMENT_VENDOR.selectPaymentXdcbSupplier(vars.$L_file, vars.$supplierId);
        vars.$G_hasError = false;
        vars.$G_errMsg = "";
    } catch (xdcbError) {
        vars.$G_hasError = true;
        vars.$G_errMsg = String(xdcbError.message || xdcbError);
        vars.$L_action = "do nothing";
    }
} else if (isXDCB) {
    try {
        lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.selectExpenseSupplier(vars.$L_file, vars.$supplierId);
        vars.$G_hasError = false;
        vars.$G_errMsg = "";

        // 1. Lưu thông tin NCC vào bảng esdHTKTpaymentVendor ngay sau khi chọn (XDCB)
        var savedXDCB = savePaymentVendorRecord(vars.$L_file);
        if (!savedXDCB) {
            vars.$G_hasError = true;
            vars.$G_errMsg = "Không thể lưu thông tin nhà cung cấp vào bảng.";
            vars.$L_action = "do nothing";
        }
    } catch (supplierError) {
        lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.clearExpenseSupplierScreenDraft();
        // Xóa thông tin lựa chọn lỗi để Save không dùng lại tên/MST của NCC trước.
        vars.$supplierId = "";
        vars.$supplierName = "";
        vars.$taxCode = "";
        vars.$supplierAddress = "";
        vars.$G_supplier_id = "";
        vars.$vendorType = "";
        vars.$G_hasError = true;
        vars.$G_errMsg = String(supplierError.message || supplierError);
        vars.$L_action = "do nothing";
    }
} else {
    var supplierOptions = typeof arrVendors !== "undefined" ? arrVendors : [];
    if (supplierOptions && typeof supplierOptions.toArray === "function") {
        supplierOptions = supplierOptions.toArray();
    }
    var findVendor = null;
    for (var supplierIndex = 0; supplierOptions && supplierIndex < supplierOptions.length; supplierIndex++) {
        if (supplierOptions[supplierIndex] && supplierOptions[supplierIndex]["supplier.id"] == vars.$supplierId) {
            findVendor = supplierOptions[supplierIndex];
            break;
        }
    }
    if (findVendor) {
        vars.$supplierId = findVendor["supplier.id"];
        vars.$supplierName = findVendor["supplier.name"];
        vars.$taxCode = findVendor["tax.code"];
        vars.$L_file["transaction.des"] = findVendor["description"];
        vars.$currency = "VND";
        vars.$G_supplier_id = findVendor["supplier.id"];

        // 2. Tra cứu vendor.id từ danh mục esdHTKTvendor theo Tax Code / Supplier ID
        var selectedVendorId = findVendor["vendor.id"] || findVendor.vendorId || "";
        var vendorType = "";
        if (!selectedVendorId) {
            var vLookup = new SCFile("esdHTKTvendor", SCFILE_READONLY);
            try {
                var conditions = [];
                if (findVendor["tax.code"]) {
                    conditions.push('vendor.number="' + String(findVendor["tax.code"]).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"');
                }
                if (findVendor["supplier.id"]) {
                    conditions.push('supplier.id="' + String(findVendor["supplier.id"]).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"');
                }
                if (conditions.length > 0 && vLookup.doSelect(conditions.join(" or ")) === RC_SUCCESS) {
                    selectedVendorId = vLookup["id"] || selectedVendorId;
                    vendorType = vLookup["vendor.type"] || "";
                }
            } catch (eVendorLookup) {
            } finally {
                try { if (vLookup) vLookup.doClose(); } catch (eClose) {}
            }
        }

        if (!selectedVendorId) {
            selectedVendorId = findVendor["supplier.id"] || "";
        }

        // 3. Gán đầy đủ thông tin NCC vào vars.$L_file
        vars.$L_file["vendor.id"] = selectedVendorId;
        if (vendorType) {
            vars.$vendorType = vendorType;
            vars.$L_file["vendor.type"] = vendorType;
        }
        vars.$L_file["currency"] = "VND";
        vars.$L_file["ogl.sync.status"] = false; // Reset cờ OGL khi đổi NCC
        vars.$L_file["vendor.site.id"] = "";     // Reset site khi đổi NCC

        // 4. Lưu thông tin NCC vào bảng esdHTKTpaymentVendor ngay sau khi chọn (HHDV)
        var savedHHDV = savePaymentVendorRecord(vars.$L_file);
        if (savedHHDV) {
            vars.$G_hasError = false;
            vars.$G_errMsg = "";
        } else {
            vars.$G_hasError = true;
            vars.$G_errMsg = "Không thể lưu thông tin nhà cung cấp vào bảng.";
            vars.$L_action = "do nothing";
        }
    }
}