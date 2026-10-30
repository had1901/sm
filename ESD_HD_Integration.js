// Tạo mới contract payment
function createContractPayment(record) {
    try {

        const nextNumber = lib.ESD_Utils.generateNextNumber("esdHDcontractPayment");

        const payload = {
            "id": nextNumber,
            "contract.id": record["contract.id"],
            "document.id": record["id"],
            "document.type": record["transaction.type"],
            "actual.date": record["created.at"],
            "created.at": record["created.at"],
            "currency.code": record["currency"],
            "completed.date": record["completed.date"],
            "amount.advance": record["amount"] || "",
            "amount.payment": record["total.amount.paid"] || "",
            "amount.accept": record["approved.invoice.amount"],
            "amount.refund": record["total.refund.amount"] || "",
            "unit.lv1": record["unit.lv1"],
            "unit.lv2": record["unit.lv2"],
            "executor.id": record["created.by"],
            "transaction.content": record["description"],
            "status": record["status"],
            "supplier": record["supplier"] || ""
        };

        lib.ESD_Utils.CreateTicket("esdHDcontractPayment", payload);

    } catch (e) {
        print("createContractPayment: " + e);
    }
}

// Cập nhật contract payment
function updateContractPayment(record) {

    if (!record || !record["id"]) return;

    let f = null;

    try {

        f = new SCFile("esdHDcontractPayment");

        const rc = f.doSelect(`document.id="${record["id"]}"`);

        if (rc == RC_SUCCESS) {

            f["completed.date"] = record["completed.date"];

            f["amount.advance"] = record["amount"] || "";
            f["amount.payment"] = record["total.amount.paid"] || "";
            f["amount.accept"] = record["approved.invoice.amount"] || "";
            f["amount.refund"] = record["total.refund.amount"] || "";

            f["unit.lv1"] = record["unit.lv1"] || "";
            f["unit.lv2"] = record["unit.lv2"] || "";

            f["executor.id"] = record["created.by"] || "";
            f["transaction.content"] = record["description"] || "";
            f["status"] = record["status"];
            f["supplier"] = record["supplier"];

            const updateRc = f.doUpdate();

            if (updateRc != RC_SUCCESS) {
                print("Đã xảy ra lỗi: " + system.functions.valmessage(updateRc));
            }

        } else {
            createContractPayment(record);
        }

    } catch (e) {
        print("updateContractPayment: " + e);
    } finally {
        if (f) {
            f.doClose();
        }
    }
}

// Xóa contract payment
function deleteContractPayment(record) {

    if (!record || !record["id"]) return;

    let f = null;

    try {

        f = new SCFile("esdHDcontractPayment");

        const rc = f.doSelect(`document.id="${record["id"]}"`);

        if (rc == RC_SUCCESS) {

            const delRc = f.doDelete();

            if (delRc != RC_SUCCESS) {
                print("Đã xảy ra lỗi khi xóa bản ghi: " + system.functions.valmessage(delRc));
            }
        }

    } catch (e) {
        print("deleteContractPayment: " + e);
    } finally {
        if (f) {
            f.doClose();
        }
    }
}