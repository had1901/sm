/**
 * ScriptLibrary: ESD_SHTL_TEST_DATA
 * Chạy thủ công bằng DO trên phiếu Dự chi XDCB ở môi trường test; không gắn vào workflow/API.
 * Phần A preview/create/verify/cleanup: tạo liên kết SHTL vào HĐ có sẵn, không sửa HĐ thật.
 * Phần B previewContracts/auditContracts/createContracts/completeContracts/verifyContracts/clearContracts: bộ 8 HĐ và nguồn.
 * TH1: SHTL.id.contract -> HĐ.id.
 * TH2: SHTL.id.contract -> hồ sơ.id -> hồ sơ.ctr.id -> HĐ.id; MST lấy từ NCC thật của HĐ.
 * Không tạo tài liệu ECM, trạng thái hoàn tất hay sự kiện thanh toán/đồng bộ ngược S4.
 */

/** Xem trước HĐ/NCC và các bản ghi sẽ tạo; hoàn toàn chỉ đọc. */
function preview(options) {
    return shtlTestRun("preview", options);
}

/** Tạo dữ liệu thiếu, tái sử dụng dữ liệu test khớp sẵn và kiểm tra lại bằng reader nghiệp vụ. */
function create(options) {
    return shtlTestRun("create", options);
}

/** Đọc bản ghi test đã lưu qua reader SHTL/HĐ/NCC thật; không dùng dữ liệu dự kiến làm kết quả. */
function verify(options) {
    return shtlTestRun("verify", options);
}

/** Chỉ xóa đúng các ID test thuộc người dùng/phiếu hiện tại, sau khi kiểm tra tham chiếu. */
function cleanup(options) {
    return shtlTestRun("cleanup", options);
}

/** Điều phối thao tác; lỗi tạo sẽ thử thu hồi riêng những dòng vừa thêm trong lần chạy này. */
function shtlTestRun(action, options) {
    var inserted = [];
    var context = null;
    var slots = null;
    try {
        options = options || {};
        context = shtlTestContext(options);
        slots = shtlTestSlots(context);
        var existing = shtlTestExisting(slots);
        if (action === "cleanup") return shtlTestCleanup(context, slots, existing);

        var plan = shtlTestPlan(context, options, slots, existing);
        if (action === "preview") {
            return {
                success: true,
                action: action,
                paymentId: context.paymentId,
                actor: context.actor,
                cases: plan.cases,
                records: plan.records,
                message: "Chỉ xem trước, chưa ghi dữ liệu."
            };
        }
        if (action === "create") {
            // Tất cả ID đã được kiểm tra trước khi ghi dòng đầu; không cập nhật/ghi đè bản ghi có sẵn.
            for (var i = 0; i < plan.records.length; i++) {
                var record = plan.records[i];
                if (record.exists) continue;
                shtlTestInsert(record);
                inserted.push(record);
            }
        }
        var checked = shtlTestVerify(context, plan);
        return {
            success: true,
            action: action,
            paymentId: context.paymentId,
            actor: context.actor,
            createdCount: inserted.length,
            reusedCount: action === "create" ? plan.records.length - inserted.length : 0,
            records: plan.records,
            checks: checked,
            message: "Đã đọc được liên kết test bằng reader HĐ và NCC hiện tại."
        };
    } catch (error) {
        var rollback = [];
        if (inserted.length) {
            try {
                // Nếu người khác vừa tạo món dùng nguồn này thì giữ nguồn lại, báo rõ để xử lý thủ công.
                shtlTestAssertUnused(context, slots, shtlTestExisting(slots));
                for (var r = inserted.length - 1; r >= 0; r--) {
                    shtlTestDelete(inserted[r]);
                    rollback.push(inserted[r].values.id);
                }
            } catch (rollbackError) {
                error.rollbackMessage = String(rollbackError.message || rollbackError);
            }
        }
        var remaining = [];
        for (var n = 0; n < inserted.length; n++) {
            if (rollback.indexOf(inserted[n].values.id) < 0) remaining.push(inserted[n].values.id);
        }
        var result = {
            success: false,
            action: action,
            message: String(error.message || error),
            rolledBackIds: rollback,
            remainingCreatedIds: remaining,
            rollbackMessage: error.rollbackMessage || ""
        };
        print("[DC-SHTL-TEST][ERROR] " + JSON.stringify(result));
        return result;
    }
}

/** Lấy actor từ phiên SM, kiểm tra đúng phiếu Dự chi XDCB và dùng lại quyền/phase của picker thật. */
function shtlTestContext(options) {
    var actor = shtlTestText(vars.$lo_operator && vars.$lo_operator["contact.name"]);
    actor = actor || shtlTestText(vars["$lo.contact.name"]);
    var current = vars.$L_file;
    var paymentId = shtlTestText(options.paymentId);
    if (!paymentId && current) {
        paymentId = shtlTestText(current["payment.id"]) || shtlTestText(current.id);
    }
    if (!actor || paymentId.indexOf("DC.") !== 0) {
        throw new Error("Chạy DO từ phiếu Dự chi XDCB, hoặc truyền paymentId Dự chi hợp lệ.");
    }
    var contractLib = lib.ESD_HTKT_EXPENSE_CONTRACT;
    if (!contractLib || typeof contractLib.expenseDigitizationContractPlan !== "function" ||
            typeof contractLib.expenseDigitizationReadRows !== "function" ||
            !lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER) {
        throw new Error("Cần cập nhật hai SL EXPENSE_CONTRACT và EXPENSE_CONTRACT_SUPPLIER hỗ trợ SHTL trước.");
    }
    var gate = contractLib.listExpenseContracts({ details: {
        paymentId: paymentId,
        currentUser: actor,
        start: 1,
        count: 1
    } });
    if (!gate || gate.success !== true || gate.contractCategory !== "XDCB") {
        throw new Error((gate && gate.message) || "Chỉ chạy trên phiếu Dự chi XDCB được phép chọn HĐ.");
    }
    var marker = "S6DC_SHTL_TEST|" + actor.toLowerCase() + "|" + paymentId;
    if (marker.length > 220) throw new Error("Mã phiếu/người dùng quá dài để đánh dấu dữ liệu test.");
    return {
        actor: actor,
        paymentId: paymentId,
        marker: marker,
        prefix: "S6DC_TEST_" + shtlTestHash(marker),
        scope: contractLib.expenseContractScope(actor, paymentId)
    };
}

/** Ba ID cố định theo phiên người dùng/phiếu; marker đầy đủ giúp phát hiện cả va chạm hash. */
function shtlTestSlots(context) {
    return [
        {
            table: "esdHDdigitization",
            id: context.prefix + "_S1",
            markerField: "name",
            marker: context.marker + "|TH1",
            fields: ["id", "name", "type.document", "id.contract"]
        },
        {
            table: "esdXDCBctrPaymentAdvance",
            id: context.prefix + "_HS2",
            markerField: "content",
            marker: context.marker + "|TH2",
            fields: ["id", "content", "ctr.id", "ctr.name", "contractor.tax.code", "contractor.name"]
        },
        {
            table: "esdHDdigitization",
            id: context.prefix + "_S2",
            markerField: "name",
            marker: context.marker + "|TH2",
            fields: ["id", "name", "type.document", "id.contract"]
        }
    ];
}

/** Đọc đúng ba ID; bản ghi cùng ID nhưng không có marker của lần test này phải dừng, không ghi đè. */
function shtlTestExisting(slots) {
    var existing = {};
    for (var i = 0; i < slots.length; i++) {
        var slot = slots[i];
        var rows = shtlTestRead(slot.table, 'id="' + shtlTestQuote(slot.id) + '"', slot.fields);
        if (rows.length > 1) throw new Error("Trùng ID test: " + slot.id);
        if (!rows.length) continue;
        if (shtlTestText(rows[0][slot.markerField]) !== slot.marker) {
            throw new Error("ID đã thuộc dữ liệu khác; không ghi đè/xóa: " + slot.id);
        }
        existing[slot.id] = rows[0];
    }
    return existing;
}

/** Lập kế hoạch TH1/TH2 từ HĐ thật trong phạm vi; BOTH cần hai HĐ khác nhau để không che nhánh NCC TH2. */
function shtlTestPlan(context, options, slots, existing) {
    var mode = shtlTestText(options.mode).toUpperCase() || "BOTH";
    if (mode !== "BOTH" && mode !== "TH1" && mode !== "TH2") {
        throw new Error("mode chỉ nhận BOTH, TH1 hoặc TH2.");
    }
    var contractLib = lib.ESD_HTKT_EXPENSE_CONTRACT;
    var nativePlan = contractLib.expenseDigitizationContractPlan({}, context.scope);
    var contracts = contractLib.expenseDigitizationReadRows(
        "esdXDCBrepairProjectCtr",
        nativePlan.query,
        nativePlan.fields,
        "test-candidate-contracts",
        contractLib.expenseContractRow
    );
    contracts.sort(function (a, b) {
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    var old1 = existing[slots[0].id];
    var old2 = existing[slots[1].id];
    var id1 = shtlTestText(options.contractIdTH1) || shtlTestText(old1 && old1["id.contract"]);
    var id2 = shtlTestText(options.contractIdTH2) || shtlTestText(old2 && old2["ctr.id"]);
    var cases = [];
    var records = [];
    if (mode !== "TH2") {
        var first = shtlTestChooseContract(contracts, id1, id2);
        id1 = first.id;
        // TH1 cũng kiểm tra NCC thật, tránh tạo nguồn mà sau đó droplist NCC không thể mở.
        var suppliers1 = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseXdcbSuppliers(first);
        cases.push({ sourceCase: "TH1", contractId: id1, shtlId: slots[0].id, supplierCount: suppliers1.length });
        records.push(shtlTestRecord(slots[0], {
            id: slots[0].id,
            name: slots[0].marker,
            "type.document": "XDCB_CTSC_XMCT_TTQ",
            "id.contract": id1
        }, existing));
    }
    if (mode !== "TH1") {
        var second = shtlTestChooseContract(contracts, id2, id1);
        if (mode === "BOTH" && second.id === id1) throw new Error("TH1/TH2 cần chọn hai HĐ khác nhau.");
        var suppliers2 = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseXdcbSuppliers(second);
        var tax = shtlTestText(options.taxCodeTH2) || shtlTestText(old2 && old2["contractor.tax.code"]);
        var chosen = null;
        for (var i = 0; i < suppliers2.length; i++) {
            if (!tax || shtlTestText(suppliers2[i]["tax.code"]) === tax) {
                chosen = suppliers2[i];
                break;
            }
        }
        if (!chosen) throw new Error("MST TH2 không thuộc NCC thật của HĐ đã chọn.");
        tax = shtlTestText(chosen["tax.code"]);
        cases.push({
            sourceCase: "TH2",
            contractId: second.id,
            shtlId: slots[2].id,
            dossierId: slots[1].id,
            taxCode: tax
        });
        // Tạo hồ sơ trước SHTL; không điền amount/paid.amount/remaining.amount hoặc trạng thái thanh toán giả.
        records.push(shtlTestRecord(slots[1], {
            id: slots[1].id,
            content: slots[1].marker,
            "ctr.id": second.id,
            "ctr.name": second.name,
            "contractor.tax.code": tax,
            "contractor.name": shtlTestText(chosen["supplier.name"])
        }, existing));
        records.push(shtlTestRecord(slots[2], {
            id: slots[2].id,
            name: slots[2].marker,
            "type.document": "XDCB_XMCT_VTQ",
            "id.contract": slots[1].id
        }, existing));
    }
    return { cases: cases, records: records };
}

/** Chỉ chọn HĐ đủ điều kiện; mã chỉ định sai quyền/status không được fallback sang HĐ khác. */
function shtlTestChooseContract(contracts, requestedId, excludedId) {
    for (var i = 0; i < contracts.length; i++) {
        if (requestedId ? contracts[i].id === requestedId : contracts[i].id !== excludedId) {
            return contracts[i];
        }
    }
    throw new Error(requestedId
        ? "HĐ không đủ điều kiện/phạm vi: " + requestedId
        : "Không đủ HĐ Đang thực hiện trong phạm vi; chọn mode TH1/TH2 hoặc chỉ định HĐ hợp lệ.");
}

/** Kiểm tra toàn bộ field liên kết trước khi ghi; chạy lại chỉ tái sử dụng khi dữ liệu khớp hoàn toàn. */
function shtlTestRecord(slot, values, existing) {
    var old = existing[slot.id];
    if (old) {
        for (var key in values) {
            if (Object.prototype.hasOwnProperty.call(values, key) &&
                    shtlTestText(old[key]) !== shtlTestText(values[key])) {
                throw new Error("Dữ liệu test đã khác kế hoạch tại " + slot.id + ", field " + key + ". Không ghi đè.");
            }
        }
    }
    return {
        table: slot.table,
        markerField: slot.markerField,
        marker: slot.marker,
        exists: !!old,
        values: values
    };
}

/** Insert trực tiếp đúng bảng nguồn, không gọi Document Engine, add workflow hay helper tăng số tiền. */
function shtlTestInsert(record) {
    var file = new SCFile(record.table);
    try {
        for (var key in record.values) {
            if (Object.prototype.hasOwnProperty.call(record.values, key)) file[key] = record.values[key];
        }
        file["created.at"] = system.functions.tod();
        if (record.table === "esdHDdigitization") {
            file["created.by"] = shtlTestText(vars.$lo_operator && vars.$lo_operator["contact.name"]) ||
                shtlTestText(vars["$lo.contact.name"]);
            file.year = String(new Date().getFullYear());
        }
        var rc = file.doInsert();
        if (rc !== RC_SUCCESS) throw new Error("Insert " + record.table + "/" + record.values.id + " lỗi RC=" + rc);
    } finally {
        shtlTestClose(file);
    }
}

/** Kiểm tra nguồn riêng từng SHTL và kết quả picker thật; TH2 phải lọc đúng MST từ hồ sơ. */
function shtlTestVerify(context, plan) {
    var checked = [];
    for (var i = 0; i < plan.records.length; i++) {
        var record = plan.records[i];
        var fields = [];
        for (var key in record.values) {
            if (Object.prototype.hasOwnProperty.call(record.values, key)) fields.push(key);
        }
        var rows = shtlTestRead(record.table, 'id="' + shtlTestQuote(record.values.id) + '"', fields);
        if (rows.length !== 1) throw new Error("Chưa có bản ghi test: " + record.values.id);
        var existing = {};
        existing[record.values.id] = rows[0];
        shtlTestRecord({ id: record.values.id, table: record.table }, record.values, existing);
    }
    for (var c = 0; c < plan.cases.length; c++) {
        var item = plan.cases[c];
        var resolved = lib.ESD_HTKT_EXPENSE_CONTRACT.getExpenseXdcbContract({ details: {
            currentUser: context.actor,
            paymentId: context.paymentId,
            contractId: item.contractId,
            digitizationId: item.shtlId
        } });
        if (!resolved || !resolved.success || !resolved.data || resolved.data.id !== item.contractId) {
            throw new Error("Không phân giải được " + item.sourceCase + ": " + ((resolved && resolved.message) || item.shtlId));
        }
        var refs = resolved.data.digitizationReferences || [];
        if (refs.length !== 1 || refs[0].id !== item.shtlId || refs[0].sourceCase !== item.sourceCase) {
            throw new Error("Reader trả sai tham chiếu SHTL của " + item.sourceCase);
        }
        var suppliers = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseXdcbSuppliers(resolved.data);
        if (item.sourceCase === "TH2" && (refs[0].referenceId !== item.dossierId ||
                refs[0].taxCode !== item.taxCode || suppliers.length !== 1 ||
                shtlTestText(suppliers[0]["tax.code"]) !== item.taxCode)) {
            throw new Error("TH2 chưa phân giải/lọc đúng hồ sơ và MST.");
        }
        var picker = lib.ESD_HTKT_EXPENSE_CONTRACT.listExpenseContracts({ details: {
            paymentId: context.paymentId,
            currentUser: context.actor,
            keyword: item.contractId,
            start: 1,
            count: 100
        } });
        var visible = false;
        if (picker && picker.success) {
            for (var p = 0; p < picker.data.length; p++) {
                if (picker.data[p].id === item.contractId) visible = true;
            }
        }
        if (!visible) throw new Error("Picker Dự chi không trả HĐ test: " + item.contractId);
        checked.push({
            sourceCase: item.sourceCase,
            shtlId: refs[0].id,
            sourceReferenceId: refs[0].referenceId,
            contractId: resolved.data.id,
            supplierCount: suppliers.length,
            taxCode: item.taxCode || "",
            visibleInPicker: true
        });
    }
    return checked;
}

/** Không thu hồi nguồn test khi phiếu đã tạo món hoặc hồ sơ test được SHTL khác tham chiếu. */
function shtlTestAssertUnused(context, slots, existing) {
    var contracts = [];
    var first = existing[slots[0].id];
    var dossier = existing[slots[1].id];
    if (first) contracts.push(shtlTestText(first["id.contract"]));
    if (dossier) contracts.push(shtlTestText(dossier["ctr.id"]));
    var conditions = [];
    for (var i = 0; i < contracts.length; i++) {
        if (contracts[i]) conditions.push('contract.id="' + shtlTestQuote(contracts[i]) + '"');
    }
    if (conditions.length) {
        var items = shtlTestRead(
            "esdHTKTpaymentVendor",
            'payment.id="' + shtlTestQuote(context.paymentId) + '" and (' + conditions.join(" or ") + ")",
            ["id"]
        );
        if (items.length) throw new Error("Phiếu còn món dùng HĐ test; xóa món qua UI trước khi cleanup nguồn.");
    }
    if (dossier) {
        var sources = shtlTestRead(
            "esdHDdigitization",
            'id.contract="' + shtlTestQuote(slots[1].id) + '" and id~="' + shtlTestQuote(slots[2].id) + '"',
            ["id"]
        );
        if (sources.length) throw new Error("Hồ sơ test được SHTL khác tham chiếu; chưa xóa nguồn.");
    }
}

/** Dọn SHTL trước hồ sơ, không xóa HĐ/NCC thật; trả danh sách đã xóa kể cả khi chỉ dọn được một phần. */
function shtlTestCleanup(context, slots, existing) {
    shtlTestAssertUnused(context, slots, existing);
    var deleted = [];
    try {
        for (var i = slots.length - 1; i >= 0; i--) {
            var slot = slots[i];
            if (!existing[slot.id]) continue;
            shtlTestDelete({
                table: slot.table,
                markerField: slot.markerField,
                marker: slot.marker,
                values: existing[slot.id]
            });
            deleted.push(slot.id);
        }
        return { success: true, action: "cleanup", deletedIds: deleted };
    } catch (error) {
        return {
            success: false,
            action: "cleanup",
            deletedIds: deleted,
            message: String(error.message || error)
        };
    }
}

/** Đọc lại marker và liên kết trước Delete; chỉ cho phép hai bảng nguồn test đã định sẵn. */
function shtlTestDelete(record) {
    if (record.table !== "esdHDdigitization" && record.table !== "esdXDCBctrPaymentAdvance") {
        throw new Error("Không được xóa bảng ngoài nguồn test.");
    }
    var file = new SCFile(record.table);
    try {
        var rc = file.doSelect('id="' + shtlTestQuote(record.values.id) + '"');
        if (rc !== RC_SUCCESS || shtlTestText(file[record.markerField]) !== record.marker) {
            throw new Error("Không còn đúng bản ghi test để xóa: " + record.values.id);
        }
        for (var key in record.values) {
            if (Object.prototype.hasOwnProperty.call(record.values, key) &&
                    shtlTestText(file[key]) !== shtlTestText(record.values[key])) {
                throw new Error("Bản ghi test vừa đổi, không xóa: " + record.values.id);
            }
        }
        rc = file.doDelete();
        if (rc !== RC_SUCCESS) throw new Error("Delete " + record.values.id + " lỗi RC=" + rc);
    } finally {
        shtlTestClose(file);
    }
}

/** Dùng cùng native cursor reader với chức năng nghiệp vụ, giữ lỗi query/RC trên SM. */
function shtlTestRead(table, query, fields) {
    return lib.ESD_HTKT_EXPENSE_CONTRACT.expenseDigitizationReadRows(
        table,
        query,
        fields,
        "test-fixture"
    );
}

/** Hash ngắn chỉ dùng tạo namespace ID; quyền sở hữu luôn kiểm tra lại bằng marker đầy đủ. */
function shtlTestHash(value) {
    var hash = 0;
    for (var i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    return ("00000000" + (hash >>> 0).toString(16)).slice(-8);
}

/** Giữ ID và MST dạng text, không làm mất số 0 đầu. */
function shtlTestText(value) {
    return value == null ? "" : String(value).replace(/^\s+|\s+$/g, "");
}

/** Escape giá trị trước khi ghép vào native query SM. */
function shtlTestQuote(value) {
    return shtlTestText(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Giải phóng cursor sau Insert/Delete, kể cả khi SM trả lỗi. */
function shtlTestClose(file) {
    try { if (file) file.doClose(); } catch (closeError) {}
}

// ============================================================================
// PHẦN B - BỘ 8 HĐ GIẢ LẬP: TH1/TH2 x CTSC under500, CTSC over500, Xây mới, Cải tạo.
// Chỉ chạy thủ công trên môi trường test. ID/tên có S6DC_TEST, namespace theo actor + phiếu.
// Giữ nguyên 2 HĐ/nguồn test cũ. Không tạo phiếu, hạch toán, NCC/site S6 hoặc file ECM.
// Công trình/dự án lấy từ mẫu hợp lệ đã có; clear không được xóa các bản ghi mẫu đó.
// ============================================================================

/** Xem trước đủ 8 case cùng HĐ, gói thầu, NCC, hồ sơ-HĐ và SHTL dự kiến; chưa ghi DB. */
function previewContracts(options) {
    options = options || {};
    if (options.fullData == null) options.fullData = true;
    return shtlMockContractsRun("preview", options);
}

/** Tạo bộ 8 HĐ có đánh dấu test; chạy lại chỉ tái sử dụng dữ liệu khớp, không tạo trùng/ghi đè. */
function createContracts(options) {
    options = options || {};
    if (options.fullData == null) options.fullData = true;
    return shtlMockContractsRun("create", options);
}

/** Tạo phần còn thiếu và bổ sung field nghiệp vụ đang trống của đúng bộ mock; không ghi đè field đã có. */
function completeContracts(options) {
    return shtlMockContractsRun("complete", options);
}

/** Audit readonly: dựng đủ kế hoạch, kiểm tra liên kết/quyền và kiểu field native trước khi cho chạy complete. */
function auditContracts(options) {
    options = options || {};
    options.fullData = true;
    return shtlMockContractsRun("audit", options);
}

/** Kiểm tra đủ 8 case bằng reader HĐ/NCC/SHTL và picker Dự chi thật. */
function verifyContracts(options) {
    return shtlMockContractsRun("verify", options);
}

/** Chỉ xóa bản ghi bộ 8 tạo trong 5 bảng nguồn; tài liệu/phiếu bên ngoài bộ này sẽ chặn clear. */
function clearContracts(options) {
    return shtlMockContractsRun("clear", options);
}

/** Điều phối riêng bộ 8; lỗi tạo chỉ thu hồi những dòng vừa tạo và chưa bị nghiệp vụ khác sử dụng. */
function shtlMockContractsRun(action, options) {
    var inserted = [];
    var updated = [];
    var context;
    var slots;
    try {
        options = options || {};
        context = shtlTestContext(options);
        context.prefix += "_M8";
        context.marker += "|CONTRACT_MATRIX8";
        var cases = shtlMockContractCases(context);
        slots = shtlMockContractSlots(context, cases);
        var existing = shtlMockContractsExisting(slots);
        if (action === "clear") return shtlMockContractsClear(context, slots, existing);
        var plan = shtlMockContractPlan(context, options, cases, slots, existing);
        // fullData phục vụ bộ mock đủ thông tin; bản create/verify cũ vẫn chạy được khi chỉ cần nối nguồn.
        if (options.fullData === true || action === "complete") {
            shtlMockContractsBusinessPlan(context, plan, existing);
        }
        if (action === "preview" || action === "audit") {
            shtlMockPrepareWriteTypes(plan, true);
            return {
                success: true, action: action, paymentId: context.paymentId,
                contractCount: 8, cases: plan.cases, records: plan.records,
                dataCoverage: plan.dataCoverage || [],
                nativeTypesValidated: true,
                message: "Bộ 8 HĐ test, chưa ghi DB. Hai HĐ/nguồn test cũ giữ nguyên."
            };
        }
        if (action === "create" || action === "complete") {
            if (action === "complete") shtlMockContractsAssertUnused(slots);
            // Chặn sai kiểu của toàn bộ kế hoạch trước khi Insert/Update dòng đầu, tránh lại tạo dở vì TIME.
            shtlMockPrepareWriteTypes(plan, action === "complete");
            for (var i = 0; i < plan.records.length; i++) {
                if (plan.records[i].exists) continue;
                shtlMockContractInsert(plan.records[i], context);
                inserted.push(plan.records[i]);
                // Ghi nhận trước khi đọc lại để lỗi cắt field vẫn nằm trong danh sách rollback.
                shtlMockContractReadBack(plan.records[i]);
            }
            if (action === "complete") {
                for (var u = 0; u < plan.records.length; u++) {
                    if (!plan.records[u].exists || !plan.records[u].fillMissing) continue;
                    if (shtlMockContractFillMissing(plan.records[u])) updated.push(plan.records[u].values.id);
                }
            }
        }
        var checks = shtlTestVerify(context, plan);
        var counts = {};
        var reusedLegacyMarkers = [];
        for (var c = 0; c < inserted.length; c++) {
            counts[inserted[c].table] = (counts[inserted[c].table] || 0) + 1;
        }
        for (var l = 0; l < plan.records.length; l++) {
            if (plan.records[l].legacyTruncatedMarker) reusedLegacyMarkers.push(plan.records[l].values.id);
        }
        return {
            success: true, action: action, paymentId: context.paymentId, contractCount: 8,
            createdCount: inserted.length, createdByTable: counts,
            reusedCount: plan.records.length - inserted.length, checks: checks,
            updatedCount: updated.length, updatedIds: updated,
            dataCoverage: plan.dataCoverage || [],
            reusedLegacyMarkerIds: reusedLegacyMarkers,
            message: "Đã kiểm tra đủ 8 HĐ giả lập qua SHTL và NCC; không sửa hai HĐ/nguồn cũ."
        };
    } catch (error) {
        if (error.updatedId && updated.indexOf(error.updatedId) < 0) updated.push(error.updatedId);
        var rolledBack = [];
        var rollbackMessage = "";
        if (inserted.length) {
            try {
                shtlMockContractsAssertUnused(slots);
                for (var r = inserted.length - 1; r >= 0; r--) {
                    shtlMockContractDelete(inserted[r]);
                    rolledBack.push(inserted[r].values.id);
                }
            } catch (rollbackError) { rollbackMessage = String(rollbackError.message || rollbackError); }
        }
        var remaining = [];
        for (var n = 0; n < inserted.length; n++) {
            if (rolledBack.indexOf(inserted[n].values.id) < 0) remaining.push(inserted[n].values.id);
        }
        return {
            success: false, action: action, message: String(error.message || error),
            rolledBackIds: rolledBack, remainingCreatedIds: remaining, rollbackMessage: rollbackMessage,
            updatedIds: updated
        };
    }
}

/** Ma trận cố định 8 case; under500 không có gói thầu, các nhánh còn lại dùng gói thầu test riêng. */
function shtlMockContractCases(context) {
    var kinds = [
        { key: "CTSC_U500", label: "CTSC under500", project: "Công trình sửa chữa", model: "under500" },
        { key: "CTSC_O500", label: "CTSC over500", project: "Công trình sửa chữa", model: "over500" },
        { key: "XAY_MOI", label: "Xay moi", project: "Xây mới", model: "construction" },
        { key: "CAI_TAO", label: "Cai tao", project: "Cải tạo", model: "construction" }
    ];
    var cases = [];
    for (var k = 0; k < kinds.length; k++) {
        for (var t = 1; t <= 2; t++) {
            var number = ("0" + (cases.length + 3)).slice(-2);
            var key = context.prefix + "_" + number;
            cases.push({
                sourceCase: "TH" + t, kind: kinds[k].key, model: kinds[k].model,
                projectLabel: kinds[k].project,
                label: "TH" + t + " " + kinds[k].label + " #" + number,
                contractId: key + "_C", shtlId: key + "_S", dossierId: t === 2 ? key + "_H" : "",
                packageId: k ? key + "_P" : "", joinPrefix: key + "_J"
            });
        }
    }
    return cases;
}

/** Lập toàn bộ ID/marker trước khi ghi; thứ tự gói -> NCC -> HĐ -> hồ sơ -> SHTL để clear theo chiều ngược. */
function shtlMockContractSlots(context, cases) {
    var slots = [];
    for (var i = 0; i < cases.length; i++) {
        var item = cases[i];
        // Giữ marker tên trong 60 byte, vẫn chứa đủ actor + phiếu để phân biệt bộ test khi unload.
        var nameMarker = "[S6DC_TEST] " + item.sourceCase + "_" + item.kind + "|" +
            context.actor.toLowerCase() + "|" + context.paymentId;
        if (item.packageId) {
            slots.push(shtlMockContractSlot("esdXDCBtenderPackage", item.packageId, "id", item.packageId,
                ["id", "repair.id", "construction.id"]));
            for (var j = 1; j <= 2; j++) {
                var joinId = item.joinPrefix + j;
                slots.push(shtlMockContractSlot("esdjoinXDCBtenderPackageContractor", joinId, "contractor.group.name",
                    context.marker + "|" + item.label + "|NCC" + j,
                    ["id", "tender.package.id", "tax.code", "name", "address", "total.amount.due", "total.amount.paid", "contractor.group.name"]));
            }
        }
        var contractMarker = nameMarker;
        slots.push(shtlMockContractSlot("esdXDCBrepairProjectCtr", item.contractId, "contract.name", contractMarker,
            ["id", "contract.code", "contract.name", "contract.amount", "total.amount.paid", "currency", "status",
                "repair.id", "construction.id", "type.budget", "type.project", "tender.package.id",
                "tax.code", "vendor.name", "vendor.address", "unit.level1", "unit.level2", "unit.level3", "responsible.officer"]));
        if (item.dossierId) {
            // content chỉ có 60 byte: dùng marker ngắn như tên HĐ, không dùng marker đầy đủ của bản cũ.
            var dossierSlot = shtlMockContractSlot("esdXDCBctrPaymentAdvance", item.dossierId, "content", nameMarker,
                ["id", "content", "ctr.id", "ctr.name", "contractor.tax.code", "contractor.name"]);
            dossierSlot.legacyMarker = context.marker + "|" + item.label;
            dossierSlot.linkedContractId = item.contractId;
            dossierSlot.linkedContractName = contractMarker;
            slots.push(dossierSlot);
        }
        slots.push(shtlMockContractSlot("esdHDdigitization", item.shtlId, "name", nameMarker,
            ["id", "name", "type.document", "id.contract"]));
    }
    return slots;
}

/** Mô tả một slot sở hữu test; marker đầy đủ chống nhầm dữ liệu sau unload hoặc va chạm ID. */
function shtlMockContractSlot(table, id, markerField, marker, fields) {
    if (id.length > 60 || id.indexOf("S6DC_TEST_") !== 0) throw new Error("ID test không hợp lệ.");
    if (["name", "contract.name", "content"].indexOf(markerField) >= 0 && shtlMockMarkerBytes(marker) > 60) {
        throw new Error("Marker test của " + markerField + " vượt 60 byte; chưa ghi dữ liệu.");
    }
    return { table: table, id: id, markerField: markerField, marker: marker, fields: fields };
}

/** Đếm byte UTF-8 trong SM JavaScript; marker phải vừa field, kể cả actor hoặc mã phiếu có Unicode. */
function shtlMockMarkerBytes(value) {
    var text = String(value);
    var bytes = 0;
    for (var i = 0; i < text.length; i++) {
        var code = text.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length &&
                text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) {
            bytes += 4;
            i++;
        } else bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    }
    return bytes;
}

/** Nhận đúng marker ASCII cũ bị SM cắt ở byte 60, kèm ID/ctr.id/ctr.name và HĐ test sở hữu cùng bộ. */
function shtlMockContractLegacyOwned(slot, row, existing) {
    if (slot.table !== "esdXDCBctrPaymentAdvance" || !slot.legacyMarker || /[^\x20-\x7E]/.test(slot.legacyMarker)) return false;
    var contract = existing[slot.linkedContractId];
    if (!contract || shtlTestText(contract["contract.name"]) !== slot.linkedContractName ||
            shtlTestText(row.id) !== slot.id || shtlTestText(row["ctr.id"]) !== slot.linkedContractId ||
            shtlTestText(row["ctr.name"]) !== slot.linkedContractName) return false;
    var marker = shtlTestText(row[slot.markerField]);
    return marker === slot.legacyMarker || marker === shtlTestText(slot.legacyMarker.slice(0, 60));
}

/** Đọc bộ 8; chỉ chấp nhận marker hiện tại hoặc đúng hồ sơ-HĐ cũ bị cắt đã có đủ bằng chứng sở hữu. */
function shtlMockContractsExisting(slots) {
    var existing = {};
    for (var i = 0; i < slots.length; i++) {
        var slot = slots[i];
        var rows = shtlTestRead(slot.table, 'id="' + shtlTestQuote(slot.id) + '"', slot.fields);
        if (rows.length > 1) throw new Error("Trùng ID test: " + slot.id);
        if (!rows.length) continue;
        var row = rows[0];
        if (shtlTestText(row[slot.markerField]) !== slot.marker && !shtlMockContractLegacyOwned(slot, row, existing)) {
            throw new Error("ID đã thuộc dữ liệu khác; không ghi đè/xóa: " + slot.id);
        }
        if (slot.table === "esdXDCBctrPaymentAdvance" &&
                (shtlTestText(row["ctr.id"]) !== slot.linkedContractId ||
                shtlTestText(row["ctr.name"]) !== slot.linkedContractName)) {
            throw new Error("Hồ sơ test đã đổi liên kết HĐ; chưa ghi/xóa: " + slot.id);
        }
        existing[slot.id] = row;
    }
    return existing;
}

/** Tái sử dụng content cũ đã bị cắt mà không UPDATE DB; mọi field khác vẫn phải khớp đúng kế hoạch. */
function shtlMockContractRecord(slot, values, existing) {
    var old = existing[slot.id];
    var legacy = old && shtlTestText(old[slot.markerField]) !== slot.marker &&
        shtlMockContractLegacyOwned(slot, old, existing);
    var effectiveSlot = slot;
    if (legacy) {
        values[slot.markerField] = shtlTestText(old[slot.markerField]);
        effectiveSlot = { id: slot.id, table: slot.table, markerField: slot.markerField, marker: values[slot.markerField] };
    }
    var record = shtlTestRecord(effectiveSlot, values, existing);
    record.legacyTruncatedMarker = !!legacy;
    return record;
}

/** Chỉ lấy mẫu Đang thực hiện trong phạm vi; có thể dùng lại HĐ của chính bộ test đã xác thực để chạy tiếp. */
function shtlMockContractModels(context, options, existing) {
    var plan = lib.ESD_HTKT_EXPENSE_CONTRACT.expenseDigitizationContractPlan({}, context.scope);
    var fields = plan.fields.concat(["unit.level1", "unit.level2", "unit.level3", "type.project"]);
    // Snapshot scalar ngay tại cursor: không giữ Datum gắn với file khi đã getNext/đóng SCFile.
    var rows = lib.ESD_HTKT_EXPENSE_CONTRACT.expenseDigitizationReadRows(
        "esdXDCBrepairProjectCtr", plan.query, fields, "test-models",
        function (file) {
            var row = {};
            for (var f = 0; f < fields.length; f++) row[fields[f]] = shtlTestText(file[fields[f]]);
            return row;
        }
    );
    rows.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    var models = {};
    var requested = options.models || {};
    var rejected = [];
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var id = shtlTestText(row.id);
        // Không mượn mock của người/phiếu khác. ID cùng bộ chỉ được dùng sau kiểm tra marker + liên kết ở bước đọc slots.
        if (id.indexOf("S6DC_TEST_") === 0 && !existing[id]) continue;
        var repairId = shtlTestText(row["repair.id"]);
        var constructionId = shtlTestText(row["construction.id"]);
        var key = repairId ? shtlTestText(row["type.budget"]).toLowerCase() : constructionId ? "construction" : "";
        if (["under500", "over500", "construction"].indexOf(key) < 0 || models[key]) continue;
        if (requested[key] && shtlTestText(requested[key]) !== shtlTestText(row.id)) continue;
        try {
            var suppliers = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseXdcbSuppliers(row);
            if (!shtlTestText(row.currency) || !suppliers.length) continue;
            models[key] = { contract: row, suppliers: suppliers };
        } catch (invalidModel) {
            // Giữ nguyên lỗi gốc để không nhầm thiếu HĐ với thiếu NCC hoặc SL trên SM chưa đồng bộ.
            rejected.push({ id: id, group: key, message: String(invalidModel.message || invalidModel) });
        }
    }
    for (var n = 0; n < 3; n++) {
        var required = ["under500", "over500", "construction"][n];
        if (!models[required]) throw new Error("Thiếu HĐ mẫu Đang thực hiện trong phạm vi cho nhóm " + required +
            ". Actor=" + context.actor + ", query=" + plan.query +
            (rejected.length ? ", mẫu bị loại=" + JSON.stringify(rejected) : "") +
            ". options.models không bỏ qua trạng thái/quyền; không đổi trạng thái HĐ thật.");
    }
    return models;
}

/**
 * Case đã có HĐ: cố định vào snapshot của chính case, không chọn lại mẫu khác khi status/sort/data nguồn đổi.
 * Marker đã được kiểm tra ở existing; vẫn đọc lại HĐ bằng cùng status, soft-delete và phạm vi hiện hành.
 */
function shtlMockContractPinnedModel(context, item, existing) {
    if (!existing[item.contractId]) return null;
    var contractLib = lib.ESD_HTKT_EXPENSE_CONTRACT;
    var plan = contractLib.expenseDigitizationContractPlan({ contractId: item.contractId }, context.scope);
    var fields = plan.fields.concat(["unit.level1", "unit.level2", "unit.level3", "type.project"]);
    var rows = contractLib.expenseDigitizationReadRows(
        "esdXDCBrepairProjectCtr", plan.query, fields, "test-existing-case",
        function (file) {
            var row = {};
            for (var f = 0; f < fields.length; f++) row[fields[f]] = shtlTestText(file[fields[f]]);
            return row;
        }
    );
    if (rows.length !== 1) {
        throw new Error("HĐ mock của case không còn Đang thực hiện hoặc không thuộc phạm vi: " + item.contractId);
    }
    var contract = rows[0];
    var group = contract["repair.id"] ? contract["type.budget"].toLowerCase() : "construction";
    if (group !== item.model || contract["type.project"] !== item.projectLabel ||
            contract["tender.package.id"] !== item.packageId) {
        throw new Error("HĐ mock đã đổi phân loại hoặc gói thầu, không chọn lại mẫu để ghi đè: " + item.contractId);
    }
    var suppliers = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseXdcbSuppliers(contract);
    if (!contract.currency || !suppliers.length) throw new Error("HĐ mock thiếu loại tiền/NCC: " + item.contractId);
    if (item.packageId) {
        var ordered = [];
        for (var j = 1; j <= 2; j++) {
            var joinId = item.joinPrefix + j;
            if (!existing[joinId]) continue;
            var found = null;
            for (var s = 0; s < suppliers.length; s++) {
                if (shtlTestText(suppliers[s]["supplier.id"]) === joinId) found = suppliers[s];
            }
            if (!found || shtlTestText(existing[joinId]["tender.package.id"]) !== item.packageId) {
                throw new Error("NCC mock không còn thuộc đúng gói thầu của case: " + joinId);
            }
            ordered.push(found);
        }
        // Giữ thứ tự J1/J2 đã lưu; không để thứ tự cursor hoặc NCC ngoài bộ làm thay NCC của hồ sơ TH2.
        if (!ordered.length || ordered.length !== suppliers.length) {
            throw new Error("Gói thầu mock có NCC thiếu hoặc ngoài bộ test: " + item.packageId);
        }
        suppliers = ordered;
    }
    return { contract: contract, suppliers: suppliers };
}

/** Tạo dữ liệu 8 case: gói/NCC độc lập, TH2 giới hạn một MST; tiền giả lập chỉ nằm trên bản ghi mới. */
function shtlMockContractPlan(context, options, cases, slots, existing) {
    var models = shtlMockContractModels(context, options, existing);
    var byId = {};
    var used = {};
    var records = [];
    for (var s = 0; s < slots.length; s++) byId[slots[s].id] = slots[s];
    // Mỗi dòng đều lấy marker từ slot cố định, không nhận bảng/ID/marker tùy ý từ người gọi.
    function add(id, values) {
        var slot = byId[id];
        values.id = id;
        values[slot.markerField] = slot.marker;
        records.push(shtlMockContractRecord(slot, values, existing));
        used[id] = true;
    }
    for (var i = 0; i < cases.length; i++) {
        var item = cases[i];
        // Chỉ case chưa có HĐ mới mượn mẫu theo nhóm; case đã tạo luôn giữ dự án/NCC của chính nó.
        var model = shtlMockContractPinnedModel(context, item, existing) || models[item.model];
        var source = model.contract;
        var suppliers = model.suppliers.slice(0, 2);
        var amount = (i + 1) * 1000000;
        if (item.packageId) {
            add(item.packageId, { "repair.id": shtlTestText(source["repair.id"]), "construction.id": shtlTestText(source["construction.id"]) });
            for (var j = 0; j < suppliers.length; j++) {
                add(item.joinPrefix + (j + 1), {
                    "tender.package.id": item.packageId, "tax.code": shtlTestText(suppliers[j]["tax.code"]),
                    name: shtlTestText(suppliers[j]["supplier.name"]), address: shtlTestText(suppliers[j].address),
                    "total.amount.due": amount, "total.amount.paid": 0
                });
            }
        }
        var supplier = suppliers[0];
        add(item.contractId, {
            "contract.code": item.contractId, "contract.amount": amount, "total.amount.paid": 0,
            currency: shtlTestText(source.currency), status: "Đang thực hiện",
            "repair.id": shtlTestText(source["repair.id"]), "construction.id": shtlTestText(source["construction.id"]),
            "type.budget": shtlTestText(source["type.budget"]), "type.project": item.projectLabel,
            "tender.package.id": item.packageId,
            "tax.code": item.packageId ? "" : shtlTestText(supplier["tax.code"]),
            "vendor.name": item.packageId ? "" : shtlTestText(supplier["supplier.name"]),
            "vendor.address": item.packageId ? "" : shtlTestText(supplier.address),
            "unit.level1": shtlTestText(source["unit.level1"]), "unit.level2": shtlTestText(source["unit.level2"]),
            "unit.level3": shtlTestText(source["unit.level3"]), "responsible.officer": shtlTestText(source["responsible.officer"])
        });
        item.modelContractId = shtlTestText(source.id);
        item.supplierCount = suppliers.length;
        if (item.dossierId) {
            item.taxCode = shtlTestText(supplier["tax.code"]);
            add(item.dossierId, { "ctr.id": item.contractId, "ctr.name": byId[item.contractId].marker,
                "contractor.tax.code": item.taxCode, "contractor.name": shtlTestText(supplier["supplier.name"]) });
        }
        add(item.shtlId, { "type.document": item.sourceCase === "TH1" ? "XDCB_CTSC_XMCT_TTQ" : "XDCB_XMCT_VTQ",
            "id.contract": item.dossierId || item.contractId });
    }
    for (var key in existing) {
        if (Object.prototype.hasOwnProperty.call(existing, key) && !used[key]) {
            throw new Error("Bộ test cũ khác mẫu hiện tại tại " + key + "; không ghi đè hoặc bỏ sót bản ghi.");
        }
    }
    return { cases: cases, records: records };
}

/** Insert trực tiếp nguồn test theo thứ tự đã duyệt; không gọi workflow, OGL, ECM hoặc đồng bộ tiến độ. */
function shtlMockContractInsert(record, context) {
    if (record.table === "esdXDCBctrPaymentAdvance" && shtlMockMarkerBytes(record.values.content) > 60) {
        throw new Error("content vượt 60 byte; không Insert hồ sơ test.");
    }
    var file = new SCFile(record.table);
    try {
        for (var key in record.values) {
            if (Object.prototype.hasOwnProperty.call(record.values, key)) {
                file[key] = shtlMockNativeWriteValue(file, key, record.values[key]);
            }
        }
        if (record.table !== "esdXDCBtenderPackage" && !Object.prototype.hasOwnProperty.call(record.values, "created.at")) {
            file["created.at"] = system.functions.tod();
        }
        if (record.table === "esdHDdigitization") {
            file["created.by"] = context.actor;
            file.year = String(new Date().getFullYear());
        }
        if (record.table === "esdXDCBrepairProjectCtr") {
            file["created.by"] = context.actor;
            if (!Object.prototype.hasOwnProperty.call(record.values, "effective.date")) file["effective.date"] = system.functions.tod();
        }
        var rc = file.doInsert();
        if (rc !== RC_SUCCESS) throw new Error("Insert " + record.table + "/" + record.values.id + " lỗi RC=" + rc);
    } finally { shtlTestClose(file); }
}

/** Đọc lại ngay sau Insert để phát hiện field bị cắt/sửa trước khi tiếp tục thêm các dòng khác. */
function shtlMockContractReadBack(record) {
    var fields = [];
    for (var key in record.values) if (Object.prototype.hasOwnProperty.call(record.values, key)) fields.push(key);
    var rows = shtlTestRead(record.table, 'id="' + shtlTestQuote(record.values.id) + '"', fields);
    if (rows.length !== 1) throw new Error("Không đọc lại được bản ghi vừa thêm: " + record.values.id);
    var expected = {};
    for (var field in record.values) {
        if (!Object.prototype.hasOwnProperty.call(record.values, field)) continue;
        if (shtlMockNativeType(rows[0][field]) === "TIME") {
            if (!shtlMockNativeValueMatches(rows[0][field], record.values[field])) {
                throw new Error("Ngày/giờ mock lưu khác kế hoạch: " + record.values.id + "/" + field);
            }
            // Dùng format native đã đọc được cho bước verify tiếp theo, không ghi lại DB.
            record.values[field] = shtlTestText(rows[0][field]);
        } else expected[field] = record.values[field];
    }
    var existing = {};
    existing[record.values.id] = rows[0];
    shtlTestRecord({ id: record.values.id, table: record.table, markerField: record.markerField, marker: record.marker }, expected, existing);
}

/** Ghép OR cho các khóa test cố định; không nhận tên field từ tùy chọn người gọi. */
function shtlMockContractQuery(field, ids) {
    if (!ids.length) return "1=0";
    var parts = [];
    for (var i = 0; i < ids.length; i++) parts.push(field + '="' + shtlTestQuote(ids[i]) + '"');
    return "(" + parts.join(" or ") + ")";
}

/** Chặn clear/rollback nếu nguồn test đã được phiếu hoặc nguồn ngoài bộ này sử dụng. */
function shtlMockContractsAssertUnused(slots) {
    var ids = { contracts: [], sources: [], dossiers: [], packages: [], joins: [] };
    for (var i = 0; i < slots.length; i++) {
        var slot = slots[i];
        if (slot.table === "esdXDCBrepairProjectCtr") ids.contracts.push(slot.id);
        if (slot.table === "esdHDdigitization") ids.sources.push(slot.id);
        if (slot.table === "esdXDCBctrPaymentAdvance") ids.dossiers.push(slot.id);
        if (slot.table === "esdXDCBtenderPackage") ids.packages.push(slot.id);
        if (slot.table === "esdjoinXDCBtenderPackageContractor") ids.joins.push(slot.id);
    }
    var references = [
        ["esdHTKTpaymentVendor", shtlMockContractQuery("contract.id", ids.contracts)],
        ["esdHTKTpayment", shtlMockContractQuery("contract.id", ids.contracts)],
        ["esdHTKTprepayment", shtlMockContractQuery("contract.id", ids.contracts)],
        ["esdXDCBrepairProjectCtrPayment", shtlMockContractQuery("contract.id", ids.contracts)],
        ["esdXDCBrepairProjectCtrDoc", shtlMockContractQuery("contract.id", ids.contracts)],
        ["esdHDtlks", shtlMockContractQuery("parent.id", ids.sources)],
        ["esdHDdigitization", shtlMockContractQuery("id.contract", ids.contracts.concat(ids.dossiers)) + " and not " + shtlMockContractQuery("id", ids.sources)],
        ["esdXDCBctrPaymentAdvance", shtlMockContractQuery("ctr.id", ids.contracts) + " and not " + shtlMockContractQuery("id", ids.dossiers)],
        ["esdXDCBrepairProjectCtr", shtlMockContractQuery("tender.package.id", ids.packages) + " and not " + shtlMockContractQuery("id", ids.contracts)],
        ["esdjoinXDCBtenderPackageContractor", shtlMockContractQuery("tender.package.id", ids.packages) + " and not " + shtlMockContractQuery("id", ids.joins)]
    ];
    for (var r = 0; r < references.length; r++) {
        var used = shtlTestRead(references[r][0], references[r][1], ["id"]);
        if (used.length) throw new Error("Chưa clear: " + references[r][0] + "/" + used[0].id + " đang tham chiếu bộ test. Gỡ qua nghiệp vụ trước.");
    }
}

/** Clear đúng 5 bảng mà bộ 8 tạo; không cascade sang bảng khác dù bản ghi đó có liên kết tới test. */
function shtlMockContractsClear(context, slots, existing) {
    shtlMockContractsAssertUnused(slots);
    var deleted = [];
    try {
        for (var s = slots.length - 1; s >= 0; s--) {
            if (!existing[slots[s].id]) continue;
            shtlMockContractDelete({ table: slots[s].table, markerField: slots[s].markerField,
                marker: shtlTestText(existing[slots[s].id][slots[s].markerField]), values: existing[slots[s].id] });
            deleted.push({ table: slots[s].table, id: slots[s].id });
        }
        return { success: true, action: "clear", deletedCount: deleted.length, deleted: deleted,
            message: "Đã clear đúng bản ghi do bộ 8 tạo; giữ hai HĐ/nguồn cũ, mọi bảng khác và bản ghi mẫu." };
    } catch (error) {
        return { success: false, action: "clear", deleted: deleted, message: String(error.message || error) };
    }
}

/** Delete chỉ trong whitelist bảng test và sau khi đọc lại đúng marker, ID, liên kết đã kiểm tra. */
function shtlMockContractDelete(record) {
    var allowed = ["esdHDdigitization", "esdXDCBctrPaymentAdvance", "esdXDCBrepairProjectCtr",
        "esdjoinXDCBtenderPackageContractor", "esdXDCBtenderPackage"];
    if (allowed.indexOf(record.table) < 0) throw new Error("Không được clear bảng ngoài bộ test.");
    if (shtlTestText(record.values.id).indexOf("S6DC_TEST_") !== 0) {
        throw new Error("Không được clear ID ngoài namespace test.");
    }
    var file = new SCFile(record.table);
    try {
        if (file.doSelect('id="' + shtlTestQuote(record.values.id) + '"') !== RC_SUCCESS ||
                shtlTestText(file[record.markerField]) !== record.marker) throw new Error("Marker test không còn khớp: " + record.values.id);
        for (var key in record.values) {
            if (Object.prototype.hasOwnProperty.call(record.values, key) &&
                    shtlTestText(file[key]) !== shtlTestText(record.values[key])) throw new Error("Bản ghi vừa thay đổi, chưa clear: " + record.values.id);
        }
        var rc = file.doDelete();
        if (rc !== RC_SUCCESS) throw new Error("Delete " + record.values.id + " lỗi RC=" + rc);
    } finally { shtlTestClose(file); }
}

// ============================================================================
// PHẦN C - DỮ LIỆU NGHIỆP VỤ MOCK: preview/create mặc định fullData; complete bổ sung cả mock có sẵn.
// Mượn field có thật từ mẫu readonly. Không tạo thêm bảng, file ECM, phiếu S6 hoặc tiến độ S4.
// complete chỉ điền field đang trống của bản ghi đã xác thực; field đã có luôn được giữ nguyên.
// ============================================================================

/** Whitelist field nghiệp vụ đã đối chiếu bảng thật; không sao chép khóa hồ sơ cha, ECM hay lịch sử xử lý. */
function shtlMockBusinessColumns(table) {
    var columns = {
        esdXDCBrepairProjectCtr: [
            "signed.date", "effective.date", "expire.date", "duration.days", "currency.name",
            "doc.type", "contract.type.code", "contract.type.name", "execution.type.code", "execution.type.name",
            "payment.estimate.type", "payment.estimate.name", "signer.code", "signer.name", "signer.position",
            "repair.name", "year.doing", "vendor.profile.id", "vendor.address", "representative.name",
            "bank.account", "bank.name", "unit.level1", "unit.level2", "unit.level3"
        ],
        esdjoinXDCBtenderPackageContractor: [
            "address", "phone.number", "representative.name", "bank.number", "bank.name",
            "contractor.group", "contractor.id"
        ],
        esdHDdigitization: ["status", "supervisor.id", "digitization.signer", "year"],
        esdXDCBctrPaymentAdvance: [
            "payment.type", "status", "receiver.name", "effective.date", "sla"
        ]
    };
    return columns[table] || [];
}

/** Đọc một mẫu native, lấy đúng field có trong XML/schema; snapshot thành scalar trước khi đóng cursor. */
function shtlMockBusinessProfile(table, query, cache) {
    var key = table + "|" + query;
    if (cache[key]) return cache[key];
    var file = new SCFile(table, SCFILE_READONLY);
    var result = { id: "", values: {}, fields: [] };
    try {
        var rc = file.doSelect(query);
        if (rc === RC_NO_MORE) return result;
        if (rc !== RC_SUCCESS) throw new Error("Không đọc được mẫu nghiệp vụ " + table + ", RC=" + rc);
        result.id = shtlTestText(file.id);
        // getXML().instance cung cấp tên field thực, không đoán tên cột của bảng gói thầu chưa mở REST.
        var instance = file.getXML().instance;
        var allowed = shtlMockBusinessColumns(table);
        for (var index in instance) {
            var node = instance[index];
            if (!node || typeof node.getName !== "function" || node.getFirstChildElement() != null) continue;
            var name = String(node.getName());
            // Gói thầu lấy scalar có thật từ schema, loại khóa ngoại/lịch sử/file; repair/construction được đặt lại từ case.
            var packageField = table === "esdXDCBtenderPackage" &&
                !/(^|[.])(id|doc|attachment|approval|workflow|payment|contract|ctr|dossier|created|sysmodtime|sysmoduser|deleted)([.]|$)/.test(name) &&
                !/[.]id$/.test(name) && name !== "current.phase";
            if (allowed.indexOf(name) < 0 && !packageField) continue;
            var value = file[name];
            if (shtlTestText(value) === "") continue;
            if (shtlMockNativeType(value) === "TIME") {
                // Giữ TIME khi rời cursor, không ép String rồi gán ngược vào field ngày/SLA.
                var xmlTime = new XMLDate(value);
                var copiedTime = /([.]date|[.]at)$/.test(name) ? xmlTime.JSDate() : xmlTime.getDatum();
                if (copiedTime == null) throw new Error("Không snapshot được TIME của mẫu: " + table + "/" + name);
                result.values[name] = copiedTime;
            } else {
                result.values[name] = typeof value === "number" || typeof value === "boolean" ? value : shtlTestText(value);
            }
            result.fields.push(name);
        }
        cache[key] = result;
        return result;
    } finally { shtlTestClose(file); }
}

/** Gộp các field đã xác nhận; chỉ dùng trên object kế hoạch, không cập nhật mẫu nguồn. */
function shtlMockBusinessMerge(target, source) {
    for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
    }
    return target;
}

/** Ngày minh họa cho mock khi mẫu chưa có: ký/hiệu lực hôm nay, hết hạn sau 365 ngày; không dùng làm quy tắc thật. */
function shtlMockBusinessDate(offsetDays) {
    var date = new Date();
    date.setDate(date.getDate() + offsetDays);
    date.setHours(0, 0, 0, 0);
    return date;
}

/** Nhận Date JS trực tiếp; các Datum khác lấy type native, không dùng tên field để ép kiểu giá trị nguồn. */
function shtlMockNativeType(value) {
    return Object.prototype.toString.call(value) === "[object Date]" ? "TIME" : String(new SCDatum(value).getType());
}

/** Chuyển đúng Date/Datum TIME; field ngày dùng Date object theo API SM, duration giữ Datum TIME. */
function shtlMockNativeWriteValue(file, field, value) {
    var fieldType = shtlMockNativeType(file[field]);
    var valueType = shtlMockNativeType(value);
    // Một số getter trả NULL khi field TIME chưa có dữ liệu; Date/Datum nguồn vẫn phải giữ TIME khi ghi.
    var emptyCalendar = fieldType === "NULL" && /([.]date|[.]at)$/.test(field);
    if (fieldType !== "TIME" && valueType !== "TIME" && !emptyCalendar) return value;
    if (typeof value === "string" || value == null || valueType !== "TIME") {
        throw new Error("Field TIME cần Date/Datum hợp lệ, không nhận chuỗi: " + field);
    }
    if (/([.]date|[.]at)$/.test(field)) {
        var date = new XMLDate(value).JSDate();
        if (date == null || typeof date.getTime !== "function" || !isFinite(date.getTime())) {
            throw new Error("Ngày mock không hợp lệ: " + field);
        }
        return date;
    }
    var nativeTime = new XMLDate(value).getDatum();
    if (nativeTime == null || shtlMockNativeType(nativeTime) !== "TIME") {
        throw new Error("Không chuyển được giá trị sang native TIME: " + field);
    }
    return nativeTime;
}

/** So sánh giá trị TIME qua cùng dạng Datum, tránh coi cùng ngày khác format là khác hoặc chỉ kiểm tra khác rỗng. */
function shtlMockNativeValueMatches(actual, expected) {
    if (shtlMockNativeType(actual) !== "TIME") return shtlTestText(actual) === shtlTestText(expected);
    if (!shtlTestText(actual) || !shtlTestText(expected)) return shtlTestText(actual) === shtlTestText(expected);
    if (typeof expected === "string") return false;
    var actualDatum = new XMLDate(actual).getDatum();
    var expectedDatum = new XMLDate(expected).getDatum();
    return actualDatum != null && expectedDatum != null && shtlTestText(actualDatum) === shtlTestText(expectedDatum);
}

/** Preflight chỉ đọc schema/bản ghi: mọi giá trị sắp ghi phải tương thích trước khi phát sinh bất kỳ Insert/Update nào. */
function shtlMockPrepareWriteTypes(plan, includeExisting) {
    for (var i = 0; i < plan.records.length; i++) {
        var record = plan.records[i];
        if (record.exists && !includeExisting) continue;
        var values = record.exists ? record.fillMissing || {} : record.values;
        var file = new SCFile(record.table, SCFILE_READONLY);
        try {
            if (record.exists && (file.doSelect('id="' + shtlTestQuote(record.values.id) + '"') !== RC_SUCCESS ||
                    shtlTestText(file[record.markerField]) !== record.marker)) {
                throw new Error("Mock đã đổi trước preflight: " + record.values.id);
            }
            for (var field in values) {
                if (Object.prototype.hasOwnProperty.call(values, field)) shtlMockNativeWriteValue(file, field, values[field]);
            }
        } finally { shtlTestClose(file); }
    }
}

/** Bổ sung dữ liệu HĐ/NCC/gói/SHTL/hồ sơ vào kế hoạch; tiền minh họa chỉ ghi trên mock, không phải công thức production. */
function shtlMockContractsBusinessPlan(context, plan, existing) {
    var cache = {};
    var valuesById = {};
    var coverage = [];
    for (var v = 0; v < plan.records.length; v++) valuesById[plan.records[v].values.id] = plan.records[v].values;
    for (var r = 0; r < plan.records.length; r++) {
        var record = plan.records[r];
        var item = null;
        for (var i = 0; i < plan.cases.length; i++) {
            var candidate = plan.cases[i];
            if ([candidate.contractId, candidate.shtlId, candidate.dossierId, candidate.packageId].indexOf(record.values.id) >= 0 ||
                    record.values.id.indexOf(candidate.joinPrefix) === 0) { item = candidate; break; }
        }
        if (!item) throw new Error("Bản ghi không thuộc case mock: " + record.values.id);
        var contract = valuesById[item.contractId];
        // Code hiển thị ngắn, tránh cắt ở các cột code hẹp hơn ID; khóa liên kết vẫn là ID đầy đủ.
        var testCode = "TEST_" + shtlTestHash(context.prefix) + "_" + item.contractId.slice(-4, -2);
        var full = {};
        var profile = { id: "", values: {} };
        var query;
        if (record.table === "esdXDCBrepairProjectCtr") {
            // Nếu đang dùng HĐ mock cũ còn thiếu metadata, chỉ mượn điều khoản chung từ HĐ thật Đang thực hiện cùng loại tiền/phạm vi.
            var common = shtlMockBusinessProfile(record.table, 'status="Đang thực hiện" and currency="' +
                shtlTestQuote(contract.currency) + '" and (null(deleted.flag) or deleted.flag=false) and (' + context.scope +
                ') and not (id like "S6DC_TEST_*")', cache).values;
            var commonFields = ["execution.type.code", "execution.type.name", "contract.type.code", "contract.type.name",
                "payment.estimate.type", "payment.estimate.name", "signer.code", "signer.name", "signer.position", "currency.name"];
            for (var cf = 0; cf < commonFields.length; cf++) {
                if (shtlTestText(common[commonFields[cf]])) full[commonFields[cf]] = common[commonFields[cf]];
            }
            query = 'id="' + shtlTestQuote(item.modelContractId) + '" and status="Đang thực hiện" and (' + context.scope + ')';
            profile = shtlMockBusinessProfile(record.table, query, cache);
            shtlMockBusinessMerge(full, profile.values);
            full["signed.date"] = full["signed.date"] || shtlMockBusinessDate(0);
            full["effective.date"] = full["effective.date"] || shtlMockBusinessDate(0);
            full["expire.date"] = full["expire.date"] || shtlMockBusinessDate(365);
            full["duration.days"] = full["duration.days"] || 365;
            // HĐ vẫn Đang thực hiện; không chép actual.end.date/completion.milestone hoặc tài liệu ECM của mẫu.
        } else if (record.table === "esdjoinXDCBtenderPackageContractor") {
            profile = shtlMockBusinessProfile(record.table, 'tax.code="' + shtlTestQuote(record.values["tax.code"]) +
                '" and not (id like "S6DC_TEST_*")', cache);
            shtlMockBusinessMerge(full, profile.values);
        } else if (record.table === "esdXDCBtenderPackage") {
            var projectField = shtlTestText(contract["repair.id"]) ? "repair.id" : "construction.id";
            profile = shtlMockBusinessProfile(record.table, projectField + '="' + shtlTestQuote(contract[projectField]) +
                '" and not (id like "S6DC_TEST_*")', cache);
            if (!profile.id) throw new Error("Chưa có gói thầu mẫu thật cùng công trình/dự án để bổ sung: " + item.packageId);
            shtlMockBusinessMerge(full, profile.values);
            // Các trường định danh có trên mẫu đều đổi sang mã test, tránh nhầm mã/tên gói thật khi unload.
            for (var packageName in full) {
                if (Object.prototype.hasOwnProperty.call(full, packageName) &&
                        (/^(name|code|content)$/.test(packageName) || /package[.](name|code)$/.test(packageName))) {
                    full[packageName] = /(^|[.])code$/.test(packageName) ? testCode : item.packageId;
                }
            }
        } else if (record.table === "esdHDdigitization") {
            profile = shtlMockBusinessProfile(record.table, 'type.document="' + shtlTestQuote(record.values["type.document"]) +
                '" and not (id like "S6DC_TEST_*")', cache);
            shtlMockBusinessMerge(full, profile.values);
            full.year = String(new Date().getFullYear());
            full["supervisor.id"] = context.actor;
        } else if (record.table === "esdXDCBctrPaymentAdvance") {
            profile = shtlMockBusinessProfile(record.table, 'contractor.tax.code="' + shtlTestQuote(record.values["contractor.tax.code"]) +
                '" and not (id like "S6DC_TEST_*")', cache);
            shtlMockBusinessMerge(full, profile.values);
            if (!profile.id) {
                // Chưa có hồ sơ cùng MST: chỉ mượn enum loại/trạng thái đã có thật, không mượn tên người nhận của NCC khác.
                var commonDossier = shtlMockBusinessProfile(record.table,
                    'not null(payment.type) and not (id like "S6DC_TEST_*")', cache).values;
                if (commonDossier["payment.type"]) full["payment.type"] = commonDossier["payment.type"];
                if (commonDossier.status) full.status = commonDossier.status;
            }
            // Bộ test dùng số minh họa cố định: đề nghị 10% giá trị HĐ, chưa trả tiền. Không gọi hàm tổng tiền thật.
            full["ctr.code"] = item.contractId;
            full["code"] = testCode;
            full["ctr.total.amount"] = Number(contract["contract.amount"]);
            full["amount"] = Number(contract["contract.amount"]) / 10;
            full["paid.amount"] = 0;
            full["remaining.amount"] = full["ctr.total.amount"] - full["amount"];
            // Không tự gắn payment.dossier.id/code của hồ sơ thật vào bản ghi mock; chưa tạo header hồ sơ mới.
        }
        // Không giả MST/tài khoản nếu nguồn không có. NCC rút gọn có thể lấy thông tin bổ sung cùng MST từ Contractor thật.
        if (record.table === "esdXDCBrepairProjectCtr" && shtlTestText(contract["tax.code"])) {
            var supplier = shtlMockBusinessProfile("esdjoinXDCBtenderPackageContractor", 'tax.code="' +
                shtlTestQuote(contract["tax.code"]) + '" and not (id like "S6DC_TEST_*")', cache).values;
            if (!full["bank.account"] && supplier["bank.number"]) full["bank.account"] = supplier["bank.number"];
            if (!full["bank.name"] && supplier["bank.name"]) full["bank.name"] = supplier["bank.name"];
            if (!full["representative.name"] && supplier["representative.name"]) full["representative.name"] = supplier["representative.name"];
        }
        // Lưu ngày/người tạo riêng của mock, không mạo nhận người tạo bản ghi mẫu.
        if (record.table !== "esdXDCBtenderPackage") {
            full["created.at"] = system.functions.tod();
            full["created.by"] = context.actor;
        }
        var missing = {};
        var old = existing[record.values.id];
        var additions = [];
        for (var field in full) {
            if (!Object.prototype.hasOwnProperty.call(full, field) || shtlTestText(full[field]) === "" ||
                    Object.prototype.hasOwnProperty.call(record.values, field)) continue;
            if (old) {
                if (shtlTestText(old[field]) === "") missing[field] = full[field];
            } else record.values[field] = full[field];
            additions.push(field);
        }
        // Các slot cũ chỉ đọc field liên kết: đọc lại đúng field bổ sung trước khi quyết định đang trống hay không.
        if (old && additions.length) {
            var fields = ["id", record.markerField].concat(additions);
            var current = shtlTestRead(record.table, 'id="' + shtlTestQuote(record.values.id) + '"', fields)[0];
            for (var m = 0; m < additions.length; m++) {
                if (shtlTestText(current[additions[m]]) !== "") delete missing[additions[m]];
            }
        }
        record.fillMissing = missing;
        var unavailable = [];
        var expectedColumns = shtlMockBusinessColumns(record.table);
        for (var ec = 0; ec < expectedColumns.length; ec++) {
            if (!shtlTestText(full[expectedColumns[ec]]) && !shtlTestText(record.values[expectedColumns[ec]])) {
                unavailable.push(expectedColumns[ec]);
            }
        }
        coverage.push({ table: record.table, id: record.values.id, templateId: profile.id,
            businessFields: additions, missingFields: Object.keys(missing), unavailableTemplateFields: unavailable });
    }
    plan.dataCoverage = coverage;
}

/** Bổ sung đúng field còn trống sau khi đọc lại ID/marker/base; field đã có hoặc vừa đổi thì giữ nguyên và dừng khi lệch base. */
function shtlMockContractFillMissing(record) {
    if (["esdXDCBrepairProjectCtr", "esdjoinXDCBtenderPackageContractor", "esdXDCBtenderPackage",
            "esdHDdigitization", "esdXDCBctrPaymentAdvance"].indexOf(record.table) < 0 ||
            shtlTestText(record.values.id).indexOf("S6DC_TEST_") !== 0) {
        throw new Error("Không được bổ sung ngoài bảng/ID mock.");
    }
    var file = new SCFile(record.table);
    try {
        if (file.doSelect('id="' + shtlTestQuote(record.values.id) + '"') !== RC_SUCCESS ||
                shtlTestText(file[record.markerField]) !== record.marker) throw new Error("Không còn đúng bản ghi mock: " + record.values.id);
        for (var key in record.values) {
            if (Object.prototype.hasOwnProperty.call(record.values, key) &&
                    shtlTestText(file[key]) !== shtlTestText(record.values[key])) throw new Error("Mock vừa đổi, chưa bổ sung: " + record.values.id);
        }
        var applied = {};
        var changed = false;
        for (var field in record.fillMissing) {
            if (Object.prototype.hasOwnProperty.call(record.fillMissing, field) && shtlTestText(file[field]) === "") {
                file[field] = shtlMockNativeWriteValue(file, field, record.fillMissing[field]);
                applied[field] = record.fillMissing[field];
                changed = true;
            }
        }
        if (!changed) return false;
        var rc = file.doUpdate();
        if (rc !== RC_SUCCESS) throw new Error("Bổ sung mock lỗi RC=" + rc + ": " + record.values.id);
        // Đọc lại ngay để nhận biết cả trường hợp SM trả RC=0 nhưng cắt chuỗi lúc Update.
        if (file.doSelect('id="' + shtlTestQuote(record.values.id) + '"') !== RC_SUCCESS) {
            var readError = new Error("Không đọc lại được mock đã bổ sung: " + record.values.id);
            readError.updatedId = record.values.id;
            throw readError;
        }
        for (var added in applied) {
            if (!Object.prototype.hasOwnProperty.call(applied, added)) continue;
            var matches = shtlMockNativeValueMatches(file[added], applied[added]);
            if (!matches) {
                var valueError = new Error("Field mock bị đổi/cắt sau Update: " + record.values.id + "/" + added);
                valueError.updatedId = record.values.id;
                throw valueError;
            }
        }
        return true;
    } finally { shtlTestClose(file); }
}

// ============================================================================
// PHẦN D - THÊM NCC THỨ HAI CHO MỘT HĐ MOCK TH1 CHƯA PHÁT SINH NGHIỆP VỤ.
// Giữ tổng HĐ; chia total.amount.due cho hai NCC. Không giả lập tiền đã TT/TƯ.
// Dùng quyền/phiếu hiện tại, xác thực marker của bộ mock cũ kể cả phiếu tạo bộ mock đã bị xóa.
// ============================================================================

/** Xem trước thêm Mạnh Hưng vào mock _05_C; không ghi DB hoặc gọi OGL. */
function previewSecondSupplier(options) {
    return shtlSecondSupplierRun("preview", options || {});
}

/** Thêm đúng một NCC; chạy lại chỉ đọc kết quả đã có, không ghi đè các số tiền người dùng đang test. */
function addSecondSupplier(options) {
    return shtlSecondSupplierRun("add", options || {});
}

/** Kiểm tra owner/TH1/quyền/nguồn và chỉ phân bổ tiền khi mock chưa có món hoặc tiến độ. */
function shtlSecondSupplierRun(action, options) {
    var inserted = null;
    var slots = null;
    var first = null;
    var firstSlot = null;
    var originalDue = null;
    var firstDue = null;
    try {
        var current = shtlTestContext(options);
        var contractId = shtlTestText(options.contractId) || "S6DC_TEST_aff72456_M8_05_C";
        var contractRows = shtlTestRead("esdXDCBrepairProjectCtr", 'id="' + shtlTestQuote(contractId) + '"',
            ["id", "contract.name"]);
        if (contractRows.length !== 1) throw new Error("Không đọc được HĐ mock đã chọn.");
        var owner = shtlTestText(contractRows[0]["contract.name"]).split("|");
        if (owner.length !== 3 || owner[1] !== current.actor.toLowerCase() || owner[2].indexOf("DC.") !== 0) {
            throw new Error("HĐ không thuộc bộ mock của người dùng hiện tại; không ghi dữ liệu.");
        }
        var marker = "S6DC_SHTL_TEST|" + owner[1] + "|" + owner[2];
        var seed = { actor: current.actor, paymentId: owner[2], marker: marker + "|CONTRACT_MATRIX8",
            prefix: "S6DC_TEST_" + shtlTestHash(marker) + "_M8" };
        var cases = shtlMockContractCases(seed);
        var item = null;
        for (var c = 0; c < cases.length; c++) if (cases[c].contractId === contractId) item = cases[c];
        if (!item || item.sourceCase !== "TH1" || !item.packageId) {
            throw new Error("Chỉ thêm NCC cho HĐ mock TH1 có gói thầu; TH2 còn bị giới hạn MST theo hồ sơ.");
        }
        slots = shtlMockContractSlots(seed, [item]);
        var existing = shtlMockContractsExisting(slots);
        first = existing[item.joinPrefix + "1"];
        var secondId = item.joinPrefix + "2";
        if (!first || !existing[item.shtlId] || !existing[item.packageId]) throw new Error("Thiếu nguồn HĐ/gói thầu/NCC/SHTL mock.");
        var selection = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseXdcbSelection(contractId, current.actor, current.paymentId);
        var refs = selection.digitizationReferences || [];
        var hasTH1 = false;
        for (var r = 0; r < refs.length; r++) if (refs[r].id === item.shtlId && refs[r].sourceCase === "TH1") hasTH1 = true;
        if (!hasTH1) throw new Error("SHTL TH1 của mock không còn hợp lệ.");
        var secondTax = "0311368188";
        if (shtlTestText(first["tax.code"]) === secondTax) throw new Error("NCC thêm trùng MST với NCC hiện có.");
        if (existing[secondId]) {
            if (shtlTestText(existing[secondId]["tax.code"]) !== secondTax ||
                    shtlTestText(existing[secondId]["tender.package.id"]) !== item.packageId) {
                throw new Error("Slot NCC2 đã được dùng cho dữ liệu khác; không ghi đè.");
            }
            return { success: true, action: action, reused: true, contractId: contractId, packageId: item.packageId,
                suppliers: lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseXdcbSuppliers(selection) };
        }
        // Không thay số dư của một mock đã có món/tiến độ hoặc đã được người dùng nhập tiền thanh toán thử.
        try { shtlMockContractsAssertUnused(slots); }
        catch (usedError) { throw new Error("Không phân bổ lại tiền mock đã được sử dụng: " + String(usedError.message || usedError)); }
        var money = lib.ESD_HTKT_EXPENSE_CONTRACT.expenseXdcbMoney;
        var contract = existing[contractId];
        var total = money(contract["contract.amount"]);
        var secondDue = options.secondDue == null ? 1000000 : Number(options.secondDue);
        originalDue = money(first["total.amount.due"]);
        firstDue = total - secondDue;
        if (money(contract["total.amount.paid"]) !== 0 || money(first["total.amount.paid"]) !== 0 ||
                originalDue !== total || !isFinite(secondDue) || secondDue <= 0 || firstDue <= 0) {
            throw new Error("Tiền mock đã khác trạng thái ban đầu hoặc phần chia không hợp lệ; giữ nguyên để tránh mất số đang test.");
        }
        var templateId = "0311368188THAU-299";
        var profileFields = ["id", "tax.code", "name", "address", "phone.number", "representative.name",
            "bank.number", "bank.name", "contractor.group", "contractor.id"];
        var templates = shtlTestRead("esdjoinXDCBtenderPackageContractor", 'id="' + templateId + '"', profileFields);
        if (templates.length !== 1 || shtlTestText(templates[0]["tax.code"]) !== secondTax ||
                !shtlTestText(templates[0].name) || !shtlTestText(templates[0].address)) {
            throw new Error("NCC mẫu Mạnh Hưng không còn hợp lệ; không tự bịa thông tin NCC.");
        }
        var secondSlot = null;
        for (var s = 0; s < slots.length; s++) {
            if (slots[s].id === secondId) secondSlot = slots[s];
            if (slots[s].id === first.id) firstSlot = slots[s];
        }
        var values = { id: secondId, "tender.package.id": item.packageId,
            "total.amount.due": secondDue, "total.amount.paid": 0,
            "contractor.group.name": secondSlot.marker, "created.by": current.actor,
            "created.at": shtlMockBusinessDate(0) };
        for (var f = 1; f < profileFields.length; f++) {
            var field = profileFields[f];
            values[field] = shtlTestText(templates[0][field]);
        }
        var record = { table: "esdjoinXDCBtenderPackageContractor", markerField: secondSlot.markerField,
            marker: secondSlot.marker, values: values };
        shtlMockPrepareWriteTypes({ records: [record] }, false);
        if (action === "preview") return { success: true, action: action, contractId: contractId,
            packageId: item.packageId, contractAmount: total,
            existingSupplier: { id: first.id, tax: first["tax.code"], dueBefore: originalDue, dueAfter: firstDue, paid: 0 },
            newSupplier: values };
        shtlMockContractInsert(record, current);
        inserted = record;
        shtlMockContractReadBack(record);
        shtlSecondSupplierSetDue(first, firstSlot, originalDue, firstDue);
        var suppliers = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseXdcbSuppliers(selection);
        if (suppliers.length !== 2) throw new Error("Reader S4 chưa trả đúng hai NCC.");
        var sum = 0;
        for (var v = 0; v < suppliers.length; v++) {
            if (Number(suppliers[v]["total.amount.paid"]) !== 0) throw new Error("Tiền đã TT/TƯ của NCC vừa thay đổi, dừng thêm mock.");
            sum += Number(suppliers[v]["total.amount.due"]);
        }
        if (sum !== total) throw new Error("Tổng tiền NCC sau ghi không bằng tổng HĐ.");
        return { success: true, action: action, createdId: secondId, contractId: contractId,
            packageId: item.packageId, contractAmount: total, suppliers: suppliers };
    } catch (error) {
        var rollbackError = "";
        if (inserted) {
            try {
                shtlMockContractsAssertUnused(slots);
                // Nếu Update đã ghi rồi mới phát sinh lỗi, phục hồi đúng giá trị trước lần gọi này.
                var now = shtlTestRead("esdjoinXDCBtenderPackageContractor", 'id="' + shtlTestQuote(first.id) + '"',
                    ["id", "total.amount.due"]);
                if (now.length !== 1) throw new Error("Không đọc được NCC1 khi rollback.");
                if (Number(now[0]["total.amount.due"]) === firstDue) shtlSecondSupplierSetDue(first, firstSlot, firstDue, originalDue);
                else if (Number(now[0]["total.amount.due"]) !== originalDue) throw new Error("NCC1 vừa đổi số tiền, dừng rollback.");
                shtlMockContractDelete(inserted);
                inserted = null;
            } catch (cleanupError) { rollbackError = String(cleanupError.message || cleanupError); }
        }
        return { success: false, action: action, message: String(error.message || error), rollbackMessage: rollbackError,
            remainingCreatedId: inserted ? inserted.values.id : "" };
    }
}

/** Chỉ đổi total.amount.due của đúng NCC1 mock, kiểm tra snapshot/đã TT=0 trước Update và đọc lại sau ghi. */
function shtlSecondSupplierSetDue(row, slot, expectedDue, due) {
    var file = new SCFile("esdjoinXDCBtenderPackageContractor");
    try {
        if (file.doSelect('id="' + shtlTestQuote(row.id) + '"') !== RC_SUCCESS ||
                shtlTestText(file[slot.markerField]) !== slot.marker ||
                shtlTestText(file["tender.package.id"]) !== shtlTestText(row["tender.package.id"]) ||
                shtlTestText(file["tax.code"]) !== shtlTestText(row["tax.code"]) ||
                Number(file["total.amount.due"]) !== expectedDue || shtlTestText(file["total.amount.paid"]) === "" ||
                Number(file["total.amount.paid"]) !== 0) {
            throw new Error("NCC1 mock đã thay đổi, không Update số tiền.");
        }
        file["total.amount.due"] = due;
        var rc = file.doUpdate();
        if (rc !== RC_SUCCESS) throw new Error("Không cập nhật được phần tiền NCC1, RC=" + rc);
    } finally { shtlTestClose(file); }
    var rows = shtlTestRead("esdjoinXDCBtenderPackageContractor", 'id="' + shtlTestQuote(row.id) + '"',
        ["id", "total.amount.due"]);
    if (rows.length !== 1 || Number(rows[0]["total.amount.due"]) !== due) throw new Error("Đọc lại tiền NCC1 không khớp.");
}
