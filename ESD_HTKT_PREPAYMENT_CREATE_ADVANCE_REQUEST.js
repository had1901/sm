var createActivity = lib.ESD_Utils.createActivity;

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
            case 'createAdvanceRequest':
                result = createAdvanceRequest(input);
                break;
            case 'listPurchaseContracts':
                listPurchaseContracts(input);
                break;
            case 'listFileAttachment':
                listFileAttachment(input);
                break;

            default:
                result = { success: false, message: "Hành động (name) không hợp lệ: " + name };
        }

        // Ép kiểu chuỗi JSON 
        input.queryReturn = JSON.stringify(result);

    } catch (e) {
        if (vars['$L.file']) {
            vars['$L.file'].queryReturn = JSON.stringify({ success: false, error: 'Gateway Error: ' + e.toString() });
        }
    }
}

function createAdvanceRequest(input) {
    try {
        var rawData = input.queryString;
        if (!rawData) return { success: false, message: "Thiếu dữ liệu." };

        var contractList = JSON.parse(rawData);
        var contractData = contractList[0];


        // =========================================================================
        // BỔ SUNG: Tính toán động số tiền còn lại của hợp đồng trước khi tạo phiếu
        // =========================================================================
        var contractId = contractData['id'];

        if (contractId) {
            try {
                // 1. TỔNG GIÁ TRỊ ĐÃ TẠM ỨNG
                var totalPrepayment = "0";
                var prepaymentFile = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
                var sqlPrepayment = 'contract.id="' + contractId + '" and (status="approved" or status="accounted")';

                if (prepaymentFile.doSelect(sqlPrepayment) === RC_SUCCESS) {
                    do {
                        var prepaymentVendorFile = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
                        if (prepaymentVendorFile.doSelect('prepayment.id="' + prepaymentFile.id + '"') === RC_SUCCESS) {
                            do {
                                // Đảm bảo amount không bị rỗng/null để thư viện cộng chuỗi không báo lỗi
                                var vendorAmt = prepaymentVendorFile.amount ? String(prepaymentVendorFile.amount) : "0";
                                totalPrepayment = lib.ESD_HTKT_Utils.addStringsManual(totalPrepayment, vendorAmt);

                            } while (prepaymentVendorFile.getNext() === RC_SUCCESS);
                        }
                        prepaymentVendorFile.doClose();

                    } while (prepaymentFile.getNext() === RC_SUCCESS);
                }
                prepaymentFile.doClose();

                // 2. TỔNG GIÁ TRỊ ĐÃ THANH TOÁN
                var totalPayment = "0";
                var paymentFile = new SCFile("esdHTKTpayment", SCFILE_READONLY);
                var sqlPayment = 'contract.id="' + contractId + '" and (status="approved" or status="accounted")';
                if (paymentFile.doSelect(sqlPayment) === RC_SUCCESS) {
                    do {
                        totalPayment =
                            lib.ESD_HTKT_Utils.addStringsManual(
                                totalPayment,
                                paymentFile["total.amount.paid"]
                            );
                    } while (paymentFile.getNext() === RC_SUCCESS);
                }
                paymentFile.doClose();
                // 3. GIÁ TRỊ HĐ/KMS CÒN LẠI
                var currentContractAmount = String(contractData['totalValue'] || contractData['contract.amount'] || "0");

                var remainingContractValue = lib.ESD_HTKT_Utils.subtractStringsManual(currentContractAmount, totalPrepayment);
                remainingContractValue = lib.ESD_HTKT_Utils.subtractStringsManual(remainingContractValue, totalPayment);

                // 4. KIỂM TRA CHẶN
                // Ép kiểu về số để kiểm tra <= 0
                if (Number(remainingContractValue) <= 0) {
                    return {
                        success: false,
                        message: "Tổng giá trị HĐ/KMS còn lại của hợp đồng đã về 0. Không thể tạo thêm phiếu tạm ứng mới."
                    };
                }

            } catch (eCalc) {
                return {
                    success: false,
                    message: "Lỗi hệ thống khi tính toán số dư hợp đồng: " + eCalc.toString()
                };
            }
        }
        // =========================================================================
        // =========================================================================
        // =========================================================================
        /*
         * HTKT PREPAYMENT CURRENT USER
         */
        var currentUser = htktCreatePrepay_resolveCurrentUser(contractData);

        if (!currentUser) {
            return {
                success: false,
                message: "Không xác định được người tạo phiếu tạm ứng."
            };
        }

        contractData["currentUser"] = currentUser;
        contractData["user"] = currentUser;
        contractData["createdBy"] = currentUser;

        var rawDepartment = contractData['unitLv1'] || contractData['unitLv2'] || contractData['unitLv3'];

        var entityInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(rawDepartment);

        // 2. Lấy giá trị oglBranchCode từ Object trả về
        var oglBranchCode = (entityInfo && entityInfo.oglBranchCode) ? String(entityInfo.oglBranchCode).replace(/^0+/, '') : '';

        // 3. Lấy branchCode (nếu oglBranchCode rỗng thì lấy mặc định "100")
        var branchCode = oglBranchCode;

        if (!branchCode) {
            return {
                success: false,
                message: "Yêu cầu cấu hình đơn vị theo user"
            };
        }

        var docType = "TU";


        var prepaymentRec = new SCFile("esdHTKTprepayment");

        var newPrepaymentId = generateDocumentCode(docType, branchCode);

        // Map dữ liệu
        mapPrepaymentRecord(prepaymentRec, contractData, newPrepaymentId);

        /*
         * HTKT PREPAYMENT AUTO ACTIVITY -Hanh Code 
         */
        var returnCode;
        var previousSkipAutoPrepaymentActivity = htktCreatePrepay_normalizeValue(
            vars["$L.skipAutoPrepaymentActivity"]
        );

        try {
            vars["$L.skipAutoPrepaymentActivity"] = "true";
            returnCode = prepaymentRec.doAction("add");
        } finally {
            /*
             * Khôi phục giá trị cũ để không ảnh hưởng các xử lý tiếp theo
             */
            vars["$L.skipAutoPrepaymentActivity"] = previousSkipAutoPrepaymentActivity;
        }

        if (returnCode == RC_SUCCESS) {
            /*
             * Lưu lịch sử với operator là user thật.
             */
            createActivity(
                "activityHTKTprepayment",
                'Thêm mới Đề nghị Tạm ứng: Mã đề nghị: "' +
                prepaymentRec["id"] +
                '"',
                prepaymentRec["id"],
                "Thêm mới",
                currentUser
            );

            //Đồng bộ giá trị Tạm ứng/Thanh toán giữa Squad 6 và Squad 2
            try {
                lib.ESD_HD_Integration.createContractPayment(prepaymentRec);
            } catch (ex) {
                print("[ERROR] Đồng bộ createContractPayment thất bại cho ID: " + prepaymentRec["id"] + " | Detail: " + ex);
            }


            return {
                success: true,
                message: "Thêm đề nghị tạm ứng thành công.",
                id: prepaymentRec['id']
            };
        } else {
            return {
                success: false,
                message: "Lỗi ghi nhận vào Database esdHTKTprepayment. Code: " + returnCode
            };
        }

    } catch (error) {

        return { success: false, message: "Lỗi thực thi createAdvanceRequest: " + error.toString() };
    }
}

function mapPrepaymentRecord(prepaymentRec, contractData, prepaymentId) {

    // Để null để hệ thống tự động tăng ID khi insert
    prepaymentRec['id'] = prepaymentId;

    // 4. Map riêng biệt chi tiết từng trường một từ JSON vào Record
    prepaymentRec['transaction.type'] = "Tạm ứng";
    prepaymentRec['department'] =
        contractData['unitLv3'] ||
        contractData['unitLv2'] ||
        contractData['unitLv1'] ||
        "";

    prepaymentRec['description'] = "";

    prepaymentRec['require.check.level1'] = false;
    prepaymentRec['require.check.level2'] = false;
    prepaymentRec['user.checker.kttc'] = "";
    prepaymentRec['user.checker.dmms'] = "";
    prepaymentRec['user.approver.dmms'] = "";
    prepaymentRec['user.approver.kttc'] = "";
    prepaymentRec['user.checker.final'] = "";
    prepaymentRec['user.approver.final'] = "";
    prepaymentRec['return.reason'] = "";
    prepaymentRec['unit.lv1'] = contractData['unitLv1'] || "";
    prepaymentRec['unit.lv2'] = contractData['unitLv2'] || "";

    prepaymentRec['created.at'] = new Date();
    prepaymentRec['created.by'] = contractData['createdBy'];
    prepaymentRec['currency'] = "VND";
    prepaymentRec['contract.amount'] = contractData['totalValue'] || 0;
    prepaymentRec['contract.id'] = contractData['id'];
    prepaymentRec['contract.name'] = contractData['name'];
    prepaymentRec['current.phase'] = "start";
    prepaymentRec['executor'] = contractData['currentUser'];


    /*
     * HTKT PREPAYMENT - Hoàng Anh sửa đoạn này
     *
     * Bỏ hard-code:
     * - 099922000 => dmms
     * - 099917000 => kttc
     *
     * Quy tắc mới:
     * - Tạo mới phiếu tạm ứng vẫn được chọn HĐ/KMS của Khối/CN/ĐVSN khác.
     * - Vì vậy KHÔNG chặn theo unit.lv1 của hợp đồng tại bước tạo mới.
     * - Chỉ xác định initial.role/status theo quyền của người tạo.
     * - Phân quyền theo lv1 sẽ kiểm soát ở bước phân giao/phê duyệt combobox.
     */
    var creatorUser = htktCreatePrepay_resolveCurrentUser(
        contractData
    );

    if (!creatorUser) {
        throw new Error("Không xác định được người tạo phiếu tạm ứng.");
    }

    var initialRole = htktCreatePrepay_detectInitialRoleByRights(creatorUser);

    if (initialRole === "kttc") {
        prepaymentRec['status'] = "kttc_created";
        prepaymentRec['initial.role'] = "kttc";
    } else if (initialRole === "dmms") {
        prepaymentRec['status'] = "dmms_created";
        prepaymentRec['initial.role'] = "dmms";
    } else {
        throw new Error(
            "Người tạo " +
            creatorUser +
            " chưa có quyền phù hợp để lập phiếu tạm ứng. Cần quyền lập đề nghị tạm ứng; nếu là KTTC cần thêm quyền nhập liệu hạch toán."
        );
    }

}

function generateDocumentCode(docType, branchCode) {
    var fullYear = new Date().getFullYear();
    var year = ("0" + (fullYear % 100)).slice(-2);
    var numberClass = "esdHTKTprepayment";

    var maxAttempts = 50;
    var attempt = 0;
    var synced = false;

    while (attempt < maxAttempts) {
        attempt++;

        var sequence = getNextSequenceFromSm(numberClass, docType);
        if (sequence === null) {
            // Không gọi được getnumber từ SM -> chuyển sang fallback
            break;
        }

        var candidateId = docType + "." + branchCode + "." + year + "." +
            ("0000000" + sequence).slice(-7);

        if (!checkPrepaymentIdExists(candidateId)) {
            return candidateId;
        }

        print("[WARN generateDocumentCode] Bộ đếm " + numberClass + " cấp mã đã tồn tại: " + candidateId + ". Tiến hành đồng bộ bộ đếm...");

        // Khi phát hiện mã đã tồn tại: quét maxSeq thực tế trong DB và đồng bộ vào bảng number của SM
        if (!synced) {
            synced = true;
            var maxExistingSeq = getMaxExistingPrepaymentSequence(docType, year);
            if (maxExistingSeq >= sequence) {
                syncSmNumberTable(numberClass, maxExistingSeq);
            }
        }
    }

    // Fallback an toàn nếu getnumber bị lỗi hoặc sau vòng lặp vẫn đụng mã trùng:
    var safeSeq = getMaxExistingPrepaymentSequence(docType, year);
    var finalPrepaymentId = "";
    do {
        safeSeq++;
        finalPrepaymentId = docType + "." + branchCode + "." + year + "." +
            ("0000000" + safeSeq).slice(-7);
    } while (checkPrepaymentIdExists(finalPrepaymentId));

    // Đồng bộ lại bộ đếm SM về safeSeq để các lần cấp tiếp theo không bị lệch
    syncSmNumberTable(numberClass, safeSeq);

    return finalPrepaymentId;
}

function getNextSequenceFromSm(numberClass, docType) {
    try {
        var numberRc = new SCDatum();
        numberRc.setValue(-1);
        var nextNumber = new SCDatum();
        system.functions.rtecall(
            "getnumber", numberRc, nextNumber, numberClass
        );

        var rcText = String(numberRc.getText()).replace(/^\s+|\s+$/g, "");
        var rawNumber = String(nextNumber.getText()).replace(/^\s+|\s+$/g, "");

        if (/^"[^"]*"$/.test(rawNumber) || /^'[^']*'$/.test(rawNumber)) {
            rawNumber = rawNumber.substring(1, rawNumber.length - 1);
        }

        if (rawNumber.indexOf(docType) === 0) {
            rawNumber = rawNumber.substring(docType.length);
        }

        if (rcText === "0" && /^\d+$/.test(rawNumber)) {
            var seq = Number(rawNumber);
            if (seq >= 1 && seq <= 9999999) {
                return seq;
            }
        }
    } catch (e) {
        print("[ERROR getNextSequenceFromSm] " + e);
    }
    return null;
}

function checkPrepaymentIdExists(prepaymentId) {
    var existing = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
    try {
        var rc = existing.doSelect('id="' + escapeSmQueryValue(prepaymentId) + '"');
        return rc === RC_SUCCESS;
    } catch (e) {
        return false;
    } finally {
        closeSCFile(existing);
    }
}

function getMaxExistingPrepaymentSequence(docType, year) {
    var maxSeq = 0;
    var file = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
    try {
        var queryPattern = docType + ".*." + year + ".*";
        var query = 'id like "' + queryPattern + '"';
        var rc = file.doSelect(query);

        while (rc == RC_SUCCESS) {
            var currentId = file.id;
            if (currentId) {
                var parts = String(currentId).split(".");
                if (parts.length >= 2) {
                    var seqStr = parts[parts.length - 1];
                    if (/^\d+$/.test(seqStr)) {
                        var seq = parseInt(seqStr, 10);
                        if (!isNaN(seq) && seq > maxSeq) {
                            maxSeq = seq;
                        }
                    }
                }
            }
            rc = file.getNext();
        }
    } catch (e) {
        print("[ERROR getMaxExistingPrepaymentSequence] " + e);
    } finally {
        closeSCFile(file);
    }
    return maxSeq;
}

function syncSmNumberTable(numberClass, targetSeq) {
    try {
        var numFile = new SCFile("number");
        if (numFile.doSelect('name="' + escapeSmQueryValue(numberClass) + '"') === RC_SUCCESS) {
            var currentVal = Number(numFile["number"] || 0);
            if (isNaN(currentVal) || targetSeq > currentVal) {
                numFile["number"] = targetSeq;
                var rcUpdate = numFile.doUpdate();
                print("[INFO syncSmNumberTable] Đồng bộ bộ đếm " + numberClass + " từ " + currentVal + " lên " + targetSeq + " (rc=" + rcUpdate + ")");
            }
        }
        closeSCFile(numFile);
    } catch (eSync) {
        print("[WARN syncSmNumberTable] Không thể cập nhật bảng number: " + eSync);
    }
}

function escapeSmQueryValue(value) {
    return String(value || "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}

function closeSCFile(file) {
    try {
        if (file) file.doClose();
    } catch (ignore) {}
}

//function generateDocumentCode(docType, branchCode) {
//    var now = new Date();
//    var year = (now.getFullYear() % 100).toString();
//    
//    var rawSeq = nextId1("esdHTKTprepayment");
//    var seqStr = ("0000000" + rawSeq).slice(-7);
//    
//    return docType + "." + branchCode + "." + year + "." + seqStr;
//}


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

// =========== Lay het danh sach HD ================
//function listPurchaseContracts(input) {
//
//    // 1. Lấy dữ liệu linh hoạt từ details hoặc queryString
//    var rawData = input ? (input.details || input.queryString) : null;
//    if (!rawData) return { success: false, message: "Thiếu dữ liệu đầu vào." };
//
//    var params = {};
//    try {
//        params = JSON.parse(rawData);
//        if (Array.isArray(params)) {
//            params = params[0] || {};
//        }
//    } catch (e) {
//        return { success: false, message: "Dữ liệu JSON đầu vào không hợp lệ." };
//    }
//
//    /*
//     * HTKT PREPAYMENT CURRENT USER
//     */
//    var currentUser = htktCreatePrepay_resolveCurrentUser(params);
//
//    if (!currentUser) {
//        return {
//            success: false,
//            message: "Không xác định được người tạo phiếu tạm ứng."
//        };
//    }
//
//    var fieldMappings = [
//        ['id', 'id', 'S'],
//        ['name', 'name', 'S'],
//        ['status', 'status', 'S'],
//        ['current.phase', 'current.phase', 'S'],
//        ['created.by', 'created.by', 'S'],
//        ['created.at', 'created.at', 'D'],
//        ['sysmodtime', 'sysmodtime', 'D'],
//        ['sysmoduser', 'sysmoduser', 'S'],
//        ['total.budget', 'total.budget', 'S'],
//        ['is.budgeted', 'is.budgeted', 'B'],
//        ['execution.dependency', 'execution.dependency', 'S'],
//        ['start.date', 'start.date', 'D'],
//        ['execution.duration', 'execution.duration', 'N'],
//        ['expected.end.date', 'expected.end.date', 'D'],
//        ['actual.end.date', 'actual.end.date', 'D'],
//        ['executor.id', 'executor.id', 'S'],
//        ['total.executed.value', 'total.executed.value', 'S'],
//        ['total.unexecuted.value', 'total.unexecuted.value', 'S'],
//        ['total.paid.amount', 'total.paid.amount', 'S'],
//        ['remaining.amount', 'remaining.amount', 'S'],
//        ['category', 'category', 'S'],
//        ['item.id', 'item.id', 'S'],
//        ['item.name', 'item.name', 'S'],
//        ['signed.date', 'signed.date', 'D'],
//        ['total.contract.value', 'total.contract.value', 'S'],
//        ['contract.group', 'contract.group', 'S'],
//        ['contract.value.before.tax', 'contract.value.before.tax', 'S'],
//        ['contract.value.after.tax', 'contract.value.after.tax', 'S'],
//        ['tax.amount', 'tax.amount', 'S'],
//        ['unit.lv1', 'unit.lv1', 'S'],
//        ['unit.lv2', 'unit.lv2', 'S'],
//        ['unit.lv3', 'unit.lv3', 'S'],
//        ['contract.type', 'contract.type', 'S'],
//        ['contract.no', 'contract.no', 'S'],
//        ['signer', 'signer', 'S'],
//        ['note', 'note', 'S'],
//        ['contract.end.date', 'contract.end.date', 'S'],
//        ['duration.unit', 'duration.unit', 'S'],
//        ['contact.list', 'contact.list', 'S']
//    ];
//
//    // 2. Xây dựng điều kiện lọc WHERE
//    var conditions = [];
//
//    conditions.push("((category=\"HD_GT\" and contract.value.after.tax > 0) or (category=\"HD_KMS\" and total.budget > 0))");
//
//    var role = params.initialRole || (input ? input.initialRole : null);
//    if (role) {
//        role = String(role).trim().toLowerCase();
//        if (role === "dmms") {
//            conditions.push("executor.id=\"" + params.currentUser + "\"");
//        }
//    }
//
//    if (params.status) {
//        conditions.push("status=\"" + params.status + "\"");
//    }
//
//    var unitLv1Param = params.unitLv1 || params["unit.lv1"];
//    print("unitLv1Param: " + unitLv1Param);
//    if (unitLv1Param && String(unitLv1Param).trim() === "099917000") {
//        conditions.push("unit.lv1 like \"0999*\"");
//    } else {
//        conditions.push("unit.lv1=\"" + unitLv1Param + "\"");
//    }
//
//    //    var unitLv1Param = params.unitLv1 || params["unit.lv1"];
//    //    var cleanUnitLv1 = unitLv1Param ? String(unitLv1Param).trim() : "";
//    //    if (cleanUnitLv1 && cleanUnitLv1.indexOf("0999") !== 0) {
//    //        conditions.push("unit.lv1=\"" + unitLv1Param + "\"");
//    //    }
//
//    var whereClause = conditions.length > 0 ? conditions.join(" and ") : "true";
//
//    var sqlFields = fieldMappings.map(function(item) {
//        return item[0];
//    }).join(", ");
//
//    // Câu SQL Query
//    var querySQL = " SELECT " + sqlFields + " FROM esdHDcontract WHERE " + whereClause;
//
//    var dataArray = [];
//    var f = new SCFile('esdHDcontract', SCFILE_READONLY);
//
//    try {
//        var rc = f.doSelect(querySQL);
//
//        while (rc == RC_SUCCESS) {
//            var itemData = mapRowToObject(f, fieldMappings);
//
//            // --- XỬ LÝ ĐỔI GIÁ TRỊ CỦA NAME THEO CATEGORY ---
//            if (itemData.category === "HD_KMS") {
//                itemData.name = itemData["item.name"] || itemData.name;
//            } else if (itemData.category === "HD_GT") {
//                itemData.name = itemData.name;
//            }
//
//            if (itemData.category === "HD_KMS") {
//                itemData.totalValue = itemData["total.budget"];
//            } else if (itemData.category === "HD_GT") {
//                itemData.totalValue = itemData["contract.value.after.tax"];
//            }
//
//            var wrappedItem = {
//                "esdHTKTprepaymentPurchaseContracts": itemData
//            };
//
//            dataArray.push(JSON.stringify(wrappedItem));
//
//            rc = f.getNext();
//        }
//    } catch (e) {
//        print("[ERROR listPurchaseContracts] Lỗi doSelect: " + e);
//    } finally {
//        try { if (f) f.doClose(); } catch (e) {}
//    }
//
//    // Trả mảng kết quả
//    input.queryReturnArray = system.functions.denull(dataArray);
//}


/**
 * Bản bổ sung phân trang, filter và sort server cho listPurchaseContracts của tạm ứng.
 */
function listPurchaseContracts(input) {

    // 1. Lấy dữ liệu linh hoạt từ details hoặc queryString
    var rawData = input ? (input.details || input.queryString) : null;
    if (!rawData) return { success: false, message: "Thiếu dữ liệu đầu vào." };

    var params = {};
    try {
        params = JSON.parse(rawData);
        if (Array.isArray(params)) {
            params = params[0] || {};
        }
    } catch (e) {
        return { success: false, message: "Dữ liệu JSON đầu vào không hợp lệ." };
    }

    /*
     * HTKT PREPAYMENT CURRENT USER
     */
    var currentUser = htktCreatePrepay_resolveCurrentUser(params);

    if (!currentUser) {
        return {
            success: false,
            message: "Không xác định được người tạo phiếu tạm ứng."
        };
    }

    // PHÂN TRANG: chỉ bổ sung start/count, không thay đổi điều kiện nghiệp vụ.
    var start = parseInt(params.start, 10);
    var count = parseInt(params.count, 10);
    start = isNaN(start) || start < 1 ? 1 : start;
    count = isNaN(count) || count < 1 ? 10 : count;

    // FILTER
    var escapeQueryValue = function(value) {
        return String(value || "")
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
    };

    var fieldMappings = [
        ['id', 'id', 'S'],
        ['name', 'name', 'S'],
        ['status', 'status', 'S'],
        ['current.phase', 'current.phase', 'S'],
        ['created.by', 'created.by', 'S'],
        ['created.at', 'created.at', 'D'],
        ['sysmodtime', 'sysmodtime', 'D'],
        ['sysmoduser', 'sysmoduser', 'S'],
        ['total.budget', 'total.budget', 'S'],
        ['is.budgeted', 'is.budgeted', 'B'],
        ['execution.dependency', 'execution.dependency', 'S'],
        ['start.date', 'start.date', 'D'],
        ['execution.duration', 'execution.duration', 'N'],
        ['expected.end.date', 'expected.end.date', 'D'],
        ['actual.end.date', 'actual.end.date', 'D'],
        ['executor.id', 'executor.id', 'S'],
        ['total.executed.value', 'total.executed.value', 'S'],
        ['total.unexecuted.value', 'total.unexecuted.value', 'S'],
        ['total.paid.amount', 'total.paid.amount', 'S'],
        ['remaining.amount', 'remaining.amount', 'S'],
        ['category', 'category', 'S'],
        ['item.id', 'item.id', 'S'],
        ['item.name', 'item.name', 'S'],
        ['signed.date', 'signed.date', 'D'],
        ['total.contract.value', 'total.contract.value', 'S'],
        ['contract.group', 'contract.group', 'S'],
        ['contract.value.before.tax', 'contract.value.before.tax', 'S'],
        ['contract.value.after.tax', 'contract.value.after.tax', 'S'],
        ['tax.amount', 'tax.amount', 'S'],
        ['unit.lv1', 'unit.lv1', 'S'],
        ['unit.lv2', 'unit.lv2', 'S'],
        ['unit.lv3', 'unit.lv3', 'S'],
        ['contract.type', 'contract.type', 'S'],
        ['contract.no', 'contract.no', 'S'],
        ['signer', 'signer', 'S'],
        ['note', 'note', 'S'],
        ['contract.end.date', 'contract.end.date', 'S'],
        ['duration.unit', 'duration.unit', 'S'],
        ['contact.list', 'contact.list', 'S']
    ];

    // 2. Xây dựng điều kiện lọc WHERE
    var conditions = [];

    conditions.push("((category=\"HD_GT\" and contract.value.after.tax > 0) or (category=\"HD_KMS\" and total.budget > 0))");

    var role = params.initialRole || (input ? input.initialRole : null);
    if (role) {
        role = String(role).trim().toLowerCase();
        if (role === "dmms") {
            conditions.push("executor.id=\"" + params.currentUser + "\"");
        }
    }

    if (params.status) {
        conditions.push("status=\"" + params.status + "\"");
    }

    //    var unitLv1Param = params.unitLv1 || params["unit.lv1"];
    //    print("unitLv1Param: " + unitLv1Param);
    //    if (unitLv1Param && String(unitLv1Param).trim() === "099917000") {
    //        conditions.push("unit.lv1 like \"0999*\"");
    //    } else {
    //        conditions.push("unit.lv1=\"" + unitLv1Param + "\"");
    //    }

    // Lấy thông tin quyền và unit.lv1
    var scope = params.scope;
    var unitLv1Param = params.unitLv1 || params["unit.lv1"];
    var cleanUnitLv1 = unitLv1Param ? String(unitLv1Param).trim() : "";

    // 1. Trường hợp QT_PQDL_06: Hậu kiểm toàn hệ thống -> Xem tất cả (không filter unit.lv1)
    if (scope === "QT_PQDL_06") {
        print("QT_PQDL_06");
    }
    else if (scope === "QT_PQDL_04") {
    print("QT_PQDL_04");
        if (cleanUnitLv1.indexOf("0999") === 0) {
            var isMappedToEntity = false;
            var entityFile = new SCFile("esdDMentity", SCFILE_READONLY);
            var entityQuery = 'ps.code="' + escapeQueryValue(cleanUnitLv1) + '" and status="ACTIVE" and entity.code="1010098"';

            try {
                if (entityFile.doSelect(entityQuery) === RC_SUCCESS) {
                    isMappedToEntity = true;
                }
            } finally {
                try { if (entityFile) entityFile.doClose(); } catch (e) {}
            }
            
            if (isMappedToEntity) {
                conditions.push('unit.lv1 like "0999*"');
            } else {
                conditions.push('1=1');
            }
        } else if (cleanUnitLv1) {
            conditions.push('unit.lv1="' + escapeQueryValue(cleanUnitLv1) + '"');
        }
    } else if (cleanUnitLv1) {
        conditions.push('unit.lv1="' + escapeQueryValue(cleanUnitLv1) + '"');
    }


    // FILTER: bổ sung đúng các điều kiện trên popup
    var categoryFilter = String(params.category || "").trim();
    if (categoryFilter === "HD_GT" || categoryFilter === "HD_KMS") {
        conditions.push('category="' + escapeQueryValue(categoryFilter) + '"');
    }

    var keywordFilter = String(params.keyword || "").trim().toLowerCase();
    if (keywordFilter) {
        var safeKeyword = escapeQueryValue(keywordFilter);
        conditions.push(
            '(tolower(id) like "*' + safeKeyword + '*" or ' +
            'tolower(name) like "*' + safeKeyword + '*" or ' +
            'tolower(item.name) like "*' + safeKeyword + '*")'
        );
    }

    if (params.createdAtFrom) {
        conditions.push('created.at >= "' + escapeQueryValue(params.createdAtFrom) + '"');
    }
    if (params.createdAtTo) {
        conditions.push('created.at <= "' + escapeQueryValue(params.createdAtTo) + '"');
    }

    //    var unitLv1Param = params.unitLv1 || params["unit.lv1"];
    //    var cleanUnitLv1 = unitLv1Param ? String(unitLv1Param).trim() : "";
    //    if (cleanUnitLv1 && cleanUnitLv1.indexOf("0999") !== 0) {
    //        conditions.push("unit.lv1=\"" + unitLv1Param + "\"");
    //    }

    var whereClause = conditions.length > 0 ? conditions.join(" and ") : "true";

    var sqlFields = fieldMappings.map(function(item) {
        return item[0];
    });

    // PHÂN TRANG: đếm trên SCFile riêng với đúng whereClause nghiệp vụ hiện tại.
    var totalCount = 0;
    var countFile = new SCFile('esdHDcontract', SCFILE_READONLY);
    try {
        totalCount = countFile.doCount(whereClause);
    } finally {
        try { if (countFile) countFile.doClose(); } catch (e) {}
    }

    var dataArray = [];
    var f = new SCFile('esdHDcontract', SCFILE_READONLY);

    try {
        // Tương đương danh sách cột trong SELECT cũ; không thay đổi field trả về.
        f.setFields(sqlFields);

        // SORT SERVER: chỉ cho phép các field thật của esdHDcontract.
        var sortFieldMap = {
            "id": "id",
            "category": "category",
            "created.at": "created.at",
            "executor.id": "executor.id",
            "status": "status"
        };
        var smSortField = sortFieldMap[String(params.sortField || "")];
        if (smSortField) {
            var sortSequence = parseInt(params.sortOrder, 10) === -1 ? SCFILE_DSC : SCFILE_ASC;
            var sortFields = [smSortField];
            var sortSequences = [sortSequence];

            // Giữ thứ tự ổn định giữa các trang khi nhiều bản ghi có cùng giá trị sort.
            if (smSortField !== "id") {
                sortFields.push("id");
                sortSequences.push(SCFILE_ASC);
            }
            f.setOrderBy(sortFields, sortSequences);
        }

        // PHÂN TRANG: lấy đúng trang sau khi đã áp dụng filter/sort phía SM.
        var rc = f.doSelectEx(whereClause, start, count);

        while (rc == RC_SUCCESS) {
            var itemData = mapRowToObject(f, fieldMappings);

            // --- XỬ LÝ ĐỔI GIÁ TRỊ CỦA NAME THEO CATEGORY ---
            if (itemData.category === "HD_KMS") {
                itemData.name = itemData["item.name"] || itemData.name;
            } else if (itemData.category === "HD_GT") {
                itemData.name = itemData.name;
            }

            if (itemData.category === "HD_KMS") {
                itemData.totalValue = itemData["total.budget"];
            } else if (itemData.category === "HD_GT") {
                itemData.totalValue = itemData["contract.value.after.tax"];
            }

            var wrappedItem = {
                "esdHTKTprepaymentPurchaseContracts": itemData
            };

            dataArray.push(JSON.stringify(wrappedItem));

            rc = f.getNext();
        }
    } catch (e) {
        print("[ERROR listPurchaseContracts] Lỗi doSelectEx: " + e);
        return {
            success: false,
            message: "Lỗi lấy danh sách hợp đồng mua sắm: " + e.toString()
        };
    } finally {
        try { if (f) f.doClose(); } catch (e) {}
    }

    // PHÂN TRANG: trả dữ liệu trang hiện tại và tổng số bản ghi cho paginator.
    return {
        success: true,
        // PHÂN TRANG: trả JavaScript Array để JSON.stringify giữ đúng kiểu mảng.
        data: dataArray,
        totalCount: totalCount,
        start: start,
        count: count,
        returnedCount: dataArray.length,
        hasMore: start - 1 + dataArray.length < totalCount
    };
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
        } else if (dataType === "B") {
            item[jsonKey] = Boolean(dbValue);
        } else if (dataType === "D") {
            item[jsonKey] = dbValue ? (dbValue.toISOString ? dbValue.toISOString() : String(dbValue)) : "";
        } else {
            item[jsonKey] = dbValue ? String(dbValue) : "";
        }
    }
    return item;
}

/* =========================================================
 * HTKT PREPAYMENT CREATE
 * ========================================================= */

function htktCreatePrepay_detectInitialRoleByRights(contactId) {
    var RIGHT_VIEW_INVOICE = "0040040001000001";
    var RIGHT_VIEW_PREPAYMENT = "0040040002000001";
    var RIGHT_CREATE_PREPAYMENT = "0040040002000002";
    var RIGHT_ACCOUNTING_INPUT = "0040040002000003";

    var rights = htktCreatePrepay_getRights(contactId);

    /*
     * Quy tắc nhận diện role khi khởi tạo phiếu:
     *
     * 1. KTTC khởi tạo:
     *    - Có quyền xem hóa đơn
     *    - Có quyền xem danh sách đề nghị tạm ứng
     *    - Có quyền lập đề nghị tạm ứng
     *    - Có quyền nhập liệu hạch toán
     *
     * 2. DMMS khởi tạo:
     *    - Có quyền xem hóa đơn
     *    - Có quyền xem danh sách đề nghị tạm ứng
     *    - Có quyền lập đề nghị tạm ứng
     *    - Không bắt buộc quyền rà soát DMMS 1
     *
     * Lưu ý:
     * - 0040040002000004 là quyền Rà soát đề nghị tạm ứng 1,
     *   không phải quyền khởi tạo DMMS.
     * - Ưu tiên KTTC trước vì KTTC có thêm quyền đặc thù 0003.
     */

    if (
        htktCreatePrepay_hasAllRights(rights, [
            RIGHT_VIEW_INVOICE,
            RIGHT_VIEW_PREPAYMENT,
            RIGHT_CREATE_PREPAYMENT,
            RIGHT_ACCOUNTING_INPUT
        ])
    ) {
        return "kttc";
    }

    if (
        htktCreatePrepay_hasAllRights(rights, [
            RIGHT_VIEW_INVOICE,
            RIGHT_VIEW_PREPAYMENT,
            RIGHT_CREATE_PREPAYMENT
        ])
    ) {
        return "dmms";
    }

    return "";
}

function htktCreatePrepay_getRights(contactId) {
    try {
        return htktCreatePrepay_normalizeArray(
            lib.ESD_PERMS_RIGHTS.permsRight(contactId) || []
        );
    } catch (e) {
        return [];
    }
}

function htktCreatePrepay_hasAllRights(userRights, requiredRights) {
    userRights = htktCreatePrepay_normalizeArray(userRights);
    requiredRights = htktCreatePrepay_normalizeArray(requiredRights);

    var map = {};

    for (var i = 0; i < userRights.length; i++) {
        map[userRights[i]] = true;
    }

    for (var j = 0; j < requiredRights.length; j++) {
        if (!map[requiredRights[j]]) {
            return false;
        }
    }

    return true;
}

function htktCreatePrepay_resolveCurrentUser(source) {
    source = source || {};

    return htktCreatePrepay_normalizeValue(
        source["currentUser"] ||
        source["current_user"] ||
        source["user"] ||
        source["contactId"] ||
        source["contact_id"] ||
        source["contact.id"] ||
        source["contact.name"] ||
        source["createdBy"] ||
        source["created.by"] ||
        source["created_by"] ||
        ""
    );
}

function htktCreatePrepay_normalizeValue(value) {
    return String(value == null ? "" : value).trim();
}

function htktCreatePrepay_normalizeArray(source) {
    var array = source || [];
    var result = [];
    var seen = {};

    try {
        if (array.toArray) {
            array = array.toArray();
        }
    } catch (eToArray) {
        array = [];
    }

    if (!array || typeof array.length === "undefined") {
        return result;
    }

    for (var i = 0; i < array.length; i++) {
        var value = htktCreatePrepay_normalizeValue(array[i]);

        if (value && !seen[value]) {
            seen[value] = true;
            result.push(value);
        }
    }

    return result;
}

function htktCreatePrepay_getVar(name) {
    try {
        return vars[name];
    } catch (e) {
        return "";
    }
}

//-----
function listFileAttachment(input) {

    // 1. Lấy dữ liệu linh hoạt từ details hoặc queryString
    var rawData = input ? (input.details || input.queryString) : null;
    if (!rawData) return { success: false, message: "Thiếu dữ liệu đầu vào." };

    var params = {};
    try {
        params = JSON.parse(rawData);
        if (Array.isArray(params)) {
            params = params[0] || {};
        }
    } catch (e) {
        return { success: false, message: "Dữ liệu JSON đầu vào không hợp lệ." };
    }

    // 2. Định nghĩa fieldMappings chuẩn cho bảng esdHDtlks
    var fieldMappings = [
        ['t.id', 'id', 'S'],
        ['t.id.activity.vj', 'id.activity.vj', 'S'],
        ['t.name', 'name', 'S'],
        ['t.status', 'status', 'S'],
        ['t.created.by', 'created.by', 'S'],
        ['t.created.at', 'created.at', 'D'],
        ['t.sysmodtime', 'sysmodtime', 'D'],
        ['t.sysmoduser', 'sysmoduser', 'S'],
        ['t.sizeKb', 'sizeKb', 'N'],
        ['t.parent.id', 'parent.id', 'S'],
        ['t.attach.type', 'attach.type', 'S'],
        ['t.note', 'note', 'S'],
        ['t.executor', 'executor', 'S'],
        ['t.document.type', 'document.type', 'S'],
        ['t.attach.id', 'attach.id', 'S'],
        ['t.table', 'table', 'S'],
        ['t.doc.id', 'doc.id', 'S'],
        ['t.document.source', 'document.source', 'S'],
        ['t.document.date', 'document.date', 'D'],
        ['t.category', 'category', 'S'],
        ['t.step.status', 'step.status', 'S'],
        ['t.transaction.id', 'transaction.id', 'S'],
        ['t.function', 'function', 'S'],
        ['t.original.id', 'original.id', 'S']
    ];

    // 3. Xây dựng điều kiện lọc chung (WHERE Clause)
    var whereConditions = [];
    var cId = params.contractId;
    if (cId) {
        whereConditions.push('c.id="' + cId + '"');
    }
    if (params.status) {
        whereConditions.push('t.status="' + params.status + '"');
    }
    if (params.role !== "kttc" && params.createdBy) {
        whereConditions.push('tolower(t.executor)="' + params.createdBy.toLowerCase() + '"');
    }

    var baseWhereClause = whereConditions.length > 0 ? " and " + whereConditions.join(" and ") : "";

    var dataArray = [];
    // Khởi tạo Object để lưu các t.id đã duyệt qua (lọc trùng)
    var processedIds = {};

    // Danh sách các cột cần lấy từ alias t (bảng esdHDtlks)
    var selectFields = "t.id, t.id.activity.vj, t.name, t.status, t.created.by, t.created.at, t.sysmodtime, t.sysmoduser, " +
        "t.sizeKb, t.parent.id, t.attach.type, t.note, t.executor, t.document.type, t.attach.id, " +
        "t.table, t.doc.id, t.document.source, t.document.date, t.category, t.step.status, t.transaction.id, " +
        "t.function, t.original.id ";

    // ==========================================
    // LUỒNG 1: DIGITIZATION (c JOIN d JOIN t)
    // ==========================================
    var querySQL1 = "SELECT " + selectFields +
        "FROM esdHDcontract c " +
        "JOIN esdHDdigitization d ON (c.id = d.id.contract) " +
        "JOIN esdHDtlks t ON (d.id = t.parent.id) " +
        "WHERE true" + baseWhereClause;

    var f1 = new SCFile('esdHDtlks', SCFILE_READONLY);
    try {
        var rc1 = f1.doSelect(querySQL1);
        while (rc1 == RC_SUCCESS) {
            var itemData1 = mapRowToObject(f1, fieldMappings);
            var itemId1 = itemData1["id"];

            // Kiểm tra trùng t.id: Nếu chưa có thì mới xử lý
            if (itemId1 && !processedIds[itemId1]) {
                processedIds[itemId1] = true; // Đánh dấu đã tồn tại

                if (!itemData1["table"]) {
                    itemData1["table"] = "esdHDdigitization";
                }

                dataArray.push(JSON.stringify({ "esdHDtlks": itemData1 }));
            }

            rc1 = f1.getNext();
        }
    } catch (e) {
        print("[ERROR listFileAttachment] Lỗi Luồng 1 (Digitization): " + e);
    } finally {
        try { if (f1) f1.doClose(); } catch (e) {}
    }

    // ==========================================
    // LUỒNG 2: ATTACHMENT (c JOIN a JOIN t)
    // ==========================================
    var querySQL2 = "SELECT " + selectFields +
        "FROM esdHDcontract c " +
        "JOIN esdHDattachment a ON (c.id = a.parent.id) " +
        "JOIN esdHDtlks t ON (t.original.id = a.id) " +
        "WHERE true" + baseWhereClause;

    var f2 = new SCFile('esdHDtlks', SCFILE_READONLY);
    try {
        var rc2 = f2.doSelect(querySQL2);
        while (rc2 == RC_SUCCESS) {
            var itemData2 = mapRowToObject(f2, fieldMappings);
            var itemId2 = itemData2["id"];

            // Kiểm tra trùng t.id: Nếu chưa có thì mới xử lý
            if (itemId2 && !processedIds[itemId2]) {
                processedIds[itemId2] = true; // Đánh dấu đã tồn tại

                if (!itemData2["table"]) {
                    itemData2["table"] = "esdHDattachment";
                }

                dataArray.push(JSON.stringify({ "esdHDtlks": itemData2 }));
            }

            rc2 = f2.getNext();
        }
    } catch (e) {
        print("[ERROR listFileAttachment] Lỗi Luồng 2 (Attachment): " + e);
    } finally {
        try { if (f2) f2.doClose(); } catch (e) {}
    }

    // 4. Trả mảng kết quả tổng hợp
    input.queryReturnArray = system.functions.denull(dataArray);
}

function nextId1(name) {
    var nextNumber = new SCDatum();
    funcs.rtecall("getnumber", 1, nextNumber, name);
    return nextNumber;
}