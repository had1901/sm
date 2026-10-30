# Luồng NCC S2 hiện có và cách áp dụng cho Dự chi XDCB

Đây là ghi nhận rà soát trước khi triển khai ngày 28/10/2026. Các đoạn mô tả loader/filter S2 bên dưới phản ánh source lúc review. Code NCC/site XDCB đã được nối sau đó; xem [duchi-s4-supplier-implementation.md](duchi-s4-supplier-implementation.md) để biết hành vi hiện tại, kiểm thử và hướng dẫn nạp SM. Chưa chạy tạo NCC/site trên SM thật.

Phạm vi đã chốt: cuối cùng cả Tạm ứng/Thanh toán/Dự chi đều có tạo phiếu theo hạng mục. Triển khai Dự chi trước do dùng chung dữ liệu với Thanh toán; phần adapter nguồn HĐ/NCC và chuẩn hóa NCC/site S6 phải có thể dùng lại. Đợt này chỉ nối nhánh mới cho Dự chi, giữ hợp đồng gọi/hành vi mặc định của các helper TT/TU và chạy hồi quy các luồng dùng chung. Chi tiết ranh giới và thứ tự mở ở mục 0 của `output/plans/du-chi-s4-integration-plan-2026-10-27.md`.

## Luồng Dự chi HHDV đang dùng S2

1. Phiếu Dự chi được tạo trước; thêm món mới mở picker HĐ. `ESD_HTKT_EXPENSE_CONTRACT.listExpenseContracts` đọc `original.contract.category` trên cha; HHDV gọi `ESD_HTKT_PAYMENT_CREATE_REQUEST.listPurchaseContracts`. Hàm đang có hiệu lực là declaration có tham số `input` phía sau trong file Payment, không phải declaration cùng tên cũ phía trước.
2. Nguồn HĐ là `esdHDcontract`. `ESD_HTKT_PAYMENT_VENDOR.getContractInfo` đọc chi tiết HĐ/KMS từ bảng này. `ESD_HTKT_EXPENSE_VENDOR.createPaymentVendor` tạo món gắn ID HĐ, chưa có NCC hạch toán cho đến khi hoàn thiện món.
3. `ESD_HTKT_EXPENSE_VENDOR.loadPaymentVendorInfo` lấy NCC qua `esdHDcontractSupplier.contract.id = món.contract.id`, lấy tên/ID NCC và nối `supplier.id = esdDMSupplier.id` để lấy MST. NCC đã chọn đọc từ `món.vendor.id -> esdHTKTvendor.id`. Danh sách và NCC hạch toán là hai lớp khác nhau.
4. `esdHTKTpaymentVendor.view_save_for_expense.js` validate tên/ID NCC, MST, số tiền và nội dung. Tìm NCC hạch toán bằng `vendor.number = MST` AND `supplier.id = ID danh mục NCC`. Nếu thấy thì dùng lại ID; nhánh chưa có cấp số `esdHTKTvendor`, lưu tên/MST/địa chỉ/username/quốc gia/liên kết supplier. Gán ID hạch toán vào `món.vendor.id`; không dùng MST hay ID nguồn thay ID hạch toán.
5. Script save gọi `ESD_HTKT_PREPAYMENT_VENDOR.syncVendorToOgl`, rồi tải lại site để gán site mặc định. Luồng nút Đồng bộ OGL dùng thêm các kiểm tra trạng thái/đọc lại bản ghi của `ESD_HTKT_EXPENSE_VENDOR`.

Lưu ý: import hiện tại khác lưu thủ công, vì `expenseImportValidateRow` yêu cầu NCC hạch toán đã tồn tại và có `supplier.id`. Điều này phải đổi cho nhánh XDCB theo yêu cầu mới: lấy NCC từ nguồn S4 rồi tạo/dùng lại NCC S6, không đòi nhập trước toàn bộ 12 MST đã kiểm tra.

## Display Screen bổ sung: esdHTKTpaymentVendor.new.js

Người dùng cung cấp code Display Screen ngày 28/10. File này bổ sung điểm nạp danh sách NCC khi vào màn thêm mới; phần thông tin chi tiết HĐ vẫn cần phối hợp với resolver/view đã nêu trên.

- Dòng 27-33 lấy `payment.id`/`contract.id` từ record hoặc biến session, gán lại vào record.
- Dòng 37-65 query những món đã có cùng phiếu và HĐ, nối từng `vendor.id` sang `esdHTKTvendor.supplier.id` để tạo tập `usedSupplierIds`.
- Dòng 70-86 lấy NCC bằng `esdHTKTpayment -> esdHDcontractSupplier -> esdDMSupplier`. Nếu có `contractId` thì query theo HĐ đã chọn; nếu không có thì dùng HĐ trên phiếu cha. Các field được SELECT: tên/ID NCC, MST, địa chỉ, loại NCC, hình thức thanh toán, số chưa trả, ghi chú phiếu và đơn vị cấp 1.
- Dòng 94-120 loại NCC đã có trong `usedSupplierIds`, chống trùng option, dựng `arrVendors`, rồi gán `$supplierdisplays`/`$suppliervalues` để hiển thị droplist. File chưa tạo NCC hạch toán/site.
- Đoạn callback khi đổi NCC và cách lấy từng phần tử `arrVendors` để gán `$supplierName`, `$taxCode`, `$supplierAddress` không nằm trong file này; cần đối chiếu cấu hình callback/Format Control khi triển khai.

Hai lưu ý nghiệp vụ trước khi tái sử dụng cho XDCB:

1. Lọc NCC đã xuất hiện trong món trước có thể phù hợp luồng TT, nhưng trái yêu cầu Dự chi cho phép nhiều món cùng HĐ/NCC. Nhánh Dự chi chỉ chống trùng option trong danh sách nguồn, không loại NCC chỉ vì đã có món khác. Giữ hành vi TT hiện có ở nhánh riêng.
2. `arrVendors` đọc `bank` và `expire.date` ở dòng 102-103 nhưng SELECT hiện không lấy hai alias đó; không xem đây là nguồn ngân hàng/ngày đã hoàn thiện. S4 có field `bank.number`/`bank.name` riêng và cần mapping tường minh.

Đây là thêm một điểm cần route theo loại phiếu/hạng mục đã lưu trên backend. Không thay JOIN S2 thành S4 cho toàn bộ Display Screen vì file phục vụ dữ liệu chung Thanh toán/Dự chi. Chưa sửa nội dung file người dùng cung cấp trong lần review này.

## Luồng site dùng chung

`ESD_HTKT_PREPAYMENT_VENDOR.syncVendorToOgl` hiện thực hiện:

- Đọc `esdHTKTvendor` theo ID hạch toán của món.
- Nếu có site local active theo NCC/chi nhánh, bỏ qua gọi OGL và đánh dấu đồng bộ.
- Nếu chưa có, gọi `ESD_HTKT_INVOICE_OGL_INTEGRATION.getVendorSiteInfo` bằng MST và chi nhánh. Lưu site OGL về local qua `saveVendorSite`.
- Nếu OGL chưa có site mặc định, build payload từ NCC S6 rồi gọi `createVendorSiteInfo`. Sau thành công lưu site local và đánh dấu đồng bộ.
- `saveVendorSite` tìm bằng tổ hợp `vendor.id + ogl.site.code + ogl.entity`, cập nhật hoặc cấp ID site mới. Script lưu món gán `vendor.site.id` tương ứng.

Điểm phải xử lý riêng khi nối XDCB:

1. `getVendorDefaultSiteInfo(goodType = "HHDV")` đã cấu hình HHDV `126150610`, XDCB `126150640`, credit account `224421300`. Nhưng helper đồng bộ và các caller Dự chi hiện gọi không truyền hạng mục nên dùng HHDV.
2. Nhánh local-site hiện chỉ kiểm tra có site bất kỳ cùng NCC/chi nhánh. Với một NCC có cả HHDV/XDCB, phải tìm đúng site của hạng mục; không bỏ qua đồng bộ chỉ vì có site HHDV.
3. Helper đang dùng `esdHTKTvendor.supplier.id` để cập nhật `esdDMSupplier.isAccounted`. Đây là liên kết danh mục S2/chung; không đưa ID bản ghi Contractor S4 vào đó rồi tiếp tục query `esdDMSupplier` như cùng nguồn.

Giữ mặc định/hành vi TT/TU và Dự chi HHDV; nhánh Dự chi XDCB resolve hạng mục từ cha đã lưu. Không đổi site mặc định toàn hệ thống sang XDCB.

## Adapter S4 cần làm

`HĐ S4.id -> HĐ.tender.package.id -> esdjoinXDCBtenderPackageContractor -> NCC được chọn -> tạo/dùng lại esdHTKTvendor -> site S6/OGL -> món.vendor.id và món.vendor.site.id`.

| Dữ liệu nguồn S4 | Đích S6 / cách xử lý |
| --- | --- |
| `tax.code` | `esdHTKTvendor.vendor.number`; giữ dạng text, gồm số 0 đầu |
| `name` | `esdHTKTvendor.vendor.name` |
| `address` | `esdHTKTvendor.address` |
| ID HĐ S4 | `esdHTKTpaymentVendor.contract.id` |
| ID NCC hạch toán do S6 tạo/dùng lại | `esdHTKTpaymentVendor.vendor.id` |
| ID site local đúng hạng mục/chi nhánh | `esdHTKTpaymentVendor.vendor.site.id` |

Không tạo NCC hạch toán theo mỗi gói thầu. ID join S4 như `0311368188THAU-299` thay đổi theo gói; một MST có nhiều ID join. `contractor.id` hiện trống trong dữ liệu đã kiểm tra, nên chưa thể dùng làm khóa NCC ổn định. Cần resolver tạo/dùng lại NCC theo MST, xử lý rõ nhiều kết quả và giữ `supplier.id` đúng nghĩa liên kết danh mục, không gán tùy ý ID join vào field này.

Yêu cầu người dùng đã chốt: NCC chưa tồn tại trong S6 được lấy thông tin từ nguồn S4 để lưu về S6 như luồng S2, sau đó xử lý site. Vì thế kết quả 12/12 MST Contractor chưa có trong 24 NCC S6 không phải điều kiện bắt buộc phải nhập tay trước khi triển khai. Hai vấn đề dữ liệu vẫn cần xử lý là HĐ không có gói thầu và dữ liệu NCC nguồn không đủ/không hợp lệ.

Không cần tạo bản sao HĐ S4 trong `esdHDcontract` để tái dùng hạch toán. Các bảng món, vendor, vendorSite và entry vẫn là S6; resolver chọn nguồn HĐ/NCC và kiểm tra quan hệ là phần thay đổi.

## Kiểm tra trước khi mở XDCB

- Chưa có NCC S6 -> tạo đúng một NCC từ S4; thêm lại cùng NCC qua HĐ/gói khác phải dùng lại, không tạo trùng theo ID join.
- NCC đã có ở S6 -> giữ đúng bản ghi và các site hiện có; nhiều kết quả MST không tự lấy dòng đầu.
- Site local đúng XDCB/chi nhánh -> dùng lại. Chỉ có site HHDV -> tiếp tục tìm/tạo site XDCB. OGL có/chưa có site -> lưu đúng kết quả.
- Lỗi cấp số/lookup/ghi NCC -> không gọi OGL bằng ID rỗng, không tạo món với tham chiếu lỗi. Lỗi OGL/site giữ trạng thái chưa đồng bộ để thử lại; không tạo lại NCC thành công.
- Manual/import dùng cùng resolver; kiểm tra NCC thuộc gói thầu HĐ ở backend, kể cả trước khi trình phiếu.
- Hồi quy HHDV/TT/TU, quyền nút OGL, import nhiều dòng cùng NCC, và hai lần tạo đồng thời theo MST.

Giới hạn rà soát: source thư viện `ESD_HD_Integration` được gọi để trả tiến độ về S2 không có trong repo. Nó không phải bằng chứng về cách tạo NCC/site; phần đã xác nhận ở trên dựa vào loader, script lưu món và helper OGL hiện có. Cấu hình callback/Format Control đang deploy trên SM cần đối chiếu khi UAT.
