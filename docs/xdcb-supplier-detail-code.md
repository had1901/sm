# Hiển thị Mã NCC S6 trong màn chi tiết TU/TT/DC

## Bind trên Format Designer

Trong FD chi tiết NCC của cả TU, TT và DC, đổi **Input của riêng ô Mã NCC** từ biến hiện tại (`$supplierId` hoặc `$G_supplier_id`) sang **`$supplierCode`**, giữ Read-Only.

Giữ Input/value của droplist **Tên NCC** như hiện tại. Droplist vẫn dùng `$supplierId` và danh sách `$suppliervalues` để chọn đúng NCC nguồn S4.

Ví dụ NCC gói thầu:

```text
Khóa chọn NCC S4 ($supplierId): 0200157375THAU-378
MST ($taxCode):                 0200157375
Mã NCC trên FD ($supplierCode): NCC - 00001
```

`$supplierCode` đọc từ `esdHTKTvendor.supplier.id`. Không lấy từ `esdjoinXDCBtenderPackageContractor.id`, không lấy MST thay cho mã.

Không có file FD trong workspace để sửa trực tiếp. Code JS đã nối biến; nếu chưa đổi Input trên FD thì ô Mã NCC vẫn hiển thị khóa cũ.

## Khi nào điền mã

- Mở màn thêm mới/chỉnh sửa: XDCB đọc mã S6 của NCC đang chọn; HHDV giữ nguyên mã hiển thị cũ.
- Chọn NCC khác: đọc lại mã theo MST NCC vừa chọn, không dùng mã của NCC trước.
- NCC chưa tồn tại tại S6 hoặc chưa được cấp mã: để trống trước khi lưu; không tạo master/cấp Number chỉ vì mở màn hoặc chọn NCC.
- Lưu: hàm lưu chung tạo/tái sử dụng master và mã từ Number `esdHTKTvendorCode`, sau đó điền mã đã lưu lên `$supplierCode` ngay trong lượt lưu đó.
- Quay lại rồi chọn Không ở cảnh báo chưa lưu: giữ logic draft cũ, đọc mã của đúng NCC trong draft; không đổi số tiền, khóa chọn hoặc ghi lựa chọn xuống DB.
- Lỗi nguồn: xóa biến mã hiển thị để không còn mã của NCC trước.

## Những file JS cần cập nhật lên SM

SL dùng chung:

- `EXPENSE/SL/ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.js`: hàm đọc mã theo MST và điền mã khi nạp/chọn/lưu DC XDCB.
- `PAYMENT/SL/ESD_HTKT_PAYMENT_VENDOR.js`: điền mã khi nạp/chọn/lưu TU/TT XDCB; giữ mã HHDV khi nạp màn.
- `PREPAYMENT/SL/ESD_HTKT_PREPAYMENT_VENDOR.js`: nạp mã HHDV cũ vào biến hiển thị mới.
- `EXPENSE/SL/ESD_HTKT_EXPENSE_VENDOR.js`: nạp mã HHDV cũ vào biến hiển thị mới.

DS (khai báo biến hiển thị ở màn):

- `PAYMENT/DS/esdHTKTpaymentVendor.new.js`
- `PAYMENT/DS/esdHTKTpaymentVendor.view.js`
- `PREPAYMENT/DS/esdHTKTprepaymentVendor.new.js`
- `PREPAYMENT/DS/esdHTKTprepaymentVendor.view.js`

DO chọn NCC (giữ mã HHDV cũ và xóa mã hiển thị khi lựa chọn lỗi):

- `PAYMENT/DO/esdHTKTpaymentVendor.new_fill_data.js`
- `PAYMENT/DO/esdHTKTpaymentVendor.view_fill_data.js`
- `PREPAYMENT/DO/esdHTKTprepaymentVendor.new_fill_data.js`

Không đổi giá trị `$supplierId`/`$G_supplier_id`, cách phân nguồn TH1/TH2, cấp Number, số tiền, OGL, phân quyền, phase hoặc đồng bộ tiến độ S4 trong thay đổi này. Không cần sửa lại addon/list cho phần ô Mã NCC này.
