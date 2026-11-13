/**
 * ScriptLibrary: ESD_HTKT_EXPENSE_CONTRACT
 * Dự chi: phiếu cha -> quyền/phạm vi -> SHTL -> HĐ thật -> resolver NCC S4.
 * TH1: SHTL.id.contract = HĐ.id. TH2: SHTL.id.contract = hồ sơ.id -> hồ sơ.ctr.id = HĐ.id.
 * Dự chi và Thanh toán có entrypoint/quyền riêng, dùng chung reader SHTL; HHDV/S2 và Tạm ứng giữ đường cũ.
 */

/** Nguồn HĐ được xác định từ phiếu đã lưu, không lấy từ lựa chọn phía client. */
function listExpenseContracts(input) {
    var payment = null;
    try { 
        var params = expenseContractParams(input);
        var paymentId = expenseContractText(params.paymentId);
        var actor = expenseContractText(params.currentUser);
        if (paymentId.indexOf("DC.") !== 0 || !actor) {
            throw expenseContractError("INVALID_EXPENSE", "Thiếu phiếu Dự chi hoặc người thực hiện hợp lệ.");
        }
        payment = new SCFile("esdHTKTpayment", SCFILE_READONLY);
        payment.setFields(["id", "transaction.type", "original.contract.category", "current.phase",
            "initial.role", "created.by", "user.checker.kttc"]);
        if (payment.doSelect('id="' + expenseContractQuote(paymentId) + '"') !== RC_SUCCESS ||
                expenseContractText(payment["transaction.type"]) !== "Dự chi") {
            throw expenseContractError("INVALID_EXPENSE", "Không tìm thấy phiếu Dự chi hợp lệ.");
        }
        var phase = expenseContractText(payment["current.phase"]);
        var role = expenseContractText(payment["initial.role"]);
        var creator = expenseContractText(payment["created.by"]).toLowerCase();
        var checker = expenseContractText(payment["user.checker.kttc"]).toLowerCase();
        var canSelect = (phase === "initial_dmms" && role === "dmms" && actor.toLowerCase() === creator) ||
                (phase === "initial_kttc" && (actor.toLowerCase() === checker || (role === "kttc" && actor.toLowerCase() === creator)));
        if (!canSelect) throw expenseContractError("EXPENSE_NOT_EDITABLE", "Không có quyền chọn HĐ tại bước hiện tại của phiếu Dự chi.");
        var category = expenseContractText(payment["original.contract.category"]).toUpperCase() || "HHDV";
        var result;
        if (category === "HHDV") {
            var hhdvParams = lib.ESD_HTKT_EXPENSE_VENDOR.expenseImportGetContractParams(payment, actor);
            var filters = ["start", "count", "category", "keyword", "createdAtFrom", "createdAtTo", "sortField", "sortOrder"];
            for (var i = 0; i < filters.length; i++) {
                if (params[filters[i]] != null) hhdvParams[filters[i]] = params[filters[i]];
            }
            result = lib.ESD_HTKT_PAYMENT_CREATE_REQUEST.listPurchaseContracts({ queryString: JSON.stringify(hhdvParams) });
        } else if (category === "XDCB") {
            var filterCategory = expenseContractText(params.category);
            if (filterCategory && filterCategory !== "HD_GT") {
                throw expenseContractError("XDCB_CATEGORY_UNSUPPORTED", "Nguồn XDCB hiện chỉ hỗ trợ Hợp đồng.");
            }
            var sortMap = { id: "id", name: "name", "created.at": "effectiveDate",
                totalValue: "contractAmount", status: "status", "executor.id": "responsibleOfficer" };
            var requestedSort = expenseContractText(params.sortField);
            if (requestedSort && !Object.prototype.hasOwnProperty.call(sortMap, requestedSort)) {
                throw expenseContractError("INVALID_SORT_FIELD", "Cột sắp xếp HĐ XDCB không hợp lệ.");
            }
            result = listExpenseXdcbContracts({ details: {
                currentUser: actor, paymentId: paymentId, start: params.start, count: params.count, keyword: params.keyword,
                effectiveDateFrom: expenseContractText(params.createdAtFrom).substring(0, 10),
                effectiveDateTo: expenseContractText(params.createdAtTo).substring(0, 10),
                sortField: requestedSort ? sortMap[requestedSort] : "id",
                sortOrder: Number(params.sortOrder) === -1 ? "desc" : "asc"
            } });
            if (result.success) {
                for (var j = 0; j < result.data.length; j++) {
                    var row = result.data[j];
                    row.category = "HD_GT";
                    row.totalValue = row.contractAmount;
                    row["created.at"] = row.effectiveDate;
                    row["start.date"] = row.effectiveDate;
                    row["expected.end.date"] = row.expireDate;
                    row["contract.no"] = row.id;
                    row["executor.id"] = row.responsibleOfficer;
                }
            }
        } else {
            throw expenseContractError("INVALID_EXPENSE_CATEGORY", "Hạng mục của phiếu Dự chi không hợp lệ.");
        }
        if (!result) throw expenseContractError("CONTRACT_QUERY_FAILED", "Không nhận được kết quả danh sách HĐ.");
        result.contractCategory = category;
        return result;
    } catch (error) {
        return { success: false, data: [], totalCount: 0, errorCode: error.expenseContractCode || "EXPENSE_CONTRACT_READ_FAILED",
            message: String(error.message || error) };
    } finally {
        expenseContractClose(payment);
    }
}

/** Dự chi XDCB: lấy nguồn từ SHTL rồi phân giải HĐ S4, giữ quyền/phạm vi Dự chi hiện có. */
function listExpenseXdcbContracts(input) {
    try {
        var params = expenseContractParams(input);
        return expenseContractReadDigitizations(params, expenseContractScope(params.currentUser, params.paymentId));
    } catch (error) {
        return { 
            success: false, 
            data: [], 
            totalCount: 0, 
            returnedCount: 0, 
            hasMore: false,
            errorCode: error.expenseContractCode || "EXPENSE_CONTRACT_READ_FAILED", 
            message: String(error.message || error) 
        };
    }
}

/**
 * Dự chi XDCB đi từ SHTL, dùng query native giống các reader S2 đang chạy trên SM.
 * Không truyền SELECT/subselect vào doSelectEx: mẫu đó bị môi trường hiện tại từ chối (GET probe RC 71).
 * Chỉ đọc khóa/cột sort của HĐ theo lô, gộp/sắp xếp rồi đọc đủ thông tin của trang cần trả.
 */
function expenseContractReadDigitizations(params, scopeQuery) {
    var plan = expenseDigitizationContractPlan(params, scopeQuery);
    var source = expenseDigitizationReadSourceLinks(params);
    var keys = [];
    var seen = {};
    var keyFields = plan.sortField === "id" ? ["id"] : ["id", plan.sortField];

    // Nguồn rỗng là kết quả hợp lệ, không mở cursor HĐ rồi biến trường hợp này thành lỗi đọc trang.
    for (var batch = 0; batch < source.contractIds.length; batch += 100) {
        var keyQuery =
            "(" +
            plan.query +
            ") and " +
            expenseDigitizationIdQuery(source.contractIds.slice(batch, batch + 100));
        // Chuẩn hóa giá trị ngay khi cursor còn mở, cùng kiểu dữ liệu với DTO HĐ cũ.
        var batchKeys = expenseDigitizationReadRows(
            "esdXDCBrepairProjectCtr",
            keyQuery,
            keyFields,
            "contract-keys",
            function (file) {
                var value = file[plan.sortField];
                return {
                    id: expenseContractText(file.id),
                    value:
                        plan.sortField === "contract.amount"
                            ? Number(value || 0)
                            : plan.sortField === "effective.date"
                              ? expenseContractDate(value)
                              : expenseContractText(value)
                };
            }
        );
        for (var k = 0; k < batchKeys.length; k++) {
            var key = "$" + batchKeys[k].id;
            if (batchKeys[k].id && !seen[key]) {
                keys.push(batchKeys[k]);
                seen[key] = true;
            }
        }
    }

    // Một HĐ có nhiều SHTL/hồ sơ chỉ tính một dòng. Phải lọc quyền và loại trùng trước khi cắt trang.
    keys.sort(function (a, b) {
        var comparison = a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
        if (comparison) return plan.direction === "desc" ? -comparison : comparison;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    var pageKeys = keys.slice(plan.start - 1, plan.start - 1 + plan.count);
    var pageIds = [];
    for (var p = 0; p < pageKeys.length; p++) pageIds.push(pageKeys[p].id);
    var rows = [];

    if (pageIds.length) {
        var pageQuery = "(" + plan.query + ") and " + expenseDigitizationIdQuery(pageIds);
        var pageRows = expenseDigitizationReadRows(
            "esdXDCBrepairProjectCtr",
            pageQuery,
            plan.fields,
            "contract-page",
            function (file) {
                var row = expenseContractRow(file);
                var money = expenseXdcbContractAmounts(file);
                row.totalPaidAmount = money.totalPaidAmount;
                row.remainingAmount = money.remainingAmount;
                return row;
            }
        );
        var byId = {};
        for (var r = 0; r < pageRows.length; r++) byId["$" + pageRows[r].id] = pageRows[r];
        for (var i = 0; i < pageIds.length; i++) {
            var row = byId["$" + pageIds[i]];
            if (!row) {
                throw expenseContractError(
                    "SHTL_SOURCE_CHANGED",
                    "HĐ XDCB đã thay đổi trong khi tải trang. Vui lòng tải lại danh sách."
                );
            }
            rows.push(row);
        }
        expenseDigitizationAttachReferences(rows, source);
    }

    return {
        success: true,
        data: rows,
        totalCount: keys.length,
        start: plan.start,
        count: plan.count,
        returnedCount: rows.length,
        hasMore: plan.start - 1 + rows.length < keys.length
    };
}

/** Đọc SHTL TH1/TH2 bằng native query, phân giải hồ sơ và giữ các tham chiếu theo HĐ thật. */
function expenseDigitizationReadSourceLinks(params) {
    var query =
        "(" +
        expenseDigitizationSourceQuery("XDCB_CTSC_XMCT_TTQ", params.digitizationId) +
        ") or (" +
        expenseDigitizationSourceQuery("XDCB_XMCT_VTQ", params.digitizationId) +
        ")";
    var sources = expenseDigitizationReadRows(
        "esdHDdigitization",
        query,
        ["id", "type.document", "id.contract"],
        "shtl-sources"
    );
    var dossierIds = [];
    var dossierSeen = {};
    var dossiers = {};
    for (var i = 0; i < sources.length; i++) {
        var reference = expenseContractText(sources[i]["id.contract"]);
        if (sources[i]["type.document"] === "XDCB_XMCT_VTQ" && !dossierSeen["$" + reference]) {
            dossierIds.push(reference);
            dossierSeen["$" + reference] = true;
        }
    }
    // TH1 không phải đọc bảng hồ sơ. TH2 chỉ đọc các ID do SHTL thực sự dẫn tới, tối đa 100 ID mỗi lô.
    for (var d = 0; d < dossierIds.length; d += 100) {
        var dossierRows = expenseDigitizationReadRows(
            "esdXDCBctrPaymentAdvance",
            expenseDigitizationIdQuery(dossierIds.slice(d, d + 100)),
            ["id", "ctr.id", "contractor.tax.code"],
            "shtl-dossiers"
        );
        for (var h = 0; h < dossierRows.length; h++) {
            var dossierKey = "$" + expenseContractText(dossierRows[h].id);
            if (dossiers[dossierKey]) {
                throw expenseContractError("AMBIGUOUS_DOSSIER", "Trùng ID hồ sơ-HĐ S4.");
            }
            dossiers[dossierKey] = dossierRows[h];
        }
    }

    var contractIds = [];
    var references = {};
    for (var s = 0; s < sources.length; s++) {
        var item = sources[s];
        var ref = expenseContractText(item["id.contract"]);
        var dossier = item["type.document"] === "XDCB_XMCT_VTQ" ? dossiers["$" + ref] : null;
        var contractId =
            item["type.document"] === "XDCB_CTSC_XMCT_TTQ"
                ? ref
                : expenseContractText(dossier && dossier["ctr.id"]);
        // Không dùng ID hồ sơ thay HĐ.id, không fallback sang toàn bộ HĐ khi liên kết đứt.
        if (!contractId || !expenseContractText(item.id)) continue;
        if (params.contractId && contractId !== expenseContractText(params.contractId)) continue;
        if (params.contractCode && contractId !== expenseContractText(params.contractCode))
            continue;
        var contractKey = "$" + contractId;
        if (!references[contractKey]) {
            references[contractKey] = [];
            contractIds.push(contractId);
        }
        references[contractKey].push({
            id: expenseContractText(item.id),
            type: expenseContractText(item["type.document"]),
            referenceId: ref,
            sourceCase: dossier ? "TH2" : "TH1",
            taxCode: expenseContractText(dossier && dossier["contractor.tax.code"])
        });
    }
    return {
        contractIds: contractIds,
        references: references
    };
}

/** Bộ lọc SHTL native; giữ nguyên loại/khóa, chưa tự thêm trạng thái SHTL khi chưa có quy tắc. */
function expenseDigitizationSourceQuery(type, sourceId) {
    if (type !== "XDCB_CTSC_XMCT_TTQ" && type !== "XDCB_XMCT_VTQ") {
        throw expenseContractError("INVALID_SHTL_TYPE", "Loại SHTL XDCB không hợp lệ.");
    }
    var query =
        'type.document="' +
        type +
        '" and not null(id) and id~="" and not null(id.contract) and id.contract~=""';
    if (expenseContractText(sourceId)) query += ' and id="' + expenseContractQuote(sourceId) + '"';
    return query;
}

/** Gắn metadata đã đọc trên server vào trang HĐ; chỉ dùng để kiểm tra NCC, không thay contract.id của món. */
function expenseDigitizationAttachReferences(rows, source) {
    for (var i = 0; i < rows.length; i++) {
        var refs = source.references["$" + rows[i].id];
        if (!refs || !refs.length) {
            throw expenseContractError(
                "SHTL_SOURCE_CHANGED",
                "Không xác định được nguồn SHTL của HĐ XDCB."
            );
        }
        rows[i].digitizationReferences = refs;
    }
}

/** Đọc cursor native readonly; rỗng là hợp lệ, lỗi phải giữ bước/table/RC để chẩn đoán trên SM. */
function expenseDigitizationReadRows(table, query, fields, stage, mapper) {
    var file = new SCFile(table, SCFILE_READONLY);
    var rows = [];
    var step = "doSelect";
    try {
        file.setFields(fields);
        var rc = file.doSelect(query);
        while (rc === RC_SUCCESS) {
            if (mapper) {
                rows.push(mapper(file));
            } else {
                var row = {};
                for (var i = 0; i < fields.length; i++) row[fields[i]] = file[fields[i]];
                rows.push(row);
            }
            step = "getNext";
            rc = file.getNext();
        }
        if (rc !== RC_NO_MORE) {
            throw expenseDigitizationQueryError(stage || "source-read", table, step, rc, query);
        }
        return rows;
    } finally {
        expenseContractClose(file);
    }
}

/** Đưa RC gốc vào thông báo; query chỉ ghi Messages để kiểm tra, không gửi credentials/URL ra client. */
function expenseDigitizationQueryError(stage, table, step, rc, query) {
    var rcText = "";
    try {
        if (typeof RCtoString === "function") rcText = String(RCtoString(rc));
    } catch (translateError) {
        /* Giữ nguyên RC ngay cả khi SM không dịch được mã lỗi. */
    }
    try {
        print(
            "[DC-XDCB-SHTL][QUERY-ERROR] " +
                JSON.stringify({
                    stage: stage,
                    table: table,
                    step: step,
                    rc: String(rc),
                    rcText: rcText,
                    query: query
                })
        );
    } catch (logError) {
        /* Log không được che lỗi query gốc. */
    }
    var code =
        table === "esdXDCBrepairProjectCtr" ? "CONTRACT_QUERY_FAILED" : "SHTL_SOURCE_READ_FAILED";
    return expenseContractError(
        code,
        "Không đọc được dữ liệu XDCB (" +
            stage +
            "/" +
            step +
            ", " +
            table +
            ", RC=" +
            rc +
            (rcText ? ": " + rcText : "") +
            ")."
    );
}

/** Giữ nguyên bộ lọc/quyền/sort của HĐ; reader gắn thêm các ID hợp lệ do SHTL dẫn tới. */
function expenseDigitizationContractPlan(params, scopeQuery) {
    var start = expenseContractPageNumber(params.start, 1);
    var count = Math.min(expenseContractPageNumber(params.count, 10), 100);
    var sort = expenseContractText(params.sortField) || "id";
    var sortFields = {
        id: "id",
        contractCode: "id",
        name: "contract.name",
        contractAmount: "contract.amount",
        effectiveDate: "effective.date",
        status: "status",
        responsibleOfficer: "responsible.officer",
        currency: "currency"
    };
    var direction = expenseContractText(params.sortOrder) || "asc";
    if (!Object.prototype.hasOwnProperty.call(sortFields, sort))
        throw expenseContractError("INVALID_SORT_FIELD", "Cột sắp xếp HĐ XDCB không hợp lệ.");
    if (direction !== "asc" && direction !== "desc")
        throw expenseContractError("INVALID_SORT_ORDER", "Chiều sắp xếp HĐ XDCB không hợp lệ.");
    var projectType = expenseContractText(params.projectType);
    if (projectType && projectType !== "REPAIR" && projectType !== "CONSTRUCTION")
        throw expenseContractError(
            "INVALID_PROJECT_TYPE",
            "Loại công trình/dự án XDCB không hợp lệ."
        );
    var from = expenseContractDateFilter(params.effectiveDateFrom);
    var to = expenseContractDateFilter(params.effectiveDateTo);
    if (from && to && from > to)
        throw expenseContractError("INVALID_DATE_RANGE", "Khoảng ngày hiệu lực không hợp lệ.");

    var repair =
        '((not null(repair.id) and repair.id~="") and (null(construction.id) or construction.id=""))';
    var construction =
        '((not null(construction.id) and construction.id~="") and (null(repair.id) or repair.id=""))';
    // DC/TT XDCB chỉ chọn HĐ Đang thực hiện; SHTL không làm thay đổi điều kiện trạng thái này.
    var conditions = [
        "(null(deleted.flag) or deleted.flag=false)",
        'status="Đang thực hiện"',
        scopeQuery,
        projectType === "REPAIR"
            ? repair
            : projectType === "CONSTRUCTION"
              ? construction
              : "(" + repair + " or " + construction + ")"
    ];
    var contractId = expenseContractText(params.contractId),
        contractCode = expenseContractText(params.contractCode);
    if (contractId) conditions.push('id="' + expenseContractQuote(contractId) + '"');
    // contractCode chỉ là tên tham số cũ; luôn đối chiếu HĐ.id, không dùng contract.code của S4.
    if (contractCode) conditions.push('id="' + expenseContractQuote(contractCode) + '"');
    var keyword = expenseContractText(params.keyword);
    if (keyword) {
        var escaped = expenseContractQuote(keyword.toLowerCase());
        conditions.push(
            '(tolower(id) like "*' +
                escaped +
                '*" or tolower(contract.name) like "*' +
                escaped +
                '*")'
        );
    }
    if (from) conditions.push('effective.date >= "' + from + ' 00:00:00"');
    if (to) conditions.push('effective.date < "' + expenseContractNextDate(to) + ' 00:00:00"');
    var fields = [
        "id",
        "contract.name",
        "contract.amount",
        "total.amount.paid",
        "currency",
        "signed.date",
        "effective.date",
        "expire.date",
        "status",
        "responsible.officer",
        "repair.id",
        "construction.id",
        "type.budget",
        "vendor.name",
        "tax.code",
        "vendor.address",
        "tender.package.id"
    ];

    return {
        start: start,
        count: count,
        sortField: sortFields[sort],
        direction: direction,
        fields: fields,
        query: conditions.join(" and ")
    };
}

/** Ghép danh sách khóa nội bộ đã escape; field thuộc whitelist, danh sách rỗng phải trả điều kiện không khớp. */
function expenseDigitizationIdQuery(ids, field) {
    field = field || "id";
    if (field !== "id" && field !== "id.contract" && field !== "ctr.id")
        throw expenseContractError("INVALID_LINK_FIELD", "Khóa liên kết SHTL không hợp lệ.");
    if (!ids.length) return "1=0";
    var conditions = [];
    for (var i = 0; i < ids.length; i++)
        conditions.push(field + '="' + expenseContractQuote(ids[i]) + '"');
    return "(" + conditions.join(" or ") + ")";
}

/** Thanh toán: chỉ đọc HĐ S4 bằng quyền tạo Thanh toán, không tạo phiếu/NCC hay dùng quyền Dự chi. */
function listPaymentXdcbContracts(input) {
    try {
        var params = expenseContractParams(input);
        var scopeQuery = expenseContractScope(params.currentUser, null, "PAYMENT");
        var category = expenseContractText(params.category);
        if (category && category !== "HD_GT") {
            throw expenseContractError("XDCB_CATEGORY_UNSUPPORTED", "Nguồn XDCB hiện chỉ hỗ trợ Hợp đồng.");
        }
        var sortMap = { 
            id: "id", 
            category: "id", 
            name: "name", 
            currency: "currency", 
            "created.at": "effectiveDate",
            totalValue: "contractAmount", 
            status: "status", 
            "executor.id": "responsibleOfficer" 
        };
        var sort = expenseContractText(params.sortField);
        if (sort && !Object.prototype.hasOwnProperty.call(sortMap, sort)) {
            throw expenseContractError("INVALID_SORT_FIELD", "Cột sắp xếp HĐ XDCB không hợp lệ.");
        }
        var result = expenseContractReadDigitizations({
            contractId: params.contractId,
            start: params.start, 
            count: params.count, 
            keyword: params.keyword,
            effectiveDateFrom: expenseContractText(params.createdAtFrom).substring(0, 10),
            effectiveDateTo: expenseContractText(params.createdAtTo).substring(0, 10),
            sortField: sort ? sortMap[sort] : "id", 
            sortOrder: Number(params.sortOrder) === -1 ? "desc" : "asc"
        }, scopeQuery);
        if (result.success) {
            for (var i = 0; i < result.data.length; i++) {
                var row = result.data[i];
                // Popup cũ nhận cùng cấu trúc S2, nhưng mã và khóa HĐ S4 luôn là field id.
                row.category = "HD_GT";
                row.totalValue = row.contractAmount;
                row["created.at"] = row.effectiveDate;
                row["start.date"] = row.effectiveDate;
                row["expected.end.date"] = row.expireDate;
                row["contract.no"] = row.id;
                row["executor.id"] = row.responsibleOfficer;
            }
        }
        result.contractCategory = "XDCB";
        return result;
    } catch (error) {
        return { 
            success: false, 
            data: [], 
            totalCount: 0, 
            returnedCount: 0, 
            hasMore: false,
            errorCode: error.expenseContractCode || "PAYMENT_CONTRACT_READ_FAILED", 
            message: String(error.message || error) 
        };
    }
}

/** TT trước tạo phiếu: đọc lại HĐ qua SHTL và quyền TT; trả HĐ thật, không chọn/lưu HS-HĐ. */
function getPaymentXdcbContract(input) {
    var params = expenseContractParams(input);
    var id = expenseContractText(params.contractId);
    if (!id) {
        return { 
            success: false, 
            data: null, 
            message: "Thiếu ID HĐ XDCB." 
        };
    } 
    params.contractId = id;
    params.start = 1;
    params.count = 1;

    var result = listPaymentXdcbContracts({ details: params });
    if (!result.success || !result.data || result.data.length !== 1 || result.data[0].id !== id) {
        return {
            success: false,
            data: null,
            message: result.message || "HĐ XDCB không còn đủ điều kiện trong phạm vi được chọn."
        };
    }
    return { 
        success: true, 
        data: result.data[0] 
    };
}

/** Đếm/lọc/phân trang S4 dùng chung; scopeQuery đã được entrypoint kiểm tra theo đúng loại phiếu. */
function expenseContractReadXdcb(params, scopeQuery) {
    var countFile = null;
    var contractFile = null;
    try {
        var start = expenseContractPageNumber(params.start, 1);
        var count = Math.min(expenseContractPageNumber(params.count, 10), 100);
        var projectType = expenseContractText(params.projectType);
        if (projectType && projectType !== "REPAIR" && projectType !== "CONSTRUCTION") {
            throw expenseContractError("INVALID_PROJECT_TYPE", "Loại công trình/dự án XDCB không hợp lệ.");
        }

        var repairPresent = '(not null(repair.id) and repair.id~="")';
        var repairEmpty = '(null(repair.id) or repair.id="")';
        var constructionPresent = '(not null(construction.id) and construction.id~="")';
        var constructionEmpty = '(null(construction.id) or construction.id="")';
        var repairQuery = '(' + repairPresent + ' and ' + constructionEmpty + ')';
        var constructionQuery = '(' + constructionPresent + ' and ' + repairEmpty + ')';
        var conditions = [
            '(null(deleted.flag) or deleted.flag=false)',
            // Chỉ cho chọn HĐ đang thực hiện; dùng chung cho picker, thêm món và import.
            'status="Đang thực hiện"',
            scopeQuery,
            projectType === "REPAIR" ? repairQuery :
                    (projectType === "CONSTRUCTION" ? constructionQuery :
                            '(' + repairQuery + ' or ' + constructionQuery + ')')
        ];
        var keyword = expenseContractText(params.keyword);
        var contractId = expenseContractText(params.contractId);
        // contractCode là tên tham số API cũ; mã HĐ XDCB được đối chiếu bằng ID nguồn.
        var contractCode = expenseContractText(params.contractCode);
        if (contractId) conditions.push('id="' + expenseContractQuote(contractId) + '"');
        if (contractCode) conditions.push('id="' + expenseContractQuote(contractCode) + '"');
        if (keyword) {
            var escapedKeyword = expenseContractQuote(keyword.toLowerCase());
            conditions.push('(tolower(id) like "*' + escapedKeyword +
                    '*" or tolower(contract.name) like "*' + escapedKeyword + '*")');
        }
        var dateFrom = expenseContractDateFilter(params.effectiveDateFrom);
        var dateTo = expenseContractDateFilter(params.effectiveDateTo);
        if (dateFrom && dateTo && dateFrom > dateTo) {
            throw expenseContractError("INVALID_DATE_RANGE", "Khoảng ngày hiệu lực không hợp lệ.");
        }
        if (dateFrom) conditions.push('effective.date >= "' + dateFrom + ' 00:00:00"');
        if (dateTo) conditions.push('effective.date < "' + expenseContractNextDate(dateTo) + ' 00:00:00"');

        var sortFields = {
            id: "id", 
            contractCode: "id", 
            name: "contract.name",
            contractAmount: "contract.amount", 
            effectiveDate: "effective.date", 
            status: "status", 
            responsibleOfficer: "responsible.officer", 
            currency: "currency"
        };
        var requestedSort = expenseContractText(params.sortField) || "id";
        var sortField = sortFields[requestedSort];
        if (!Object.prototype.hasOwnProperty.call(sortFields, requestedSort)) {
            throw expenseContractError("INVALID_SORT_FIELD", "Cột sắp xếp HĐ XDCB không hợp lệ.");
        }
        var direction = expenseContractText(params.sortOrder) || "asc";
        if (direction !== "asc" && direction !== "desc") {
            throw expenseContractError("INVALID_SORT_ORDER", "Chiều sắp xếp HĐ XDCB không hợp lệ.");
        }

        var query = conditions.join(" and ");
        countFile = new SCFile("esdXDCBrepairProjectCtr", SCFILE_READONLY);
        var totalCount = Number(countFile.doCount(query));
        if (!isFinite(totalCount) || totalCount < 0 || Math.floor(totalCount) !== totalCount) {
            throw expenseContractError("CONTRACT_COUNT_FAILED", "Không đếm được danh sách HĐ XDCB.");
        }
        contractFile = new SCFile("esdXDCBrepairProjectCtr", SCFILE_READONLY);
        contractFile.setFields([
            "id", "contract.name", "contract.amount", "currency",
            "signed.date", "effective.date", "expire.date", "status", "responsible.officer",
            "repair.id", "construction.id", "type.budget", "vendor.name", "tax.code", "vendor.address", "tender.package.id"
        ]);
        var orderFields = [sortField];
        var orderSequences = [direction === "desc" ? SCFILE_DSC : SCFILE_ASC];
        if (sortField !== "id") {
            orderFields.push("id");
            orderSequences.push(SCFILE_ASC);
        }
        contractFile.setOrderBy(orderFields, orderSequences);
        var rows = [];
        var rc = contractFile.doSelectEx(query, start, count);
        while (rc === RC_SUCCESS) {
            rows.push(expenseContractRow(contractFile));
            rc = contractFile.getNext();
        }
        if (rc !== RC_NO_MORE) {
            throw expenseContractError("CONTRACT_QUERY_FAILED", "Không tải được danh sách HĐ XDCB.");
        }
        return {
            success: true, data: rows, totalCount: totalCount,
            start: start, count: count, returnedCount: rows.length,
            hasMore: start - 1 + rows.length < totalCount
        };
    } catch (error) {
        return {
            success: false, data: [], totalCount: 0, returnedCount: 0, hasMore: false,
            errorCode: error.expenseContractCode || "EXPENSE_CONTRACT_READ_FAILED",
            message: String(error.message || error)
        };
    } finally {
        expenseContractClose(contractFile);
        expenseContractClose(countFile);
    }
}

/** Đọc một HĐ theo ID nội bộ, áp dụng cùng điều kiện và quyền với danh sách. */
function getExpenseXdcbContract(input) {
    try {
        var params = expenseContractParams(input);
        if (!expenseContractText(params.contractId)) {
            throw expenseContractError("MISSING_CONTRACT_ID", "Thiếu khóa HĐ XDCB.");
        }
        params.start = 1;
        params.count = 1;
        var result = listExpenseXdcbContracts({ details: params });
        if (!result.success) return {
            success: false, data: null, errorCode: result.errorCode, message: result.message
        };
        if (!result.data.length) {
            throw expenseContractError("CONTRACT_NOT_AVAILABLE", "Không tìm thấy HĐ XDCB đủ điều kiện trong phạm vi được xem.");
        }
        return { success: true, data: result.data[0] };
    } catch (error) {
        return {
            success: false, data: null,
            errorCode: error.expenseContractCode || "EXPENSE_CONTRACT_READ_FAILED",
            message: String(error.message || error)
        };
    }
}

/** Ánh xạ phạm vi S2 sang S4; mặc định quyền Dự chi, chỉ entrypoint Thanh toán truyền PAYMENT. */
function expenseContractScope(currentUser, paymentId, selectionType) {
    var actor = expenseContractText(currentUser);
    if (!actor) throw expenseContractError("MISSING_ACTOR", "Không xác định được người thực hiện.");
    var contact = null;
    var contactId;
    var unitLv1;
    try {
        contact = new SCFile("contacts", SCFILE_READONLY);
        contact.setFields(["contact.name", "lv1.id"]);
        var rc = contact.doSelect('contact.name="' + expenseContractQuote(actor) + '"');
        if (rc === RC_NO_MORE) {
            rc = contact.doSelect('tolower(contact.name)="' + expenseContractQuote(actor.toLowerCase()) + '"');
        }
        if (rc !== RC_SUCCESS) throw expenseContractError("ACTOR_LOOKUP_FAILED", "Không xác định được hồ sơ người thực hiện.");
        contactId = expenseContractText(contact["contact.name"]);
        unitLv1 = expenseContractText(contact["lv1.id"]);
        if (!contactId || contact.getNext() !== RC_NO_MORE) {
            throw expenseContractError("ACTOR_LOOKUP_FAILED", "Không xác định được duy nhất hồ sơ người thực hiện.");
        }
    } finally {
        expenseContractClose(contact);
    }
    var rights = expenseContractArray(lib.ESD_PERMS_RIGHTS.permsRight(contactId));
    var isPayment = selectionType === "PAYMENT";
    if (!isPayment && rights.indexOf("0040040004000001") < 0) {
        throw expenseContractError("EXPENSE_VIEW_DENIED", "Không có quyền xem dữ liệu Dự chi.");
    }
    var permission = lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(contactId, "00401") || {};
    var scope = expenseContractText(permission.scope || permission.dataScopeList || permission["permission.scope"]) || "QT_PQDL_01";
    if (!unitLv1 && scope !== "QT_PQDL_06") {
        throw expenseContractError("CONTRACT_SCOPE_EMPTY", "Hồ sơ người thực hiện chưa có đơn vị cấp 1 để kiểm tra phạm vi HĐ XDCB.");
    }
    var conditions = [];
    // Nhánh Thanh toán lấy vai trò từ quyền thật trên SM, không nhận initialRole/scope/unit từ client.
    var role = isPayment ? lib.ESD_HTKT_PAYMENT_CREATE_REQUEST.htktCreatePay_detectInitialRoleByRights(contactId) :
            expenseContractSelectionRole(paymentId);
    if (isPayment && (!role || rights.indexOf("0040040003000001") < 0 || rights.indexOf("0040040003000010") >= 0)) {
        throw expenseContractError("PAYMENT_CREATE_DENIED", "Không có quyền chọn HĐ để tạo phiếu Thanh toán.");
    }
    if (role === "dmms") {
        conditions.push('responsible.officer="' + expenseContractQuote(contactId) + '"');
    }
    if (scope === "QT_PQDL_06") return conditions.length ? conditions.join(" and ") : "true";
    if (scope === "QT_PQDL_04" && unitLv1.indexOf("0999") === 0) {
        var entity = null;
        try {
            entity = new SCFile("esdDMentity", SCFILE_READONLY);
            var entityRc = entity.doSelect('ps.code="' + expenseContractQuote(unitLv1) +
                    '" and status="ACTIVE" and entity.code="1010098"');
            if (entityRc !== RC_SUCCESS && entityRc !== RC_NO_MORE) {
                throw expenseContractError("CONTRACT_SCOPE_QUERY_FAILED", "Không kiểm tra được mapping entity của đơn vị hội sở.");
            }
            // Giữ nhánh hội sở S2: có mapping lấy 0999*, không có mapping không lọc đơn vị.
            conditions.push(entityRc === RC_SUCCESS ? 'unit.level1 like "0999*"' : '1=1');
        } finally { expenseContractClose(entity); }
    } else {
        // S2 dùng LV1 của hồ sơ đăng nhập cho các scope còn lại, không dùng danh sách unit từ client.
        conditions.push('unit.level1="' + expenseContractQuote(unitLv1) + '"');
    }
    return conditions.join(" and ");
}

/** Lấy vai trò từ phiếu như S2; các entrypoint hiện có vẫn kiểm tra quyền thao tác/phase. */
function expenseContractSelectionRole(paymentId) {
    var id = expenseContractText(paymentId);
    if (!id) return ""; // API chỉ đọc không gắn phiếu vẫn áp phạm vi LV1/quyền xem ở trên.
    var payment = null;
    try {
        payment = new SCFile("esdHTKTpayment", SCFILE_READONLY);
        payment.setFields(["id", "transaction.type", "original.contract.category", "current.phase",
            "initial.role"]);
        if (id.indexOf("DC.") !== 0 || payment.doSelect('id="' + expenseContractQuote(id) + '"') !== RC_SUCCESS ||
                expenseContractText(payment["transaction.type"]) !== "Dự chi" ||
                expenseContractText(payment["original.contract.category"]).toUpperCase() !== "XDCB") {
            throw expenseContractError("INVALID_EXPENSE", "Không tìm thấy phiếu Dự chi XDCB hợp lệ.");
        }
        var phase = expenseContractText(payment["current.phase"]);
        var role = expenseContractText(payment["initial.role"]).toLowerCase();
        return phase === "initial_kttc" ? "kttc" : role;
    } finally { expenseContractClose(payment); }
}

/** Dùng ID S4 làm mã HĐ; trả phân loại và NCC trên HĐ để resolver chọn đúng nguồn NCC. */
function expenseContractRow(record) {
    var repairId = expenseContractText(record["repair.id"]);
    return {
        id: expenseContractText(record["id"]),
        contractCode: expenseContractText(record["id"]),
        name: expenseContractText(record["contract.name"]),
        contractAmount: Number(record["contract.amount"] || 0),
        currency: expenseContractText(record["currency"]),
        signedDate: expenseContractDate(record["signed.date"]),
        effectiveDate: expenseContractDate(record["effective.date"]),
        expireDate: expenseContractDate(record["expire.date"]),
        status: expenseContractText(record["status"]),
        responsibleOfficer: expenseContractText(record["responsible.officer"]),
        projectType: repairId ? "REPAIR" : "CONSTRUCTION",
        repairId: repairId,
        constructionId: expenseContractText(record["construction.id"]),
        budgetType: expenseContractText(record["type.budget"]),
        vendorName: expenseContractText(record["vendor.name"]),
        vendorTaxCode: expenseContractText(record["tax.code"]),
        vendorAddress: expenseContractText(record["vendor.address"]),
        tenderPackageId: expenseContractText(record["tender.package.id"]),
        source: "S4"
    };
}

/** Đọc payload object/JSON dùng chung cho các entrypoint HĐ Dự chi. */
function expenseContractParams(input) {
    var value = input ? (input.details || input.queryString || input) : {};
    try {
        if (typeof value === "string") value = JSON.parse(value);
        if (value instanceof Array) value = value[0];
        if (!value || typeof value !== "object") throw new Error("Invalid input");
        return value;
    } catch (error) {
        throw expenseContractError("INVALID_INPUT", "Dữ liệu đọc HĐ XDCB không hợp lệ.");
    }
}

/** Giữ mã định danh dạng text, gồm cả số 0 đầu. */
function expenseContractText(value) {
    return value == null ? "" : String(value).replace(/^\s+|\s+$/g, "");
}

/** Escape giá trị trước khi ghép vào query SM. */
function expenseContractQuote(value) {
    return expenseContractText(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Chỉ nhận số nguyên dương cho start/count. */
function expenseContractPageNumber(value, fallback) {
    if (value == null || value === "") return fallback;
    var number = Number(value);
    if (!isFinite(number) || number < 1 || number > 9007199254740991 || Math.floor(number) !== number) {
        throw expenseContractError("INVALID_PAGINATION", "Thông tin phân trang HĐ XDCB không hợp lệ.");
    }
    return number;
}

/** Kiểm tra ngày lọc có đúng định dạng và tồn tại trên lịch. */
function expenseContractDateFilter(value) {
    var text = expenseContractText(value);
    if (!text) return "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw expenseContractError("INVALID_DATE", "Ngày hiệu lực cần có định dạng YYYY-MM-DD.");
    }
    var parts = text.split("-");
    var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    if (date.getUTCFullYear() !== Number(parts[0]) || date.getUTCMonth() !== Number(parts[1]) - 1 || date.getUTCDate() !== Number(parts[2])) {
        throw expenseContractError("INVALID_DATE", "Ngày hiệu lực không hợp lệ.");
    }
    return text;
}

/** Chuẩn hóa ngày SM thành giá trị trả về API. */
function expenseContractDate(value) {
    return value && value.toISOString ? value.toISOString() : expenseContractText(value);
}

/** Đọc số tiền S4; field trống là chưa có dữ liệu, không tự biến thành số 0. */
function expenseXdcbMoney(value) {
    if (value == null || expenseContractText(value) === "") return null;
    var amount = Number(value);
    if (!isFinite(amount)) throw new Error("Số tiền nguồn S4 không hợp lệ.");
    return amount;
}

/** HĐ S4: số còn lại = giá trị HĐ - tổng đã TU/TT; giữ null nếu nguồn chưa đủ hai số. */
function expenseXdcbContractAmounts(record) {
    var total = expenseXdcbMoney(record["contract.amount"]);
    var paid = expenseXdcbMoney(record["total.amount.paid"]);
    return {
        totalPaidAmount: paid,
        remainingAmount: total === null || paid === null ? null : total - paid
    };
}

/** Lấy đầu ngày kế tiếp để bộ lọc bao gồm toàn bộ ngày kết thúc. */
function expenseContractNextDate(value) {
    var parts = value.split("-");
    var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + 1));
    return date.toISOString().substring(0, 10);
}

/** Chuẩn hóa danh sách quyền/đơn vị và bỏ giá trị trùng. */
function expenseContractArray(value) {
    var values = value && value.toArray ? value.toArray() : value;
    if (typeof values === "string") values = [values];
    var result = [];
    for (var i = 0; values && i < values.length; i++) {
        var item = expenseContractText(values[i]);
        if (item && result.indexOf(item) < 0) result.push(item);
    }
    return result;
}

/** Gắn mã lỗi nghiệp vụ để caller phân biệt lỗi dữ liệu và quyền. */
function expenseContractError(code, message) {
    var error = new Error(message);
    error.expenseContractCode = code;
    return error;
}

/** Giải phóng SCFile kể cả khi truy vấn thất bại. */
function expenseContractClose(file) {
    try { if (file) file.doClose(); } catch (closeError) {}
}
