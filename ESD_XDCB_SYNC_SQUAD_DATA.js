// Nguoi tao: hadv
// Ngay tao: 30/10/2026
// Nguoi cap nhat: hadv
// Ngay cap nhat: 30/10/2026
// Mo ta chuc nang: Validate truong du lieu bat buoc
function requireFields(obj, fields) {
    if (!obj || typeof obj !== "object") {
        return "Dữ liệu đầu vào không hợp lệ.";
    }
    var errors = [];
    Object.keys(fields).forEach(key => {
        if ((obj[key] === null || obj[key] === undefined || obj[key] === "") && !!key && !!fields[key]) {
            errors.push(`${fields[key]} (${key})`);
        }
    });
    if (errors.length > 0) {
        return `Trường dữ liệu ${errors.join(", ")} là bắt buộc.`;
    }
    return "";
}

// Nguoi tao: hadv
// Ngay tao: 30/10/2026
// Nguoi cap nhat: hadv
// Ngay cap nhat: 30/10/2026
// Mo ta chuc nang: Validate truong du lieu bat buoc nhung cho phep trong
function requireFieldsAllowEmpty(obj, fields) {
    if (!obj || typeof obj !== "object") {
        return "Dữ liệu đầu vào không hợp lệ.";
    }
    var errors = [];
    Object.keys(fields).forEach(key => {
        if ((obj[key] === null || obj[key] === undefined) && !!key && !!fields[key]) {
            errors.push(`${fields[key]} (${key})`);
        }
    });
    if (errors.length > 0) {
        return `Trường dữ liệu ${errors.join(", ")} là bắt buộc (cho phép trống).`;
    }
    return "";
}

// Nguoi tao: hadv
// Ngay tao: 30/10/2026
// Nguoi cap nhat: hadv
// Ngay cap nhat: 30/10/2026
// Mo ta chuc nang: Doi voi TH1: id.contract cua esdHDdigitization la id HD va type.document="XDCB_CTSC_XMCT_TTQ"
//                  Ngay sau khi sự kiện thanh toán thành công diễn ra S6 truy vấn CSDL S4 và cập nhật cho S4, Thêm mới bản ghi esdXDCBrepairProjectCtrPayment 
//                  SQ6 gui lai id HD va du lieu can them moi
function squad6ThemMoiTienDoThanhToanTamUngCuaHDTH1(hdId, insertFields) {
    if (!hdId) {
        print(`Trường dữ liệu id Hợp đồng là bắt buộc`);
        return;
    }
    var messErrorRequireFields = requireFields(insertFields, {
        "payment.category": "Phân loại TUTT",
        "value": "Số tiền thanh toán thực tế",
        "proposed.date": "Ngày đề xuất",
        "approved.date": "Ngày thanh toán thực tế",
        "vendor.id": "MST NCC"
    });

    if (!!messErrorRequireFields) {
        print(messErrorRequireFields);
        return;
    }
    var messErrorRequireFieldsAllowEmpty = requireFieldsAllowEmpty(insertFields, {
        "vendor.name": "Tên NCC",
        "bank.account": "STK NCC",
        "bank.name": "Tên ngân hàng NCC"
    });
    if (!!messErrorRequireFieldsAllowEmpty) {
        print(messErrorRequireFieldsAllowEmpty);
        return;
    }
    var paymentCategory = insertFields["payment.category"];
    if (!["Tạm ứng", "Thanh toán"].includes(paymentCategory)) {
        print(`Trường dữ liệu payment.category phải là Tạm ứng | Thanh toán`);
        return;
    }
    var paymentAmount = Number(insertFields["value"]);
    if (!isFinite(paymentAmount) || paymentAmount <= 0) {
        print("Trường dữ liệu Số tiền thanh toán thực tế phải là số lớn hơn 0.");
        return;
    }
    var id = lib.ESD_Utils.generateNextNumber("esdXDCBrepairProjectCtrPayment");

    var contract = lib.ESD_Utils.getOneRecord("esdXDCBrepairProjectCtr", `id="${hdId}"`, ["contract.code", "contract.name", "tender.package.id", "total.amount.paid"]);
    if (!contract) {
        print("Không tìm thấy hợp đồng.");
        return;
    }

    var sc = new SCFile("esdXDCBrepairProjectCtrPayment");
    Object.keys(insertFields).forEach(key => {
        sc[key] = insertFields[key];
    });
    sc["id"] = id;
    sc["contract.id"] = hdId;
    sc["contract.code"] = contract["contract.code"];
    sc["currency"] = "VND";
    sc["created.at"] = system.functions.tod();
    sc["status"] = "Đã thanh toán";
    // Thêm mới bản ghi tiến độ thanh toán cho hợp đồng
    var insertRc = sc.doInsert();
    if (sc) {
        sc.doClose();
    }
    if (insertRc !== RC_SUCCESS) {
        print("Không thể thêm bản ghi tiến độ thanh toán.");
        return;
    }
    // Cập nhật tiền cho hợp đồng
    lib.ESD_Utils.updateFieldsOne("esdXDCBrepairProjectCtr", `id="${hdId}"`, {
        "total.amount.paid": (contract["total.amount.paid"] || 0) + paymentAmount
    });
    // Cập nhật tiền cho nhà thầu trong gói thầu
    var joinRecord = lib.ESD_Utils.getOneRecord("esdjoinXDCBtenderPackageContractor ", `tender.package.id="${contract["tender.package.id"]}" and tax.code="${insertFields["vendor.id"]}"`, ["total.amount.paid"]);
    if (!joinRecord) {
        return;
    }
    lib.ESD_Utils.updateFieldsOne("esdjoinXDCBtenderPackageContractor ", `tender.package.id="${contract["tender.package.id"]}" and tax.code="${insertFields["vendor.id"]}"`, {
        "total.amount.paid": (joinRecord["total.amount.paid"] || 0) + paymentAmount
    });

}
// // test
// squad6ThemMoiTienDoThanhToanTamUngCuaHDTH1("Ctr-00221", {
//     "payment.category": "Thanh toán",
//     "value": 1000000000,
//     "proposed.date": system.functions.tod(),
//     "approved.date": system.functions.tod(),
//     "vendor.id": "1400647202",
//     "vendor.name": "Công ty TNHH Nam Đô",
//     "bank.account": "",
//     "bank.name": ""
// });


// Nguoi tao: hadv
// Ngay tao: 30/10/2026
// Nguoi cap nhat: hadv
// Ngay cap nhat: 30/10/2026
// Mo ta chuc nang: Doi voi TH2: id.contract cua esdHDdigitization la id HD va type.document="XDCB_XMCT_VTQ"
//                  Sau khi tao yeu cau SHTL, SQ6 tiep nhan yeu cau, thuc hien quy trinh thanh toan thi can cap nhat trang thai Ho So HD TUTT thanh Chờ thanh toán
function squad6CapNhatTrangThaiHoSoHopDongTUTT(hsHdId) {
    if (!hsHdId) {
        print(`Trường dữ liệu id Hợp đồng là bắt buộc`);
        return;
    }
    lib.ESD_Utils.updateFieldsOne("esdXDCBctrPaymentAdvance", `id="${hsHdId}"`, { status: "Chờ thanh toán" });
}

// Nguoi tao: hadv
// Ngay tao: 30/10/2026
// Nguoi cap nhat: hadv
// Ngay cap nhat: 30/10/2026
// Mo ta chuc nang: Doi voi TH2: id.contract cua esdHDdigitization la id HD va type.document="XDCB_CTSC_XMCT_TTQ"
//                  Ngay sau khi sự kiện thanh toán thành công diễn ra S6 truy vấn CSDL S4 và cập nhật cho S4, Thêm mới bản ghi esdXDCBrepairProjectCtrPayment 
//                  SQ6 gui lai id HD va du lieu can them moi
function squad6ThemMoiTienDoThanhToanTamUngCuaHDTH2(hsHdId, insertFields) {
    if (!hsHdId) {
        print(`Trường dữ liệu id Hợp đồng là bắt buộc`);
        return;
    }
    var messErrorRequireFields = requireFields(insertFields, {
        "payment.category": "Phân loại TUTT",
        "value": "Số tiền thanh toán thực tế",
        "proposed.date": "Ngày đề xuất",
        "approved.date": "Ngày thanh toán thực tế",
        "vendor.id": "MST NCC"
    });

    if (!!messErrorRequireFields) {
        print(messErrorRequireFields);
        return;
    }
    var messErrorRequireFieldsAllowEmpty = requireFieldsAllowEmpty(insertFields, {
        "vendor.name": "Tên NCC",
        "bank.account": "STK NCC",
        "bank.name": "Tên ngân hàng NCC"
    });
    if (!!messErrorRequireFieldsAllowEmpty) {
        print(messErrorRequireFieldsAllowEmpty);
        return;
    }
    var paymentCategory = insertFields["payment.category"];
    if (!["Tạm ứng", "Thanh toán"].includes(paymentCategory)) {
        print(`Trường dữ liệu payment.category phải là Tạm ứng | Thanh toán`);
        return;
    }
    var paymentAmount = Number(insertFields["value"]);
    if (!isFinite(paymentAmount) || paymentAmount <= 0) {
        print("Trường dữ liệu Số tiền thanh toán thực tế phải là số lớn hơn 0.");
        return;
    }
    var recordCtrPaymentAdvance = lib.ESD_Utils.getOneRecord("esdXDCBctrPaymentAdvance", `id="${hsHdId}"`, ["ctr.id", "amount", "total.amount.paid"]);
    if (!recordCtrPaymentAdvance) {
        print("Không tìm thấy hồ sơ hợp đồng tạm ứng.");
        return;
    }
    var hdId = recordCtrPaymentAdvance["ctr.id"];
    var id = lib.ESD_Utils.generateNextNumber("esdXDCBrepairProjectCtrPayment");
    var contract = lib.ESD_Utils.getOneRecord("esdXDCBrepairProjectCtr", `id="${hdId}"`, ["contract.code", "contract.name", "tender.package.id", "total.amount.paid"]);
    if (!contract) {
        print("Không tìm thấy hợp đồng.");
        return;
    }

    var sc = new SCFile("esdXDCBrepairProjectCtrPayment");
    Object.keys(insertFields).forEach(key => {
        sc[key] = insertFields[key];
    });
    sc["id"] = id;
    sc["contract.id"] = hdId;
    sc["contract.code"] = contract["contract.code"];
    sc["currency"] = "VND";
    sc["created.at"] = system.functions.tod();
    sc["status"] = "Đã thanh toán";
    // thêm mới bản ghi tiến độ thanh toán cho hợp đồng
    var insertRc = sc.doInsert();
    if (sc) {
        sc.doClose();
    }
    if (insertRc !== RC_SUCCESS) {
        print("Không thể thêm bản ghi tiến độ thanh toán.");
        return;
    }
    // Cập nhật tiền cho Hồ sơ - hợp đồng
    lib.ESD_Utils.updateFieldsOne("esdXDCBctrPaymentAdvance", `id="${hsHdId}"`, {
        "amount": (recordCtrPaymentAdvance["amount"] || 0) + paymentAmount,
        "status": "Đã thanh toán"
    });

    // Cập nhật tiền cho hợp đồng
    lib.ESD_Utils.updateFieldsOne("esdXDCBrepairProjectCtr", `id="${hdId}"`, {
        "total.amount.paid": (contract["total.amount.paid"] || 0) + paymentAmount
    });
    // Cập nhật tiền cho nhà thầu trong gói thầu
    var joinRecord = lib.ESD_Utils.getOneRecord("esdjoinXDCBtenderPackageContractor ", `tender.package.id="${contract["tender.package.id"]}" and tax.code="${insertFields["vendor.id"]}"`, ["total.amount.paid"]);
    if (!joinRecord) {
        return;
    }
    lib.ESD_Utils.updateFieldsOne("esdjoinXDCBtenderPackageContractor ", `tender.package.id="${contract["tender.package.id"]}" and tax.code="${insertFields["vendor.id"]}"`, {
        "total.amount.paid": (joinRecord["total.amount.paid"] || 0) + paymentAmount
    });

}

// // test
// squad6ThemMoiTienDoThanhToanTamUngCuaHDTH2("HDTT_TU-000003", {
//     "payment.category": "Thanh toán",
//     "value": 1000000111,
//     "proposed.date": system.functions.tod(),
//     "approved.date": system.functions.tod(),
//     "vendor.id": "1400647202",
//     "vendor.name": "Công ty TNHH Nam Đô",
//     "bank.account": "",
//     "bank.name": ""
// });
