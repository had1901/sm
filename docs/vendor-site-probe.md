# Vấn tin site OGL theo danh sách NCC S6

1. Tạo ScriptLibrary `ESD_HTKT_VENDOR_SITE_PROBE`, copy toàn bộ `ESD_HTKT_VENDOR_SITE_PROBE.js`.
2. Tạo DO chẩn đoán riêng trên DS muốn đặt nút. Chọn một GUI option chưa dùng; Action `do nothing`; bỏ chọn `Modifies Record`. Giữ quyền hiển thị/thao tác theo môi trường đang test, không đổi DO Lưu/Trình.
3. Pre JavaScript dùng nội dung `esdHTKTpaymentVendor.ogl_site_probe.display_option.js`:

   ```js
   lib.ESD_HTKT_VENDOR_SITE_PROBE.runVendorSiteProbe({ offset: 0, limit: 0 });
   ```

4. Click DO, mở Messages và lấy các dòng `[OGL-SITE-PROBE]`, đặc biệt `SUMMARY`, `RESPONSE-GROUP` và một số `REQUEST`/`RESPONSE`.

Script chỉ dùng `SCFile` read-only với `esdHTKTvendor`; đọc/đóng cursor trước khi gọi mạng. Lấy `vendor.number` nguyên dạng sau trim, không ép số, không bỏ `NCC_`, không suy từ `supplier.id`, không lọc bỏ NCC chưa đồng bộ. Các bản ghi cùng `vendor.number` chỉ vấn tin một lần mỗi branch.

Với mỗi NCC, script gọi đúng `lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.getVendorSiteInfo({vendorNumber, entity: "100"})`, sau đó entity `106`; không gọi `createVendorSiteInfo`, không ghi NCC/site/món. Hàm dùng chung vẫn có thể tự lấy/làm mới token và cập nhật cấu hình theo cơ chế hiện có.

`completed:true` chỉ xác nhận chạy hết phép thử. Xem `responseSuccess` và `outcome` của từng request để biết API thành công hay thất bại. `BUSINESS_ERROR` vẫn giữ nguyên body/data để so sánh MST và entity, không dùng data đó để lưu site. `allResponsesIdentical:true` chỉ mô tả các body bằng nhau, chưa tự kết luận môi trường là mock.

HTTP status thực tế xem log `getVendorSiteInfo::httpStatus` của helper. `responseHttpStatus` chỉ có khi object trả từ helper chứa trường này; không tự gán HTTP 200 khi metadata không có.

Có thể chia lượt bằng `{offset:0,limit:5}`, `{offset:5,limit:5}`, ...; thứ tự sắp theo chuỗi `vendor.number`. Mặc định DO chạy tất cả. Không đổi danh mục giữa các lượt nếu muốn offset ổn định.

REST GET ngày 29/10/2026 đã đọc đủ 28/28 bản ghi NCC, 28 `vendor.number` khác nhau: dự kiến 56 request khi chạy tất cả. Đây là số liệu danh mục tại thời điểm đọc, chưa phải kết quả gọi OGL. Chưa chạy trực tiếp SL chẩn đoán trên SM trong lượt chuẩn bị này.

## Đọc bảng site và nối với NCC ngay trên SM

REST của `esdHTKTvendorSite` hiện trả `404 / Restful config not found`. Để đọc đúng bảng local mà không cần mở REST, nạp bản mới của cùng SL chẩn đoán, rồi thay Pre JavaScript của DO thử nghiệm bằng:

```js
lib.ESD_HTKT_VENDOR_SITE_PROBE.inspectLocalVendorSites();
```

Hàm này chỉ đọc hai bảng bằng `SCFILE_READONLY`, nối `esdHTKTvendorSite.vendor.id = esdHTKTvendor.id`, không gọi OGL hoặc ghi dữ liệu. Log `LOCAL-JOIN` có NCC/MST và site; `LOCAL-SUMMARY` thống kê mã site, chi nhánh, site thiếu entity hoặc thiếu master; `VENDORS-WITHOUT-SITES` liệt kê NCC chưa có site local. Các field được in dạng chuỗi để tránh serialize Datum SM.
