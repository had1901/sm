
function popup_add_e_form(file, file_name_template, tableName) {
    var activityTable = tableName ? "activity" + tableName.replace(/^esd/, "") : null;
    const taskName = lib.ESD_Utils.getCommonName(
        'esdMSkmsTaskStep',
        `kms.id="${file.id}" and task.parent~="" and status="Dang thuc hien"`,
        'task.name'
    ) || '';
    try {
        if (!file || !file.id) {
            return {
                Code: "false",
                Msg: "Thiếu thông tin file"
            };
        }
        // upload ECM
        var result = lib.ESD_ECM_SERVICE.uploadFileTaiLieu({
            "docCat": "E-form " + file.id,
            "docName": "E-form " + file.id,
            "cifNum": file.id,
            "accNum": file.id,
            "docCreated": system.functions.tod(),
            "sourceId": "CSEP_QLTS",
            "sessionId": "csep_session",
            "appId": "NEWTPSS",
            "fileBytes": vars["$base64PDF"],
            "fileName": file_name_template + ".pdf",
            "seq": "1",
            "userId": "ach"
        });
        result = JSON.parse(result);
        if (result) {
            var nextId = lib.ESD_Utils.generateNextNumber("esdMSdxmsAttach");
            var excutorFormat = system.user.name ? system.user.name.toUpperCase() : "";
            // upload esdMSdxmsAttach
            var res_sm_attach = lib.ESD_Utils.CreateTicket("esdMSdxmsAttach", {
                "id": nextId,
                "dxms.id": file.id,
                "name": file_name_template,
                "document.type": "E-form",
                "executor": excutorFormat,
                "attach.id": result.Data[0].ObjectId,
                "attach.type": "Trinh ky",
                "doc.id": result.Data[0].DocId,
                "table": file.table,
                "dxms.status.step": taskName
            });

            // handle write logs activity when success
            if (activityTable) {
                var isCreateAttachSuccess =
                    res_sm_attach &&
                    res_sm_attach.Code != "false";
                if (isCreateAttachSuccess && activityTable) {
                    lib.ESD_ApiCustomScript_DXMS_Functions.createActivity(
                        activityTable,
                        "Tạo Eform thành công.",
                        file.id,
                        "Thêm mới",
                        null
                    );
                }
            }

            return result;
        }

        return {
            Code: "false",
            Msg: "Upload ECM thất bại",
            Data: result
        };

    } catch (err) {
        return {
            Code: "false",
            Msg: "Thất bại: " + err
        };
    }
}

function get_file_ecm(file) {
    try {
        if (file.DOC_OBJECTID) {
            var params = [{
                DOC_OBJECTID: file.DOC_OBJECTID,
                APP_ID: "NEWTPSS",
                SESSION_ID: "csep_session"
            }];

            var data = lib.ESD_ECM_SERVICE.downloadDocument(params);

            return {
                success: data.success,
                message: data.message,
                data: data.data,
                //            params, status 
            };
        }
        if (!file || !file.id) {
            return {
                Code: "Fail",
                Msg: "Thiếu file.id"
            };
        }

        var fields = ["dxms.id", "name", "attach.type", "executor", "attach.id", "status"];

        var result = lib.ESD_Utils.fetchData(
            "esdMSdxmsAttach",
            'dxms.id="' + file.id + '" and attach.type="Trinh ky"',
            fields
        );

        if (!result || result.length == 0) {
            return [];
        }
        var status = false;
        var resultApproval = lib.ESD_Utils.fetchData(
            "esdMSdxmsApproval",
            'dxms.id="' + file.id + '" and approval.status="Da phe duyet"' + 'AND tolower(approver.id)="' + file.userad.toLowerCase() + '"',
            fields
        );
        if (resultApproval.length > 0) {
            status = true;
        }
        var params = result
            .filter(function(item) {
                return item["attach.id"];
            })
            .map(function(item) {
                return {
                    DOC_OBJECTID: item["attach.id"],
                    APP_ID: "NEWTPSS",
                    SESSION_ID: "csep_session"
                };
            });

        if (!params.length) {
            return [];
        }
        //        var finalData = []
        //        for(var i =0;i<params.length;i++){
        //            var singlePagram = params[i];
        //            print(JSON.stringify(singlePagram))
        //            var res = lib.ESD_ECM_SERVICE.downloadDocument([singlePagram]);
        //            print(JSON.stringify(res))
        //            if(res){
        //            finalData.push(res.data);
        //            }
        //        }
        var data = {};
        for (var i = 0; i < params.length; i++) {
            var res = lib.ESD_ECM_SERVICE.downloadDocument([params[i]]);
            Object.assign(data, res.data.Data);
            // name.pdf : base64
            // data.push({
            //                params[i].DOC_OBJECTID + ".pdf": Object
            //            })
        }

        //        var data = lib.ESD_ECM_SERVICE.downloadDocument(params);

        return { success: data.success, message: data.message, data: { Data: data }, params, status };
        //        return { success: data.success, message: data.message, data: finalData, params, status };

    } catch (err) {

        return {
            Code: "Fail",
            Msg: "get_file_ecm error: " + err
        };
    }
}

/**
ky-so 
Check trạng thái ký số
HSM: gui luon
SMCA: Ký xong gửi 1 request -> wait từ vấn tin -> kết quả ký số -> gọi [sendInfoSign] lần 2 để lưu xem thành công hay thất bại.
@params {
      id,
      userad,
      object_ids[{
        old: "11kjfkjakljkdfla",
        new: "22ckclpapdaop;ao".
      }],
      sign_tech: HSM | SMART-GOI,
 
}
@return {
 
}
*/
function ky_so(file, expectExpense) {
    lib.ESD_Utils.writeSystemLog(JSON.stringify(file));
    try {
        file = file || {};
        var tableName = file.tableName;
        var id = file.id;
        var userad = file.userad;
        var object_ids = file.objectIds;
        var sign_tech = file.signTech;
        var status = "WAIT";
        var expenseId = String(id || "").trim();
        var isExpense = /^DC\.[A-Za-z0-9._-]+$/.test(expenseId);
        var expenseSignTech = String(sign_tech || "").toUpperCase();

        if (isExpense) {
            id = expenseId;
            userad = String(userad || "").trim();
            if (!userad || !object_ids || !object_ids.length || !object_ids[0] ||
                !lib.ESD_HTKT_EXPENSE_SIGNATURE) {
                return { statusCode: "01", statusDesc: "Thong tin ky so Du chi khong hop le." };
            }
        } else if (expectExpense === true || expenseId.indexOf("DC.") === 0) {
            return { statusCode: "01", statusDesc: "Ma phieu Du chi khong hop le." };
        } else {
            // updateTable chi thao tac tren esdMSdxmsAttach, khong dung cho Du chi.
            updateTable(id, object_ids);
        }
        if ((isExpense ? expenseSignTech : sign_tech) == "HSM") status = "SUCCESS";

        switch (true) {
            case isExpense:
                if (lib.ESD_HTKT_EXPENSE_SIGNATURE.signatureExpense(
                    id, userad.toUpperCase(), status, object_ids
                ) !== true) {
                    return { statusCode: "01", statusDesc: "Khong cap nhat duoc ket qua ky so Du chi." };
                }
                if (expenseSignTech != "HSM" && !object_ids[0]["new"] &&
                    !lib.ESD_HTKT_EXPENSE_SIGNATURE.createScheduleSignatureHTKT(id, 10)) {
                    return { statusCode: "01", statusDesc: "Khong tao duoc lich van tin ky so Du chi." };
                }
                break;
            case tableName === "esdMSdxms":
                lib.ESD_MS_DXMS_COMMON.signatureDXMS(id, userad.toUpperCase(), status);
                if (sign_tech != "HSM") lib.ESD_MS_DXMS_SIGNATURE.createScheduleSignatureDXMS(id, 10);
                break;
            case tableName === "esdMSttms":
                lib.ESD_MS_TTMS_COMMON.signatureTTMS(id, userad.toUpperCase(), status);
                if (sign_tech != "HSM") lib.ESD_MS_TTMS_SIGNATURE.createScheduleSignatureTTMS(id, 10);
                break;
            case tableName === "esdMSdgbg":
                lib.ESD_MS_DGBG_COMMON.signatureDGBG(id, userad.toUpperCase(), status);
                if (sign_tech != "HSM") lib.ESD_MS_DGBG_SIGNATURE.createScheduleSignatureDGBG(id, 10);
                break;
            case tableName === "esdMSycbg":
                lib.ESD_MS_YCBG_COMMON.signatureYCBG(id, userad.toUpperCase(), status);
                if (sign_tech != "HSM") lib.ESD_MS_YCBG_SIGNATURE.createScheduleSignatureYCBG(id, 10);
                break;
            case tableName === "esdHTKTprepayment" || String(id || "").indexOf("TU") === 0:
                lib.ESD_HTKT_SIGNATURE.signaturePrepayment(id, userad.toUpperCase(), status, object_ids);
                if (sign_tech != "HSM") lib.ESD_HTKT_SIGNATURE.createScheduleSignatureHTKT(id, 10);
                break;
            case tableName === "esdHTKTpayment" || String(id || "").indexOf("TT") === 0:
                lib.ESD_HTKT_PAYMENT_SIGNATURE.signaturePayment(id, userad.toUpperCase(), status, object_ids);
                if (sign_tech != "HSM") lib.ESD_HTKT_PAYMENT_SIGNATURE.createScheduleSignatureHTKT(id, 10);
                break;
            case tableName === "esdMSkhlcnt" || tableName === "esdMShsmt" ||
                tableName === "esdMSbcdg" || tableName === "esdMSkqlcnt":
                lib.ESD_MS_YCBG_COMMON.signatureHSM(id, userad.toUpperCase(), status, tableName);
                if (sign_tech != "HSM") lib.ESD_MS_YCBG_SIGNATURE.createScheduleSignature(id, 10, 240, tableName);
                break;
            default:
                lib.ESD_MS_DXMS_COMMON.signatureDXMS(id, userad.toUpperCase(), status);
                if (sign_tech != "HSM") lib.ESD_MS_DXMS_SIGNATURE.createScheduleSignatureDXMS(id, 10);
        }

        var response = { statusCode: "00", file: file };
        if (isExpense) response.statusDesc = "Thanh cong.";
        return response;
    } catch (ex) {
        lib.ESD_Utils.writeSystemLog("[HTKT_SIGNATURE] ky_so: " + ex);
        return { statusCode: "01", statusDesc: String(ex) };
    }
}

function updateTableMSdxmsApproval(dxmsId, userad) {
    var file = new SCFile("esdMSdxmsApproval");
    var rc = file.doSelect('dxms.id="' + dxmsId + '"' + 'AND tolower(approver.id)="' + userad.toLowerCase() + '"');
    while (rc == RC_SUCCESS) {
        file["approval.status"] = 'Da phe duyet';
        rc = file.doUpdate();
        rc = file.getNext();
    }
}

function updateTable(dxmsId, object_ids) {
    var file = new SCFile("esdMSdxmsAttach");
    var rc = file.doSelect('dxms.id="' + dxmsId + '"');
    while (rc == RC_SUCCESS) {
        for (var i = 0; i < object_ids.length; i++) {
            var obj = object_ids[i];
            if (obj.old && obj["new"] && file["attach.id"] == obj.old) {
                file["attach.id"] = obj["new"];
                file["transactionId"] = obj.transactionId;
            }
            if (file["attach.id"] == obj.old) {
                file["transactionId"] = obj.transactionId;
            }
            file.doUpdate();
        }
        rc = file.getNext();
    }
}

/**
 * @params {objectid[], id phiếu, userad}
 */

function deleteFileECM(params) {
    var objectIds = params.objectids;
    var id = params.id;
    var user = params.user;
    var tableName = params.tableName;
    try {
        var resECM = lib.ESD_ECM_SERVICE.deleteDocument(objectIds);
        if (resECM && resECM.success) {
            var resSM = deleteTable(id, objectIds, tableName);
            if (resSM) return {
                statusCode: "00",
                message: "success"
            }
        }


        return {
            statusCode: "01",
            message: "Thất bại"
        }
    } catch (ex) {
        return {
            statusCode: "01",
            message: ex
        }
    }
}

//function deleteTable(id, object_ids, tableName) {
//    tableName = tableName || "esdMSdxmsAttach";
//    var key = tableName === "esdMSdxmsAttach" ? 'dxms.id' : 'parent.id';
//    var file = new SCFile(tableName);
//    var rc = file.doSelect(key + '="' + id + '"');
//    while (rc == RC_SUCCESS) {
//        for (var i = 0; i < object_ids.length; i++) {
//            var obj = object_ids[i];
//            print("docid", file["doc.id"], obj.DOC_ID)
//            if (file["doc.id"] == obj.DOC_ID) {
//                rc = file.doDelete();
//                break;
//            }
//        }
//        rc = file.getNext();
//    }
//}

function deleteTable(id, object_ids, tableName) {
    tableName = tableName || "esdMSdxmsAttach";

    var key = tableName === "esdMSdxmsAttach" ?
        "dxms.id" :
        "parent.id";

    var file = new SCFile(tableName);
    var rc = file.doSelect(key + '="' + id + '"');
    var deletedCount = 0;

    while (rc == RC_SUCCESS) {
        for (var i = 0; i < object_ids.length; i++) {
            if (file["doc.id"] == object_ids[i].DOC_ID) {
                var deleteRc = file.doDelete();

                if (deleteRc != RC_SUCCESS) {
                    return false;
                }

                deletedCount++;
                break;
            }
        }

        rc = file.getNext();
    }

    return deletedCount == object_ids.length;
}

//pagrams{
//id : id phieu
//documentName : ten van ban,
//base64File : base64 file,
//user : user ad
//}
function addFileECM(file) {
    try {
        var extensionCheck = lib.ESD_INTEGRATIONS_HELPER.checkAllowedAttachmentExtension(file.type);

        if (!extensionCheck.isAllowed) {
            return {
                Code: "false",
                Msg: "Định dạng tập tin không được hỗ trợ.",
                Data: null
            };
        }

        var result = lib.ESD_ECM_SERVICE.uploadFileTaiLieu({
            "docCat": file.documentName,
            "docName": file.documentName,
            "cifNum": file.id,
            "accNum": file.id,
            "docCreated": system.functions.tod(),
            "sourceId": "CSEP_QLTS",
            "sessionId": "csep_session",
            "appId": "NEWTPSS",
            "fileBytes": file.base64File,
            "fileName": file.documentName + "." + file.type,
            "seq": "1",
            "userId": "ach"
        });

        result = JSON.parse(result);
        if (result) {
            var nextId = lib.ESD_Utils.generateNextNumber("esdMSdxmsAttach");

            lib.ESD_Utils.CreateTicket("esdMSdxmsAttach", {
                "id": nextId,
                "dxms.id": file.id,
                "name": file.documentName,
                "attach.type": "Trinh ky",
                "executor": file.user,
                "attach.id": result.Data[0].ObjectId,
                "note": file.note,
                "document.type": "Tài liệu đính kèm hồ sơ",
                "doc.id": result.Data[0].DocId,
                "is.authority.approval": file['is.authority.approval'],
                "is.stamp.number": file['is.stamp.number'],
                "dxms.status.step": file.taskName
            });

            return {
                Code: "OK",
                Msg: "Cap nhat thanh cong",
                Data: result
            };
        }

        return {
            Code: "false",
            Msg: "Upload ECM thất bại",
            Data: result
        };

    } catch (err) {
        return {
            Code: "false",
            Msg: "Thất bại: " + err
        };
    }
}

/** 
 * check status sign in esdMSdxmsApproval, esdMSkmsApproval
 */
function getStatusSign(file) {
    var status = false;
    if (!file) {
        return { Code: "Fail", status };
    }
    var conditionKms = file.tableName == "esdMSttms" || file.tableName == "esdMSdgbg" || file.tableName == "esdMSycbg";
    var keyField = conditionKms ? "parent.id" : "dxms.id";
    var approvalTbl = conditionKms ? "esdMSkmsApproval" : "esdMSdxmsApproval";

    var fields = [keyField, "approval.status", "approver.id"];
    var resultApproval = lib.ESD_Utils.fetchData(
        approvalTbl,
        keyField + '="' + file.id + '"and approval.status="Da phe duyet"' + 'and tolower(approver.id)="' + file.userad.toLowerCase() + '"',
        fields
    );

    if (resultApproval.length > 0) {
        status = true;
    }

    return { Code: "OK", status }
}

function getStatusKySo(dxmsId) {
    try {
        var resultToken = lib.ESD_DIGITAL_SIGNATURE.getTokenKeycloak();
        var access_token = resultToken.access_token;
        var uuid = dxmsId;

        var fields = [
            "dxms.id",
            "attach.type",
            "attach.id",
            "transactionId",
            "doc.id"
        ];

        var attachData = lib.ESD_Utils.fetchData(
            "esdMSdxmsAttach",
            'dxms.id="' + dxmsId + '" and attach.type="Trinh ky"',
            fields
        );
        //        print("attachDataeeee", JSON.stringify(attachData))
        if (!attachData || attachData.length == 0) {
            return "Error";
        }

        var results = [];
        var payloadDelECM = [];
        for (var i = 0; i < attachData.length; i++) {

            var transaction_id = attachData[i]["transactionId"];
            if (!transaction_id) {
                return "Error";
            }

            var body = {
                "requestId": uuid,
                "username": null,
                "password": null,
                "clientDt": "1695974522",
                "channel": "A100_IBC",
                "reftype": "x",
                "refid": null,
                "sessionkey": null,
                "spname": null,
                "data": {
                    "app_id": "A452_DSM",
                    "transaction_id": transaction_id
                }
            };

            var pagram = {
                accessToken: access_token,
                requestId: uuid,
                requestTime: system.functions.tod(),
                body: body
            };
            var objectidext = null;
            var rs = lib.ESD_DIGITAL_SIGNATURE.getStatusSign(pagram);
            //            print(rs)
            rs = JSON.parse(rs)
            if (rs.data.signed.length > 0) {
                objectidext = rs.data.signed[0].objectidext;
            }
            if (!objectidext) {
                print("Chưa đủ dữ liệu, dừng update");
                return "Error";
            }
            payloadDelECM.push({
                docId: attachData[i]["doc.id"],
                appId: "NEWTPSS",
                sessionId: "A1B2C3"
            });
            results.push({
                transactionId: transaction_id,
                objectidext: objectidext
            });
        }


        for (var j = 0; j < results.length; j++) {
            var item = results[j];
            var f = new SCFile("esdMSdxmsAttach");
            var rc = f.doSelect('transactionId="' + item.transactionId + '"');

            if (rc == RC_SUCCESS) {
                f.status = "Da co chu ky so";
                f["attach.id"] = item.objectidext;
                f.doUpdate();
            }
        }

        lib.ESD_ECM_SERVICE.deleteDocument(payloadDelECM);

        return "SUCCESS";

    } catch (ex) {
        print("Lỗi: " + ex);
    }
}

function updateParentDigitizationStatus(parentId) {
    if (!parentId) return;

    var fDigit = new SCFile('esdHDdigitization');
    var rc = fDigit.doSelect(`id = "${parentId}"`);
    if (rc !== 0) {
        fDigit.doClose();
        return;
    }

    var currentStatus = fDigit['status'];

    // Đã hoàn thành từ trước thì không xử lý gì thêm
    if (currentStatus === 'Hoan thanh') {
        fDigit.doClose();
        return;
    }

    // Đếm x/y trong esdHDtlks theo parent.id
    var total = 0;
    var doneCount = 0;
    try {
        var tlksList = lib.ESD_Utils.fetchData(
            "esdHDtlks",
            `parent.id = "${parentId}"`,
            ["id", "status"]
        ) || [];

        total = tlksList.length;
        doneCount = tlksList.filter(function(item) {
            return item["status"] !== "Cho ky so";
        }).length;
    } catch (eCount) {
        print('[updateParentDigitizationStatus] Lỗi đếm x/y: ' + eCount.message);
        fDigit.doClose();
        return;
    }

    // x = y -> Hoan thanh; x < y -> Dang so hoa tai lieu
    var newStatus = (total > 0 && doneCount === total) ? 'Hoan thanh' : 'Dang so hoa tai lieu';
    var dshtlText = (newStatus === 'Hoan thanh') ? '' : ('(' + doneCount + '/' + total + ')');

    var statusChanged = newStatus !== currentStatus;
    var currentDshtl = fDigit['status.dshtl'] || '';
    var dshtlChanged = currentDshtl !== dshtlText;

    // Không có gì thay đổi (cả status lẫn x/y) thì thôi, không cần update
    if (!statusChanged && !dshtlChanged) {
        fDigit.doClose();
        return;
    }

    // Luôn cập nhật status.dshtl theo giá trị x/y mới nhất
    fDigit['status.dshtl'] = dshtlText;

    if (statusChanged) {
        fDigit['status'] = newStatus;
        fDigit['current.phase'] = newStatus;
        if (newStatus === 'Hoan thanh') {
            fDigit['complete.date'] = system.functions.tod();
        } else {
            fDigit['complete.date'] = '';
        }
    }

    var rcUpdate = fDigit.doUpdate();
    if (rcUpdate === 0) {
        //        if (statusChanged) {
        //            try {
        //                var createActivity = lib.ESD_Utils.createActivity;
        //                createActivity(
        //                    'activityHDdigitization',
        //                    'Cập nhật trạng thái: "' + currentStatus + '" → "' + newStatus + '"' +
        //                        (newStatus !== 'Hoan thanh' ? ' ' + dshtlText : ''),
        //                    parentId,
        //                    'Cập nhật'
        //                );
        //            } catch (eActivity) {
        //                print('Lỗi ghi activity: ' + eActivity.message);
        //            }
        //        }
    } else {
        print('Update esdHDdigitization thất bại, id = ' + parentId);
    }

    fDigit.doClose();
}

function getStatusKySoHD(records) {
    try {
        var resultToken = lib.ESD_DIGITAL_SIGNATURE.getTokenKeycloak();
        var access_token = resultToken.access_token;

        var results = [];
        for (var i = 0; i < records.length; i++) {
            var transaction_id = records[i]["transaction.id"];
            var attach_id = records[i]["attach.id"];
            if (!transaction_id) {
                return "Error";
            }
            var uuid = transaction_id;
            var body = {
                "requestId": uuid,
                "username": null,
                "password": null,
                "clientDt": "1695974522",
                "channel": "A100_IBC",
                "reftype": "x",
                "refid": null,
                "sessionkey": null,
                "spname": null,
                "data": {
                    "app_id": "A452_DSM",
                    "transaction_id": transaction_id
                }
            };
            var pagram = {
                accessToken: access_token,
                requestId: uuid,
                requestTime: system.functions.tod(),
                body: body
            };
            var objectidext = null;
            var rs = lib.ESD_DIGITAL_SIGNATURE.getStatusSign(pagram);
            rs = JSON.parse(rs);
            if (rs.data.signed.length > 0) {
                objectidext = rs.data.signed[0].objectidext;
            }
            if (!objectidext) {
                print("Chưa đủ dữ liệu, dừng update");
                return "Error";
            }
            results.push({
                oldAttachId: attach_id,
                transactionId: transaction_id,
                objectidext: objectidext
            });
        }

        var affectedParentIds = {};
        for (var j = 0; j < results.length; j++) {
            var item = results[j];
            var f = new SCFile("esdHDtlks");
            var rc = f.doSelect('attach.id="' + item.oldAttachId + '"');
            if (rc == RC_SUCCESS) {
                f.status = "So hoa thanh cong";
                f['transaction.id'] = item.transactionId;
                f["attach.id"] = item.objectidext;
                var parentId = f['parent.id'];
                var rcUpdate = f.doUpdate();
                if (rcUpdate == RC_SUCCESS && parentId) {
                    affectedParentIds[parentId] = true;
                }
            }
            f.doClose();
        }

        for (var pid in affectedParentIds) {
            updateParentDigitizationStatus(pid);
        }

        return "SUCCESS";
    } catch (ex) {
        print("Lỗi: " + ex);
    }
}
//start tam ung
/**
 * Vấn tin kết quả ký SmartCA cho prepayment HTKT.
 *
 * @param {string} prepaymentId - Mã đề nghị tạm ứng HTKT.
 * @returns {{status: "SUCCESS"|"PENDING"|"ERROR", objectidext?: string, attachmentId?: string}}
 */
function getStatusKySo_HTKT(prepaymentId) {
    prepaymentId = String(prepaymentId || "").trim();

    if (!prepaymentId) {
        return { status: "ERROR" };
    }

    try {
        var tokenResult = lib.ESD_DIGITAL_SIGNATURE.getTokenKeycloak();
        var accessToken = tokenResult && tokenResult.access_token;

        if (!accessToken) {
            return { status: "ERROR" };
        }

        // Đọc attachment TRINH_KY để lấy transactionId.
        // transactionId được lưu tại signatureConfirmReal khi SM nhận action ky-so.
        var attachmentFile = new SCFile(
            "esdHTKTprepaymentAttachment",
            SCFILE_READONLY
        );

        var rc = attachmentFile.doSelect(
            'prepayment.id="' +
            prepaymentId +
            '" and doc.code="TRINH_KY"'
        );

        if (rc != RC_SUCCESS) {
            try {
                attachmentFile.doClose();
            } catch (closeError) {
                // Bỏ qua lỗi đóng file.
            }

            return { status: "ERROR" };
        }

        // Tên field đúng theo dbdict: transactionId.
        var transactionId = String(
            attachmentFile["transactionId"] || ""
        ).trim();

        var attachmentId = String(
            attachmentFile["id"] || ""
        ).trim();

        try {
            attachmentFile.doClose();
        } catch (closeError) {
            // Bỏ qua lỗi đóng file.
        }

        if (!transactionId) {
            return {
                status: "PENDING",
                attachmentId: attachmentId
            };
        }

        // Vấn tin kết quả ký từ DSM.
        var body = {
            requestId: prepaymentId,
            username: null,
            password: null,
            clientDt: String(system.functions.tod()),
            channel: "A100_IBC",
            reftype: "x",
            refid: null,
            sessionkey: null,
            spname: null,
            data: {
                app_id: "A452_DSM",
                transaction_id: transactionId
            }
        };

        var params = {
            accessToken: accessToken,
            requestId: prepaymentId,
            requestTime: system.functions.tod(),
            body: body
        };

        var response = lib.ESD_DIGITAL_SIGNATURE.getStatusSign(params);
        var parsed = typeof response === "string" ?
            JSON.parse(response) :
            response;

        if (
            parsed &&
            parsed.data &&
            parsed.data.signed &&
            parsed.data.signed.length > 0
        ) {
            var signedRow = parsed.data.signed[0];
            var signCode = String(signedRow.status || "").trim();
            var objectIdExt = signedRow.objectidext ?
                String(signedRow.objectidext).trim() :
                "";

            // trưởng thêm: có objectidext (file mới đã ký lên ECM) -> dừng vấn tin.
            // 07: file kết quả đã được tải lên ECM.
            // 05 chỉ hoàn tất khi DSM đã trả objectidext.
            if (
                objectIdExt ||
                signCode === "07" ||
                (signCode === "05" && objectIdExt)
            ) {
                return {
                    status: "SUCCESS",
                    objectidext: objectIdExt || null,
                    attachmentId: attachmentId
                };
            }

            if (signCode) {
                return {
                    status: "PENDING",
                    attachmentId: attachmentId
                };
            }
        }

        return {
            status: "PENDING",
            attachmentId: attachmentId
        };
    } catch (error) {
        lib.ESD_Utils.writeSystemLog(
            "[HTKT_SIGNATURE] getStatusKySo error: " +
            (error && error.message ? error.message : String(error))
        );

        return { status: "ERROR" };
    }
}


//getStatusPhieu
function getStatusPhieu_HTKT(input) {
    input = input || {};

    var prepaymentId = String(
        input.id || input.prepaymentId || ""
    ).trim();

    var oldObjectId = String(
        input.oldObjectId || ""
    ).trim();

    if (!prepaymentId || !oldObjectId) {
        return {
            Code: "FAIL",
            status: false,
            Msg: "Thieu ma phieu hoac Object ID cu."
        };
    }

    var attachmentFile = null;

    try {
        attachmentFile = new SCFile(
            "esdHTKTprepaymentAttachment",
            SCFILE_READONLY
        );

        var safePrepaymentId = prepaymentId
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');

        var query =
            'prepayment.id="' + safePrepaymentId + '"' +
            ' and doc.code="TRINH_KY"';

        var rc = attachmentFile.doSelect(query);
        var oldAttachmentExists = false;
        var newObjectId = "";

        while (rc == RC_SUCCESS) {
            var objectId = String(
                attachmentFile["ecm.object.id"] || ""
            ).trim();

            if (objectId === oldObjectId) {
                oldAttachmentExists = true;
            } else if (objectId) {
                newObjectId = objectId;
            }

            rc = attachmentFile.getNext();
        }

        if (
            newObjectId !== "" &&
            oldAttachmentExists === false
        ) {
            return {
                Code: "OK",
                status: true
            };
        }

        return {
            Code: "OK",
            status: false
        };

    } catch (error) {
        return {
            Code: "FAIL",
            status: false,
            Msg: "Khong kiem tra duoc trang thai ky so."
        };

    } finally {
        try {
            if (attachmentFile) {
                attachmentFile.doClose();
            }
        } catch (closeError) {}
    }
}
//end tam ung

// start thanh toan 
function getStatusPhieu_Payment_HTKT(input) {
    input = input || {};

    var paymentId = "";
    var oldObjectId = "";

    if (typeof input === "object" && input !== null) {
        paymentId = String(input.id || input.paymentId || "").trim();
        oldObjectId = String(input.oldObjectId || input.old_object_id || "").trim();
    } else {
        paymentId = String(input || "").trim();
    }

    if (!paymentId || !oldObjectId) {
        return {
            Code: "FAIL",
            status: false,
            Msg: "Thieu ma phieu hoac Object ID cu."
        };
    }

    var attachmentFile = null;

    try {
        attachmentFile = new SCFile(
            "esdHTKTpaymentAttachment",
            SCFILE_READONLY
        );

        var safePaymentId = paymentId
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');

        var query =
            'payment.id="' + safePaymentId + '"' +
            ' and doc.code="TRINH_KY"';

        var rc = attachmentFile.doSelect(query);
        var oldAttachmentExists = false;
        var newObjectId = "";

        while (rc == RC_SUCCESS) {
            var objectId = String(
                attachmentFile["ecm.object.id"] || ""
            ).trim();

            if (objectId === oldObjectId) {
                oldAttachmentExists = true;
            } else if (objectId) {
                newObjectId = objectId;
            }

            rc = attachmentFile.getNext();
        }

        var completed =
            newObjectId !== "" &&
            oldAttachmentExists === false;

        return {
            Code: "OK",
            status: completed,
            pending: !completed
        };

    } catch (error) {
        return {
            Code: "FAIL",
            status: false,
            Msg: "Khong kiem tra duoc trang thai ky so."
        };

    } finally {
        try {
            if (attachmentFile) {
                attachmentFile.doClose();
            }
        } catch (closeError) {}
    }
}

/**
 * Vấn tin kết quả ký SmartCA cho payment HTKT.
 *
 * @param {string|object} input - Mã đề nghị thanh toán HTKT hoặc object chứa id/paymentId.
 * @returns {{status: "SUCCESS"|"PENDING"|"ERROR", objectidext?: string, attachmentId?: string}}
 */
function getStatusKySo_Payment_HTKT(input) {
    var paymentId = "";
    if (typeof input === "object" && input !== null) {
        paymentId = String(input.id || input.paymentId || "").trim();
    } else {
        paymentId = String(input || "").trim();
    }

    if (!paymentId) {
        return { status: "ERROR" };
    }

    try {
        var tokenResult = lib.ESD_DIGITAL_SIGNATURE.getTokenKeycloak();
        var accessToken = tokenResult && tokenResult.access_token;

        if (!accessToken) {
            return { status: "ERROR" };
        }

        // Đọc attachment TRINH_KY để lấy transactionId.
        // transactionId được lưu tại signatureConfirmReal khi SM nhận action ky-so.
        var attachmentFile = new SCFile(
            "esdHTKTpaymentAttachment",
            SCFILE_READONLY
        );

        var rc = attachmentFile.doSelect(
            'payment.id="' +
                paymentId +
                '" and doc.code="TRINH_KY"'
        );

        if (rc != RC_SUCCESS) {
            try {
                attachmentFile.doClose();
            } catch (closeError) {
                // Bỏ qua lỗi đóng file.
            }

            return { status: "ERROR" };
        }

        // Tên field đúng theo dbdict: transactionId.
        var transactionId = String(
            attachmentFile["transaction.id"] || ""
        ).trim();

        var attachmentId = String(
            attachmentFile["id"] || ""
        ).trim();

        try {
            attachmentFile.doClose();
        } catch (closeError) {
            // Bỏ qua lỗi đóng file.
        }

        if (!transactionId) {
            return {
                status: "PENDING",
                attachmentId: attachmentId
            };
        }

        // Vấn tin kết quả ký từ DSM.
        var body = {
            requestId: paymentId,
            username: null,
            password: null,
            clientDt: String(system.functions.tod()),
            channel: "A100_IBC",
            reftype: "x",
            refid: null,
            sessionkey: null,
            spname: null,
            data: {
                app_id: "A452_DSM",
                transaction_id: transactionId
            }
        };

        var params = {
            accessToken: accessToken,
            requestId: paymentId,
            requestTime: system.functions.tod(),
            body: body
        };

        var response = lib.ESD_DIGITAL_SIGNATURE.getStatusSign(params);
        var parsed = typeof response === "string"
            ? JSON.parse(response)
            : response;

        if (
            parsed &&
            parsed.data &&
            parsed.data.signed &&
            parsed.data.signed.length > 0
        ) {
            var signedRow = parsed.data.signed[0];
            var signCode = String(signedRow.status || "").trim();
            var objectIdExt = signedRow.objectidext
                ? String(signedRow.objectidext).trim()
                : "";

            // trưởng thêm: có objectidext (file mới đã ký lên ECM) -> dừng vấn tin.
            // 07: file kết quả đã được tải lên ECM.
            // 05 chỉ hoàn tất khi DSM đã trả objectidext.
            if (
                objectIdExt ||
                signCode === "07" ||
                (signCode === "05" && objectIdExt)
            ) {
                return {
                    status: "SUCCESS",
                    objectidext: objectIdExt || null,
                    attachmentId: attachmentId
                };
            }

            if (signCode) {
                return {
                    status: "PENDING",
                    attachmentId: attachmentId
                };
            }
        }

        return {
            status: "PENDING",
            attachmentId: attachmentId
        };
    } catch (error) {
        lib.ESD_Utils.writeSystemLog(
            "[HTKT_PAYMENT_SIGNATURE] getStatusKySo_Payment_HTKT error: " +
            (error && error.message ? error.message : String(error))
        );

        return { status: "ERROR" };
    }
}

//end thanh toan

function getStatusPhieu_Expense_HTKT(input) {
    input = input || {};
    var id = String(input.id || "").trim();
    var oldObjectId = String(input.oldObjectId || "").trim();
    if (!/^DC\.[A-Za-z0-9._-]+$/.test(id) || !oldObjectId) {
        return { Code: "FAIL", status: false, Msg: "Thieu ma Du chi hoac Object ID cu." };
    }

    var attachment = null;
    try {
        attachment = new SCFile("esdHTKTpaymentAttachment", SCFILE_READONLY);
        var safeId = id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        var rc = attachment.doSelect('payment.id="' + safeId + '" and doc.code="TRINH_KY"');
        var oldExists = false;
        var newExists = false;
        while (rc == RC_SUCCESS) {
            var objectId = String(attachment["ecm.object.id"] || "").trim();
            if (objectId === oldObjectId) oldExists = true;
            else if (objectId) newExists = true;
            rc = attachment.getNext();
        }
        var completed = newExists && !oldExists;
        return { Code: "OK", status: completed, pending: !completed };
    } catch (error) {
        lib.ESD_Utils.writeSystemLog("[HTKT_EXPENSE_SIGNATURE] getStatusPhieu_Expense_HTKT: " + error);
        return { Code: "FAIL", status: false, Msg: "Khong kiem tra duoc trang thai ky so Du chi." };
    } finally {
        try { if (attachment) attachment.doClose(); } catch (closeError) {}
    }
}

function getStatusKySo_Expense_HTKT(input) {
    var id = typeof input === "object" && input !== null
        ? String(input.id || input.expenseId || "").trim()
        : String(input || "").trim();
    if (!/^DC\.[A-Za-z0-9._-]+$/.test(id)) return { status: "ERROR" };

    var attachment = null;
    try {
        attachment = new SCFile("esdHTKTpaymentAttachment", SCFILE_READONLY);
        var safeId = id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        var rc = attachment.doSelect(
            'payment.id="' + safeId + '" and doc.code="TRINH_KY"'
        );
        if (rc != RC_SUCCESS) return { status: "ERROR" };

        var transactionId = String(attachment["transaction.id"] || "").trim();
        var attachmentId = String(attachment.id || "").trim();
        if (!transactionId) return { status: "PENDING", attachmentId: attachmentId };

        var tokenResult = lib.ESD_DIGITAL_SIGNATURE.getTokenKeycloak();
        var accessToken = tokenResult && tokenResult.access_token;
        if (!accessToken) return { status: "ERROR", attachmentId: attachmentId };

        var requestTime = system.functions.tod();
        var params = {
            accessToken: accessToken,
            requestId: id,
            requestTime: requestTime,
            body: {
                requestId: id,
                username: null,
                password: null,
                clientDt: String(requestTime),
                channel: "A100_IBC",
                reftype: "x",
                refid: null,
                sessionkey: null,
                spname: null,
                data: { app_id: "A452_DSM", transaction_id: transactionId }
            }
        };
        var response = lib.ESD_DIGITAL_SIGNATURE.getStatusSign(params);
        var parsed = typeof response === "string" ? JSON.parse(response) : response;
        var signed = parsed && parsed.data && parsed.data.signed && parsed.data.signed[0];
        var objectIdExt = signed ? String(signed.objectidext || "").trim() : "";
        if (objectIdExt) {
            return { status: "SUCCESS", objectidext: objectIdExt, attachmentId: attachmentId };
        }
        return { status: "PENDING", attachmentId: attachmentId };
    } catch (error) {
        lib.ESD_Utils.writeSystemLog("[HTKT_EXPENSE_SIGNATURE] getStatusKySo_Expense_HTKT: " + error);
        return { status: "ERROR" };
    } finally {
        try { if (attachment) attachment.doClose(); } catch (closeError) {}
    }
}
