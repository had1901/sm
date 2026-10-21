// 1. id tu sinh
function nextId1(name) {
    var nextNumber = new SCDatum();
    funcs.rtecall("getnumber", 1, nextNumber, name);
    return nextNumber;
}

function newId(tableName) {
    var newid = new Datum();
    var rcode = new Datum();
    rcode = funcs.rtecall("getnumber", rcode, newid, tableName);
    return newid.getText();
}

function generateNextNumber(tableName) {
    var nRtn = new SCDatum();
    var nNumber = new SCDatum();
    system.functions.rtecall("getnumber", nRtn, nNumber, tableName);
    return nNumber.getText();
}

function isPreDelOrg(unitId) {
    let countDVContact = lib.ESD_Utils.countFile(
        "contacts",
        `lv1.id="${unitId}" or lv2.id="${unitId}" or lv3.id="${unitId}"`
    );
    let countChild = lib.ESD_Utils.countFile("esdQTorgUnit", `parent.id="${unitId}"`); // barn ghi truc thuoc
    let result = countDVContact > 0 || countChild > 0 ? true : false;
    return result;
}
// luu log khi delete
function logDeleteAction(tableName, recordId, description) {
    var nextNumber = lib.ESD_Utils.generateNextNumber("esdauditdeletelog");
    var log = new SCFile("esdauditdeletelog");
    log.id = nextNumber;
    log.table = tableName;
    log.record_id = recordId;
    log.deleted_by = system.functions.operator();
    log.delete_time = system.functions.tod();
    log.des = description;
    log.doInsert();
    if (log) log.doClose();
}

//2. tạo ticket
function CreateTicket(tableName, fields) {
    var f = null;

    try {
        if (!tableName) {
            writeSystemLog("CreateTicket ERROR: missing tableName");
            return false;
        }

        // init
        f = new SCFile(tableName);

        // set fields
        for (var field in fields) {
            f[field] = fields[field];
        }

        // insert
        var rc = f.doInsert();

        if (rc == RC_SUCCESS) {
            return true;
        } else {
            // print("Insert thất bại: " + system.functions.rtecode(rc));
            return false;
        }
    } catch (e) {
        writeSystemLog("CreateTicket EXCEPTION: " + e.message);
        print("CreateTicket EXCEPTION: " + e.message);
        return false;
    } finally {
        if (f) {
            try {
                var rcClose = f.doClose();
                if (rcClose != RC_SUCCESS) {
                    print("CreateTicket doClose ERROR: " + RCtoString(rcClose));
                    writeSystemLog("CreateTicket doClose ERROR: " + RCtoString(rcClose));
                }
            } catch (closeErr) {
                print("CreateTicket doClose EXCEPTION: " + closeErr.message);
                writeSystemLog("CreateTicket doClose EXCEPTION: " + closeErr.message);
            }
        }
    }
}

// tinh tong
function sumFieldValue(tableName, query, costField) {
    var total = 0;
    var f = null;

    try {
        if (!tableName || !costField) {
            print("sumFieldValue ERROR: missing params");
            return 0;
        }

        f = new SCFile(tableName);

        var rc = f.doSelect(query);

        while (rc == RC_SUCCESS) {

            var cost = parseFloat(f[costField]);

            if (!isNaN(cost)) {
                total += cost;
            }

            rc = f.getNext();
        }

        return total;
    } catch (e) {
        print("sumFieldValue EXCEPTION: " + e.message);
        return 0;
    } finally {
        // 🔥 đảm bảo close
        if (f) {
            try {
                var rcClose = f.doClose();
                if (rcClose != RC_SUCCESS) {
                    print("sumFieldValue doClose ERROR: " + RCtoString(rcClose));
                }
            } catch (closeErr) {
                print("sumFieldValue doClose EXCEPTION: " + closeErr.message);
            }
        }
    }
}

function sumFieldValue_SQL(tableName, query, costField) {
    var f = new SCFile(tableName);
    var total = 0;
    var whereClause = query ? " where " + query : "";
    var sql = "select sum(" + costField + ") as total from " + tableName + whereClause;
    var rc = f.doSelect(sql);
    if (rc == RC_SUCCESS) {
        var rawTotal = f["total"];
        //        total = parseFloat(rawTotal);
        total = rawTotal;
        if (isNaN(total)) total = 0;
    }
    return total;
}

function sumFieldValueKH02_SQL(tableName, query, costField) {
    var f = new SCFile(tableName);
    var total = 0;
    var whereClause = query && query !== true ? " where " + query : "";
    var sql = "select sum(" + costField + ") as total from " + tableName + whereClause;
    var rc = f.doSelect(sql);
    if (rc == RC_SUCCESS) {
        var rawTotal = f["total"];

        // Không có data / NULL → trả ""
        if (rawTotal === null || rawTotal === undefined || rawTotal === "") {
            return "";
        }

        total = parseFloat(rawTotal);
        if (isNaN(total)) return "";
    }
    return total;
}

//3. dem so luong bản ghi trong bảng
function countFile(filename, query) {
    var file = new SCFile(filename, SCFILE_READONLY);
    var nCount = file.doCount(query);
    var rc = getLastRC();
    if (file) file.doClose();
    if (RC_SUCCESS == rc) {
        return nCount;
    } else {
        print("Could not count records. " + RCtoString(rc));
        return -1;
    }
}

function isCountTicket(fileName, fieldName, query) {
    var f = new SCFile(fileName, SCFILE_READONLY);
    var sql = `SELECT ${fieldName} FROM ${fileName} WHERE ${query}`;
    var count = f.doCount(sql);
    if (f) f.doClose();
    return count > 0 ? true : false;
}

// Lấy ra tên theo id
function getCommonName(tableName, sql, fieldName) {
    var f = new SCFile(tableName, SCFILE_READONLY);
    try {
        var rc = f.doSelect(sql);
        if (rc == RC_SUCCESS) {
            return f[fieldName];
        }

        return "NONE";
    } finally {
        if (f) f.doClose();
    }
}


function getCommonNameKH02(tableName, sql, fieldName) {
    var f = new SCFile(tableName, SCFILE_READONLY);
    try {
        var rc = f.doSelect(sql);
        if (rc == RC_SUCCESS) {
            return f[fieldName];
        }
        return "";
    } finally {
        if (f) f.doClose();
    }
}

function removeVietnameseTones(str) {
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Xóa dấu
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D") // Thay thế đ -> d
        .toLowerCase(); // Chuyển thành chữ thường
}

function stripHtml(input) {
    if (!input) {
        return "";
    }
    let convertArr = input.toArray();
    let rmNullArr = lib.ESD_ArrObj_Utils.rmArrNull(convertArr);
    let inputText = rmNullArr.join();
    var plainText = inputText.replace(/<[^>]+>/g, ""); // Loại bỏ các thẻ HTML
    // Chuyển đổi các ký tự HTML đặc biệt
    plainText = plainText.replace(/&nbsp;/g, " "); // Chuyển &nbsp; thành dấu cách
    plainText = plainText.replace(/&amp;/g, "&"); // Chuyển &amp; thành &
    plainText = plainText.replace(/&lt;/g, "<"); // Chuyển &lt; thành <
    plainText = plainText.replace(/&gt;/g, ">"); // Chuyển &gt; thành >
    plainText = plainText.replace(/&quot;/g, '"'); // Chuyển &quot; thành "
    plainText = plainText.replace(/&#39;/g, "'"); // Chuyển &#39; thành '
    plainText = plainText.trim();
    return plainText;
}

// check dupicate ticket in db
function isDuplicateField(filename, query, oldValue, newValue, fieldkey) {
    let f = new SCFile(filename);
    try {
        let rc = f.doSelect(query);
        if (rc == RC_SUCCESS) {
            do {
                let dbValue = f[fieldkey];
                if (oldValue == newValue && vars["$L.mode"] !== "add") {
                    continue;
                }
                if (newValue == dbValue) {
                    return false;
                }
            } while (f.getNext() == RC_SUCCESS);
        }
        return true;
    } finally {
        if (f) f.doClose();
    }
}
//kiem tra trung lap du lieu tron bang
function checkDuplicateFields(filename, query, field) {
    let f = new SCFile(filename);
    try {
        let rc = f.doSelect(query);
        if (rc == RC_SUCCESS) {
            do {
                let currentValue = removeVietnameseTones(vars["$L.file"][field].toLowerCase());
                let savedValue = removeVietnameseTones(vars["$L.file.save"][field].toLowerCase());
                let dbValue = removeVietnameseTones(f[field].toLowerCase());
                if (savedValue == currentValue && vars["$L.mode"] !== "add") {
                    continue;
                }
                if (currentValue == dbValue) {
                    return false;
                }
            } while (f.getNext() == RC_SUCCESS);
        }
        return true;
    } catch (e) {
        print("[ESD_Utils.checkDuplicateFields] error: " + e.message);
    } finally {
        if (f) f.doClose();
    }
}

function checkDuplicateFieldtoPopup(filename, query, currentValue, fieldDB) {
    let f = new SCFile(filename);
    try {
        let rc = f.doSelect(query);
        if (rc == RC_SUCCESS) {
            do {
                let dbValue = f[fieldDB];
                if (currentValue == dbValue) {
                    return true;
                }
            } while (f.getNext() == RC_SUCCESS);
        }
        return false;
    } catch (e) {
        print("[ESD_Utils.checkDuplicateFieldtoPopup] error: " + e.message);
    } finally {
        if (f) f.doClose();
    }
}
// 4. Lay du lieu tu globallist
function getDataGl(fieldName, query) {
    var f = new SCFile("globallists");
    try {
        var rc = f.doSelect(query);
        if (rc == RC_SUCCESS) {
            const arrayList = JSON.parse(
                f[fieldName].replace(/[{}']/g, (m) => ({ "{": "[", "}": "]", "'": '"' })[m])
            );
            return arrayList;
        }
    } catch (e) {
        print("[ESD_Utils.getDataGl] error: " + e.message);
    } finally {
        if (f) f.doClose();
    }
}

// show message hien thi
function printMsg(sMessage, sSeverity) {
    sSeverity = sSeverity ? sSeverity : "1";
    if (!sMessage) {
        return false;
    }
    var scRetVal = new SCDatum();
    system.functions.rtecall("msg", scRetVal, sMessage, sSeverity);
}

// Tạo mới lịch sử
function createActivityLog(file, oldfile, actType, visibleToCustomer) {
    var rteNames = new SCDatum();
    rteNames.push("file");
    rteNames.push("second.file");
    rteNames.push("text");
    rteNames.push("boolean1");
    var rteValues = new SCDatum();
    rteValues.push(file);
    rteValues.push(oldfile);
    rteValues.push(actType);
    rteValues.push(visibleToCustomer);
    system.functions.rtecall("callrad", new SCDatum(), "sc.activity", rteNames, rteValues, false);
}

// Kiểm tra approver.list có tồn tại và không rỗng
function checkApproverExists(datum, nameToCheck) {
    const length = datum.length();
    const approvers = [];
    for (let i = 0; i < length; i++) {
        const item = datum[i].toArray(); // Lấy từng phần tử
        if (item[0] && item[1]) {
            approvers.push({
                name: item[0],
                value: item[1]
            });
        }
    }
    for (x in approvers) {
        if (approvers[x].name === nameToCheck) {
            return "NOT_FOUND";
        }
    }
    return "FOUND";
}

// truy van du lieu select
function getUniqueOption(tableName, columnName) {
    var file = new SCFile(tableName);
    try {
        var sql = `select DISTINCT ${columnName} from ${tableName}`;
        var arg = [];
        var success = file.doSelect(sql);
        while (success == RC_SUCCESS) {
            arg.push(file[columnName]);
            success = file.getNext();
        }
        return Array.from(new Set(lib.ESD_ArrObj_Utils.rmArrNull(arg)));
    } catch (e) {
        print("[ESD_Utils.getUniqueOption] error: " + e.message);
    } finally {
        if (file) file.doClose();
    }
}

/**
 *
 * @param {string} tableName
 * @param {string} sqlQuery
 * @param {string[]} fields
 * @returns {Record<string, any>[]} Trả về mảng các object chứa các field được chỉ định, hoặc mảng rỗng nếu không tìm thấy bản ghi nào
 * @description Hàm lấy dữ liệu từ database dựa trên câu truy vấn SQL và trả về một mảng các object chứa các field được chỉ định
 */
function fetchData(tableName, sqlQuery, fields) {
    if (!Array.isArray(fields) || fields.length === 0) {
        print("[ESD_Utils.fetchData] error: Tham số 'fields' phải là mảng và không được rỗng.");
        return;
    }
    var f = new SCFile(tableName, SCFILE_READONLY);
    try {
        f.setFields(fields);
        var rc = f.doSelect(sqlQuery);
        var data = [];
        if (rc == RC_SUCCESS) {
            do {
                let row = {};
                fields.forEach((field) => {
                    row[field] = f[field];
                });
                data.push(row);
            } while (f.getNext() == RC_SUCCESS);
        }
        return Array.from(new Set(lib.ESD_ArrObj_Utils.rmArrNull(data)));
    } catch (e) {
        print("[ESD_Utils.fetchData] error: " + e.message);
    } finally {
        if (f) f.doClose();
    }
}

/**
 *
 * @param {string} tableName
 * @param {string} sqlQuery
 * @param {string[]} fields
 * @returns {Record<string, any>|null} Trả về object chứa các field nếu tìm thấy, hoặc null nếu không tìm thấy
 */
function getOneRecord(tableName, sqlQuery, fields) {
    if (!Array.isArray(fields) || fields.length === 0) {
        print("[ESD_Utils.getOneRecord] error: Tham số 'fields' phải là mảng và không được rỗng.");
        return null;
    }
    var f = new SCFile(tableName, SCFILE_READONLY);

    try {
        f.setFields(fields);
        var rc = f.doSelectEx(sqlQuery, 0, 1);
        if (rc == RC_SUCCESS) {
            let row = {};
            fields.forEach((field) => {
                row[field] = f[field];
            });
            return row;
        }
        return null;
    } catch (e) {
        print("[ESD_Utils.getOneRecord] error: " + e.message);
    } finally {
        if (f) f.doClose();
    }
}

function getDataWithCondition(tableName, columnName, columnCondition, dataName) {
    var file = new SCFile(tableName);
    try {
        var sql = `select DISTINCT ${columnName} from ${tableName} where ${columnCondition}="${dataName}"`;
        var arg = [];
        var success = file.doSelect(sql);
        while (success == RC_SUCCESS) {
            arg.push(file[columnName]);
            success = file.getNext();
        }
        return Array.from(new Set(lib.ESD_ArrObj_Utils.rmArrNull(arg))).sort();
    } catch (e) {
        print("[ESD_Utils.getDataWithCondition] error: " + e.message);
    } finally {
        if (file) file.doClose();
    }
}

// other
function getDisplayForValue(value, valueList, displayList) {
    const index = valueList.indexOf(value);
    if (index !== -1) {
        return displayList[index];
    } else {
        return "Không tìm thấy giá trị tương ứng";
    }
}

function relationship(sourceFile, targetFile, recordId) {
    var f = new SCFile("relation");
    try {
        const query = `(source.file="${sourceFile}" or target.file="${targetFile}") and not (def.type="link" and relType="C") and not (target.file#"activity") and not (source.file="SYSATTACHMENTS" or target.file="SYSATTACHMENTS")`;
        let rc = f.doSelect(query);
        const relatedTables = [];
        while (rc == RC_SUCCESS) {
            relatedTables.push({
                table: f.source_file === sourceFile ? f.target_file : f.source_file,
                field: f.source_file === sourceFile ? f.target_field : f.source_field
            });
            rc = f.getNext();
        }
        const relatedTableLength = relatedTables.length;
        let isResult = false;
        // Kiểm tra các bảng liên quan
        for (let i = 0; i < relatedTableLength; i++) {
            let related = relatedTables[i];
            const relatedTable = new SCFile(related.table);
            const checkQuery = `${related.field}="${recordId}"`;
            const rcRelated = relatedTable.doSelect(checkQuery);
            //         Nếu tìm thấy kết quả, thoát ngay
            if (rcRelated == RC_SUCCESS) {
                isResult = true;
                break;
            }
        }
        return isResult;
    } catch (e) {
        print("[ESD_Utils.relationship] error: " + e.message);
    } finally {
        if (f) f.doClose();
    }
}

function setApprover(datum, name, value) {
    let approvers = datum;
    if (!approvers) {
        datum = [];
        approvers = datum;
    }
    let newIndex = approvers.length();

    if (newIndex === 1 && (!approvers[0]["approver.name"] || !approvers[0]["approver.value"])) {
        approvers[0]["approver.name"] = name;
        approvers[0]["approver.value"] = value;
    } else {
        approvers[newIndex]["approver.name"] = name;
        approvers[newIndex]["approver.value"] = value;
    }
    return approvers;
}

//check duplicate trường
function checkDuplicate(filename, query, field) {
    var f = new SCFile(filename);
    try {
        var rc = f.doSelect(query);
        if (rc == RC_SUCCESS) {
            do {
                if (f[field] !== field) return false;
            } while (f.getNext() == RC_SUCCESS);
        }
        return true;
    } catch (e) {
        print("[ESD_Utils.checkDuplicate] error: " + e.message);
    } finally {
        if (f) f.doClose();
    }
}

// convert status
function convertStatus(status_en, sqlQuery = true, showColor = true) {
    var f = new SCFile("esdDMstatus");
    try {
        var finalQuery = `status.en="${status_en}" AND ${sqlQuery}`;
        var rc = f.doSelect(finalQuery);
        if (rc == RC_SUCCESS) {
            return showColor ? {
                status_vn: f.status_vi,
                textColor: f.color,
                backgroundColor: f.bgcolor
            } : {
                status_vn: f.status_vi
            };
        } else {
            return showColor ? {
                status_vn: status_en,
                backgroundColor: "#F4F5F7",
                textColor: "#42526E"
            } : {
                status_vn: status_en
            };
        }
    } catch (e) {
        print("[ESD_Utils.convertStatus] error: " + e.message);
    } finally {
        if (f) f.doClose();
    }
}

// get data array của bảng
function getDataArr(tablename, sqlquery, field) {
    let arr = [];
    let f = new SCFile(tablename, SCFILE_READONLY);
    try {
        f.setFields([field]);
        let rc = f.doSelect(sqlquery);
        while (rc == RC_SUCCESS) {
            arr.push(f[field]);
            rc = f.getNext();
        }
        return Array.from(new Set(lib.ESD_ArrObj_Utils.rmArrNull(arr)));
    } catch (e) {
        print("[ESD_Utils.getDataArr] error: " + e.message);
    } finally {
        if (f) f.doClose();
    }
}

function getDataArrMulti(tablename, sqlquery, fields) {
    let arr = [];
    let f = new SCFile(tablename, SCFILE_READONLY);
    try {
        // Nếu truyền "a,b,c" thì tách ra array
        let fieldsArr = Array.isArray(fields) ? fields : fields.split(",").map((s) => s.trim());

        f.setFields(fieldsArr);

        let rc = f.doSelect(sqlquery);
        while (rc == RC_SUCCESS) {
            let record = {};
            for (let i = 0; i < fieldsArr.length; i++) {
                record[fieldsArr[i]] = f[fieldsArr[i]];
            }
            arr.push(record);
            rc = f.getNext();
        }

        // Xóa null/undefined
        arr = lib.ESD_ArrObj_Utils.rmArrNull(arr);

        return arr;
    } catch (e) {
        print("[ESD_Utils.getDataArrMulti] error: " + e.message);
    } finally {
        if (f) f.doClose();
    }
}

// check lock ( 0 xóa lock, 1 trả về tồn tại lock hay không )
function checkLock(queryKey, tableName, control) {
    let f = new SCFile("lock");
    try {
        if (!vars["$L.file"]) return false;
        let key = getDataArr("datadict", queryKey, "unique.key");
        let query = 'resourcename = "' + tableName;
        for (i in key[0]) {
            query += ";" + vars["$L.file"][key[0][i]];
        }
        query += '"';
        let f = new SCFile("lock");
        let rc = f.doSelect(query);
        if (rc == RC_SUCCESS) {
            switch (control) {
                case 0:
                    f.doDelete();
                    return true;
                case 1:
                    return true;
            }
        }
        return false;
    } catch (e) {
        print("[ESD_Utils.checkLock] error: " + e.message);
    } finally {
        if (f) f.doClose();
    }
}

// chuc nang lay value - display
function getDisplayNameField(tableName, query, ticketID, ticketName) {
    if (!tableName || !query) {
        return ticketID || "";
    }
    let f = new SCFile(tableName);
    try {
        var rc = f.doSelect(query);
        if (rc == RC_SUCCESS) {
            return f[ticketName] || f[ticketID] || "";
        } else {
            return "";
        }
    } catch (e) {
        print("[ESD_Utils.getDisplayNameField] error: " + e.message);
    } finally {
        if (f) f.doClose();
    }
}

function getDisplayNameField_sys(tableName, lfiled, value, ticketID) {
    if (!tableName) {
        return ticketID || "";
    }
    let f = new SCFile(tableName);
    try {
        var rc = f.doSelect(`${lfiled}="${value}"`);
        if (rc == RC_SUCCESS) {
            return f[ticketID] || "";
        } else {
            return "";
        }
    } catch (e) {
        print("[ESD_Utils.getDisplayNameField_sys] error: " + e.message);
    } finally {
        if (f) f.doClose();
    }
}

function getDistinctFieldValues(tableName, levels, fields) {
    var result = {};
    fields.forEach((field) => {
        result[field] = [];
    });
    var fieldList = fields.join(", ");
    let f = new SCFile(tableName);
    try {
        var query = `SELECT DISTINCT ${fieldList} FROM ${tableName} WHERE level="${levels}"`;
        var rc = f.doSelect(query);
        while (rc == RC_SUCCESS) {
            fields.forEach((field) => {
                if (f[field]) {
                    result[field].push(f[field]);
                }
            });
            rc = f.getNext();
        }
        fields.forEach((field) => {
            result[field] = [...new Set(result[field])];
        });
        return result;
    } catch (e) {
        print("[ESD_Utils.getDistinctFieldValues] error: " + e.message);
    } finally {
        if (f) f.doClose();
    }
}

function formatMoney(number) {
    if (!number) return "";
    const str = String(number).replace(/\D/g, ""); // loại bỏ mọi ký tự không phải số
    return str.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

//xóa bản ghi
function deleteTicket(filename, query) {
    var f = new SCFile(filename);
    var rc = f.doSelect(query);
    while (rc == RC_SUCCESS) {
        f.doDelete();
        rc = f.getNext();
    }
    if (f) f.doClose();
}
// xoa expression
function deleteById(tableName, keyField, keyValue) {
    var f = new SCFile(tableName);
    var rc = f.doSelect(keyField + '="' + String(keyValue) + '"');
    if (rc === RC_SUCCESS) {
        f.doDelete();
    }
    if (f) f.doClose();
}

//reset number
function resetNumber(tableName, number) {
    var f = new SCFile("number");
    var rc = f.doSelect(`name like "${tableName}*"`);
    print(`name like "${tableName}"`);
    while (rc === RC_SUCCESS) {
        f.number = number || 1;
        f.doUpdate();
        rc = f.getNext();
    }
    if (f) f.doClose();
}

//update fields for many record, fieldsObj like {key1: value1, key2: value2}
function updateFields(tableName, sqlQuery, fieldsObj) {
    var f = null;

    try {
        f = new SCFile(tableName);

        var rc = f.doSelect(sqlQuery);

        while (rc == RC_SUCCESS) {
            for (var key in fieldsObj) {
                f[key] = fieldsObj[key];
            }

            f.doUpdate();
            rc = f.getNext();
        }
    } catch (e) {
        print("[updateFields] Error: " + e);
    } finally {
        if (f) f.doClose();
    }
}

//update fields for many record, fieldsObj like {key1: value1, key2: value2}
function updateFieldsOne(tableName, sqlQuery, fieldsObj) {
    var f = null;

    try {
        f = new SCFile(tableName);

        var rc = f.doSelect(sqlQuery);

        if (rc == RC_SUCCESS) {
            for (var key in fieldsObj) {
                f[key] = fieldsObj[key];
            }

            f.doUpdate();
        }
    } catch (e) {
        print("[updateFieldsOne] Error: " + e);
    } finally {
        if (f) f.doClose();
    }
}

//Thêm lịch sử thực hiện
function createActivity(tableName, description, number, type, user) {
    if (!user) {
        user = vars["$lo.user.name"];
    }
    var date = system.functions.tod();
    var nextNumber = generateNextNumber(tableName);
    print("nextNumber = " + nextNumber);
    writeSystemLog("nextNumber = " + nextNumber);
    var fields = {
        thenumber: nextNumber,
        operator: user,
        description: [description],
        number: number,
        datestamp: date,
        negdatestamp: lib.OctaneUtil.calcNegDate(date),
        "cust.visible": false,
        type: type
    };
    CreateTicket(tableName, fields);
}

function createActivity2(tableName, description, number, user) {
    if (!user) {
        user = vars["$lo.user.name"];
    }

    var date = system.functions.tod();
    var nextNumber = generateNextNumber(tableName);

    print("nextNumber = " + nextNumber);
    writeSystemLog("nextNumber = " + nextNumber);

    var fields = {
        thenumber: nextNumber,
        operator: user,
        description: [description],
        number: number,
        datestamp: date,
        negdatestamp: lib.OctaneUtil.calcNegDate(date),
        "cust.visible": false
    };

    CreateTicket(tableName, fields);
}


//Thêm Cán bộ phê duyệt thực hiện
function createApprovalStaff(tableName, parentID, status, type, note) {
    var date = system.functions.tod();
    var nextNumber = generateNextNumber(tableName);
    var fields = {
        id: nextNumber,
        "contact.id": vars["$lo.contact.name"],
        "approval.date": date,
        "parent.id": parentID,
        "approval.status": status,
        "approval.type": type,
        note: note
    };
    CreateTicket(tableName, fields);
}
// call RULESET
function callRuleSet(file, rulename) {
    //send notification
    var rteReturnValue = new SCDatum();
    var rteNames = new SCDatum();
    var rteVals = new SCDatum();
    rteNames.setType(8); //type array
    rteNames.push("file"); //Current File
    rteNames.push("name"); //RuleSet Name
    rteVals.setType(8);
    rteVals.push(file); // Incident Record
    rteVals.push(rulename); //RuleSet Name
    system.functions.rtecall("callrad", rteReturnValue, "Ruleset.run", rteNames, rteVals, false); //false to run in the same thread, true to run in new one.
}

//Phan quyen duw lieu danh sachs
function buildPermissionQuery(dataScope, unitIds, fieldNames, createdByField) {
    createdByField = createdByField || "created.by";
    const createdByCond = `${createdByField}="${vars["$lo.contact.name"]}"`;
    switch (dataScope) {
        case "QT_PQDL_01":
            return createdByCond;
        case "QT_PQDL_06":
            return "true";
        default:
            let conditions = [];
            if (!dataScope) return "false";
            if (
                Array.isArray(unitIds) &&
                unitIds.length > 0 &&
                Array.isArray(fieldNames) &&
                fieldNames.length > 0
            ) {
                for (let i = 0; i < unitIds.length; i++) {
                    const unitId = unitIds[i];
                    const orPerUnit = fieldNames.map((fn) => `${fn}="${unitId}"`).join(" or ");
                    conditions.push(`(${orPerUnit})`);
                }
            }
            conditions.push(`(${createdByCond})`);
            const unique = Array.from(new Set(conditions));
            return unique.join(" or ");
    }
}

// check dk menu
function PQmenu(rights) {
    if (!rights || !vars["$G.rights"]) return "F";
    rights = rights.split(",").map((s) => s.trim());
    var arrRights = vars["$G.rights"].toArray().map((s) => s.trim());
    var map = {},
        i,
        key;
    for (i = 0; i < arrRights.length; i++) {
        key = arrRights[i];
        map[key] = 1;
    }
    for (i = 0; i < rights.length; i++) {
        key = rights[i];
        if (map[key] == 1) return "T";
    }
    return "F";
}

// ghi nhớ vị trí vào hàng đợi ( sử dụng cho nút back )
function backQueue(table, query) {
    var backTable = [],
        backQuery = [];
    if (!table) {
        return false;
    }
    var table = table;
    var query = query ? query : `id ="${vars["$L.file"]["id"]}"`;
    var n = 0;
    if (vars["$G.back.table"] && vars["$G.back.query"]) {
        backTable = vars["$G.back.table"].toArray();
        backQuery = vars["$G.back.query"].toArray();
        n = backTable.length - 1;
    }
    if (backTable[n] != table || backQuery[n] != query) {
        backTable.push(table);
        backQuery.push(query);
    } else {
        return false;
    }
    vars["$G.back.table"] = backTable;
    vars["$G.back.query"] = backQuery;
    return true;
}

// Utility function for enhanced Excel export with styling
function createEnhancedExcelButton(options = {}) {
    const defaultOptions = {
        buttonText: '<i class="iconhpt-cloud-download"></i> Xuất Excel',
        title: "Báo cáo",
        sheetName: "Sheet1",
        filename: function() {
            var currentDate = new Date();
            var dateStr =
                currentDate.getFullYear() +
                String(currentDate.getMonth() + 1).padStart(2, "0") +
                String(currentDate.getDate()).padStart(2, "0");
            return "Export_" + dateStr;
        },
        columns: "all", // 'all' to export all columns, or array of column indices [0,1,2,3,4,5]
        currencyColumns: [], // Array of column indices that contain currency, e.g. [2,3]
        columnWidths: [], // Array of column widths, e.g. [18,15,25,25,18,18]
        headerBgColor: "FFD9D9D9", // Gray background for header
        font: "Times New Roman",
        fontSize: 11
    };

    // Merge options with defaults
    const config = Object.assign({}, defaultOptions, options);

    // Handle filename - if it's a string, convert to function that adds date
    if (typeof config.filename === "string") {
        const baseFilename = config.filename;
        config.filename = function() {
            var currentDate = new Date();
            var dateStr =
                currentDate.getFullYear() +
                String(currentDate.getMonth() + 1).padStart(2, "0") +
                String(currentDate.getDate()).padStart(2, "0");
            return baseFilename + "_" + dateStr;
        };
    }

    return {
        text: config.buttonText,
        extend: "excelHtml5",
        title: config.title,
        filename: config.filename,
        autoFilter: false,
        sheetName: config.sheetName,
        exportOptions: {
            columns: config.columns === "all" ? ":visible" : config.columns,
            orthogonal: "export",
            stripHtml: true,
            format: {
                body: function(data, row, column, node) {
                    // Format currency columns
                    if (config.currencyColumns.includes(column)) {
                        var numVal = parseFloat(data.toString().replace(/[^0-9.-]/g, ""));
                        return !isNaN(numVal) ? numVal : 0;
                    }
                    // Remove HTML tags for other columns
                    return typeof data === "string" ? data.replace(/<[^>]*>/g, "") : data;
                }
            }
        },
        customize: function(xlsx) {
            var sheet = xlsx.xl.worksheets["sheet1.xml"];
            var $ = window.jQuery;

            // Add styles to workbook
            var styles = xlsx.xl["styles.xml"];

            // Add number formats
            var numFmts = $("numFmts", styles);
            if (numFmts.length === 0) {
                $("styleSheet", styles).prepend(
                    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0_ ;[Red]-#,##0 "/></numFmts>'
                );
            } else {
                numFmts.append('<numFmt numFmtId="164" formatCode="#,##0_ ;[Red]-#,##0 "/>');
                numFmts.attr("count", parseInt(numFmts.attr("count")) + 1);
            }

            // Add fonts
            var fonts = $("fonts", styles);
            fonts.append(
                '<font><sz val="' + config.fontSize + '"/><name val="' + config.font + '"/><b/></font>'
            ); // Bold font
            fonts.append(
                '<font><sz val="' + config.fontSize + '"/><name val="' + config.font + '"/></font>'
            ); // Regular font
            fonts.attr("count", parseInt(fonts.attr("count")) + 2);

            // Add fills (backgrounds)
            var fills = $("fills", styles);
            fills.append(
                '<fill><patternFill patternType="solid"><fgColor rgb="' +
                config.headerBgColor +
                '"/></patternFill></fill>'
            ); // Header background
            fills.attr("count", parseInt(fills.attr("count")) + 1);

            // Add borders
            var borders = $("borders", styles);
            borders.append(
                '<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom></border>'
            );
            borders.attr("count", parseInt(borders.attr("count")) + 1);

            // Add cell styles
            var cellXfs = $("cellXfs", styles);
            var xfsCount = parseInt(cellXfs.attr("count"));

            // Style for header (bold, background, border)
            cellXfs.append(
                '<xf numFmtId="0" fontId="' +
                (parseInt(fonts.attr("count")) - 2) +
                '" fillId="' +
                (parseInt(fills.attr("count")) - 1) +
                '" borderId="' +
                (parseInt(borders.attr("count")) - 1) +
                '" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
            );

            // Style for currency (number format, border)
            cellXfs.append(
                '<xf numFmtId="164" fontId="' +
                (parseInt(fonts.attr("count")) - 1) +
                '" fillId="0" borderId="' +
                (parseInt(borders.attr("count")) - 1) +
                '" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>'
            );

            // Style for regular text (border)
            cellXfs.append(
                '<xf numFmtId="0" fontId="' +
                (parseInt(fonts.attr("count")) - 1) +
                '" fillId="0" borderId="' +
                (parseInt(borders.attr("count")) - 1) +
                '" applyBorder="1"/>'
            );

            cellXfs.attr("count", xfsCount + 3);

            // Apply styles to cells
            $("row", sheet).each(function(rowIndex) {
                $(this)
                    .find("c")
                    .each(function(colIndex) {
                        if (rowIndex === 0 || rowIndex === 1) {
                            // Header rows (title and column headers) - style bold with background
                            $(this).attr("s", xfsCount);
                        } else {
                            // Data rows
                            if (config.currencyColumns.includes(colIndex)) {
                                // Currency columns - number format
                                $(this).attr("s", xfsCount + 1);
                            } else {
                                // Text columns - regular style with border
                                $(this).attr("s", xfsCount + 2);
                            }
                        }
                    });
            });

            // Set column widths
            if (config.columnWidths.length > 0) {
                var cols = "<cols>";
                config.columnWidths.forEach(function(width, index) {
                    cols +=
                        '<col min="' +
                        (index + 1) +
                        '" max="' +
                        (index + 1) +
                        '" width="' +
                        width +
                        '" customWidth="1"/>';
                });
                cols += "</cols>";
                $("sheetData", sheet).before(cols);
            }
        }
    };
}

function generateNextNumbers(tableName, count) {
    if (count <= 0) return [];

    var codes = [];
    var f = new SCFile("number");
    try {
        var rc = f.doSelect('name="' + tableName + '"');

        if (rc !== RC_SUCCESS) {
            // Nếu chưa có record number, tạo mới
            f.name = tableName;
            f.number = 1;
            f.doInsert();
            rc = f.doSelect('name="' + tableName + '"');
        }

        var currentNumber = parseInt(f.number) || 0;
        var startNumber = currentNumber;

        for (var i = 0; i < count; i++) {
            currentNumber++;
            var codeStr = currentNumber.toString();
            while (codeStr.length < 10) {
                codeStr = "0" + codeStr;
            }
            codes.push(codeStr);
        }

        f.number = currentNumber;
        f.doUpdate();
        
        return codes;
    } catch (e) {
        print("[ESD_Utils.generateNextNumbers] error: " + e.message);
    } finally {
        if (f) f.doClose();
    }
}

function bulkDeleteByQuery(tableName, query) {
    var count = 0;
    var startTime = new Date().getTime();

    try {
        // Step 1: Collect all primary keys
        var primaryKeys = [];
        var f = new SCFile(tableName);
        var rc = f.doSelect(query);

        while (rc === RC_SUCCESS) {
            var pk = f.code || f.id;
            if (pk) {
                primaryKeys.push(pk);
            }
            rc = f.getNext();
        }

        var totalRecords = primaryKeys.length;
        print(
            "Collected " +
            totalRecords +
            " primary keys in " +
            (new Date().getTime() - startTime) / 1000 +
            "s"
        );

        if (totalRecords === 0) return 0;

        var batchSize = 50;
        var batches = Math.ceil(totalRecords / batchSize);

        for (var i = 0; i < primaryKeys.length; i += batchSize) {
            var batch = primaryKeys.slice(i, Math.min(i + batchSize, primaryKeys.length));
            var batchNum = Math.floor(i / batchSize) + 1;

            var pkList = "'" + batch.join("','") + "'";
            var sql = "DELETE FROM " + tableName + " WHERE code IN (" + pkList + ")";

            try {
                var delFile = new SCFile(tableName);
                var delRc = delFile.doSelect(sql);

                if (delRc === RC_SUCCESS || getLastRC() === RC_SUCCESS) {
                    count += batch.length;
                } else {
                    for (var j = 0; j < batch.length; j++) {
                        try {
                            var singleFile = new SCFile(tableName);
                            if (singleFile.doSelect('code="' + batch[j] + '"') === RC_SUCCESS) {
                                if (singleFile.doDelete() === RC_SUCCESS) {
                                    count++;
                                }
                            }
                        } catch (e) {}
                    }
                }

                if (batchNum % 10 === 0 || i + batchSize >= totalRecords) {
                    var elapsed = (new Date().getTime() - startTime) / 1000;
                    var progress = Math.round((count / totalRecords) * 100);
                    print(
                        "Delete progress: " +
                        progress +
                        "% (" +
                        count +
                        "/" +
                        totalRecords +
                        ") - " +
                        elapsed +
                        "s elapsed"
                    );
                }
            } catch (e) {
                print("Batch " + batchNum + " error: " + e.toString());
            }
        }

        var totalTime = (new Date().getTime() - startTime) / 1000;
        print(
            "Bulk delete completed: " + count + "/" + totalRecords + " records in " + totalTime + "s"
        );

        return count;
    } catch (e) {
        print("bulkDeleteByQuery critical error: " + e.toString());
        return 0;
    } finally {
        if (f) f.doClose();
    }
}
/**
 * Kiểm tra tất cả chỉ tiêu thuộc phòng ban của user đã xác nhận phòng chưa
 * @param {string} costRegId - Mã phiếu đăng ký điều chỉnh
 * @returns {string} "T" nếu tất cả đã xác nhận, "F" nếu chưa hoặc không có chỉ tiêu
 */
function checkAllDeptIndicatorsApproved(costRegId) {
    var userDeptId = vars["$G.contacts.lv2"] || "";

    if (!costRegId || !userDeptId) {
        return "F";
    }

    var queryTotal = `id.plan.cost.reg="${costRegId}" and dept.id="${userDeptId}"`;
    var queryCompleted = `id.plan.cost.reg="${costRegId}" and dept.id="${userDeptId}" and status="Da xac nhan phong"`;

    var totalCount = countFile("esdKHDCPlanIndicators", queryTotal);
    var completedCount = countFile("esdKHDCPlanIndicators", queryCompleted);
    return totalCount > 0 && totalCount === completedCount ? "T" : "F";
}

/**
 * Kiểm tra tất cả chỉ tiêu thuộc phòng ban của user đã được xử lý chưa
 * Phòng ban được coi là "đã xử lý xong" khi TẤT CẢ chỉ tiêu:
 * - Không còn ở trạng thái "Cho phe duyet phong"
 * - VÀ đã có dept.approver.id (đã được lãnh đạo phòng xác nhận)
 * @param {string} costRegId - Mã phiếu đăng ký điều chỉnh
 * @returns {string} "T" nếu tất cả đã xử lý xong (ẩn nút), "F" nếu còn chỉ tiêu chưa xử lý (hiện nút)
 */
function checkDeptIndicatorsHasApprover(costRegId) {
    var userDeptId = vars["$G.contacts.lv2"] || "";

    if (!costRegId || !userDeptId) {
        return "F";
    }

    // Đếm tổng chỉ tiêu của phòng ban hiện tại (chỉ những chỉ tiêu đang hoạt động, không bị đóng)
    var queryTotal = `id.plan.cost.reg="${costRegId}" and dept.id="${userDeptId}" and current.phase~="Dong"`;
    var totalCount = countFile("esdKHDCPlanIndicators", queryTotal);

    // Nếu không có chỉ tiêu nào của phòng ban này → Ẩn nút
    if (totalCount === 0) {
        return "T";
    }

    // Đếm chỉ tiêu chưa hoàn thành: còn chờ phê duyệt HOẶC chưa có người phê duyệt
    var queryPending = `id.plan.cost.reg="${costRegId}" and dept.id="${userDeptId}" and current.phase~="Dong" and (status="Cho phe duyet phong" or dept.approver.id=NULL)`;
    var pendingCount = countFile("esdKHDCPlanIndicators", queryPending);

    // Trả về "T" nếu không còn chỉ tiêu chưa hoàn thành (ẩn nút), "F" nếu còn (hiện nút)
    return pendingCount === 0 ? "T" : "F";
}

function convertNumberToVietnameseText(number) {
    if (!number && number !== 0) return "";

    var num = parseInt(number, 10);
    if (isNaN(num)) return "";
    if (num === 0) return "Không đồng";

    var isNegative = num < 0;
    num = Math.abs(num);

    var units = ["", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

    var levels = [
        "", // 10^0
        "nghìn", // 10^3
        "triệu", // 10^6
        "tỷ", // 10^9
        "nghìn tỷ", // 10^12
        "triệu tỷ", // 10^15
        "tỷ tỷ" // 10^18
    ];

    function readThreeDigits(n, isFirst) {
        if (n === 0) return "";

        var result = "";
        var hundreds = Math.floor(n / 100);
        var tens = Math.floor((n % 100) / 10);
        var ones = n % 10;

        if (hundreds > 0) {
            result += units[hundreds] + " trăm";
        } else if (!isFirst) {
            // Chỉ thêm "không trăm" khi không phải nhóm đầu tiên
            result += "không trăm";
        }

        if (tens === 0) {
            if (ones > 0) {
                // Chỉ thêm "lẻ" khi có trăm đứng trước (result không rỗng)
                result += (result !== "" ? " lẻ " : "") + units[ones];
            }
        } else if (tens === 1) {
            result += (result !== "" ? " " : "") + "mười";
            if (ones === 5) result += " lăm";
            else if (ones > 0) result += " " + units[ones];
        } else {
            result += (result !== "" ? " " : "") + units[tens] + " mươi";
            if (ones === 1) result += " mốt";
            else if (ones === 5) result += " lăm";
            else if (ones > 0) result += " " + units[ones];
        }

        return result.trim();
    }

    // Tách thành từng nhóm 3 chữ số
    var groups = [];
    var temp = num;
    while (temp > 0) {
        groups.push(temp % 1000);
        temp = Math.floor(temp / 1000);
    }

    var result = "";
    var groupCount = groups.length;

    for (var i = groupCount - 1; i >= 0; i--) {
        var group = groups[i];
        if (group === 0) continue;

        var isFirst = result === "";
        var groupText = readThreeDigits(group, isFirst);
        var level = levels[i] !== undefined ? levels[i] : "";

        result += groupText + (level ? " " + level : "") + " ";
    }

    result = result.trim();
    result = result.charAt(0).toUpperCase() + result.slice(1);

    if (isNegative) {
        result = "Âm " + result.charAt(0).toLowerCase() + result.slice(1);
    }

    return result + " đồng";
}
/**
 * Tạo mới lịch sử workflow (WorkflowHistory)
 *
 * @param {string} tableName - tên bảng liên kết (vd: esdMSttms)
 * @param {string} recordId - id record
 * @param {string} fromPhase - phase ban đầu
 * @param {string} toPhase - phase sau
 * @returns {boolean}
 */

function createWorkflowHistory(tableName, recordId, fromPhase, toPhase) {
    try {
        if (!tableName || !recordId) return false;

        var fields = {
            // ===== mapping =====
            linkedTableName: tableName,
            linkedId: recordId,
            fromPhase: fromPhase,
            toPhase: toPhase,

            // ===== workflow info =====
            type: "auto",
            linkName: "true:0:" + fromPhase + ":" + toPhase,

            // ===== user + time =====
            user: vars["$lo.user.name"],
            dateTime: new Date()
        };

        var newId = CreateTicket("WorkflowHistory", fields);

        return !!newId;
    } catch (e) {
        print("[createWorkflowHistory] error: " + e);
        return false;
    }
}

function clearWorkflowHistory(table, id) {
    lib.ESD_Utils.deleteTicket(
        "WorkflowHistory",
        'linkedTableName="' + table + '" and linkedId = "' + id + '"'
    );
}
// ghi log vào file "C:/LOG/SM_LOG.txt"
function writeSystemLog(text) {
    var filePath = "C:/LOG/SM_LOG.txt";
    var MAX_SIZE = 500000; // ~500KB (tùy chỉnh)

    var content = "";
    try {
        content = readFile(filePath, "t");
    } catch (e) {
        content = "";
    }

    // nếu file vượt quá size → rotate
    if (content && content.length > MAX_SIZE) {
        var time = funcs.tod();
        time = time.getTime();
        var backupPath = "C:/LOG/SM_LOG_" + time + ".txt";

        // copy nội dung sang file backup
        writeFile(backupPath, "w", content);

        // clear file gốc
        writeFile(filePath, "w", "");
    }

    // build log mới
    var arg =
        "" +
        funcs.tod() +
        "\r\n" +
        "log by user: " +
        vars["$lo.user.name"] +
        "\r\n" +
        text +
        "\r\n" +
        "###############################\r\n";

    // ghi append vào file chính
    writeFile(filePath, "a", arg);
}

function formatMoneyView(num) {
    if (num == null || num === "") return "";

    var parts = num.toString().split(".");
    var integer = parts[0];
    var decimal = parts[1];

    var isNegative = integer[0] === "-";
    if (isNegative) integer = integer.slice(1);

    integer = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

    return (isNegative ? "-" : "") + integer + (decimal ? "," + decimal : "");
}

//writeSystemLog("test")

function toFloat(value, defaultValue = 0) {
    if (value === null || value === undefined || value === "") {
        return defaultValue;
    }

    // Xóa dấu phẩy, khoảng trắng
    const normalized = String(value).replace(/,/g, "").trim();

    const number = parseFloat(normalized);

    return isNaN(number) ? defaultValue : number;
}

// TuPA: format number price
function formatCurrency(number) {
    if (!number && number !== 0) return "";

    var num = parseFloat(number);
    if (isNaN(num)) return "";

    // Dưới 10,000 thì không format
    if (Math.abs(num) < 10000) return String(number);

    var parts = num.toString().split(".");
    var integer = parts[0];
    var decimal = parts[1];

    var isNegative = integer[0] === "-";
    if (isNegative) integer = integer.slice(1);

    // Thêm dấu phẩy mỗi 3 chữ số
    integer = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    return (isNegative ? "-" : "") + integer + (decimal ? "." + decimal : "");
}

function formatDate(dateString) {
    let date = new Date(dateString);

    let day = date.getDate();
    let month = date.getMonth() + 1;
    const year = date.getFullYear();

    // thêm số 0 phía trước nếu < 10
    day = day < 10 ? "0" + day : day;
    month = month < 10 ? "0" + month : month;

    date = day + "/" + month + "/" + year;

    return date;
}

function formatDateTime(dateString) {
    if (!dateString) return null;
    let date = new Date(dateString);

    let day = date.getDate();
    let month = date.getMonth() + 1;
    const year = date.getFullYear();

    // thêm số 0 phía trước nếu < 10
    day = day < 10 ? "0" + day : day;
    month = month < 10 ? "0" + month : month;

    date = month + "/" + day + "/" + year;

    return new Date(date).getTime();
}

function inList(field, arr) {
    if (!arr || !arr.length) return "";

    // remove duplicate
    arr = [...new Set(arr)];

    var values = [];

    for (var i = 0; i < arr.length; i++) {
        if (arr[i] !== null && arr[i] !== undefined && arr[i] !== "") {
            values.push('"' + arr[i] + '"');
        }
    }

    if (!values.length) return "";

    return field + " isin {" + values.join(",") + "}";
}

// Map thue GTGT
function getVatRate(vatId) {
    const VAT_RATE_MAP = {
        "VAT_0": 0,
        "VAT_5": 5,
        "VAT_8": 8,
        "VAT_10": 10,
        "NON_VAT": 0
    };
    return lib.ESD_HD_COMMON.toFloat(
        VAT_RATE_MAP[vatId]
    ) || 0;
}

/**
 * Escape ký tự cho query SM
 */
function q(v) { 
    return (v == null ? "" : String(v))
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"'); 
}

/**
 * Build query dạng LIKE list: field like "*,A,*" OR ...
 */
function likeList(field, arr) {

    if (!arr || !arr.length) return "";

    var parts = [];

    for (var i = 0; i < arr.length; i++) {
        if (arr[i]) {
            parts.push(field + ' like "*,' + q(arr[i]) + ',*"');
        }
    }

    return parts.length ? "(" + parts.join(" or ") + ")" : "";
}

/**
 * Lấy quyền + build query phân quyền dữ liệu
 *
 * @param {string} contact - contact login
 * @param {string} moduleCode - mã phân quyền
 *
 * @returns {object}
 * {
 *   query: string,
 *   scope: string,
 *   rights: array,
 *   units: array
 * }
 */
function buildPermissionQueryDS(contact, moduleType){

    try {

        if (!contact) {
            return "1=0"
        }

        // ===== lấy quyền =====
        var result = lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(contact, moduleType);

        var data_scope = result.scope;
        var units = result.unit || [];

        var rights = [];
        if (vars['G.rights']) {
            rights = vars['G.rights'].toArray();
        }

        var contactQuery = 'contact.list like "*,' + q(contact) + ',*"';

        var finalQuery = "";

        // ===== CASE 1: QT_PQDL_01 (cá nhân) =====
        if (data_scope === "QT_PQDL_01") {

            finalQuery = contactQuery;
        }

        // ===== CASE 2: QT_PQDL_06 (full quyền) =====
        else if (data_scope === "QT_PQDL_06") {

            var rightQuery = likeList("right.list", rights);

            finalQuery = rightQuery
                ? rightQuery + " or " + contactQuery
                : contactQuery;
        }

        // ===== CASE 3: scope bình thường =====
        else {

            var scopeQuery = likeList("scope.list", units);
            var rightQuery = likeList("right.list", rights);

            var mainQuery = "";

            if (scopeQuery && rightQuery) {
                mainQuery = "(" + scopeQuery + " and " + rightQuery + ")";
            } 
            else if (rightQuery) {
                mainQuery = rightQuery;
            }

            finalQuery = mainQuery
                ? mainQuery + " or " + contactQuery
                : contactQuery;
        }

        return finalQuery

    } catch (e) {

        print("[ESD_Utils.buildPermissionQueryDS] error: " + e);

        return "1=0";
    }
}

