/**
 * ScriptLibrary: ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER
 * Nguồn HĐ/NCC và site cho Dự chi. Chưa nối entrypoint Thanh toán/Tạm ứng.
 * ID Contractor dùng trên droplist; vendor.id/site.id của món luôn là ID S6.
 */

/** Đọc hạng mục và người xử lý từ phiếu cha. */
function getExpenseSupplierContext(record, actor, requireEdit) {
    var paymentId = expenseSupplierText(record && (record["payment.id"] || record.payment_id));
    var parent = expenseSupplierReadOne("esdHTKTpayment", 'id="' + expenseSupplierQuote(paymentId) + '"',
        ["id", "transaction.type", "original.contract.category", "current.phase", "initial.role", "created.by",
            "user.checker.kttc", "unit.lv1", "unit.lv2", "description"], true);
    if (paymentId.indexOf("DC.") !== 0 || !parent || parent["transaction.type"] !== "Dự chi") {
        throw new Error("Không tìm thấy phiếu Dự chi hợp lệ.");
    }
    var category = expenseSupplierText(parent["original.contract.category"]).toUpperCase() || "HHDV";
    if (category !== "HHDV" && category !== "XDCB") throw new Error("Hạng mục của phiếu Dự chi không hợp lệ.");
    var user = expenseSupplierText(actor).toLowerCase();
    var creator = expenseSupplierText(parent["created.by"]).toLowerCase();
    var checker = expenseSupplierText(parent["user.checker.kttc"]).toLowerCase();
    var phase = expenseSupplierText(parent["current.phase"]);
    var role = expenseSupplierText(parent["initial.role"]);
    var canEdit = !!user && ((phase === "initial_dmms" && role === "dmms" && user === creator) ||
        (phase === "initial_kttc" && (user === checker || (role === "kttc" && user === creator))));
    if (requireEdit && !canEdit) throw new Error("Không có quyền sửa món tại bước hiện tại của phiếu Dự chi.");
    return { payment: parent, category: category, canEdit: canEdit,
        canSync: canEdit && phase === "initial_kttc", actor: expenseSupplierText(actor) };
}

/** Đọc HĐ S4 đủ điều kiện và có gói thầu trước khi thêm/lưu/import món. */
function getExpenseXdcbSelection(contractId, actor, paymentId) {
    var result = lib.ESD_HTKT_EXPENSE_CONTRACT.getExpenseXdcbContract({ details: {
        contractId: expenseSupplierText(contractId), currentUser: actor, paymentId: expenseSupplierText(paymentId)
    } });
    if (!result || result.success !== true || !result.data) {
        throw new Error(result && result.message || "Không kiểm tra được HĐ XDCB.");
    }
    var contract = result.data;
    if (!expenseSupplierText(contract.currency)) throw new Error("HĐ XDCB chưa có loại tiền.");
    if (!expenseSupplierText(contract.tenderPackageId)) throw new Error("HĐ XDCB chưa có liên kết gói thầu.");
    return contract;
}

/** Lấy NCC đúng gói thầu; không dùng thông tin NCC snapshot trên HĐ. */
function getExpenseXdcbSuppliers(contract) {
    var packageId = expenseSupplierText(contract.tenderPackageId);
    if (!packageId) throw new Error("HĐ XDCB chưa có liên kết gói thầu.");
    var file = new SCFile("esdjoinXDCBtenderPackageContractor", SCFILE_READONLY);
    var rows = [];
    var seen = {};
    try {
        var rc = file.doSelect('tender.package.id="' + expenseSupplierQuote(packageId) + '"');
        while (rc === RC_SUCCESS) {
            var id = expenseSupplierText(file["id"]);
            var tax = expenseSupplierText(file["tax.code"]);
            var name = expenseSupplierText(file["name"]);
            if (!id || !tax || !name) throw new Error("NCC gói thầu XDCB thiếu ID, MST hoặc tên.");
            if (seen["$" + tax]) throw new Error("Gói thầu có nhiều NCC cùng MST " + tax + ". Cần kiểm tra dữ liệu S4.");
            seen["$" + tax] = true;
            rows.push({ "supplier.id": id, "supplier.name": name, "tax.code": tax,
                "address": expenseSupplierText(file["address"]), "bank.number": expenseSupplierText(file["bank.number"]),
                "bank.name": expenseSupplierText(file["bank.name"]), "bank": expenseSupplierText(file["bank.name"]),
                "phone.number": expenseSupplierText(file["phone.number"]), "source": "S4" });
            rc = file.getNext();
        }
        if (rc !== RC_NO_MORE) throw new Error("Không đọc được đầy đủ danh sách NCC gói thầu XDCB.");
        if (!rows.length) throw new Error("Gói thầu của HĐ XDCB chưa có NCC.");
        return rows;
    } finally { expenseSupplierClose(file); }
}

/** Kiểm tra lựa chọn/MST thực sự thuộc danh sách NCC gói thầu của HĐ. */
function resolveExpenseXdcbSupplier(contract, supplierId, taxCode) {
    var rows = getExpenseXdcbSuppliers(contract);
    var key = expenseSupplierText(supplierId);
    var tax = expenseSupplierText(taxCode);
    for (var i = 0; i < rows.length; i++) {
        if ((!key || rows[i]["supplier.id"] === key) && rows[i]["tax.code"] === tax) return rows[i];
    }
    throw new Error("NCC/MST đã chọn không thuộc gói thầu của HĐ XDCB.");
}

/** Đọc NCC S6 đã lưu; supplier.id vẫn giữ ý nghĩa liên kết danh mục S2. */
function getExpenseAccountingVendor(vendorId) {
    return expenseSupplierReadOne("esdHTKTvendor", 'id="' + expenseSupplierQuote(vendorId) + '"',
        ["id", "vendor.number", "vendor.name", "address", "supplier.id", "ogl.sync.status"], true);
}

/** Tái sử dụng NCC S6 theo MST; không tạo một vendor cho mỗi ID join/gói thầu. */
function ensureExpenseXdcbVendor(supplier, actor) {
    var tax = expenseSupplierText(supplier["tax.code"]);
    var name = expenseSupplierText(supplier["supplier.name"]);
    if (!tax || !name) throw new Error("NCC XDCB thiếu MST hoặc tên để lưu về S6.");
    var query = 'vendor.number="' + expenseSupplierQuote(tax) + '"';
    var fields = ["id", "vendor.number", "vendor.name", "address", "supplier.id"];
    var existing = expenseSupplierReadOne("esdHTKTvendor", query, fields, false);
    if (existing) {
        if (!existing.id || !existing["vendor.name"]) throw new Error("NCC S6 cùng MST thiếu ID hoặc tên.");
        return existing.id;
    }
    var file = new SCFile("esdHTKTvendor");
    try {
        var vendorId = expenseSupplierNumber("esdHTKTvendor");
        // Đọc lại ngay trước Add để tái dùng NCC vừa được phiên khác tạo.
        existing = expenseSupplierReadOne("esdHTKTvendor", query, fields, false);
        if (existing) {
            if (!existing.id || !existing["vendor.name"]) throw new Error("NCC S6 cùng MST thiếu ID hoặc tên.");
            return existing.id;
        }
        file["id"] = vendorId;
        file["vendor.number"] = tax;
        file["vendor.name"] = name;
        file["address"] = expenseSupplierText(supplier.address);
        file["username"] = actor;
        file["ogl.country"] = "VN";
        // Không gán ID Contractor vào supplier.id vì helper S2 dùng field đó để cập nhật esdDMSupplier.
        var rc = file.doAction("add");
        if (rc !== RC_SUCCESS) {
            existing = expenseSupplierReadOne("esdHTKTvendor", query, fields, false);
            if (existing && existing.id && existing["vendor.name"]) return existing.id;
            throw new Error("Không lưu được NCC XDCB về S6. Code: " + rc);
        }
        existing = expenseSupplierReadOne("esdHTKTvendor", query, fields, true);
        if (!existing.id) throw new Error("NCC S6 vừa tạo chưa có ID hợp lệ.");
        return existing.id;
    } finally { expenseSupplierClose(file); }
}

/** Trả thông tin HĐ đúng nguồn; XDCB dùng ID làm mã hiển thị như khóa đã lưu trên món. */
function getExpenseContractInfo(record) {
    var context = getExpenseSupplierContext(record, "", false);
    var id = expenseSupplierText(record["contract.id"] || record.contract_id);
    if (context.category === "HHDV") return lib.ESD_HTKT_PAYMENT_VENDOR.getContractInfo(id);
    var contract = expenseSupplierReadOne("esdXDCBrepairProjectCtr", 'id="' + expenseSupplierQuote(id) + '"',
        ["id", "contract.name", "contract.amount", "effective.date"], true);
    return { id: contract.id, code: contract.id, name: contract["contract.name"], category: "HD_GT",
        categoryName: "Hợp đồng", startDate: contract["effective.date"], totalValue: contract["contract.amount"],
        totalPaidAmount: "", remainingAmount: "" };
}

/** Tạo khóa form để lựa chọn chưa lưu không lẫn món, HĐ, người dùng hoặc phase khác. */
function expenseSupplierScreenDraftKey(record, context) {
    var itemId = expenseSupplierText(record.id || vars.$G_payment_vendor_id || vars["$G.payment.vendor.id"]);
    if (!itemId) return "";
    return JSON.stringify([context.payment.id, itemId,
        expenseSupplierText(record["contract.id"] || record.contract_id),
        expenseSupplierText(record["vendor.id"] || record.vendor_id),
        expenseSupplierText(context.actor).toLowerCase(), context.payment["current.phase"], context.payment["initial.role"]]);
}

/** Xóa bản nháp của màn XDCB hiện tại; không ghi dữ liệu xuống bảng. */
function clearExpenseSupplierScreenDraft() {
    vars["$L.expense.xdcb.supplier.draft"] = "";
}

/** Chỉ khôi phục bản nháp trong cùng form còn quyền sửa; biến $L được SM dọn khi thoát ứng dụng. */
function getExpenseSupplierScreenDraft(record, context) {
    var raw = vars["$L.expense.xdcb.supplier.draft"];
    if (!raw) return null;
    try {
        var draft = JSON.parse(String(raw));
        if (context.canEdit && draft.key && draft.key === expenseSupplierScreenDraftKey(record, context)) return draft;
    } catch (draftError) { /* Dữ liệu tạm không hợp lệ không được dùng thay lựa chọn trên form. */ }
    clearExpenseSupplierScreenDraft();
    return null;
}

/** Nạp NCC S4; giữ lựa chọn chưa lưu khi DO làm DS hiển thị lại cùng món XDCB. */
function loadExpenseSupplierScreen(record) {
    var actor = vars.$lo_operator && vars.$lo_operator["contact.name"];
    var context = getExpenseSupplierContext(record, actor, false);
    if (context.category !== "XDCB") throw new Error("Hàm nạp NCC S4 chỉ áp dụng cho Dự chi XDCB.");
    var contractId = expenseSupplierText(record["contract.id"] || record.contract_id);
    var contract = expenseSupplierReadOne("esdXDCBrepairProjectCtr", 'id="' + expenseSupplierQuote(contractId) + '"',
        ["id", "tender.package.id", "currency"], true);
    var options = getExpenseXdcbSuppliers({ tenderPackageId: contract["tender.package.id"] });
    var draft = getExpenseSupplierScreenDraft(record, context);
    var draftSupplier = null;
    var savedId = expenseSupplierText(record["vendor.id"] || record.vendor_id);
    var saved = savedId ? getExpenseAccountingVendor(savedId) : null;
    vars.$supplierId = "";
    vars.$supplierName = saved ? saved["vendor.name"] : "";
    vars.$taxCode = saved ? saved["vendor.number"] : "";
    vars.$supplierAddress = saved ? saved.address : "";
    vars.$supplierdisplays = [];
    vars.$suppliervalues = [];
    for (var i = 0; i < options.length; i++) {
        options[i]["description"] = context.payment.description;
        options[i]["transaction.des"] = context.payment.description;
        vars.$supplierdisplays.push(options[i]["supplier.name"]);
        vars.$suppliervalues.push(options[i]["supplier.id"]);
        if (saved && options[i]["tax.code"] === saved["vendor.number"]) vars.$supplierId = options[i]["supplier.id"];
        if (draft && options[i]["supplier.id"] === draft.supplierId) draftSupplier = options[i];
    }
    if (draft && !draftSupplier) {
        clearExpenseSupplierScreenDraft();
        draft = null;
    }
    if (draftSupplier) {
        // Tên/MST/địa chỉ luôn đọc lại từ nguồn, chỉ giữ ID NCC vừa chọn.
        vars.$supplierId = draftSupplier["supplier.id"];
        vars.$supplierName = draftSupplier["supplier.name"];
        vars.$taxCode = draftSupplier["tax.code"];
        vars.$supplierAddress = expenseSupplierText(draftSupplier.address);
        vars.$G_supplier_id = draftSupplier["supplier.id"];
        vars.$vendorType = draftSupplier.type || "";
    }
    vars.$G_supplier_id = vars.$supplierId;
    arrVendors = options;
    vars.$arrVendors = options;
    vars.$currency = draftSupplier ? contract.currency : record.currency || record["currency"] || contract.currency || "VND";
    vars.$amount = record["amount"] || 0;
    vars.$unitLv1 = context.payment["unit.lv1"];
    vars.$unitLv2 = context.payment["unit.lv2"];
    vars.$oglSiteCode = "";
    var selectedSiteId = expenseSupplierText(record["vendor.site.id"] || record.vendor_site_id);
    if (selectedSiteId) {
        var selectedSite = expenseSupplierReadOne("esdHTKTvendorSite", 'id="' + expenseSupplierQuote(selectedSiteId) +
            '" and vendor.id="' + expenseSupplierQuote(savedId) + '"', ["ogl.site.code"], false);
        vars.$oglSiteCode = selectedSite ? selectedSite["ogl.site.code"] : "";
    }
    vars.$canEditObj = context.canEdit;
    vars.$showSyncVendorOgl = context.canSync;
    vars.$canEditSite = context.canSync && expenseSupplierFlag(record["ogl.sync.status"]);
    if (!record["transaction.des"]) record["transaction.des"] = context.payment.description || "";
    vars.$G_description = record["transaction.des"];
    return options;
}

/** Điền NCC/tiền tệ S4 cho DO 4200 của XDCB; giữ số tiền và nội dung đang nhập. */
function selectExpenseSupplier(record, supplierId) {
    var actor = vars.$lo_operator && vars.$lo_operator["contact.name"];
    var context = getExpenseSupplierContext(record, actor, true);
    if (context.category !== "XDCB") throw new Error("Hàm điền NCC S4 chỉ áp dụng cho Dự chi XDCB.");
    clearExpenseSupplierScreenDraft();
    // Không nạp lại toàn form vì sẽ làm mất số tiền người dùng đang nhập.
    var contract = getExpenseXdcbSelection(record["contract.id"], actor, context.payment.id);
    var options = getExpenseXdcbSuppliers(contract);
    var currency = expenseSupplierText(contract.currency);
    for (var i = 0; i < options.length; i++) {
        if (options[i]["supplier.id"] === expenseSupplierText(supplierId)) {
            vars.$supplierId = options[i]["supplier.id"];
            vars.$supplierName = options[i]["supplier.name"];
            vars.$taxCode = options[i]["tax.code"];
            vars.$supplierAddress = expenseSupplierText(options[i].address);
            vars.$G_supplier_id = options[i]["supplier.id"];
            vars.$vendorType = options[i].type || "";
            vars.$currency = currency;
            // Chỉ điền mặc định khi nội dung trống; không ghi đè nội dung người dùng đang soạn.
            if (!expenseSupplierText(record["transaction.des"])) record["transaction.des"] = context.payment.description || "";
            vars.$G_description = record["transaction.des"];
            var draftKey = expenseSupplierScreenDraftKey(record, context);
            if (draftKey) vars["$L.expense.xdcb.supplier.draft"] = JSON.stringify({
                key: draftKey, supplierId: options[i]["supplier.id"]
            });
            return options[i];
        }
    }
    throw new Error("NCC đã chọn không còn trong danh sách của HĐ.");
}

/** Lưu NCC XDCB từ nguồn đã xác minh, giữ món để thử lại nếu OGL lỗi. */
function saveExpenseXdcbDetails(record) {
    print('[saveExpenseXdcbDetails] record = ', record);
    var actor = vars.$lo_operator && vars.$lo_operator["contact.name"];
    var context = getExpenseSupplierContext(record, actor, true);
    if (context.category !== "XDCB") throw new Error("Hàm lưu XDCB chỉ áp dụng cho Dự chi XDCB.");
    var contract = getExpenseXdcbSelection(record["contract.id"], actor, context.payment.id);
    var supplier = resolveExpenseXdcbSupplier(contract, vars.$supplierId, vars.$taxCode);
    // Input số tiền của FD ghi trực tiếp vào record; $amount có thể vẫn là giá trị khởi tạo.
    var amount = Number(String(record["amount"]).replace(/,/g, ""));
    if (!isFinite(amount) || amount <= 0 || amount > 9007199254740991) throw new Error("Số tiền dự chi phải lớn hơn 0 hợp lệ.");
    if (!expenseSupplierText(record["transaction.des"]) || expenseSupplierText(record["transaction.des"]).length > 255) {
        throw new Error("Nội dung đề nghị là bắt buộc và không quá 255 ký tự.");
    }
    var oldId = expenseSupplierText(record["vendor.id"]);
    var oldVendor = oldId ? getExpenseAccountingVendor(oldId) : null;
    if (lib.ESD_HTKT_EXPENSE_VENDOR.hasExpenseVendorInvoices(record) &&
            (!oldVendor || oldVendor["vendor.number"] !== supplier["tax.code"])) {
        throw new Error("Không được đổi NCC khi món Dự chi đã gắn hóa đơn.");
    }
    var vendorId = ensureExpenseXdcbVendor(supplier, actor);
    record["vendor.site.id"] = "";
    record["vendor.id"] = vendorId;
    record["amount"] = amount;
    record["currency"] = contract.currency;
    record["ogl.sync.status"] = false;
    var result = syncExpenseXdcbVendorToOgl(record, null, null, actor);
    vars.$currency = contract.currency;
    vars.$supplierName = supplier["supplier.name"];
    vars.$supplierAddress = supplier.address;
    vars.$canEditSite = context.canSync && result.success;
    vars.$vendorSiteOptValue = result.success ? [record["vendor.site.id"]] : [];
    vars.$vendorSiteOptDisp = result.success ? [lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo("XDCB").siteCode] : [];
    vars.$oglSiteCode = result.success ? vars.$vendorSiteOptDisp[0] : "";
    clearExpenseSupplierScreenDraft();
    return result;
}

/** Kiểm tra HĐ/NCC đã lưu trước đồng bộ hoặc trình, tránh sửa payload bỏ qua UI. */
function validateExpenseXdcbItem(record, actor) {
    var context = getExpenseSupplierContext(record, actor, false);
    if (context.category !== "XDCB") throw new Error("Món không thuộc phiếu Dự chi XDCB.");
    var contract = getExpenseXdcbSelection(record["contract.id"], actor, context.payment.id);
    var vendor = getExpenseAccountingVendor(record["vendor.id"]);
    resolveExpenseXdcbSupplier(contract, "", vendor["vendor.number"]);
    if (expenseSupplierText(record.currency) !== expenseSupplierText(contract.currency)) {
        throw new Error("Loại tiền của món khác loại tiền HĐ XDCB.");
    }
    return { context: context, contract: contract, vendor: vendor };
}

/** Đồng bộ như S2: vấn tin chưa xác nhận có site thì tạo site XDCB từ NCC S6. */
function syncExpenseXdcbVendorToOgl(record, branchCode, entityCode, actor) {
    record["ogl.sync.status"] = false;
    try {
        var selection = validateExpenseXdcbItem(record, actor);
        if (!selection.context.canEdit) throw new Error("Không có quyền đồng bộ NCC/site tại bước hiện tại của phiếu Dự chi.");
        var mapping = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(selection.context.payment["unit.lv1"]);
        if (!mapping || !mapping.entity || !mapping.oglBranchCode) throw new Error("Chưa có entity/chi nhánh OGL của phiếu Dự chi.");
        var branch = expenseSupplierText(mapping.oglBranchCode);
        if (branch.length === 4) branch = branch.substr(1);
        var config = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo("XDCB");
        if (!config || !config.siteCode || !config.debitAccount || !config.creditAccount) throw new Error("Chưa cấu hình site XDCB.");
        var vendor = selection.vendor;
        var site = getExpenseXdcbSite(vendor.id, branch, config.siteCode);
        if (!site) {
            var response = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.getVendorSiteInfo({ vendorNumber: vendor["vendor.number"], entity: branch });
            print("[syncExpenseXdcbVendorToOgl] getVendorSiteInfo response = ", response);
            var remote = null;
            var oglName = "";
            // Giống S2: bỏ qua data khi vấn tin lỗi/null, dùng master S6 để gọi tạo site.
            if (response && response.success === true) {
                // S2 cũng đi tới tạo khi data rỗng/null hoặc không có; vẫn chặn cấu trúc khác mảng.
                var responseData = response.data === null || response.data === undefined ? [] : response.data;
                // Mảng trả từ SL tích hợp có thể khác scope; không dùng instanceof Array.
                if (Object.prototype.toString.call(responseData) !== "[object Array]") {
                    throw new Error("Phản hồi vấn tin NCC/site OGL không có data dạng mảng; chưa tạo site mới.");
                }
                for (var i = 0; i < responseData.length; i++) {
                    var item = responseData[i];
                    if (item.vendorNumber && expenseSupplierText(item.vendorNumber) !== vendor["vendor.number"]) {
                        throw new Error("OGL trả về NCC khác MST được yêu cầu.");
                    }
                    oglName = oglName || item.vendorName;
                    var sites = item.sites || [];
                    for (var j = 0; j < sites.length; j++) {
                        if (expenseSupplierText(sites[j].vendorSiteCode) === expenseSupplierText(config.siteCode) &&
                                expenseSupplierText(sites[j].entity) === branch) {
                            if (/^(false|0)$/i.test(expenseSupplierText(sites[j].active))) throw new Error("Site XDCB trên OGL đang ngừng hoạt động.");
                            if (remote) throw new Error("OGL trả nhiều site XDCB cùng chi nhánh.");
                            remote = sites[j];
                        }
                    }
                }
            }
            if (!remote) {
                if (!expenseSupplierText(vendor.address)) throw new Error("NCC S6 thiếu địa chỉ để tạo site OGL.");
                // Dùng cùng builder S2 để giữ đúng cấu trúc payload NCC/site OGL.
                var payload = lib.ESD_HTKT_PREPAYMENT_VENDOR.buildVendorAndSiteInfo(
                    vendor, config, branch, mapping.entity, actor, oglName);
                var created = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.createVendorSiteInfo(payload);
                if (!created || created.success !== true) throw new Error(created && (created.message || created.error) || "Tạo site XDCB trên OGL thất bại.");
                remote = { entity: branch, vendorSiteCode: config.siteCode,
                    debitAccount: lib.ESD_HTKT_ACCOUNTING_UTILS.buildAccountSegment(config.debitAccount, mapping.entity),
                    creditAccount: lib.ESD_HTKT_ACCOUNTING_UTILS.buildAccountSegment(config.creditAccount, mapping.entity) };
            }
            saveExpenseXdcbSite(vendor.id, remote);
            site = getExpenseXdcbSite(vendor.id, branch, config.siteCode);
            if (!site) throw new Error("Chưa lưu được site XDCB về S6.");
        }
        var master = new SCFile("esdHTKTvendor");
        try {
            if (master.doSelect('id="' + expenseSupplierQuote(vendor.id) + '"') !== RC_SUCCESS) throw new Error("Không đọc lại được NCC S6.");
            master["ogl.sync.status"] = true;
            if (master.doUpdate() !== RC_SUCCESS) throw new Error("Không lưu được trạng thái đồng bộ NCC S6.");
        } finally { expenseSupplierClose(master); }
        record["vendor.site.id"] = site.id;
        record["ogl.sync.status"] = true;
        return { success: true, siteId: site.id };
    } catch (error) {
        return { success: false, message: String(error.message || error) };
    }
}

/** Chỉ nhận site active đúng NCC, chi nhánh và mã XDCB, có đủ tài khoản. */
function getExpenseXdcbSite(vendorId, branch, siteCode) {
    var site = expenseSupplierReadOne("esdHTKTvendorSite", 'vendor.id="' + expenseSupplierQuote(vendorId) +
        '" and ogl.entity="' + expenseSupplierQuote(branch) + '" and ogl.site.code="' + expenseSupplierQuote(siteCode) + '" and active=true',
        ["id", "vendor.id", "ogl.entity", "ogl.site.code", "debit.account", "credit.account", "ogl.sync.status"], false);
    if (site && (!site.id || !site["debit.account"] || !site["credit.account"] || !expenseSupplierFlag(site["ogl.sync.status"]))) return null;
    return site;
}

/** Upsert site từ OGL, kiểm tra kết quả ghi thay vì báo đồng bộ thành công sớm. */
function saveExpenseXdcbSite(vendorId, site) {
    if (!site.debitAccount || !site.creditAccount) throw new Error("Site XDCB OGL thiếu tài khoản Nợ/Có.");
    var query = 'vendor.id="' + expenseSupplierQuote(vendorId) + '" and ogl.entity="' + expenseSupplierQuote(site.entity) +
        '" and ogl.site.code="' + expenseSupplierQuote(site.vendorSiteCode) + '"';
    var existing = expenseSupplierReadOne("esdHTKTvendorSite", query, ["id"], false);
    var file = new SCFile("esdHTKTvendorSite");
    try {
        if (existing && file.doSelect('id="' + expenseSupplierQuote(existing.id) + '"') !== RC_SUCCESS) throw new Error("Không đọc lại được site S6.");
        file["id"] = existing ? existing.id : expenseSupplierNumber("esdHTKTvendorSite");
        file["vendor.id"] = vendorId;
        file["ogl.entity"] = site.entity;
        file["ogl.site.code"] = site.vendorSiteCode;
        file["debit.account"] = site.debitAccount;
        file["credit.account"] = site.creditAccount;
        file["active"] = true;
        file["ogl.sync.status"] = true;
        var rc = file.doAction(existing ? "update" : "add");
        if (rc !== RC_SUCCESS) throw new Error("Không lưu được site XDCB về S6. Code: " + rc);
    } finally { expenseSupplierClose(file); }
}

/** Đọc một kết quả duy nhất; lỗi query và dữ liệu trùng không được coi là chưa có. */
function expenseSupplierReadOne(table, query, fields, required) {
    var file = new SCFile(table, SCFILE_READONLY);
    try {
        file.setFields(fields);
        var rc = file.doSelect(query);
        if (rc === RC_NO_MORE && !required) return null;
        if (rc !== RC_SUCCESS) throw new Error("Không đọc được dữ liệu " + table + ". Code: " + rc);
        var row = {};
        for (var i = 0; i < fields.length; i++) row[fields[i]] = file[fields[i]];
        rc = file.getNext();
        if (rc === RC_SUCCESS) throw new Error("Có nhiều bản ghi khớp trong " + table + ". Cần kiểm tra dữ liệu trùng.");
        if (rc !== RC_NO_MORE) throw new Error("Không kiểm tra được tính duy nhất trong " + table + ". Code: " + rc);
        return row;
    } finally { expenseSupplierClose(file); }
}

/** Sinh ID nội bộ bằng number series SM, giống luồng lưu NCC S2. */
function expenseSupplierNumber(table) {
    var id = new SCDatum();
    var rc = new SCDatum();
    rc.setValue(-1);
    system.functions.rtecall("getnumber", rc, id, table);
    if (String(rc.getText()) !== "0" || !id.getText()) throw new Error("Không sinh được mã " + table + ".");
    return String(id.getText());
}

/** Giữ mã/MST dạng chuỗi và bỏ khoảng trắng ngoài. */
function expenseSupplierText(value) { return value == null ? "" : String(value).replace(/^\s+|\s+$/g, ""); }

/** Escape chuỗi truy vấn SM, không làm mất số 0 đầu của MST. */
function expenseSupplierQuote(value) { return expenseSupplierText(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

/** Chuẩn hóa cờ logical SM cho trạng thái OGL. */
function expenseSupplierFlag(value) { return /^(true|1)$/i.test(expenseSupplierText(value)); }

/** Đóng cursor trong cả nhánh thành công và lỗi. */
function expenseSupplierClose(file) { try { if (file) file.doClose(); } catch (error) {} }
