# Dự chi: lưu hạng mục và đọc HĐ S4

Trạng thái code cập nhật 28/10/2026: đã nối đọc HĐ, thêm món/import XDCB, lấy NCC theo gói thầu, lưu/dùng lại NCC S6 và site OGL. Chưa deploy/UAT trên SM hoặc ghi tiến độ ngược S4. Chi tiết phiên bản hiện tại: [duchi-s4-supplier-implementation.md](duchi-s4-supplier-implementation.md). Phạm vi cuối cùng gồm cả Tạm ứng/Thanh toán/Dự chi, đợt hiện tại chỉ nối nhánh Dự chi.

## Luồng đã nối

### Cập nhật quan hệ HĐ - gói thầu - NCC từ S4

Người dùng xác nhận: mỗi HĐ có một gói thầu qua `esdXDCBrepairProjectCtr.tender.package.id`; một gói thầu có nhiều NCC. Nguồn danh sách NCC là `esdjoinXDCBtenderPackageContractor`, truy vấn cùng `tender.package.id`, lấy MST từ `tax.code`.

Đã kiểm chứng bằng REST ngày 28/10/2026: đọc đủ 34 HĐ, 46 dòng Contractor và 24 NCC hạch toán S6. Có 27 HĐ trả `tender.package.id` và cả 27 tìm thấy NCC gói thầu; 5 HĐ có nhiều NCC. Còn 7 HĐ không trả `tender.package.id`, nên chưa nối được theo quan hệ này. Cả 46 dòng Contractor đều có gói thầu/MST, gồm 12 MST khác nhau, không có cặp (gói thầu, MST) trùng. Không MST nào trong 12 MST khớp `esdHTKTvendor.vendor.number` tại môi trường đang cấu hình; đã đối chiếu độc lập toàn bộ 24 NCC S6 và kiểm tra truy vấn đối chứng với MST có sẵn.

Ví dụ truy vấn thật: HĐ `Ctr-00236` (mã `HĐ-HT21`) -> `THAU-299` -> Contractor `0311368188THAU-299`, MST `0311368188`, Công ty CP xây dựng dân dụng và công nghiệp Mạnh Hưng; MST này chưa có NCC hạch toán khớp. HĐ `Ctr-00198` -> `THAU-224` có 2 NCC: MST `0200157375`, `3002116823`, đều chưa khớp danh mục hạch toán S6.

Schema/response Contractor có `id`, `name`, `tax.code`, `address`, `bank.number`, `bank.name`, `tender.package.id` và metadata. `contractor.id` không có giá trị trong mẫu người dùng cung cấp và chưa xuất hiện trong response; không dùng nó làm khóa bắt buộc khi đã có ID bản ghi join và MST. Chú ý tên field tài khoản tại Contractor là `bank.number`, khác `bank.account` trên HĐ/Payment. Báo cáo đầy đủ: `output/analysis/duchi-s4-package-contractors-2026-10-28.md` và file JSON cùng tên ở workspace.

Resolver NCC đã nối theo HĐ -> gói thầu -> danh sách NCC -> MST -> `esdHTKTvendor.vendor.number`. Không dùng `tax.code`/`vendor.name` snapshot trên HĐ làm nguồn duy nhất của danh sách NCC. Vì vậy, kết quả 27/34 HĐ không trả MST trực tiếp không chứng minh các HĐ này thiếu NCC.

Không cần thêm truy vấn bảng gói thầu nếu bảng join đã cung cấp đủ thông tin NCC. Nguồn tên/MST đã xác định là `name`/`tax.code`; cần chốt điều kiện lọc NCC được phép dùng nếu có, xác nhận Keys và quy trình NCC chưa tồn tại trong danh mục hạch toán S6. Với import, kiểm tra MST Excel có trong danh sách NCC của gói thầu trước khi lấy NCC hạch toán; không đối chiếu duy nhất MST trên HĐ.

Người dùng đã chốt cách xử lý NCC chưa có: lấy thông tin Contractor S4, lưu NCC hạch toán về S6 như luồng S2 rồi xử lý OGL/site. Không yêu cầu nhập trước 12 MST vào danh mục S6. Đã trace luồng S2 và các điểm cần adapter trong `SM/docs/duchi-s2-supplier-flow-and-s4-adapter.md`, gồm khóa NCC ổn định qua nhiều gói và site mặc định XDCB.

Sau lần người dùng bổ sung REST/unload, bảng Contractor đã đọc được và quan hệ đã kiểm chứng như trên. Tạo món/import XDCB đã mở trong code theo resolver mới; chưa chạy xuyên suốt thêm món/import/hạch toán trên SM thật.

1. Chọn HHDV/XDCB ở popup, tạo phiếu Dự chi trống như luồng hiện có.
2. Lưu `esdHTKTpayment["original.contract.category"] = "HHDV" | "XDCB"` theo tên field người dùng chốt lại. Chỉ đọc/ghi field này, không fallback sang field hạng mục cũ. Giá trị rỗng trên phiếu cũ được đọc là HHDV; giá trị khác hai mã bị từ chối. Payload/initData vẫn dùng thuộc tính `contractCategory`.
3. Tab món đọc lại phiếu và truyền `contractCategory` trong initData.
4. Picker gọi `getDuChiContracts(paymentId, filters)` -> `listExpenseContracts`. Server action lấy actor từ session. SM đọc hạng mục từ phiếu đã lưu, không tin category/source/scope do client gửi.
5. HHDV ủy quyền `listPurchaseContracts` cũ, lấy context người dùng/phạm vi tại backend bằng helper Dự chi hiện có. API `listPurchaseContracts` của TT/TU giữ nguyên.
6. XDCB đọc `esdXDCBrepairProjectCtr` bằng `SCFile(..., SCFILE_READONLY)`: `doCount` và `doSelectEx(query, start, count)` dùng cùng điều kiện. Count mặc định 10, tối đa 100; thứ tự có khóa phụ `id`.

API Dự chi mới: `listExpenseContracts`, `listExpenseXdcbContracts`, `getExpenseXdcbContract`. Hai action XDCB chỉ đọc dùng quyền xem Dự chi và Data Permission backend. Router dùng thêm quyền theo người tham gia/phase của phiếu trước khi mở picker.

Theo chốt ngày 29/10, S4 dùng `id` làm cả mã HĐ hiển thị/tìm kiếm/import/xuất Excel và khóa liên kết; không dùng field `contract.code` của bảng nguồn. Ví dụ dùng `Ctr-00196`, không dùng `123/HĐ`. Các tên field API `contractCode`/`contract_code` được giữ tương thích nhưng mang giá trị ID. Ngày lọc là `effective.date`; cột Ngày hiệu lực của picker giữ shape `created.at` chỉ để dùng lại cấu hình bảng. Đợt này XDCB chỉ có Hợp đồng, không có Khoản mua sắm.

Điều kiện S4 hiện tại theo yêu cầu cập nhật 28/10: chưa xóa, `status="Đang thực hiện"`, và đúng một trong `repair.id`/`construction.id` có giá trị. Bộ lọc cũ chỉ loại dừng/hủy nên để lọt Hoàn thành/Cập nhật/Nháp; đã đổi sang điều kiện bằng trạng thái được chọn. Count và rows dùng cùng query; thêm món/import và tra lại HĐ theo ID dùng chung resolver nên không vượt qua bộ lọc bằng cách gửi ID/mã trực tiếp. Không bê mã trạng thái hoặc bộ lọc ngân sách S2 sang S4.

Phạm vi HĐ đã thống nhất theo S2 sau khi người dùng chốt: ĐMMS lọc `responsible.officer`; scope 06 không lọc đơn vị; scope 04 ở hội sở xử lý mapping entity `1010098` rồi lọc `0999*` hoặc giữ `1=1` khi không có mapping; còn lại dùng LV1 của hồ sơ đăng nhập. Thay thế cách lọc S4 trước đó theo danh sách LV1/LV2/LV3 của Data Permission. `paymentId` được truyền qua picker/thêm món/DO/Save/import/OGL để lấy đúng vai trò từ phiếu, tại bước KTTC dùng vai trò KTTC như S2. Các quyền thao tác và phase S6 giữ nguyên. Chi tiết và giới hạn tại mục Phân quyền và phase trong [duchi-s4-supplier-implementation.md](duchi-s4-supplier-implementation.md); cần UAT bằng tài khoản/đơn vị thật.

Nút Tiếp tục XDCB đã mở. Backend kiểm tra HĐ/nguồn NCC và hạng mục đã lưu thay cho guard chặn toàn bộ; nhánh HHDV giữ nguồn S2. Theo cập nhật 30/10/2026, DTO HĐ trả thêm `budgetType`, `vendorTaxCode`, `vendorAddress`: sửa chữa `under500` lấy NCC trực tiếp trên HĐ, sửa chữa `over500` và xây mới/cải tạo lấy qua gói thầu. OGL XDCB dùng resolver site riêng, không đổi helper OGL mặc định của TT/TU. Bút toán/workflow và writer tiến độ S4 chưa thay đổi trong bước này.

## Kiểm tra REST thực tế

### Kiểm tra lại sau khi publish hai Resource (27/10/2026)

Đã gọi GET theo cấu hình `.env.development`; không ghi dữ liệu hoặc sửa cấu hình SM. Báo cáo: `tmp/duchi-s4-rest-recheck-report.json` và `tmp/duchi-s4-rest-audit-report.json` ở workspace.

- `esdXDCBrepairProjectCtr`: HTTP 200, ReturnCode 0, đọc đủ 34/34 dòng. Wrapper thực tế là `esdXDCBrepairProjectCtr`. Đã kiểm tra hai trang `start=1/count=5`, `start=6/count=5`, sort ID tăng dần: mỗi trang 5 dòng, không trùng, cùng total 34.
- `esdXDCBrepairProjectCtrPayment`: HTTP 200, ReturnCode 0, đọc đủ 30/30 dòng. Wrapper thực tế là `esdXDCBrepairProjectCtrPayment`. Hiện có 9 Thanh toán và 21 Tạm ứng, chưa có Dự chi. Chưa kiểm tra quyền/hành vi POST/PUT/DELETE.
- Bộ lọc nền tại thời điểm kiểm tra (chưa xóa, không dừng/hủy, đúng một project ID) chạy được qua REST và trả total 29, trước khi áp dụng quyền/phạm vi tài khoản nghiệp vụ. Đây là kết quả lịch sử của bộ lọc cũ, không phải tổng HĐ Đang thực hiện sau sửa ngày 28/10. 34 HĐ gồm 20 sửa chữa, 14 xây mới; không gặp HĐ có cả hai/không có project ID.
- HĐ `Ctr-00196`: mã `123/HĐ`, MST `2600358591`, trạng thái Dừng thực hiện; không dùng làm happy path. HĐ `Ctr-00225`: mã REST `HD52-TT/QD`, `construction.id=P26`, 35 triệu VND, không trả thông tin NCC/MST.
- Chỉ 7/34 HĐ trả `tax.code`; toàn bộ response HĐ không trả `vendor.id`/`vendor.profile.id`. MST `2600358591` và `0311368188` đều chưa tìm thấy trong `esdHTKTvendor` qua API; MST đầu cũng chưa thấy trong `esdDMSupplier`.
- Trong cả 30 dòng bảng Payment chưa thấy `contract.code`, `payment.code`, `vendor.id`, `status`, `created.at`, `created.by`, `current.phase`, `storage.url`. Phải phân biệt giá trị rỗng với field chưa map/expose trong External Access Definition; GET hiện tại chưa đủ kết luận nguyên nhân.
- 30 dòng Payment tham chiếu 12 ID HĐ không xuất hiện trong 34 HĐ REST hiện tại. Tra riêng `Ctr-00034` cũng trả 0 dòng; cần đối soát dữ liệu/phạm vi, không coi các dòng cũ là dữ liệu mẫu đã khớp nguồn HĐ mới.
- Currency của Payment đang lẫn mã và tên (`VND`, `Việt Nam Đồng`, `Won Hàn Quốc`...). Cần chốt quy ước trước khi ghi tiến độ Dự chi.

Kết luận: hai REST đã đọc được; bước tiếp theo vẫn là hoàn thiện NCC/tạo món/import và quy ước writer, không tự bật ghi S4 chỉ vì GET thành công. Service S4 hiện có trong `serviceHopDong.ts` đọc wrapper `repairProjectCtr`, khác response REST vừa quan sát; nếu tái sử dụng trực tiếp phải sửa mapper đúng chỗ. API custom Dự chi chuẩn hóa response riêng nên không phụ thuộc wrapper REST này.

### Kết quả trước khi publish (lịch sử)

Đã gọi GET bằng cấu hình `.env.development`, không ghi dữ liệu, không thay cấu hình SM:

| Resource / truy vấn | Kết quả |
| --- | --- |
| `esdXDCBrepairProjectCtr` theo `Ctr-00196`, `Ctr-00225` và hai trang | HTTP 404, ReturnCode 9, `Restful config not found` |
| `esdXDCBrepairProjectCtrDoc`, `...Guarantee`, `...Payment`, `...Progress` theo `contract.id` | Cùng lỗi chưa tìm thấy cấu hình REST |
| Alias `repairProjectCtr` từ wrapper của service S4 hiện có | Cùng lỗi 404 |
| `esdDMSupplier`, `id="NCC00212"` | HTTP 200, 1 bản ghi: MST `NCC00212`, tên Nhà cung cấp 1 |
| `esdDMSupplier`, `tax.code="2600358591"` | HTTP 200, 0 bản ghi |
| `esdHTKTvendor`, `vendor.number="2600358591"` | HTTP 200, 0 bản ghi |
| `esdHTKTpayment`, một phiếu Dự chi | HTTP 200; lần kiểm tra này chưa xác nhận REST mapping của field mới `original.contract.category` |

Ở lần kiểm tra trước, người dùng xác nhận các bảng S4 chưa cấu hình REST; hai bảng HĐ và Payment đã được publish sau đó như kết quả mới ở trên. Ảnh Format/Format Control không phải cấu hình REST Resource. Nhánh triển khai dùng API custom hiện có và SCFile trong SM, nên không bắt buộc publish REST riêng từng bảng. Thư viện đọc chưa được chạy trên SM; kết quả GET 404 trước đây không chứng minh bảng vật lý không tồn tại.

Ảnh `Ctr-00196`: MST `2600358591`, nhà thầu Công ty CP Tư vấn Xây dựng Hoàng Nam, `vendor.id` trống, trạng thái Dừng thực hiện. Đây là ca phải loại khỏi picker, không phải ca thành công để tạo món. Source `useRepairContractForm.ts` xác nhận form S4 lưu MST vào `tax.code`, tên vào `vendor.name`.

Bước NCC tiếp theo dùng `tax.code` từ bảng join NCC của gói thầu -> `esdHTKTvendor.vendor.number`, cần xác định đúng một NCC hạch toán khớp. Không bắt buộc giả định `vendor.id`/`vendor.profile.id` trỏ cùng ID với S6. MST không tìm thấy ở hai danh mục hiện tại phải được xử lý theo quy trình NCC được chốt; không tự tạo NCC từ tên và không bỏ qua liên kết HĐ/gói thầu. Cần HĐ còn đủ điều kiện, có `tender.package.id` và có NCC gói thầu khớp danh mục S6 để kiểm tra happy path thực.

## Thứ tự nạp và kiểm tra

1. Kiểm tra DBdict/SQL `original.contract.category` đã đồng bộ; giữ field không bắt buộc cho TT/TU.
2. Nạp `ESD_HTKT_EXPENSE_CONTRACT`, các bản sửa `ESD_HTKT_EXPENSE_CREATE_REQUEST`, `ESD_HTKT_EXPENSE_VIEW`, `ESD_HTKT_EXPENSE_VENDOR`, rồi dispatcher `ESD_ApiCustomScript_HTKT`.
3. Phát hành UI sau khi backend có đủ action. Không cần thêm REST Resource S4 cho cách gọi này.
4. Tạo phiếu HHDV và XDCB, mở lại tab món, kiểm tra field đã lưu. Phiếu cũ rỗng vẫn lấy S2.
5. XDCB: kiểm tra hai trang không trùng, tổng đúng, mã hiển thị khác ID, tìm mã/tên, lọc ngày, sort, công trình sửa chữa/xây mới; dừng/xóa/thiếu hoặc cả hai project ID bị loại.
6. Thử tài khoản trong/ngoài phạm vi và phiếu ngoài quyền sửa. Gửi category/scope giả từ client không đổi được nguồn/quyền.
7. Gọi trực tiếp tạo món/import XDCB phải bị từ chối và không có bản ghi mới. HHDV thêm món/import và auto OGL vẫn theo API nút Đồng bộ OGL, gồm cả món cũ chưa đồng bộ.

Ở bước chỉ đọc trước đây đã qua kiểm thử mock: 42 ca resolver SM + server identity/dispatcher, 19 ca lưu/mở lại/category guard/HHDV, UI tạo phiếu và 20 ca hồi quy import/OGL; bộ hồi quy SM OGL hiện tại cũng qua. Kết quả hồi quy hiện tại, gồm phân quyền S2/S4 và các phase, nằm trong [duchi-s4-supplier-implementation.md](duchi-s4-supplier-implementation.md). `node --check` và ESLint áp dụng file thay đổi. TypeScript theo entrypoint Dự chi còn 3 lỗi có sẵn ở `convertFiltersToQuery.ts` và `historyUtils.ts`; chưa có lỗi chỉ vào file sửa. Chưa có kiểm thử giao diện trực quan hoặc chạy action mới trên SM thật.

Phần sau: tạo món + form NCC XDCB, import theo ID HĐ/MST và điều kiện chung; sau đó mới tích hợp writer S4 khi chốt mã loại Dự chi, khóa chống trùng, thời điểm ghi và quy tắc xóa. Không ghi tiến độ vào `...CtrProgress` thay cho `...CtrPayment`.
