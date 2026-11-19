/**
 * ScriptLibrary: ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER
 * Nguồn HĐ/NCC dùng chung cho DC/TT; mỗi luồng giữ kiểm tra quyền riêng trước khi gọi.
 * Droplist dùng ID Contractor hoặc MST của NCC trên HĐ rút gọn; vendor.id/site.id của món luôn là ID S6.
 * Chọn/Lưu/Import/Sync -> getExpenseXdcbSelection -> SHTL TH1/TH2 -> HĐ thật -> NCC -> master/site S6.
 * TH1/TH2 là loại SHTL trong/vượt thẩm quyền; under500/over500 là nguồn NCC, không dùng thay nhau.
 */

/** Đọc hạng mục và người xử lý từ phiếu cha. */
function getExpenseSupplierContext(record, actor, requireEdit) {
    var paymentId = expenseSupplierText(record && (record["payment.id"] || record.payment_id));
    var parent = expenseSupplierReadOne(
        "esdHTKTpayment",
        'id="' + expenseSupplierQuote(paymentId) + '"',
        [
            "id",
            "transaction.type",
            "original.contract.category",
            "current.phase",
            "initial.role",
            "created.by",
            "user.checker.kttc",
            "unit.lv1",
            "unit.lv2",
            "description"
        ],
        true
    );
    if (paymentId.indexOf("DC.") !== 0 || !parent || parent["transaction.type"] !== "Dự chi") {
        throw new Error("Không tìm thấy phiếu Dự chi hợp lệ.");
    }
    var category =
        expenseSupplierText(parent["original.contract.category"]).toUpperCase() || "HHDV";
    if (category !== "HHDV" && category !== "XDCB")
        throw new Error("Hạng mục của phiếu Dự chi không hợp lệ.");
    var user = expenseSupplierText(actor).toLowerCase();
    var creator = expenseSupplierText(parent["created.by"]).toLowerCase();
    var checker = expenseSupplierText(parent["user.checker.kttc"]).toLowerCase();
    var phase = expenseSupplierText(parent["current.phase"]);
    var role = expenseSupplierText(parent["initial.role"]);
    var canEdit =
        !!user &&
        ((phase === "initial_dmms" && role === "dmms" && user === creator) ||
            (phase === "initial_kttc" &&
                (user === checker || (role === "kttc" && user === creator))));
    if (requireEdit && !canEdit)
        throw new Error("Không có quyền sửa món tại bước hiện tại của phiếu Dự chi.");
    return {
        payment: parent,
        category: category,
        canEdit: canEdit,
        canSync: canEdit && phase === "initial_kttc",
        actor: expenseSupplierText(actor)
    };
}

/** Phân nguồn từ HĐ đã đọc trên server: sửa chữa under500 lấy trên HĐ, còn lại lấy qua gói thầu. */
function getExpenseXdcbSupplierSource(contract) {
    // TH2 lấy NCC đã được chỉ định trong hồ sơ; không bắt có dòng NCC gói thầu.
    if (contract.dossier) {
        return "DOSSIER";
    }
    // Nhận cả DTO API và record đọc trực tiếp khi mở form.
    var repairId = expenseSupplierText(contract.repairId || contract["repair.id"]);
    var constructionId = expenseSupplierText(contract.constructionId || contract["construction.id"]);
    if (!!repairId === !!constructionId) throw new Error("HĐ XDCB phải thuộc đúng một công trình sửa chữa hoặc dự án xây mới/cải tạo.");
    if (repairId) {
        var budgetType = expenseSupplierText(contract.budgetType || contract["type.budget"]).toLowerCase();
        // Thầu rút gọn không tạo gói thầu; không suy ra nhánh bằng giá trị hợp đồng.
        if (budgetType === "under500") return "CONTRACT";
        if (budgetType !== "over500") throw new Error("HĐ sửa chữa XDCB chưa có phân loại type.budget under500/over500 hợp lệ.");
    }
    // Sửa chữa over500 và mọi dự án xây mới/cải tạo đều bắt buộc có gói thầu.
    if (!expenseSupplierText(contract.tenderPackageId || contract["tender.package.id"])) {
        throw new Error("HĐ XDCB chưa có liên kết gói thầu.");
    }
    return "PACKAGE";
}

/** Đọc lại SHTL/HĐ bằng actor + phiếu cha trước khi chọn/lưu/import/sync */
function getExpenseXdcbSelection(contractId, actor, paymentId, dossierId, requireDossier) {
    var result = lib.ESD_HTKT_EXPENSE_CONTRACT.getExpenseXdcbContract({
        details: {
            contractId: expenseSupplierText(contractId),
            currentUser: actor,
            paymentId: expenseSupplierText(paymentId)
        }
    });
    if (!result || result.success !== true || !result.data) {
        throw new Error((result && result.message) || "Không kiểm tra được HĐ XDCB.");
    }
    var contract = result.data;
    // TT/DC dùng cùng bộ phân giải; khóa hồ sơ được kiểm tra từ nguồn server, không tin metadata client.
    lib.ESD_HTKT_EXPENSE_CONTRACT.selectContractDossier(
        contract,
        dossierId,
        requireDossier === true,
        paymentId
    );
    if (!expenseSupplierText(contract.currency)) throw new Error("HĐ XDCB chưa có loại tiền.");
    getExpenseXdcbSupplierSource(contract);
    return contract;
}

/** TH1 lấy NCC trên HĐ/gói thầu; TH2 lấy NCC trong đúng HS–HĐ đã chọn. */
function getExpenseXdcbSuppliers(contract) {
    if (contract.dossier) {
        var dossierSupplier = getExpenseDossierSupplier(contract);
        return dossierSupplier ? [dossierSupplier] : [];
    }
    if (getExpenseXdcbSupplierSource(contract) === "CONTRACT") {
        var tax = expenseSupplierText(contract.vendorTaxCode || contract["tax.code"]);
        var name = expenseSupplierText(contract.vendorName || contract["vendor.name"]);
        if (!tax || !name) {
            return emptyExpenseSupplierList(contract);
        }
        // Một HĐ rút gọn chỉ có một NCC: số tiền ở cấp NCC dùng cùng nguồn HĐ, không có dòng Contractor.
        var directDue = lib.ESD_HTKT_EXPENSE_CONTRACT.expenseXdcbMoney(
            contract.contractAmount != null ? contract.contractAmount : contract["contract.amount"]
        );
        var directPaid = lib.ESD_HTKT_EXPENSE_CONTRACT.expenseXdcbMoney(
            contract.totalPaidAmount != null ? contract.totalPaidAmount : contract["total.amount.paid"]
        );
        // Không có bản ghi Contractor: MST chỉ là khóa droplist, không ghi vào supplier.id/vendor.id S6.
        return filterExpenseXdcbDigitizationSuppliers(contract, [
            {
                "supplier.id": tax,
                "supplier.name": name,
                "tax.code": tax,
                "address": expenseSupplierText(
                    contract.vendorAddress || contract["vendor.address"]
                ),
                "total.amount.due": directDue,
                "total.amount.paid": directPaid,
                "remaining.amount": directDue === null || directPaid === null ? null : directDue - directPaid,
                "source": "S4"
            }
        ]);
    }
    var packageId = expenseSupplierText(contract.tenderPackageId || contract["tender.package.id"]);
    // TH1 đọc Contractor; không có NCC thì trả danh sách rỗng để màn hình vẫn mở được.
    var file = new SCFile("esdjoinXDCBtenderPackageContractor", SCFILE_READONLY);
    var rows = [];
    var seen = {};
    try {
        var query = 'tender.package.id="' + expenseSupplierQuote(packageId) + '"';
        var rc = file.doSelect(query);
        while (rc === RC_SUCCESS) {
            var id = expenseSupplierText(file["id"]);
            var tax = expenseSupplierText(file["tax.code"]);
            var name = expenseSupplierText(file["name"]);
            // Dòng chưa đủ thông tin chưa đưa vào droplist; không làm lỗi cả màn NCC.
            if (!id || !tax || !name) {
                rc = file.getNext();
                continue;
            }
            if (seen["$" + tax])
                throw new Error(
                    "Gói thầu có nhiều NCC cùng MST " + tax + ". Cần kiểm tra dữ liệu S4."
                );
            seen["$" + tax] = true;
            rows.push({
                "supplier.id": id,
                "supplier.name": name,
                "tax.code": tax,
                "address": expenseSupplierText(file["address"]),
                "bank.number": expenseSupplierText(file["bank.number"]),
                "bank.name": expenseSupplierText(file["bank.name"]),
                "bank": expenseSupplierText(file["bank.name"]),
                "phone.number": expenseSupplierText(file["phone.number"]),
                // Tổng tiền thuộc dòng NCC của gói thầu S4, không đọc unpaid.amount của S2.
                "total.amount.due": lib.ESD_HTKT_EXPENSE_CONTRACT.expenseXdcbMoney(file["total.amount.due"]),
                "total.amount.paid": lib.ESD_HTKT_EXPENSE_CONTRACT.expenseXdcbMoney(file["total.amount.paid"]),
                "source": "S4"
            });
            rc = file.getNext();
        }
        if (rc !== RC_NO_MORE) {
            throw new Error("Không đọc được đầy đủ danh sách NCC gói thầu XDCB.");
        }
        if (!rows.length) {
            return emptyExpenseSupplierList(contract);
        }

        for (var m = 0; m < rows.length; m++) {
            var due = rows[m]["total.amount.due"];
            var paid = rows[m]["total.amount.paid"];
            rows[m]["remaining.amount"] = due === null || paid === null ? null : due - paid;
        }
        return filterExpenseXdcbDigitizationSuppliers(contract, rows);
    } finally {
        expenseSupplierClose(file);
    }
}

/**
 * TH1 dùng NCC của HĐ/gói thầu; chỉ có TH2 thì giới hạn theo MST trong hồ sơ được SHTL dẫn tới.
 * Picker vẫn chọn cấp HĐ: gộp MST từ các hồ sơ TH2 của HĐ; có nguồn TH1 thì giữ đầy đủ NCC như TH1.
 * Không biến ID hồ sơ hoặc ID join Contractor thành vendor.id; bước lưu vẫn tìm/tạo master S6 bằng MST.
 */
function filterExpenseXdcbDigitizationSuppliers(contract, rows) {
    var refs = contract.digitizationReferences;
    // Các caller đọc snapshot món cũ không có metadata SHTL vẫn được hiển thị như trước; Save luôn kiểm tra nguồn lại.
    if (!refs) return rows;
    for (var t = 0; t < refs.length; t++) if (refs[t].sourceCase === "TH1") return rows;
    var allowed = {};
    for (var i = 0; i < refs.length; i++) {
        var tax = expenseSupplierText(refs[i].taxCode);
        if (refs[i].sourceCase === "TH2" && !tax) {
            print("HS–HĐ " + expenseSupplierText(refs[i].referenceId) + " không có NCC.");
            continue;
        }
        if (tax) allowed["$" + tax] = true;
    }
    var result = [];
    for (var j = 0; j < rows.length; j++)
        if (allowed["$" + expenseSupplierText(rows[j]["tax.code"])]) result.push(rows[j]);
    if (!result.length) return emptyExpenseSupplierList(contract);
    return result;
}

/** Tiền của đúng một HS–HĐ: dự kiến từ expected.amount, đã trả cộng dồn từ amount.
 * Hai field paid.amount/remaining.amount là field cũ; số còn lại luôn tính từ hai số nguồn trên.
 * Nhận cả DTO đã phân giải SHTL và record đọc trực tiếp để TT/DC dùng chung một công thức.
 */
function getContractDossierAmounts(dossier) {
    var money = lib.ESD_HTKT_EXPENSE_CONTRACT.expenseXdcbMoney;
    var total = money(dossier.expectedAmount !== undefined ? dossier.expectedAmount : dossier["expected.amount"]);
    var paid = money(dossier.paidAmount !== undefined ? dossier.paidAmount : dossier.amount);
    if ((total !== null && total < 0) || (paid !== null && paid < 0)) {
        throw new Error("Số tiền nguồn HS–HĐ không được âm.");
    }
    var remaining = null;
    if (total !== null && paid !== null) {
        remaining = lib.ESD_HTKT_Utils.subtractStringsManual(String(total), String(paid));
        // Nguồn đã trả hết hoặc vượt dự kiến thì không được thanh toán thêm.
        if (lib.ESD_HTKT_Utils.compareMoneyStrings(remaining, "0") < 0) remaining = "0";
    }
    return { totalAmount: total, paidAmount: paid, remainingAmount: remaining };
}

/** Kiểm tra tiền lần này trên đúng HS–HĐ; không lấy hạn mức HĐ/NCC khác thay cho hồ sơ.
 * Caller đọc lại nguồn trước khi gọi. Hàm chỉ kiểm tra, không cộng tiền S4 khi Lưu/Trình phiếu.
 */
function validateContractDossierAmount(dossier, amount) {
    var money = getContractDossierAmounts(dossier);
    if (money.remainingAmount === null) {
        throw new Error("HS–HĐ " + expenseSupplierText(dossier.id) + " chưa đủ expected.amount/amount để kiểm tra số tiền.");
    }
    var value = lib.ESD_HTKT_EXPENSE_CONTRACT.expenseXdcbMoney(expenseSupplierText(amount).replace(/,/g, ""));
    if (value === null) throw new Error("Thiếu số tiền thanh toán cho HS–HĐ.");
    if (lib.ESD_HTKT_Utils.compareMoneyStrings(String(value), money.remainingAmount) > 0) {
        throw new Error("Số tiền lần này vượt số còn lại của HS–HĐ " + expenseSupplierText(dossier.id) +
            " (" + money.remainingAmount + ").");
    }
    return money;
}

/** TH2 lấy NCC/ngân hàng và hạn mức của chính HS–HĐ; không yêu cầu dòng NCC gói thầu. */
function getExpenseDossierSupplier(contract) {
    var dossier = contract.dossier;
    var tax = expenseSupplierText(dossier.taxCode);
    var name = expenseSupplierText(dossier.supplierName);
    if (!tax || !name) {
        emptyExpenseSupplierList(contract);
        return null;
    }
    // Master S6 chỉ bổ sung địa chỉ của đúng MST đã lưu, không chọn lại NCC thay hồ sơ.
    var master = expenseSupplierReadOne("esdHTKTvendor", 'vendor.number="' + expenseSupplierQuote(tax) + '"', ["address"], false);
    var money = getContractDossierAmounts(dossier);
    return {
        // Droplist TH2 dùng MST; vendor.id khi lưu vẫn là ID master S6 như luồng cũ.
        "supplier.id": tax,
        "supplier.name": name,
        "tax.code": tax,
        "address": expenseSupplierText(master && master.address),
        "bank.number": expenseSupplierText(dossier.bankAccount),
        "bank.name": expenseSupplierText(dossier.bankName),
        // Dùng alias cũ để DO/SL TT vẫn kiểm tra tiền như trước, nhưng nguồn TH2 là đúng hồ sơ.
        "total.amount.due": money.totalAmount,
        "total.amount.paid": money.paidAmount,
        "remaining.amount": money.remainingAmount,
        "source": "S4"
    };
}

/** Thiếu NCC chỉ ghi Messages; không coi danh sách nguồn rỗng là lỗi mở màn TT/DC. */
function emptyExpenseSupplierList(contract) {
    var label = contract.dossier ? "HS–HĐ " + expenseSupplierText(contract.dossier.id)
        : "HĐ " + expenseSupplierText(contract.id);
    print(label + " không có NCC.");
    return [];
}

/** Kiểm tra lựa chọn/MST thuộc đúng nguồn NCC của HĐ, dùng chung cho chọn, lưu, import và đồng bộ. */
function resolveExpenseXdcbSupplier(contract, supplierId, taxCode) {
    var rows = getExpenseXdcbSuppliers(contract);
    var key = expenseSupplierText(supplierId);
    var tax = expenseSupplierText(taxCode);
    for (var i = 0; i < rows.length; i++) {
        if ((!key || rows[i]["supplier.id"] === key) && rows[i]["tax.code"] === tax) return rows[i];
    }
    throw new Error("NCC/MST đã chọn không thuộc nguồn NCC của HĐ XDCB.");
}

/** Đọc NCC S6; supplier.id giữ mã S2 đã có hoặc mã S6 tự cấp cho NCC nguồn S4. */
function getExpenseAccountingVendor(vendorId) {
    return expenseSupplierReadOne("esdHTKTvendor", 'id="' + expenseSupplierQuote(vendorId) + '"',
        ["id", "vendor.number", "vendor.name", "address", "supplier.id", "ogl.sync.status"], true);
}

/** Đọc mã S6 của đúng NCC đang chọn theo MST; chỉ hiển thị, không cấp số hoặc lưu DB. */
function getExpenseSupplierCodeByTax(taxCode) {
    var tax = expenseSupplierText(taxCode);
    if (!tax) return "";
    var vendor = expenseSupplierReadOne("esdHTKTvendor", 'vendor.number="' + expenseSupplierQuote(tax) + '"', ["supplier.id"], false);
    return expenseSupplierText(vendor && vendor["supplier.id"]);
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
        return ensureExpenseXdcbSupplierCode(existing);
    }
    var file = new SCFile("esdHTKTvendor");
    try {
        var vendorId = expenseSupplierNumber("esdHTKTvendor");
        // Đọc lại ngay trước Add để tái dùng NCC vừa được phiên khác tạo.
        existing = expenseSupplierReadOne("esdHTKTvendor", query, fields, false);
        if (existing) {
            if (!existing.id || !existing["vendor.name"]) throw new Error("NCC S6 cùng MST thiếu ID hoặc tên.");
            return ensureExpenseXdcbSupplierCode(existing);
        }
        file["id"] = vendorId;
        file["vendor.number"] = tax;
        file["vendor.name"] = name;
        file["address"] = expenseSupplierText(supplier.address);
        file["username"] = actor;
        file["ogl.country"] = "VN";
        // Mã NCC cấp một lần tại S6; MST và khóa Contractor của S4 vẫn giữ riêng.
        file["supplier.id"] = nextExpenseXdcbSupplierCode();
        var rc = file.doAction("add");
        if (rc !== RC_SUCCESS) {
            existing = expenseSupplierReadOne("esdHTKTvendor", query, fields, false);
            if (existing && existing.id && existing["vendor.name"]) return ensureExpenseXdcbSupplierCode(existing);
            throw new Error("Không lưu được NCC XDCB về S6. Code: " + rc);
        }
        existing = expenseSupplierReadOne("esdHTKTvendor", query, fields, true);
        if (!existing.id) throw new Error("NCC S6 vừa tạo chưa có ID hợp lệ.");
        return ensureExpenseXdcbSupplierCode(existing);
    } finally { expenseSupplierClose(file); }
}

/** NCC S4 cũ chưa có mã: bổ sung khi lưu; mã đã có, gồm mã S2, luôn được giữ nguyên. */
function ensureExpenseXdcbSupplierCode(vendor) {
    if (expenseSupplierText(vendor["supplier.id"])) return vendor.id;
    var file = new SCFile("esdHTKTvendor");
    try {
        var query = 'id="' + expenseSupplierQuote(vendor.id) + '"';
        var rc = file.doSelect(query);
        if (rc !== RC_SUCCESS) throw new Error("Không đọc được NCC S6 để bổ sung mã. Code: " + rc);
        // Đọc lại trên bản ghi trước khi cấp số, tránh đổi mã vừa được phiên khác lưu.
        if (expenseSupplierText(file["supplier.id"])) return vendor.id;
        file["supplier.id"] = nextExpenseXdcbSupplierCode();
        rc = file.doUpdate();
        var saved = expenseSupplierReadOne("esdHTKTvendor", query, ["id", "supplier.id"], true);
        if (!expenseSupplierText(saved["supplier.id"])) {
            throw new Error("Chưa lưu được mã NCC S6. Code: " + rc);
        }
        return saved.id;
    } finally { expenseSupplierClose(file); }
}

/** TU/TT/DC dùng chung Number SM; giữ nguyên mã trả về, toàn bộ quy tắc đặt tại Number. */
function nextExpenseXdcbSupplierCode() {
    var code = expenseSupplierText(expenseSupplierNumber("esdHTKTvendorCode"));
    if (!code) throw new Error("Number esdHTKTvendorCode chưa trả về mã NCC.");
    // Không dùng lại mã nếu bộ đếm bị reset hoặc đã có dữ liệu được nhập trước đó.
    var existing = expenseSupplierReadOne("esdHTKTvendor", 'supplier.id="' + expenseSupplierQuote(code) + '"', ["id"], false);
    if (existing) throw new Error("Mã " + code + " đã tồn tại. Cần kiểm tra bộ đếm esdHTKTvendorCode.");
    return code;
}

/**
 * Hiển thị thông tin HĐ của món đã có, XDCB dùng ID làm mã như khóa đã lưu.
 * Đây là đọc snapshot để xem món cũ, không phải bộ chọn HĐ; các thao tác ghi vẫn qua SHTL ở getExpenseXdcbSelection.
 */
function getExpenseContractInfo(record) {
    var context = getExpenseSupplierContext(record, "", false);
    var id = expenseSupplierText(record["contract.id"] || record.contract_id);
    if (context.category === "HHDV") return lib.ESD_HTKT_PAYMENT_VENDOR.getContractInfo(id);
    var contract = expenseSupplierReadOne(
        "esdXDCBrepairProjectCtr",
        'id="' + expenseSupplierQuote(id) + '"',
        ["id", "contract.name", "contract.amount", "effective.date", "total.amount.paid"],
        true
    );
    var money = lib.ESD_HTKT_EXPENSE_CONTRACT.expenseXdcbContractAmounts(contract);
    return {
        id: contract.id,
        code: contract.id,
        name: contract["contract.name"],
        category: "HD_GT",
        categoryName: "Hợp đồng",
        startDate: contract["effective.date"],
        totalValue: contract["contract.amount"],
        totalPaidAmount: money.totalPaidAmount === null ? "" : money.totalPaidAmount,
        remainingAmount: money.remainingAmount === null ? "" : money.remainingAmount
    };
}

/**
 * Điền hàng thông tin HS–HĐ cho FD phiếu TT và FD chi tiết NCC TT/DC, sau kiểm tra quyền của màn.
 * TT dùng khóa trên phiếu cha; DC dùng khóa trên từng món. TH1/HHDV không hiển thị hàng này.
 * Giá trị hồ sơ = expected.amount, đã trả = amount; chỉ tính biến hiển thị, không thay tiền HĐ/số tiền nhập.
 */
function loadContractDossierScreen(record) {
    // DS có thể chạy lại hoặc mở bản ghi khác: luôn xóa dữ liệu hiển thị của hồ sơ trước đó.
    vars.$contractDossierId = "";
    vars.$totalContractDossierAmount = "";
    vars.$totalContractDossierPaid = "";
    vars.$contractDossierRemainingAmount = "";
    try {
        var paymentId = expenseSupplierText(record && (record["payment.id"] || record.payment_id || record["prepayment.id"] || record.prepayment_id));
        var payment = null;
        // FD phiếu TT đã có chính record cha; FD NCC cần đọc lại cha theo payment.id.
        if (!paymentId && record && (record["transaction.type"] === "Thanh toán" || record["transaction.type"] === "Tạm ứng")) {
            paymentId = expenseSupplierText(record.id);
            payment = record;
        }
        var prefix = paymentId.substr(0, 2);
        // TU giữ HS trên cha như TT; DC giữ HS trên món.
        if (prefix !== "TT" && prefix !== "TU" && prefix !== "DC") return false;
        if (!payment) {
            payment = expenseSupplierReadOne(prefix === "TU" ? "esdHTKTprepayment" : "esdHTKTpayment", 'id="' + expenseSupplierQuote(paymentId) + '"',
                ["id", "transaction.type", "original.contract.category", "contract.id", "contract.dossier.id"], false);
        }
        if (!payment || expenseSupplierText(payment["original.contract.category"]).toUpperCase() !== "XDCB") return false;
        if (payment["transaction.type"] !== (prefix === "TU" ? "Tạm ứng" : prefix === "TT" ? "Thanh toán" : "Dự chi")) return false;

        // Có hồ sơ đã chọn mới là TH2; không tự lấy hồ sơ khác chỉ vì cùng HĐ.
        var dossierId = expenseSupplierText(prefix !== "DC" ? payment["contract.dossier.id"] : record["contract.dossier.id"]);
        var contractId = expenseSupplierText(prefix !== "DC" ? payment["contract.id"] : record["contract.id"] || record.contract_id);
        if (!dossierId || !contractId) return false;
        var dossier = expenseSupplierReadOne("esdXDCBctrPaymentAdvance",
            'id="' + expenseSupplierQuote(dossierId) + '" and ctr.id="' + expenseSupplierQuote(contractId) + '"',
            ["id", "expected.amount", "amount"], false);
        if (!dossier) {
            print("Không có HS–HĐ " + dossierId + " thuộc HĐ " + contractId + " để hiển thị.");
            return false;
        }
        var money = getContractDossierAmounts(dossier);
        vars.$contractDossierId = expenseSupplierText(dossier.id);
        // Giữ số 0; nguồn thiếu thì để trống, tuyệt đối không đọc hai field tiền cũ.
        vars.$totalContractDossierAmount = expenseSupplierText(money.totalAmount);
        vars.$totalContractDossierPaid = expenseSupplierText(money.paidAmount);
        vars.$contractDossierRemainingAmount = expenseSupplierText(money.remainingAmount);
        return true;
    } catch (error) {
        // Lỗi đọc hàng thông tin chỉ ghi Messages; các dữ liệu và quyền của màn vẫn do luồng cũ xử lý.
        print("Không đọc được thông tin HS–HĐ: " + String(error.message || error));
        return false;
    }
}

/** Tạo khóa form để lựa chọn chưa lưu không lẫn món, HĐ, người dùng hoặc phase khác. */
function expenseSupplierScreenDraftKey(record, context) {
    var itemId = expenseSupplierText(record.id || vars.$G_payment_vendor_id || vars["$G.payment.vendor.id"]);
    if (!itemId) return "";
    return JSON.stringify([context.payment.id, itemId,
        expenseSupplierText(record["contract.id"] || record.contract_id),
        expenseSupplierText(record["contract.dossier.id"]),
        expenseSupplierText(record["vendor.id"] || record.vendor_id),
        expenseSupplierText(context.actor).toLowerCase(), context.payment["current.phase"], context.payment["initial.role"]]);
}

/** Xóa bản nháp của màn XDCB hiện tại; không ghi dữ liệu xuống bảng. */
function clearExpenseSupplierScreenDraft() {
    vars["$L.expense.xdcb.supplier.draft"] = "";
    vars["$expense.xdcb.supplier.cancel.draft"] = "";
}

/** Giữ lựa chọn cùng form; chỉ dùng bản dự phòng theo thread khi người dùng Hủy popup Quay lại. */
function getExpenseSupplierScreenDraft(record, context) {
    var raw = vars["$L.expense.xdcb.supplier.draft"];
    // Log SM xác nhận bấm Không trả $proceed="no"; $L.exit đã rỗng khi DS chạy lại.
    var cancelledBack = expenseSupplierText(vars.$proceed).toLowerCase() === "no";
    if (!raw && cancelledBack) raw = vars["$expense.xdcb.supplier.cancel.draft"];
    if (!raw) {
        // Mở form mới không được dùng lại lựa chọn chưa lưu của lần mở trước, kể cả cùng mã món.
        vars["$expense.xdcb.supplier.cancel.draft"] = "";
        return null;
    }
    try {
        var draft = JSON.parse(String(raw));
        if (context.canEdit && draft.key && draft.key === expenseSupplierScreenDraftKey(record, context)) {
            vars["$L.expense.xdcb.supplier.draft"] = String(raw);
            return draft;
        }
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
        ["id", "repair.id", "construction.id", "type.budget", "tender.package.id", "currency",
            "vendor.name", "tax.code", "vendor.address"], true);
    var savedId = expenseSupplierText(record["vendor.id"] || record.vendor_id);
    var saved = savedId ? getExpenseAccountingVendor(savedId) : null;
    var sourcedContract = null;
    try {
        sourcedContract = getExpenseXdcbSelection(contractId, actor, context.payment.id, record["contract.dossier.id"]);
    }
    catch (sourceError) {
        // Món cũ vẫn hiển thị NCC đã lưu khi nguồn SHTL chưa được unload; không mở thêm NCC hoặc bỏ kiểm tra Save.
        if (!saved) throw sourceError;
    }
    var options = sourcedContract ? getExpenseXdcbSuppliers(sourcedContract) : [];
    // Nguồn chưa có NCC vẫn cho xem NCC đã lưu trên món cũ, không ghi lại xuống DB.
    if (!options.length && saved) options = [{
        "supplier.id": expenseSupplierText(saved["vendor.number"]), "supplier.name": saved["vendor.name"],
        "tax.code": expenseSupplierText(saved["vendor.number"]), "address": expenseSupplierText(saved.address), "source": "S4"
    }];
    var draft = getExpenseSupplierScreenDraft(record, context);
    var draftSupplier = null;
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
    // Mã hiển thị lấy ở master S6; khóa droplist S4 phía trên vẫn giữ nguyên.
    vars.$supplierCode = getExpenseSupplierCodeByTax(vars.$taxCode);
    // Chỉ cập nhật biến hiển thị số dư NCC; không ghi đè record.amount người dùng đang nhập.
    vars.$remainingAmount = "";
    for (var moneyIndex = 0; moneyIndex < options.length; moneyIndex++) {
        if (options[moneyIndex]["supplier.id"] === vars.$supplierId && options[moneyIndex]["remaining.amount"] != null) {
            vars.$remainingAmount = options[moneyIndex]["remaining.amount"];
        }
    }
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
    var contract = getExpenseXdcbSelection(record["contract.id"], actor, context.payment.id, record["contract.dossier.id"], true);
    var options = getExpenseXdcbSuppliers(contract);
    var currency = expenseSupplierText(contract.currency);
    for (var i = 0; i < options.length; i++) {
        if (options[i]["supplier.id"] === expenseSupplierText(supplierId)) {
            vars.$supplierId = options[i]["supplier.id"];
            vars.$supplierName = options[i]["supplier.name"];
            vars.$taxCode = options[i]["tax.code"];
            vars.$supplierCode = getExpenseSupplierCodeByTax(vars.$taxCode);
            vars.$remainingAmount = options[i]["remaining.amount"] == null ? "" : options[i]["remaining.amount"];
            vars.$supplierAddress = expenseSupplierText(options[i].address);
            vars.$G_supplier_id = options[i]["supplier.id"];
            vars.$vendorType = options[i].type || "";
            vars.$currency = currency;
            // Chỉ điền mặc định khi nội dung trống; không ghi đè nội dung người dùng đang soạn.
            if (!expenseSupplierText(record["transaction.des"])) record["transaction.des"] = context.payment.description || "";
            vars.$G_description = record["transaction.des"];
            var draftKey = expenseSupplierScreenDraftKey(record, context);
            if (draftKey) {
                var draftValue = JSON.stringify({ key: draftKey, supplierId: options[i]["supplier.id"] });
                vars["$L.expense.xdcb.supplier.draft"] = draftValue;
                // Biến theo thread giữ được ID qua popup RAD; không lưu tên/MST hoặc số tiền.
                vars["$expense.xdcb.supplier.cancel.draft"] = draftValue;
            }
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
    var contract = getExpenseXdcbSelection(record["contract.id"], actor, context.payment.id, record["contract.dossier.id"], true);
    var supplier = resolveExpenseXdcbSupplier(contract, vars.$supplierId, vars.$taxCode);
    // Input số tiền của FD ghi trực tiếp vào record; $amount có thể vẫn là giá trị khởi tạo.
    var amount = Number(String(record["amount"]).replace(/,/g, ""));
    if (!isFinite(amount) || amount <= 0 || amount > 9007199254740991) throw new Error("Số tiền dự chi phải lớn hơn 0 hợp lệ.");
    // Nguồn vừa được đọc lại qua SHTL; chặn vượt hồ sơ trước khi tạo master NCC hoặc đồng bộ site.
    if (contract.dossier) {
        validateContractDossierAmount(contract.dossier, amount);
    }
//    if (!expenseSupplierText(record["transaction.des"]) || expenseSupplierText(record["transaction.des"]).length > 255) {
//        throw new Error("Nội dung đề nghị là bắt buộc và không quá 255 ký tự.");
//    }
    var oldId = expenseSupplierText(record["vendor.id"]);
    var oldVendor = oldId ? getExpenseAccountingVendor(oldId) : null;
    if (lib.ESD_HTKT_EXPENSE_VENDOR.hasExpenseVendorInvoices(record) &&
            (!oldVendor || oldVendor["vendor.number"] !== supplier["tax.code"])) {
        throw new Error("Không được đổi NCC khi món Dự chi đã gắn hóa đơn.");
    }
    var vendorId = ensureExpenseXdcbVendor(supplier, actor);
    // Lần lưu đầu đã có mã từ Number: điền ngay lên FD mà không thay khóa NCC nguồn S4.
    vars.$supplierCode = getExpenseSupplierCodeByTax(supplier["tax.code"]);
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
    var contract = getExpenseXdcbSelection(record["contract.id"], actor, context.payment.id, record["contract.dossier.id"], true);
    var vendor = getExpenseAccountingVendor(record["vendor.id"]);
    resolveExpenseXdcbSupplier(contract, "", vendor["vendor.number"]);
    if (expenseSupplierText(record.currency) !== expenseSupplierText(contract.currency)) {
        throw new Error("Loại tiền của món khác loại tiền HĐ XDCB.");
    }
    return { context: context, contract: contract, vendor: vendor };
}

/** Chuyển bước DC: đọc tiền mới nhất theo khóa hồ sơ của món đã lưu.
 * Quyền chuyển bước vẫn do WF kiểm tra; không gọi quyền chọn HĐ của bước Tạo mới tại bước phê duyệt.
 * amount có thể là tổng các món cùng HS trên phiếu, để không chia nhỏ món nhằm vượt hạn mức hồ sơ.
 */
function validateExpenseDossierPayment(record, payment, amount) {
    if (expenseSupplierText(payment["original.contract.category"]).toUpperCase() !== "XDCB") return;
    var dossierId = expenseSupplierText(record["contract.dossier.id"]);
    if (!dossierId) return; // TH1 giữ nguyên luồng cũ.
    var dossier = expenseSupplierReadOne("esdXDCBctrPaymentAdvance",
        'id="' + expenseSupplierQuote(dossierId) + '" and ctr.id="' + expenseSupplierQuote(record["contract.id"]) + '"',
        ["id", "contractor.tax.code", "payment.type", "expected.amount", "amount"], true);
    var vendor = getExpenseAccountingVendor(record["vendor.id"]);
    if (expenseSupplierText(dossier["contractor.tax.code"]) !== expenseSupplierText(vendor["vendor.number"]) ||
            expenseSupplierText(dossier["payment.type"]) !== "DU_CHI") {
        throw new Error("NCC hoặc loại phiếu không khớp HS–HĐ " + dossierId + ".");
    }
    validateContractDossierAmount(dossier, amount === undefined ? record.amount : amount);
}

/** Đồng bộ như S2: vấn tin chưa xác nhận có site thì tạo site XDCB từ NCC S6. */
function syncExpenseXdcbVendorToOgl(record, branchCode, entityCode, actor) {
    record["ogl.sync.status"] = false;
    try {
        // DC giữ nguyên guard nguồn/quyền; chỉ phần OGL thuần được dùng chung với TT.
        var selection = validateExpenseXdcbItem(record, actor);
        if (!selection.context.canEdit)
            throw new Error("Không có quyền đồng bộ NCC/site tại bước hiện tại của phiếu Dự chi.");
        var mapping = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(selection.context.payment["unit.lv1"]);
        if (!mapping || !mapping.entity || !mapping.oglBranchCode)
            throw new Error("Chưa có entity/chi nhánh OGL của phiếu Dự chi.");
        return lib.ESD_HTKT_PREPAYMENT_VENDOR.syncVendorToOgl(
            record, 
            mapping.oglBranchCode, 
            mapping.entity, 
            actor, "XDCB"
        );
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
