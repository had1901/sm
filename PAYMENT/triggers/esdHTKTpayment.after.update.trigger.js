// Trigger: esdHTKTpayment.after.update | Bảng: esdHTKTpayment | Loại: 4 - After Update.
// Dùng chung cho TT/DC XDCB: cả hạch toán thường và xử lý lỗi đều cập nhật phiếu tại bảng này.
var payment = typeof record !== "undefined" ? record : null;
var previousPayment = typeof oldrecord !== "undefined" ? oldrecord : null;

// Chỉ gửi khi đã hạch toán và có ngày hoàn thành; HHDV/Tạm ứng giữ luồng hiện có.
if (payment && String(payment["original.contract.category"] || "").toUpperCase() === "XDCB" &&
        (payment["transaction.type"] === "Thanh toán" || payment["transaction.type"] === "Dự chi") &&
        String(payment["status"] || "") === "accounted" && payment["completed.date"]) {
    // Bắt lần chuyển Đã hạch toán hoặc bổ sung ngày hoàn thành cho phiếu đã hạch toán.
    // Nếu SM không cấp oldrecord, helper vẫn kiểm tra tiến độ để không cộng tiền lần nữa.
    var accountingJustCompleted = !previousPayment ||
        String(previousPayment["status"] || "") !== "accounted" || !previousPayment["completed.date"];
    if (accountingJustCompleted) {
        try {
            // Helper S6 lập dữ liệu từng món, gọi SL S4 và đọc lại kết quả; không tự cập nhật phiếu ở đây.
            lib.ESD_HTKT_PAYMENT_VENDOR.syncXdcbAccountedToSquad4(payment);
        } catch (squadError) {
            // Đồng bộ S4 lỗi chỉ ghi Messages, không ném lỗi làm gián đoạn lần lưu phiếu S6.
            print("Đã hạch toán; chưa đồng bộ S4: " + String(squadError.message || squadError));
        }
    }
}
