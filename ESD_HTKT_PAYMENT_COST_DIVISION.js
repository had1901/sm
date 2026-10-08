/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_COST_DIVISION
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Quản lý danh sách dòng phân bổ chi phí (esdHTKTcostDivision) của đề nghị thanh toán.
 * - Thực hiện các thao tác Thêm, Sửa, Xóa và Import dữ liệu phân bổ chi phí.
 * - Tự động tra cứu và điền thông tin đơn vị kế toán (GL Unit, Cost Center, Transaction Office).
 * - Đồng bộ và cập nhật tổng tiền chi phí lên phiếu đề nghị và bảng bút toán liên quan.
 * -----------------------------------------------------------------------------
 */

// Script Library cho Quản lý Phân bổ chi phí (esdHTKTpaymentCostDivision)
function run() {
    try {
        var input = vars["$L.file"];

        // print("===== DEBUG =====");
        // print("name = " + input["name"]);
        // print("details = " + input["details"]);
        // print("queryString = " + input["queryString"]);

        if (!input) {
            return;
        }

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
            case "getCostDivision":
                var data = getCostDivision(input);
                result = { success: true, data: data };
                break;
            case "createCostDivision":
                result = createCostDivision(input);
                break;
            case "updateCostDivision":
                result = updateCostDivision(input);
                break;
            case "deleteCostDivision":
                result = deleteCostDivision(input);
                break;
            case "importCostDivision":
                result = importCostDivision(input);
                break;

                // --- DANH MỤC ---
            case "getCreatorUnitInfo":
                result = getCreatorAccountingInfo(input);
                break;
            case "getGlUnitsCostDivision":
                result = getGlUnitOptions(input);
                break;
            case "getGlDepartments":
                result = getGlDepartmentOptions(input);
                break;
            case "getGlTransactionOffices":
                result = getGlTransactionOfficeOptions(input);
                break;
            case "getGlAccounts":
                result = getGlAccounts(input);
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

/** Khai báo table. */
var TABLE_ENTITY = "esdDMentity";
var TABLE_COST_CENTER = "esdDMcostCenter";
var TABLE_PAYMENT = "esdHTKTpayment";
var TABLE_CONTACT = "contacts";

var GL_UNIT_TRANSACTION_CODE = "98";
var GL_UNIT_PREFERRED_PS_CODE = {
    1010098: "99901000"
};

var ENTITY_STATUS_ACTIVE = "ACTIVE";

/**
 * =========================================================================
 * 1. CÁC HÀM TRUY VẤN DANH MỤC (Dropdown)
 * =========================================================================
 */

/** Lấy đơn vị kế toán cùng danh mục phòng ban và phòng giao dịch mặc định. */
function getCreatorAccountingInfo(input) {
    var rawDetails = extractRawDetails(input);
    var paymentId = "";
    var currentUser = "";

    if (rawDetails) {
        try {
            var parsedObj = JSON.parse(rawDetails);
            if (parsedObj.paymentId) {
                paymentId = safeString(parsedObj.paymentId).trim();
            }
            if (parsedObj.currentUser) {
                currentUser = safeString(parsedObj.currentUser).trim();
            }
        } catch (e) {}
    }

    var creatorUnit = getCreatorAccountingUnit(paymentId, currentUser);
    // Lấy PGD thuộc Chi nhánh trực tiếp bằng entityCode (creatorUnit.value) thay vì lv1Id
    var transactionOfficeOptions = getTransactionOfficeOptions(creatorUnit.value);
    // Lấy Phòng ban lọc theo đầu mã org.code dựa trên đơn vị (creatorUnit.value)
    var departments = getGlCostCenterOptions(creatorUnit.value);

    return {
        success: true,
        data: {
            creatorUnit: creatorUnit,
            transactionOptions: transactionOfficeOptions,
            departmentOptions: departments
        }
    };
}

/** lấy unit theo người đăng nhập hoặc người tạo. */
function getCreatorAccountingUnit(paymentId, currentUser) {
    var emptyResult = { code: "", name: "", value: "", lv1Id: "" };

    var creator = safeString(currentUser).trim();
    if (!creator && paymentId) {
        var request = getPaymentRequest(paymentId);
        var createdBy = request.created_by;
        creator = safeString(createdBy).trim();
    }

    if (!creator) return emptyResult;

    var lv1Id = selectOne(
            TABLE_CONTACT,
            'contact.name="' + escapeQueryValue(creator) + '"',
            function (record) {
                return readText(record, "lv1.id");
            }
    );
    var psCode = lv1Id;

    if (!psCode) {
        return { code: "", name: "", value: "", lv1Id: lv1Id };
    }

    return (
            selectOne(
                    TABLE_ENTITY,
                    'ps.code="' + escapeQueryValue(psCode) + '"',
                    function (record) {
                        var branchCode = removeFirstLeadingZero(
                                readText(record, "ogl.branch.code")
                        ).trim();
                        var name = getBranchNamePrefix(readText(record, "branch.name"));
                        return {
                            entityCode: readText(record, "entity.code"),
                            branchCode: branchCode,
                            name: name,
                            label: branchCode + " - " + name,
                            value: readText(record, "entity.code"),
                            lv1Id: lv1Id,
                            matchBranchCode: branchCode
                        };
                    }
            ) || { code: "", name: "", value: "", lv1Id: lv1Id }
    );
}

/** Lấy danh sách Phòng giao dịch trực tiếp từ esdDMentity, không phụ thuộc esdQTorgUnit */
function getTransactionOfficeOptions(unitId) {
    var optionMap = {};
    var options = [];

    // Luôn thêm mã mặc định "000000 - Không xác định" ở đầu
    options.push({
        value: "000000",
        label: "000000 - Không xác định",
        name: "Không xác định",
        psCode: ""
    });
    optionMap["000000"] = true;

    var prefix = getUnitPrefix5(unitId);
    if (prefix) {
        // Lấy trực tiếp từ esdDMentity dựa theo entity.code bắt đầu bằng 10xxx
        var query = 'status="' + escapeQueryValue(ENTITY_STATUS_ACTIVE) + '"' +
                ' and entity.code like "' + escapeQueryValue(prefix) + '*"';

        var f = new SCFile(TABLE_ENTITY, SCFILE_READONLY);
        var rc = f.doSelect(query);

        while (rc === RC_SUCCESS) {
            var code = safeString(f["entity.code"]).trim();
            var name = getTransFromNamePrefix(readText(f, "branch.name"));
            var psCode = safeString(f["ps.code"]).trim();

            // LỌC: Mã có 7 ký tự (10xxxyy), bắt đầu bằng prefix (10xxx), không trùng và loại trừ đuôi 98
            if (code && code.length === 7 && code.substring(0, 5) === prefix && !optionMap[code] && code.slice(-2) !== "98") {
                optionMap[code] = true;
                options.push({
                    value: code,
                    label: code + (name ? " - " + name : ""),
                    name: name,
                    psCode: psCode
                });
            }
            rc = f.getNext();
        }

        try {
            f.doClose();
        } catch (e) {}
    }

    // Sắp xếp các PGD (giữ mã không xác định ở vị trí đầu)
    var firstOption = options[0];
    var restOptions = options.slice(1);
    restOptions.sort(compareTransactionOfficeOption);

    return [firstOption].concat(restOptions);
}

function addTransactionOfficeOption(options, optionMap, lv2Row) {
    var lv2Id = safeString(lv2Row["unit.id"]).trim();
    var lv2Name = safeString(lv2Row["unit.name"]).trim();
    var entity = getTransactionOfficeByLv2(lv2Id);
    var code = safeString(entity.code).trim();
    var name = lv2Name || safeString(entity.name).trim();
    var psCode = lv2Id;

    if (!code || optionMap[code] || code.slice(-2) === "98") return;

    optionMap[code] = true;
    options.push({
        value: code,
        label: code + (name ? " - " + name : ""),
        name: name,
        psCode: psCode
    });
}

function getLv2OrgUnitsByLv1(lv1Id) {
    var id = safeString(lv1Id).trim();
    if (!id) return [];
    return (
            lib.ESD_Utils.fetchData(
                    "esdQTorgUnit",
                    'parent.id="' + escapeQueryValue(id) + '"',
                    ["unit.id", "unit.name"]
            ) || []
    );
}


function getTransactionOfficeByLv2(lv2Id) {
    var psCode = safeString(lv2Id).trim();
    if (!psCode) return { code: '', name: '' };

    try {
        return (
                selectOne(
                        TABLE_ENTITY,
                        'ps.code="' +
                        escapeQueryValue(psCode) +
                        '" and status="' +
                        escapeQueryValue(ENTITY_STATUS_ACTIVE) +
                        '"',
                        function (record) {
                            return {
                                code: readText(record, 'entity.code').trim(),
                                name: getTransFromNamePrefix(readText(record, 'branch.name'))
                            };
                        }
                ) || { code: '', name: '' }
        );
    } catch (e) {
        return { code: '', name: '' };
    }
}


/** Sửa SQL thành Native SM Query */
function getGlUnitOptions(input) {
    var optionMap = {};
    var options = [];

    var page = 1;
    var pageSize = 100;
    var keyword = "";

    try {
        var rawDetails = extractRawDetails(input);
        if (rawDetails) {
            var parsedObj = JSON.parse(rawDetails);

            if (parsedObj.page && Number(parsedObj.page) > 0) {
                page = Number(parsedObj.page);
            }

            if (parsedObj.pageSize && Number(parsedObj.pageSize) > 0) {
                pageSize = Number(parsedObj.pageSize);
            }

            if (parsedObj.keyword) {
                keyword = safeString(parsedObj.keyword).trim();
            }
        }
    } catch (e) {}

    var query = 'org.transaction.code="' + escapeQueryValue(GL_UNIT_TRANSACTION_CODE) + '"';
    if (keyword) {
        query += ' and entity.code like "*' + escapeQueryValue(keyword) + '*"';
    }

    var f = new SCFile(TABLE_ENTITY, SCFILE_READONLY);
    var rc = f.doSelect(query);

    while (rc === RC_SUCCESS) {
        var psCode = safeString(f["ps.code"]).trim();
        var entityCode = safeString(f["entity.code"]).trim();
        var rawBranchCode = safeString(f["ogl.branch.code"]).trim();
        var branchCode = normalizeGlBranchCode(rawBranchCode);
        var matchBranchCode = rawBranchCode;
        var branchName = getUnitFromBranchNamePrefix(f["branch.name"]);

        var currentOption = optionMap[entityCode];
        var preferredPsCode = GL_UNIT_PREFERRED_PS_CODE[entityCode] || "";

        var currentIsPreferred =
                preferredPsCode &&
                currentOption &&
                currentOption.psCode === preferredPsCode;

        var candidateIsPreferred = preferredPsCode && psCode === preferredPsCode;

        if (
                entityCode &&
                (!currentOption ||
                        (candidateIsPreferred && !currentIsPreferred) ||
                        (!currentIsPreferred &&
                                !candidateIsPreferred &&
                                ((!currentOption.psCode && psCode) ||
                                        (psCode && currentOption.psCode && psCode < currentOption.psCode))))
        ) {
            optionMap[entityCode] = {
                label: entityCode + (branchName ? " - " + branchName : ""),
                value: entityCode,
                entityCode: entityCode,
                branchCode: branchCode,
                name: branchName,
                matchBranchCode: matchBranchCode,
                psCode: psCode
            };
        }
        rc = f.getNext();
    }

    try {
        f.doClose();
    } catch (e) {}

    for (var optionKey in optionMap) {
        if (!hasOwn(optionMap, optionKey)) continue;

        options.push({
            label: optionMap[optionKey].label,
            value: optionMap[optionKey].value,
            name: optionMap[optionKey].name,
            entityCode: optionMap[optionKey].entityCode,
            branchCode: optionMap[optionKey].branchCode,
            matchBranchCode: optionMap[optionKey].matchBranchCode
        });
    }

    options.sort(compareGlUnitOption);

    var totalRecords = options.length;
    var totalPages = Math.ceil(totalRecords / pageSize);
    var startIndex = (page - 1) * pageSize;

    return {
        success: true,
        data: options.slice(startIndex, startIndex + pageSize),
        pagination: {
            page: page,
            pageSize: pageSize,
            totalRecords: totalRecords,
            totalPages: totalPages
        }
    };
}

/** Lọc Phòng ban theo cột org.code và unitId */
function getGlCostCenterOptions(unitId) {
    var optionMap = {};
    var options = [];

    // Luôn thêm mã mặc định "000000 - Không xác định" ở đầu
    options.push({
        value: "000000",
        label: "000000 - Không xác định",
        name: "Không xác định"
    });
    optionMap["000000"] = true;

    var query = 'status="ACTIVE"';

    if (unitId) {
        var xxx = getUnitXxx(unitId);
        if (xxx === "100") {
            // xxx = 100 -> org.code KHÁC đầu 3 (không bắt đầu bằng 3)
            query += ' and not org.code like "3*"';
        } else {
            // xxx != 100 -> org.code BẮT ĐẦU bằng đầu 3
            query += ' and org.code like "3*"';
        }
    }

    var f = new SCFile(TABLE_COST_CENTER, SCFILE_READONLY);
    var rc = f.doSelect(query);

    while (rc === RC_SUCCESS) {
        var costCenter = safeString(f["cost.center"]).trim();
        var name = safeString(f["name"]).trim();

        if (costCenter && !optionMap[costCenter]) {
            optionMap[costCenter] = true;
            options.push({
                value: costCenter,
                label: costCenter + (name ? ' - ' + name : ''),
                name: name
            });
        }
        rc = f.getNext();
    }

    try {
        f.doClose();
    } catch (e) {}

    // Sắp xếp các phòng ban (giữ mã không xác định ở vị trí đầu)
    var firstOption = options[0];
    var restOptions = options.slice(1);
    restOptions.sort(function (left, right) {
        var leftValue = safeString(left.value);
        var rightValue = safeString(right.value);

        if (leftValue < rightValue) return -1;
        if (leftValue > rightValue) return 1;
        return 0;
    });

    return [firstOption].concat(restOptions);
}

/** Lọc Phòng ban theo cột org.code và unitId có phân trang và keyword */
function getGlDepartmentOptions(input) {
    var optionMap = {};
    var options = [];

    var page = 1;
    var pageSize = 100;
    var keyword = "";
    var unitId = "";

    try {
        var rawDetails = extractRawDetails(input);
        if (rawDetails) {
            var parsedObj = JSON.parse(rawDetails);

            if (parsedObj.page && Number(parsedObj.page) > 0) {
                page = Number(parsedObj.page);
            }

            if (parsedObj.pageSize && Number(parsedObj.pageSize) > 0) {
                pageSize = Number(parsedObj.pageSize);
            }

            if (parsedObj.keyword) {
                keyword = safeString(parsedObj.keyword).trim();
            }

            if (parsedObj.unitId || parsedObj.entityCode) {
                unitId = safeString(parsedObj.unitId || parsedObj.entityCode).trim();
            }
        }
    } catch (e) {}

    // Luôn thêm mã mặc định "000000 - Không xác định" ở đầu
    options.push({
        value: "000000",
        label: "000000 - Không xác định",
        name: "Không xác định"
    });
    optionMap["000000"] = true;

    var query = 'status="ACTIVE"';

    if (unitId) {
        var xxx = getUnitXxx(unitId);
        if (xxx === "100") {
            // xxx = 100 -> org.code KHÁC đầu 3 (không bắt đầu bằng 3)
            query += ' and not org.code like "3*"';
        } else {
            // xxx != 100 -> org.code BẮT ĐẦU bằng đầu 3
            query += ' and org.code like "3*"';
        }
    }

    if (keyword) {
        query += ' and (cost.center like "*' + escapeQueryValue(keyword) + '*" or name like "*' + escapeQueryValue(keyword) + '*")';
    }

    var f = new SCFile(TABLE_COST_CENTER, SCFILE_READONLY);
    var rc = f.doSelect(query);

    while (rc === RC_SUCCESS) {
        var costCenter = safeString(f["cost.center"]).trim();
        var name = safeString(f["name"]).trim();

        if (costCenter && !optionMap[costCenter]) {
            optionMap[costCenter] = true;
            options.push({
                value: costCenter,
                label: costCenter + (name ? ' - ' + name : ''),
                name: name
            });
        }
        rc = f.getNext();
    }

    try {
        f.doClose();
    } catch (e) {}

    // Sắp xếp các phòng ban (giữ mã không xác định ở vị trí đầu)
    var firstOption = options[0];
    var restOptions = options.slice(1);
    restOptions.sort(function (left, right) {
        var leftValue = safeString(left.value);
        var rightValue = safeString(right.value);

        if (leftValue < rightValue) return -1;
        if (leftValue > rightValue) return 1;
        return 0;
    });

    var sortedOptions = [firstOption].concat(restOptions);

    var totalRecords = sortedOptions.length;
    var totalPages = Math.ceil(totalRecords / pageSize);
    var startIndex = (page - 1) * pageSize;

    return {
        success: true,
        data: sortedOptions.slice(startIndex, startIndex + pageSize),
        pagination: {
            page: page,
            pageSize: pageSize,
            totalRecords: totalRecords,
            totalPages: totalPages
        }
    };
}

/** Lấy danh sách Phòng giao dịch và loại bỏ đuôi 98 */
function getGlTransactionOfficeOptions(input) {
    var optionMap = {};
    var options = [];

    var page = 1;
    var pageSize = 100;
    var keyword = "";
    var unitId = "";

    try {
        var rawDetails = extractRawDetails(input);
        if (rawDetails) {
            var parsedObj = JSON.parse(rawDetails);

            if (parsedObj.page && Number(parsedObj.page) > 0) {
                page = Number(parsedObj.page);
            }

            if (parsedObj.pageSize && Number(parsedObj.pageSize) > 0) {
                pageSize = Number(parsedObj.pageSize);
            }

            if (parsedObj.keyword) {
                keyword = safeString(parsedObj.keyword).trim();
            }

            if (parsedObj.unitId || parsedObj.entityCode) {
                unitId = safeString(parsedObj.unitId || parsedObj.entityCode).trim();
            }
        }
    } catch (e) {}

    // Luôn thêm mã mặc định "000000 - Không xác định" ở đầu
    options.push({
        value: "000000",
        label: "000000 - Không xác định",
        name: "Không xác định"
    });
    optionMap["000000"] = true;

    var prefix = getUnitPrefix5(unitId);
    if (prefix) {
        var query = 'status="' + escapeQueryValue(ENTITY_STATUS_ACTIVE) + '"' +
                ' and entity.code like "' + escapeQueryValue(prefix) + '*"';

        if (keyword) {
            query += ' and (entity.code like "*' + escapeQueryValue(keyword) + '*" or branch.name like "*' + escapeQueryValue(keyword) + '*")';
        }

        var f = new SCFile(TABLE_ENTITY, SCFILE_READONLY);
        var rc = f.doSelect(query);

        while (rc === RC_SUCCESS) {
            var code = safeString(f["entity.code"]).trim();
            var branchName = safeString(f["branch.name"]).trim();
            var branchNameSeparatorIndex = branchName.indexOf("-");

            if (branchNameSeparatorIndex >= 0) {
                branchName = branchName.substring(branchNameSeparatorIndex + 1).trim();
            }

            if (code && code.length === 7 && code.substring(0, 5) === prefix && !optionMap[code] && code.slice(-2) !== "98") {
                optionMap[code] = true;
                options.push({
                    value: code,
                    label: code + (branchName ? " - " + branchName : ""),
                    name: branchName
                });
            }
            rc = f.getNext();
        }

        try {
            f.doClose();
        } catch (e) {}
    }

    var firstOption = options[0];
    var restOptions = options.slice(1);
    restOptions.sort(function (left, right) {
        var leftValue = safeString(left.value);
        var rightValue = safeString(right.value);
        if (leftValue < rightValue) return -1;
        if (leftValue > rightValue) return 1;
        return 0;
    });

    var sortedOptions = [firstOption].concat(restOptions);

    var totalRecords = sortedOptions.length;
    var totalPages = Math.ceil(totalRecords / pageSize);
    var startIndex = (page - 1) * pageSize;

    return {
        success: true,
        data: sortedOptions.slice(startIndex, startIndex + pageSize),
        pagination: {
            page: page,
            pageSize: pageSize,
            totalRecords: totalRecords,
            totalPages: totalPages
        }
    };
}

/**
 * Lấy danh sách Tài khoản GL từ esdDMglAccount (lọc theo type = "Chi phí")
 */
function getGlAccounts(input) {
    var list = [];
    var page = 1;
    var pageSize = 9999;

    try {
        var rawDetails = extractRawDetails(input);
        if (rawDetails) {
            var parsedObj = JSON.parse(rawDetails);
            if (parsedObj.page && Number(parsedObj.page) > 0)
                page = Number(parsedObj.page);
            if (parsedObj.pageSize && Number(parsedObj.pageSize) > 0)
                pageSize = Number(parsedObj.pageSize);
        }
    } catch (ex) {}

    var fieldMappings = [
        ["account", "accountNumber", "S"],
        ["name", "accountName", "S"],
        ["type", "type", "S"],
        ["account.type", "accountType", "S"]
    ];

    var f = new SCFile("esdDMglAccount", SCFILE_READONLY);
    var rc = f.doSelect("true");

    while (rc === RC_SUCCESS) {
        var account = safeString(f["account"]).trim();
        if (account) {
            var rawType = safeString(f["type"]).trim();
            var isCost = rawType === "Chi phí" || rawType === "COST";

            if (isCost) {
                var item = mapRowToObject(f, fieldMappings);
                item.label = item.accountNumber + " - " + item.accountName;
                item.value = item.accountNumber;
                item.type = rawType;
                list.push(item);
            }
        }
        rc = f.getNext();
    }

    try {
        if (f) f.doClose();
    } catch (e) {}

    return {
        success: true,
        data: list,
        pagination: {
            page: page,
            pageSize: pageSize,
            totalRecords: list.length,
            totalPages: 1
        }
    };
}
/**
 * =========================================================================
 * 2. CÁC HÀM XỬ LÝ PHÂN BỔ CHI PHÍ
 * =========================================================================
 */

/**
 * Lấy danh sách Phân bổ chi phí theo paymentId và vendorId
 */
function getCostDivision(input) {
    var list = [];
    var paymentId = "";
    var vendorId = "";

    try {
        var rawDetails = extractRawDetails(input);
        var queryObj = {};
        if (rawDetails) queryObj = JSON.parse(rawDetails);
        paymentId = queryObj.paymentId || queryObj["payment.id"] || queryObj.payment_id || "";
        vendorId =
                queryObj.vendorId ||
                queryObj["vendor.id"] ||
                queryObj.vendor_id ||
                queryObj["vendor_id"] ||
                queryObj.supplierId ||
                queryObj["supplier.id"] ||
                "";
    } catch (ex) {
        return list;
    }

    if (!paymentId) return list;

    var fieldMappings = [
        ["id", "id", "S"],
        ["payment.id", "paymentId", "S"],
        ["vendor.id", "vendorId", "S"],
        ["entry.type", "entryType", "S"],
        ["account.type", "accountType", "S"],
        ["account.number", "accountNumber", "S"],
        ["account.name", "accountName", "S"],
        ["department", "department", "S"],
        ["department.name", "departmentName", "S"],
        ["unit.id", "unitId", "S"],
        ["unit.name", "unitName", "S"],
        ["transaction.code", "transactionCode", "S"],
        ["transaction.name", "transactionName", "S"],
        ["amount", "amount", "N"]
    ];

    var query = 'payment.id="' + escapeQueryValue(paymentId) + '"';
    if (vendorId) {
        query += ' and vendor.id="' + escapeQueryValue(vendorId) + '"';
    }

    var f = new SCFile("esdHTKTpaymentCostDivision", SCFILE_READONLY);
    var rc = f.doSelect(query);

    while (rc === RC_SUCCESS) {
        var item = mapRowToObject(f, fieldMappings);
        list.push(item);
        rc = f.getNext();
    }

    try {
        if (f) f.doClose();
    } catch (e) {}

    return list;
}

/**
 * Thêm mới / Ghi đè Phân bổ chi phí (dùng cho createCostDivision - luồng khác import)
 */
function createCostDivision(input) {
    var rawDetails = extractRawDetails(input);
    // print("[COST_DIVISION_CREATE] rawDetails=" + rawDetails);

    if (!rawDetails) {
        return { success: false, message: "Thiếu dữ liệu phân bổ chi phí" };
    }

    try {
        var parsedData = JSON.parse(rawDetails);
        var dataList = Array.isArray(parsedData) ? parsedData : [parsedData];

        var totalSuccess = 0;
        var totalFailed = 0;
        var totalDuplticate = 0;

        var results = [];

        for (var i = 0; i < dataList.length; i++) {
            var item = dataList[i];
            var itemResult = processSingleCostDivision(item);

            if (!itemResult.success) {
                totalFailed++;
            } else if (itemResult.isDuplicate) {
                totalDuplticate++;
            } else {
                totalSuccess++;
            }
            results.push(itemResult);
        }

        return {
            success: totalFailed === 0,
            message:
                    "Đã xử lý " +
                    dataList.length +
                    " bản ghi (" +
                    totalSuccess +
                    " thành công, " +
                    totalDuplticate +
                    " trùng lặp, " +
                    totalFailed +
                    " thất bại)",
            details: results
        };
    } catch (e) {
        // print("[COST_DIVISION_CREATE] error=" + e.toString());
        return {
            success: false,
            message: "Lỗi định dạng JSON dữ liệu đầu vào: " + e.toString()
        };
    }
}

/**
 * Cập nhật Phân bổ chi phí
 */
function updateCostDivision(input) {
    var rawDetails = extractRawDetails(input);
    // print("[COST_DIVISION_UPDATE] rawDetails=" + rawDetails);

    if (!rawDetails) {
        return {
            success: false,
            message: "Thiếu dữ liệu cập nhật phân bổ chi phí"
        };
    }

    try {
        var data = JSON.parse(rawDetails);
        var id = data.id || "";

        if (!id)
            return { success: false, message: "Thiếu id bản ghi cần cập nhật" };

        if (data.department !== undefined) {
            var deptValidation = validateDepartment(data.department);
            if (!deptValidation.isValid) {
                return {
                    success: false,
                    message:
                            "Mã phòng ban '" +
                            data.department +
                            "' không tồn tại trong danh mục esdDMentity"
                };
            }
            if (data.departmentName === undefined)
                data.departmentName = deptValidation.name;
        }

        if (data.accountNumber !== undefined) {
            var accValidation = validateAccount(data.accountNumber);
            if (!accValidation.isValid) {
                return {
                    success: false,
                    message:
                            "Số tài khoản '" +
                            data.accountNumber +
                            "' không tồn tại trong danh mục esdDMglAccount"
                };
            }
            if (data.accountName === undefined)
                data.accountName = accValidation.accountName;
            if (data.accountType === undefined)
                data.accountType = accValidation.accountType;
        }

        var f = new SCFile("esdHTKTpaymentCostDivision");
        var rcSelect = f.doSelect('id="' + escapeQueryValue(id) + '"');

        if (rcSelect !== RC_SUCCESS) {
            try {
                if (f) f.doClose();
            } catch (e) {}
            return {
                success: false,
                message: "Không tìm thấy bản ghi cần sửa với id: " + id
            };
        }

        var targetDept =
                data.department !== undefined ? data.department : f["department"];
        var targetTransCode =
                data.transactionCode !== undefined
                        ? data.transactionCode
                        : f["transaction.code"];
        var targetVendorId =
                data.vendorId !== undefined ? data.vendorId : f["vendor.id"];
        var paymentId = f["payment.id"];

        if (targetDept && paymentId) {
            var fDup = new SCFile("esdHTKTpaymentCostDivision");
            var dupQuery =
                    'payment.id="' +
                    escapeQueryValue(paymentId) +
                    '" and department="' +
                    escapeQueryValue(targetDept) +
                    '" and transaction.code="' +
                    escapeQueryValue(targetTransCode || "") +
                    '" and id!="' +
                    escapeQueryValue(id) +
                    '"';
            if (targetVendorId) {
                dupQuery += ' and vendor.id="' + escapeQueryValue(targetVendorId) + '"';
            }
            var rcDup = fDup.doSelect(dupQuery);

            if (rcDup === RC_SUCCESS) {
                if (data.vendorId !== undefined) fDup["vendor.id"] = data.vendorId;
                if (data.department !== undefined)
                    fDup["department"] = data.department;
                if (data.departmentName !== undefined)
                    fDup["department.name"] = data.departmentName;
                if (data.accountNumber !== undefined)
                    fDup["account.number"] = data.accountNumber;
                if (data.accountName !== undefined)
                    fDup["account.name"] = data.accountName;
                if (data.accountType !== undefined)
                    fDup["account.type"] = data.accountType;
                if (data.amount !== undefined) fDup["amount"] = Number(data.amount);

                if (data.unitId !== undefined) fDup["unit.id"] = data.unitId;
                if (data.unitName !== undefined) fDup["unit.name"] = data.unitName;
                if (data.transactionCode !== undefined)
                    fDup["transaction.code"] = data.transactionCode;
                if (data.transactionName !== undefined)
                    fDup["transaction.name"] = data.transactionName;

                var rcUpdateDup = fDup.doUpdate();
                f.doDelete();

                try {
                    if (f) f.doClose();
                    if (fDup) fDup.doClose();
                } catch (e) {}

                if (rcUpdateDup === RC_SUCCESS) {
                    return {
                        success: true,
                        message: "Cập nhật và ghi đè bản ghi trùng thành công"
                    };
                } else {
                    return {
                        success: false,
                        message: "Ghi đè thất bại. Mã lỗi dịch vụ: " + rcUpdateDup
                    };
                }
            }
            try {
                if (fDup) fDup.doClose();
            } catch (e) {}
        }

        if (data.vendorId !== undefined) f["vendor.id"] = data.vendorId;
        if (data.department !== undefined) f["department"] = data.department;
        if (data.departmentName !== undefined)
            f["department.name"] = data.departmentName;
        if (data.accountNumber !== undefined)
            f["account.number"] = data.accountNumber;
        if (data.accountName !== undefined) f["account.name"] = data.accountName;
        if (data.accountType !== undefined) f["account.type"] = data.accountType;
        if (data.amount !== undefined) f["amount"] = Number(data.amount);

        if (data.unitId !== undefined) f["unit.id"] = data.unitId;
        if (data.unitName !== undefined) f["unit.name"] = data.unitName;
        if (data.transactionCode !== undefined)
            f["transaction.code"] = data.transactionCode;
        if (data.transactionName !== undefined)
            f["transaction.name"] = data.transactionName;

        var rcUpdate = f.doUpdate();
        try {
            if (f) f.doClose();
        } catch (e) {}

        if (rcUpdate === RC_SUCCESS) {
            return { success: true, message: "Cập nhật phân bổ chi phí thành công" };
        } else {
            return {
                success: false,
                message: "Cập nhật thất bại. Mã lỗi dịch vụ: " + rcUpdate
            };
        }
    } catch (e) {
        // print("[COST_DIVISION_UPDATE] error=" + e.toString());
        return { success: false, message: "Lỗi xử lý cập nhật: " + e.toString() };
    }
}

/**
 * Xóa Phân bổ chi phí
 */
function deleteCostDivision(input) {
    var rawDetails = extractRawDetails(input);
    // print("[COST_DIVISION_DELETE] rawDetails=" + rawDetails);

    if (!rawDetails) {
        return { success: false, message: "Thiếu dữ liệu chi tiết cần xóa" };
    }

    try {
        var dataList = JSON.parse(rawDetails);
        var totalSuccess = 0;
        var totalFailed = 0;
        var results = [];

        for (var i = 0; i < dataList.length; i++) {
            var item = dataList[i];
            var id = item.id || "";

            if (!id) return { success: false, message: "Thiếu id bản ghi cần xóa" };

            var itemVendorId =
                    item.vendorId ||
                    item["vendor.id"] ||
                    item.vendor_id ||
                    item["vendor_id"] ||
                    item.supplierId ||
                    item["supplier.id"] ||
                    "";
            var itemPaymentId =
                    item.paymentId ||
                    item["payment.id"] ||
                    item.payment_id ||
                    "";

            var queryDel = 'id="' + escapeQueryValue(id) + '"';
            if (itemPaymentId) {
                queryDel += ' and payment.id="' + escapeQueryValue(itemPaymentId) + '"';
            }
            if (itemVendorId) {
                queryDel += ' and vendor.id="' + escapeQueryValue(itemVendorId) + '"';
            }

            var f = new SCFile("esdHTKTpaymentCostDivision");
            var rcSelect = f.doSelect(queryDel);

            if (rcSelect === RC_SUCCESS) {
                var rcDelete = f.doDelete();
                try {
                    if (f) f.doClose();
                } catch (e) {}

                if (rcDelete === RC_SUCCESS) {
                    totalSuccess++;
                    results.push({
                        success: true,
                        id: id,
                        message: "Xóa thành công"
                    });
                } else {
                    totalFailed++;
                    results.push({
                        success: false,
                        id: id || "",
                        message: "Thao tác thất bại. Mã lỗi dịch vụ: " + rcDelete
                    });
                }
            } else {
                try {
                    if (f) f.doClose();
                } catch (e) {}
                return {
                    success: false,
                    message:
                            "Không tìm thấy bản ghi cần xóa hoặc bản ghi không thuộc NCC hiện tại (id: " +
                            id +
                            ")"
                };
            }
        }
        return {
            success: totalFailed === 0,
            message:
                    "Đã xử lý " +
                    dataList.length +
                    " bản ghi (" +
                    totalSuccess +
                    " thành công, " +
                    totalFailed +
                    " thất bại)",
            details: results
        };
    } catch (e) {
        // print("[COST_DIVISION_DELETE] error=" + e.toString());
        return { success: false, message: "Lỗi xử lý xóa: " + e.toString() };
    }
}

/**
 * Import: Thêm mới / Ghi đè (update) Phân bổ chi phí theo lô.
 */
function importCostDivision(input) {
    var rawDetails = extractRawDetails(input);
    // print("[COST_DIVISION_IMPORT] rawDetails=" + rawDetails);

    if (!rawDetails) {
        return { success: false, message: "Thiếu dữ liệu phân bổ chi phí" };
    }

    try {
        var parsedData = JSON.parse(rawDetails);
        var dataList = Array.isArray(parsedData.data)
                ? parsedData.data
                : [parsedData.data];
        var paymentId = parsedData.paymentId;

        var creatorUnit = getCreatorAccountingUnit(paymentId);

        if (!creatorUnit.value) {
            return {
                success: false,
                message:
                        "Không xác định được đơn vị kế toán của người tạo phiếu (paymentId: " +
                        paymentId +
                        ")."
            };
        }

        var totalValid = 0;
        var totalInvalid = 0;
        var totalSuccess = 0;
        var totalFailed = 0;
        var totalDuplticate = 0;

        var resultsValidate = [];
        var results = [];

        var duplicateMap = {};

        for (var i = 0; i < dataList.length; i++) {
            var item = dataList[i];

            if (creatorUnit.value !== item.unitId) {
                totalInvalid++;
                results.push({
                    success: false,
                    id: item.id,
                    message: "Không có quyền tạo đơn vị khác"
                });
                continue;
            }

            var itemResult = validateSingleCostDivision(item);

            if (!itemResult.success) {
                totalInvalid++;
                results.push(itemResult);
                continue;
            }

            var key =
                    item.paymentId + "|" +
                    (item.vendorId || "") + "|" +
                    item.department + "|" +
                    item.transactionCode + "|" +
                    item.unitId + "|" +
                    item.accountNumber;

            if (duplicateMap[key]) {
                totalDuplticate++;
                results.push({
                    success: true,
                    isDuplicate: true,
                    id: item.id,
                    message: "Trùng dữ liệu trong file import"
                });
                continue;
            }

            duplicateMap[key] = true;

            if (itemResult.isDuplicate) {
                totalDuplticate++;
            } else {
                totalValid++;
            }
            resultsValidate.push({
                index: i,
                dataValid: itemResult.data
            });

            results.push(itemResult);
        }

        if (totalInvalid > 0) {
            return {
                success: false,
                message: totalInvalid + " bản ghi ko hợp lệ.",
                details: results
            };
        }

        for (var j = 0; j < resultsValidate.length; j++) {
            var itemSave = saveSingleCostDivision(resultsValidate[j].dataValid);
            if (!itemSave.success) {
                totalFailed++;
            } else {
                totalSuccess++;
            }
            results[resultsValidate[j].index] = itemSave;
        }

        return {
            success: totalFailed === 0,
            message: totalFailed === 0 ? totalFailed + " bản ghi thất bại" : "import thành công",
            details: results
        };
    } catch (e) {
        // print("[COST_DIVISION_IMPORT] error=" + e.toString());
        return {
            success: false,
            message: "Lỗi định dạng JSON dữ liệu đầu vào: " + e.toString()
        };
    }
}

/**
 * Lưu 1 bản ghi từ luồng import
 */
function saveSingleCostDivision(data) {
    var f = new SCFile("esdHTKTpaymentCostDivision");
    var isUpdate = false;

    if (data.id) {
        var rcSelect = f.doSelect('id="' + escapeQueryValue(data.id) + '"');
        isUpdate = rcSelect === RC_SUCCESS;
    }

    if (data.id) f["id"] = data.id;
    f["payment.id"] = data.paymentId;
    f["vendor.id"] = data.vendorId || "";
    f["entry.type"] = data.entryType || "";

    f["account.number"] = data.accountNumber || "";
    f["account.name"] = data.accountName || "";
    f["account.type"] = data.accountType || "";

    f["department"] = data.department;
    f["department.name"] = data.departmentName;

    f["amount"] = Number(data.amount || 0);

    f["unit.id"] = data.unitId;
    f["unit.name"] = data.unitName;
    f["transaction.code"] = data.transactionCode;
    f["transaction.name"] = data.transactionName;

    var rc = isUpdate ? f.doUpdate() : f.doInsert();

    try {
        if (f) f.doClose();
    } catch (e) {}

    if (rc === true || rc === RC_SUCCESS) {
        return {
            success: true,
            id: data.id,
            isDuplicate: isUpdate,
            message: isUpdate ? "Đã ghi đè bản ghi trùng thành công" : "Thêm mới thành công"
        };
    } else {
        return {
            success: false,
            id: data.id || "",
            message: "Thao tác thất bại. Mã lỗi dịch vụ: " + rc
        };
    }
}

/**
 * =========================================================================
 * 3. CÁC HÀM TIỆN ÍCH (HELPER FUNCTIONS)
 * =========================================================================
 */
/**
 * Validate phòng ban (Sửa lỗi khai báo biến queryUnitId)
 */
function validateDepartment(deptCode, unitId) {
    if (!deptCode) return { isValid: false, name: "" };

    if (deptCode === "000000") return { isValid: true, name: "Không xác định"}

    var fEntity = new SCFile("esdDMcostCenter", SCFILE_READONLY);
    var rc = fEntity.doSelect('cost.center="' + escapeQueryValue(deptCode) + '" and status="ACTIVE"');

    var isValid = rc === RC_SUCCESS;
    var name = isValid ? fEntity["name"] || "" : "";
    var orgCode = isValid ? safeString(fEntity["org.code"]).trim() : "";

    try {
        if (fEntity) fEntity.doClose();
    } catch (e) {}

    if (isValid && unitId) {
        var xxx = safeString(unitId).substring(2, 5); // Tách xxx từ 10xxx98
        var startsWith3 = orgCode.charAt(0) === '3';
        if (xxx === "100") {
            if (startsWith3) isValid = false;
        } else {
            if (!startsWith3) isValid = false;
        }
    }

    return { isValid: isValid, name: name };
}

/**
 * Validate đơn vị
 */
function validateUnit(unitId) {
    if (!unitId) return { isValid: false, branchName: "" };

    if (unitId === "000000") return { isValid: true, branchName: "000000 - Không xác định"}

    var fEntity = new SCFile("esdDMentity", SCFILE_READONLY);
    var rc = fEntity.doSelect('entity.code="' + escapeQueryValue(unitId) + '"');

    var isValid = rc === RC_SUCCESS;
    var branchName = isValid ? fEntity["branch.name"] || "" : "";

    try {
        if (fEntity) fEntity.doClose();
    } catch (e) {}

    return { isValid: isValid, branchName: branchName };
}

/**
 * Validate phòng giao dịch
 */
function validateTransactionOffice(transactionCode, unitId) {
    if (!transactionCode) return { isValid: false, branchName: "" };

//    if (transactionCode === "000000" || transactionCode === "0000000") return { isValid: true, branchName: "Không xác định" };
    if (transactionCode === "0000000") return { isValid: true, branchName: "Không xác định" };

    var prefix = getUnitPrefix5(unitId);
    if (!prefix) return { isValid: false, branchName: "" };

    if (transactionCode.length !== 7 || transactionCode.substring(0, 5) !== prefix || transactionCode.slice(-2) === "98") {
        return { isValid: false, branchName: "" };
    }

    var fEntity = new SCFile("esdDMentity", SCFILE_READONLY);
    var rc = fEntity.doSelect(
            'entity.code="' + escapeQueryValue(transactionCode) + '" and status="' + escapeQueryValue(ENTITY_STATUS_ACTIVE) + '"'
    );
    var isValid = rc === RC_SUCCESS;
    var branchName = isValid ? getTransFromNamePrefix(readText(fEntity, "branch.name")) : "";

    try {
        if (fEntity) fEntity.doClose();
    } catch (e) {}

    return { isValid: isValid, branchName: branchName };
}

/**
 * Validate tài khoản
 */
function validateAccount(accountNum) {
    if (!accountNum) return { isValid: false, accountName: "", accountType: "" };

    var fAccount = new SCFile("esdDMglAccount", SCFILE_READONLY);
    var rc = fAccount.doSelect('account="' + escapeQueryValue(accountNum) + '"');

    var isValid = rc === RC_SUCCESS;
    var accountName = isValid ? fAccount["name"] || "" : "";
    var accountType = isValid ? fAccount["account.type"] || "" : "";

    try {
        if (fAccount) fAccount.doClose();
    } catch (e) {}

    return {
        isValid: isValid,
        accountName: accountName,
        accountType: accountType
    };
}

/**
 * Validate record Phân chia chi phí - dùng cho luồng IMPORT.
 */
function validateSingleCostDivision(data) {
    var unitId = data.unitId || "";
    if (!unitId) {
        return {
            success: false,
            id: data.id || "",
            message: "Mã đơn vị (unitId) không được để trống"
        };
    }
    var unitValidation = validateUnit(unitId);
    if (!unitValidation.isValid) {
        return {
            success: false,
            id: data.id || "",
            message:
                    "Mã đơn vị '" + unitId + "' không tồn tại trong danh mục esdDMentity"
        };
    }

    var deptCode = data.department || "";
    if (!deptCode) {
        return {
            success: false,
            id: data.id || "",
            message: "Mã phòng ban (department) không được để trống"
        };
    }
    var deptValidation = validateDepartment(deptCode, unitId);
    if (!deptValidation.isValid) {
        return {
            success: false,
            id: data.id || "",
            message:
                    "Mã phòng ban '" +
                    deptCode +
                    "' không tồn tại trong danh mục esdDMcostCenter với mã đơn vị là " +
                    unitId
        };
    }

    var transCode = data.transactionCode || "";
    if (!transCode) {
        return {
            success: false,
            id: data.id || "",
            message: "Mã phòng giao dịch (transactionCode) không được để trống"
        };
    }
    var transactionValidation = validateTransactionOffice(transCode, unitId);
    if (!transactionValidation.isValid) {
        return {
            success: false,
            id: data.id || "",
            message:
                    "Mã phòng giao dịch '" +
                    transCode +
                    "' không tồn tại trong danh mục esdDMentity với mã đơn vị là " +
                    unitId
        };
    }

    var accountNum = data.accountNumber || "";
    var accValidation = validateAccount(accountNum);
    if (!accValidation.isValid && accountNum) {
        return {
            success: false,
            id: data.id || "",
            message:
                    "Số tài khoản '" +
                    accountNum +
                    "' không tồn tại trong danh mục esdDMglAccount"
        };
    }

    var paymentId = data.paymentId || data["payment.id"] || data.payment_id || "";
    var itemVendorId =
            data.vendorId ||
            data["vendor.id"] ||
            data.vendor_id ||
            data["vendor_id"] ||
            data.supplierId ||
            data["supplier.id"] ||
            "";
    var f = new SCFile("esdHTKTpaymentCostDivision", SCFILE_READONLY);
    var existingId = "";

    if (data.id) {
        var rcSelectById = f.doSelect('id="' + escapeQueryValue(data.id) + '"');
        if (rcSelectById === RC_SUCCESS) {
            existingId = f["id"];
        }
    }

    if (!existingId) {
        var query =
                'payment.id="' +
                escapeQueryValue(paymentId) +
                '" and department="' +
                escapeQueryValue(deptCode) +
                '" and transaction.code="' +
                escapeQueryValue(transCode) +
                '" and unit.id="' +
                escapeQueryValue(unitId) +
                '" and account.number="' +
                escapeQueryValue(accountNum) +
                '"';
        if (itemVendorId) {
            query += ' and vendor.id="' + escapeQueryValue(itemVendorId) + '"';
        }
        var rcSelect = f.doSelect(query);
        if (rcSelect === RC_SUCCESS) {
            existingId = f["id"];
        }
    }

    try {
        f.doClose();
    } catch (e) {}

    var isDuplicate = !!existingId;

    var resultData = {
        accountName: accValidation.accountName,
        accountType: accValidation.accountType,
        departmentName: deptValidation.name,
        unitName: getUnitFromBranchNamePrefix(unitValidation.branchName),
        transactionName:
                getTransFromNamePrefix(transactionValidation.branchName) || "",
        accountNumber: accountNum,
        unitId: unitId,
        amount: Number(data.amount || 0),
        department: deptCode,
        transactionCode: transCode,
        paymentId: paymentId,
        vendorId: itemVendorId,
        entryType: data.entryType || "",
        id: isDuplicate ? existingId : data.id || ""
    };

    return {
        success: true,
        isDuplicate: isDuplicate,
        data: resultData,
        message: !accountNum || !resultData.amount
                ? "Thông tin chưa đầy đủ, vui lòng bổ sung"
                : ""
    };
}

function processSingleCostDivision(data) {
    var unitId = data.unitId || "";
    if (!unitId) {
        return {
            success: false,
            id: data.id || "",
            message: "Mã đơn vị (unitId) không được để trống"
        };
    }
    var unitValidation = validateUnit(unitId);
    if (!unitValidation.isValid) {
        return {
            success: false,
            id: data.id || "",
            message:
                    "Mã đơn vị '" + unitId + "' không tồn tại trong danh mục esdDMentity"
        };
    }

    var deptCode = data.department || "";
    if (!deptCode) {
        return {
            success: false,
            id: data.id || "",
            message: "Mã phòng ban (department) không được để trống"
        };
    }
    var deptValidation = validateDepartment(deptCode, unitId);
    if (!deptValidation.isValid) {
        return {
            success: false,
            id: data.id || "",
            message:
                    "Mã phòng ban '" +
                    deptCode +
                    "' không tồn tại trong danh mục esdDMcostCenter với mã đơn vị là " +
                    unitId
        };
    }

    var transCode = data.transactionCode || "";
    if (!transCode) {
        return {
            success: false,
            id: data.id || "",
            message: "Mã phòng giao dịch (transactionCode) không được để trống"
        };
    }
    var transactionValidation = validateTransactionOffice(transCode, unitId);
    if (!transactionValidation.isValid) {
        return {
            success: false,
            id: data.id || "",
            message:
                    "Mã phòng giao dịch '" +
                    transCode +
                    "' không tồn tại trong danh mục esdDMentity với mã đơn vị là " +
                    unitId
        };
    }

    var accountNum = data.accountNumber || "";
    var accValidation = validateAccount(accountNum);
    if (!accValidation.isValid && accountNum) {
        return {
            success: false,
            id: data.id || "",
            message:
                    "Số tài khoản '" +
                    accountNum +
                    "' không tồn tại trong danh mục esdDMglAccount"
        };
    }

    var paymentId = data.paymentId || data["payment.id"] || data.payment_id || "";
    var itemVendorId =
            data.vendorId ||
            data["vendor.id"] ||
            data.vendor_id ||
            data["vendor_id"] ||
            data.supplierId ||
            data["supplier.id"] ||
            "";
    var originalId = data.id || "";

    var originalExists = false;
    if (originalId) {
        var fOriginal = new SCFile("esdHTKTpaymentCostDivision", SCFILE_READONLY);
        var rcOriginal = fOriginal.doSelect(
                'id="' + escapeQueryValue(originalId) + '"'
        );
        originalExists = rcOriginal === RC_SUCCESS;
        try {
            fOriginal.doClose();
        } catch (e) {}
    }

    var isDuplicate = false;
    var duplicateId = "";
    if (paymentId && deptCode && unitId && transCode) {
        var fCheck = new SCFile("esdHTKTpaymentCostDivision", SCFILE_READONLY);
        var queryDup =
                'payment.id="' +
                escapeQueryValue(paymentId) +
                '" and department="' +
                escapeQueryValue(deptCode) +
                '" and transaction.code="' +
                escapeQueryValue(transCode) +
                '" and unit.id="' +
                escapeQueryValue(unitId) +
                '" and account.number="' +
                escapeQueryValue(accountNum) +
                '"';
        if (itemVendorId) {
            queryDup += ' and vendor.id="' + escapeQueryValue(itemVendorId) + '"';
        }
        var rcDup = fCheck.doSelect(queryDup);
        if (rcDup === RC_SUCCESS && (!originalId || fCheck.id != originalId)) {
            isDuplicate = true;
            duplicateId = fCheck.id;
        }
        try {
            fCheck.doClose();
        } catch (e) {}
    }

    if (isDuplicate) {
        var fUpdateB = new SCFile("esdHTKTpaymentCostDivision");
        var rcSelectB = fUpdateB.doSelect(
                'id="' + escapeQueryValue(duplicateId) + '"'
        );

        if (rcSelectB !== RC_SUCCESS) {
            try {
                fUpdateB.doClose();
            } catch (e) {}
            return {
                success: false,
                id: duplicateId,
                message: "Không thể chọn lại bản ghi trùng " + duplicateId + " để ghi đè"
            };
        }

        fUpdateB["payment.id"] = paymentId;
        fUpdateB["vendor.id"] = itemVendorId || fUpdateB["vendor.id"] || "";
        fUpdateB["entry.type"] = data.entryType || fUpdateB["entry.type"] || "";
        fUpdateB["account.number"] = accountNum;
        fUpdateB["account.name"] = data.accountName || accValidation.accountName;
        fUpdateB["account.type"] = data.accountType || accValidation.accountType;
        fUpdateB["department"] = deptCode;
        fUpdateB["department.name"] = data.departmentName || deptValidation.name;
        fUpdateB["amount"] = Number(data.amount || 0);
        fUpdateB["unit.id"] = unitId;
        fUpdateB["unit.name"] = data.unitName || unitValidation.branchName;
        fUpdateB["transaction.code"] = transCode;
        fUpdateB["transaction.name"] =
                data.transactionName || transactionValidation.branchName;

        var rcUpdateB = fUpdateB.doUpdate();
        try {
            fUpdateB.doClose();
        } catch (e) {}

        if (rcUpdateB !== true && rcUpdateB !== RC_SUCCESS) {
            return {
                success: false,
                id: duplicateId,
                message: "Ghi đè bản ghi trùng thất bại. Mã lỗi dịch vụ: " + rcUpdateB
            };
        }

        var deletedOriginal = false;
        if (originalExists && originalId && originalId !== duplicateId) {
            var fDeleteA = new SCFile("esdHTKTpaymentCostDivision");
            var rcSelectA = fDeleteA.doSelect(
                    'id="' + escapeQueryValue(originalId) + '"'
            );
            if (rcSelectA === RC_SUCCESS) {
                var rcDeleteA = fDeleteA.doDelete();
                deletedOriginal = rcDeleteA === RC_SUCCESS;
            }
            try {
                fDeleteA.doClose();
            } catch (e) {}
        }

        return {
            success: true,
            id: duplicateId,
            isDuplicate: true,
            deletedOriginalId: deletedOriginal ? originalId : "",
            message: deletedOriginal
                    ? "Dữ liệu đã tồn tại - đã ghi đè bản ghi " +
                    duplicateId +
                    " và xóa bản ghi trùng cũ " +
                    originalId
                    : "Dữ liệu đơn vị/phòng ban/phòng giao dịch đã tồn tại - đã ghi đè bản ghi " +
                    duplicateId
        };
    }

    var f = new SCFile("esdHTKTpaymentCostDivision");
    var isOverwrite = false;

    if (originalId) {
        var rcSelect = f.doSelect('id="' + escapeQueryValue(originalId) + '"');
        isOverwrite = rcSelect === RC_SUCCESS;
    }

    if (originalId) f["id"] = originalId;
    f["payment.id"] = paymentId;
    f["vendor.id"] = itemVendorId || f["vendor.id"] || "";
    f["entry.type"] = data.entryType || f["entry.type"] || "";
    f["account.number"] = accountNum;
    f["account.name"] = data.accountName || accValidation.accountName;
    f["account.type"] = data.accountType || accValidation.accountType;
    f["department"] = deptCode;
    f["department.name"] = data.departmentName || deptValidation.name;
    f["amount"] = Number(data.amount || 0);
    f["unit.id"] = unitId;
    f["unit.name"] = data.unitName || unitValidation.branchName;
    f["transaction.code"] = transCode;
    f["transaction.name"] =
            data.transactionName || transactionValidation.branchName;

    var rc = isOverwrite ? f.doUpdate() : f.doInsert();
    var recordId = f["id"];

    try {
        f.doClose();
    } catch (e) {}

    if (rc === true || rc === RC_SUCCESS) {
        return {
            success: true,
            id: recordId,
            isDuplicate: false,
            message: isOverwrite ? "Cập nhật bản ghi thành công" : "Thêm mới thành công",
            warning:
                    !accountNum || !data.amount
                            ? "Thông tin chưa đầy đủ, vui lòng bổ sung"
                            : ""
        };
    } else {
        return {
            success: false,
            id: recordId || originalId || "",
            message: "Thao tác thất bại. Mã lỗi dịch vụ: " + rc
        };
    }
}

function extractRawDetails(input) {
    if (
            input.esdHTKTpaymentCostDivision &&
            input.esdHTKTpaymentCostDivision.details
    ) {
        return input.esdHTKTpaymentCostDivision.details;
    } else if (input.details) {
        return input.details;
    } else if (input.queryString) {
        try {
            var parsedQuery = JSON.parse(input.queryString);
            if (
                    parsedQuery.esdHTKTpaymentCostDivision &&
                    parsedQuery.esdHTKTpaymentCostDivision.details
            ) {
                return parsedQuery.esdHTKTpaymentCostDivision.details;
            }
            return parsedQuery.details || input.queryString;
        } catch (e) {
            return input.queryString;
        }
    }
    return "";
}

function mapRowToObject(scFileRecord, fieldMappings) {
    var item = {};
    for (var j = 0; j < fieldMappings.length; j++) {
        var fieldName = fieldMappings[j][0];
        var jsonKey = fieldMappings[j][1];
        var dataType = fieldMappings[j][2];
        var dbValue = scFileRecord[fieldName];

        if (dataType === "N") {
            item[jsonKey] = dbValue ? Number(dbValue) : 0;
        } else if (dataType === "D") {
            item[jsonKey] = dbValue
                    ? dbValue.toISOString
                            ? dbValue.toISOString()
                            : String(dbValue)
                    : "";
        } else {
            item[jsonKey] = dbValue ? String(dbValue) : "";
        }
    }
    return item;
}

function compareGlUnitOption(left, right) {
    var leftCode = safeString(left.entityCode);
    var rightCode = safeString(right.entityCode);

    if (leftCode < rightCode) return -1;
    if (leftCode > rightCode) return 1;
    return 0;
}

function compareTransactionOfficeOption(left, right) {
    var leftPsCode = safeString(left.psCode);
    var rightPsCode = safeString(right.psCode);

    if (leftPsCode < rightPsCode) return -1;
    if (leftPsCode > rightPsCode) return 1;

    var leftValue = safeString(left.value);
    var rightValue = safeString(right.value);
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
    return 0;
}

function selectFields(fields) {
    var items = [];

    for (var i = 0; i < fields.length; i++) {
        items.push(fields[i][0]);
    }

    return items.join(", ");
}

function makeUniqueTextList(values) {
    var map = {};
    var list = [];

    for (var i = 0; i < values.length; i++) {
        var value = safeString(values[i]).trim();
        if (!value || map[value]) continue;

        map[value] = true;
        list.push(value);
    }

    return list;
}

function escapeQueryValue(value) {
    return safeString(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function readText(record, fieldName) {
    var value = readField(record, fieldName);
    return value === null || value === undefined ? "" : safeString(value);
}

function readNumber(record, fieldName) {
    return toNumber(readField(record, fieldName));
}

function readField(record, fieldName) {
    try {
        return record[fieldName];
    } catch (e) {
        return null;
    }
}

function toNumber(value) {
    if (value === null || value === undefined || value === "") return 0;
    var numberValue = Number(
            String(value).replace(/,/g, "").replace(/%/g, "").trim()
    );
    return isNaN(numberValue) ? 0 : numberValue;
}

function safeString(value) {
    if (value === null || value === undefined) return "";
    return String(value);
}

function selectOne(tableName, query, mapper) {
    var f;
    var rc;

    try {
        f = new SCFile(tableName, SCFILE_READONLY);
        rc = f.doSelect(query);
    } catch (e) {
        closeFile(f);
        return null;
    }

    var result = rc === RC_SUCCESS ? mapper(f) : null;
    closeFile(f);
    return result;
}

function closeFile(file) {
    try {
        if (file) file.doClose();
    } catch (e) {}
}

function normalizeGlBranchCode(value) {
    var branchCode = safeString(value).replace(/\s+/g, "").trim();

    if (!/^[0-9]+$/.test(branchCode)) return "";

    while (branchCode.length > 3 && branchCode.charAt(0) === "0") {
        branchCode = branchCode.substring(1);
    }

    if (branchCode.length > 3) return "";

    while (branchCode.length < 3) {
        branchCode = "0" + branchCode;
    }

    return branchCode;
}

function getUnitFromBranchNamePrefix(value) {
    var text = safeString(value).trim();
    var separatorIndex = text.indexOf("-");
    return (
            separatorIndex >= 0 ? text.substring(0, separatorIndex) : text
    ).trim();
}

function getTransFromNamePrefix(value) {
    var text = safeString(value).trim();

    var separatorIndex = text.indexOf("-");

    return (
            separatorIndex >= 0 ? text.substring(separatorIndex + 1) : text
    ).trim();
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function getUnitPrefix5(unitId) {
    var code = safeString(unitId).trim();
    if (!code) return "";
    if (code.length >= 5 && code.substring(0, 2) === "10") {
        return code.substring(0, 5);
    }
    if (code.length === 3) {
        return "10" + code;
    }
    if (code.length === 4) {
        return "10" + code.slice(-3);
    }
    return "";
}

function getUnitXxx(unitId) {
    var prefix = getUnitPrefix5(unitId);
    return prefix ? prefix.substring(2, 5) : "";
}

function getBranchCodeFromEntityCode(value) {
    var code = safeString(value).trim();
    if (code.length >= 5 && code.substring(0, 2) === "10") {
        return code.slice(1, -2);
    }
    if (code.length === 3) {
        return "0" + code;
    }
    if (code.length === 4) {
        return code;
    }
    return code;
}

function getPaymentRequest(paymentId) {
    if (!paymentId) return {};

    return (
            selectOne(
                    TABLE_PAYMENT,
                    'id="' + escapeQueryValue(paymentId) + '"',
                    function (record) {
                        return {
                            id: readText(record, "id"),
                            department: readText(record, "department"),
                            description: readText(record, "description"),
                            current_phase: readText(record, "current.phase"),
                            user_checker_kttc: readText(record, "user.checker.kttc"),
                            initial_role: readText(record, "initial.role"),
                            created_by: readText(record, "created.by"),
                            total_advance_amount: readNumber(record, "total.advance.amount"),
                            total_amount_paid: readNumber(record, "total.amount.paid"),
                            total_refund_amount: readNumber(record, "total.refund.amount"),
                            currency: readText(record, "currentcy")
                        };
                    }
            ) || {}
    );
}

function getBranchNamePrefix(value) {
    var text = safeString(value).trim();
    var index = text.indexOf("-");
    return (index >= 0 ? text.substring(0, index) : text).trim();
}

function removeFirstLeadingZero(value) {
    var text = safeString(value).trim();
    return text.charAt(0) === "0" ? text.substring(1) : text;
}
