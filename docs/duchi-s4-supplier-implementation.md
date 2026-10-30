# Dự chi XDCB: HĐ, NCC S6 và site OGL

Code local ngày 28/10/2026; chưa nạp thư viện/cấu hình lên SM và chưa tạo NCC/site trên môi trường thật.

## Nghiệp vụ đã nối

- Đọc `esdHTKTpayment.original.contract.category`; rỗng là HHDV, XDCB là S4. Không đọc lại field `contract.category` cũ và không lấy nguồn từ payload UI.
- Giữ Dự chi tạo phiếu trống trước. Picker đã cho Tiếp tục với HĐ XDCB; backend kiểm tra quyền sửa phiếu, điều kiện/quyền chọn HĐ, loại tiền và liên kết gói thầu trước khi tạo món.
- HĐ XDCB được chọn phải có `status="Đang thực hiện"`, chưa xóa và thuộc phạm vi được phép. `listExpenseXdcbContracts` dùng cùng điều kiện cho danh sách và tổng số; thêm món/Save/import/kiểm tra trước OGL dùng lại điều kiện này. HĐ Hoàn thành/Cập nhật/Nháp/dừng/hủy hoặc không có trạng thái không được chọn. Đọc thông tin HĐ đã lưu để xem lịch sử vẫn giữ nguồn S4.
- Nguồn NCC XDCB: `esdXDCBrepairProjectCtr.id -> tender.package.id -> esdjoinXDCBtenderPackageContractor`. `name`, `tax.code`, `address` là nguồn lưu NCC. Mỗi gói có thể có nhiều NCC.
- Display Screen giữ shape `arrVendors`, `$arrVendors`, `$supplierdisplays`, `$suppliervalues`. ID option XDCB là ID Contractor, chỉ dùng chọn đúng dòng nguồn; không lưu ID này vào `esdHTKTvendor.supplier.id`.
- Save lấy lại tên/MST/địa chỉ từ S4, kiểm tra NCC thuộc gói của HĐ và quyền sửa. Không tin tên, địa chỉ, currency từ biến form. Món đã có hóa đơn không được đổi sang MST khác.
- NCC S6 được tìm chính xác theo `vendor.number = tax.code`. Một kết quả hợp lệ thì dùng lại và giữ `supplier.id` S2/site khác đang có; chưa có thì sinh ID bằng number series `esdHTKTvendor`, lưu tên/MST/địa chỉ/người tạo/quốc gia VN. Nhiều kết quả thì báo lỗi, không chọn dòng đầu.
- Theo chốt ngày 29/10, món lưu `vendor.id = ID NCC S6`, `contract.id = ID HĐ S4`; mã hiển thị/tìm kiếm/import/xuất Excel cũng dùng ID đó, không dùng `contract.code`. Không cần chuyển dữ liệu món đã lưu vì khóa liên kết vẫn là ID.
- Nhánh XDCB mới cho phép nhiều món cùng HĐ/NCC; không loại NCC đã xuất hiện trên món khác. HHDV/Thanh toán giữ nguyên loader và bộ lọc NCC trước khi tích hợp S4; import vẫn giữ cơ chế thêm mới hiện có.
- Thêm món thủ công XDCB lỗi Add/cập nhật tổng thì thu hồi đúng các ID vừa thêm và tính lại tổng; không xóa các món cũ. Nếu thu hồi/tính lại tổng cũng lỗi, trả rõ thông tin để đối soát.

## Phân quyền và phase

Theo yêu cầu cập nhật 28/10, phạm vi chọn HĐ XDCB dùng quy tắc S2 đang chạy, ánh xạ `executor.id -> responsible.officer`, `unit.lv1 -> unit.level1`. Không sửa thư viện quyền, workflow hoặc các điều kiện người/bước được sửa món, import, Save, đồng bộ OGL và sửa site của S6.

- Quyền xem vẫn là `0040040004000001`, Data Permission vẫn lấy bằng `getUnitByDataPermissions(contactId, "00401")`. LV1 lấy từ `contacts.lv1.id`; không dùng `scope`, `unitLv1`, `initialRole` do client truyền để quyết định quyền.
- Vai trò lọc HĐ lấy từ phiếu đã lưu qua `paymentId`: tại `initial_kttc` dùng `kttc`, các bước khác đọc `initial.role`, giống helper S2. ĐMMS chỉ được chọn HĐ có `responsible.officer` bằng người đăng nhập. Điều kiện này vẫn áp dụng khi scope toàn hệ thống/hội sở không giới hạn đơn vị.
- Scope `QT_PQDL_06` không lọc đơn vị. Scope `QT_PQDL_04` với LV1 bắt đầu `0999`: mapping `esdDMentity` active, `entity.code="1010098"` thì lấy `unit.level1 like "0999*"`; không có mapping thì giữ `1=1` như S2 đã được người dùng đồng ý. Lỗi kỹ thuật khi query mapping báo lỗi, không coi là không có mapping.
- Các scope còn lại dùng LV1 của hồ sơ đăng nhập như code S2; không dùng danh sách `permission.unit` để tự chuyển sang bộ lọc LV2/LV3. Thiếu LV1 bị chặn, ngoại trừ scope toàn hệ thống.
- Picker, thêm món, DO đổi NCC, Save, import và kiểm tra OGL truyền cùng `paymentId` khi kiểm tra HĐ. Helper đọc vai trò chỉ bổ sung ngữ cảnh lọc; quyền thao tác/phase vẫn do các entrypoint hiện có kiểm tra, không tự cấp quyền bằng tham số này. API chỉ đọc không gắn phiếu vẫn kiểm tra quyền xem và phạm vi đơn vị, như S2 khi chưa truyền vai trò phiếu.

## Site và OGL

Nhánh XDCB trong `ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER` dùng cùng API vấn tin/tạo và cùng builder payload `ESD_HTKT_PREPAYMENT_VENDOR.buildVendorAndSiteInfo` như S2. Không sửa mặc định/hành vi của thư viện Tạm ứng/Thanh toán.

1. Đọc entity/branch từ đơn vị phiếu và cấu hình site `getVendorDefaultSiteInfo("XDCB")` hiện có (`126150640`). Không tin branch/entity do caller truyền vào.
2. Chỉ tái sử dụng site local active, đã đồng bộ, đủ tài khoản, đúng NCC + chi nhánh + mã XDCB. Site HHDV hoặc chi nhánh khác không đủ điều kiện.
3. Chưa có site hợp lệ thì vấn tin OGL bằng MST và chi nhánh. Site XDCB đã có trên OGL được upsert về S6; không gọi tạo lại.
4. Theo yêu cầu mới nhất ngày 29/10, bám đúng S2 đang chạy: nếu vấn tin null/`success=false` hoặc chưa có site XDCB phù hợp thì build payload từ master NCC S6 và gọi tạo NCC/site. Không dùng data của response thất bại, kể cả response mock có NCC `HOANG223 / 1302225`. Kết quả vấn tin `success=true` vẫn phải đúng shape/MST/site active và không trùng trước khi dùng.
5. Kiểm tra kết quả cấp số/ghi site/ghi trạng thái NCC, đọc lại site rồi mới gán `vendor.site.id` và `ogl.sync.status=true` trên món. Không cập nhật `esdDMSupplier.isAccounted` cho nguồn S4.
6. Nếu OGL hoặc ghi local lỗi, giữ NCC S6 đã lưu, món chưa đồng bộ; có thể dùng lại khi bấm Đồng bộ OGL. Không import lại file chỉ để thử OGL.

Chỉ xác nhận đồng bộ sau khi API tạo/vấn tin hợp lệ và ghi/đọc lại site S6 thành công. Nếu phải gọi tạo, chỉ `created.success===true` mới được ghi site local. Tạo lỗi/null thì giữ NCC S6 và cờ món chưa đồng bộ để thử lại. Không tự làm mới token hoặc sửa base dùng chung.

### Rà lỗi site của DC.00557 ngày 28/10

- REST GET xác nhận món thuộc phiếu `DC.100.26.0000282`, HĐ `Ctr-00244`, NCC S6 `0000000016`, số tiền `20000`, chưa đồng bộ OGL. Master có MST `0101899104` và địa chỉ. HĐ S4 đang `Đang thực hiện`, gói `THAU-315`. Như vậy bước lưu NCC từ S4 về `esdHTKTvendor` đã thành công. Endpoint `esdHTKTvendorSite` chưa cấu hình REST, nên lần kiểm tra này chưa đọc được site local.
- Response nút Đồng bộ trả `Không vấn tin được NCC/site OGL; chưa tạo site mới.`. Điều kiện cũ gộp response thất bại và `response.data instanceof Array` không đúng vào cùng lỗi. Đã tái hiện mảng hợp lệ từ scope ScriptLibrary khác bị từ chối với đúng thông báo đó. Harness trước parse response trong scope caller nên không bắt được lỗi này; hiện integration mock dùng context riêng.
- Sửa nhánh XDCB dùng `Object.prototype.toString.call(response.data)` theo cách kiểm tra mảng đã có trong `ESD_HTKT_PAYMENT_COMMON`. Tách lỗi response không thành công và lỗi data không phải mảng. Giữ kiểm tra success, HĐ/NCC, quyền/phase và site XDCB; không sửa helper S2, không coi lỗi API là NCC chưa tồn tại để tự tạo tiếp. Tính chất `instanceof` phụ thuộc realm được mô tả trong [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/instanceof#instanceof_and_multiple_realms).
- 101 test NCC/site local qua với response từ context riêng, bao gồm Save, đồng bộ toàn phiếu, có/chưa có site, timeout/lỗi API, dữ liệu sai, lỗi ghi DB và thử lại. Chưa có body gốc `getVendorSiteInfo::response`/HTTP status của lần lỗi trên SM; chưa kết luận lỗi kiểm tra mảng là nguyên nhân duy nhất ở môi trường thật. Không chạy create/sync live trong lượt kiểm tra này.
- Đối chiếu S2: DO Save HHDV tìm master theo `vendor.number + supplier.id`, tạo khi chưa có, gán ID master vào món, rồi gọi helper đồng bộ NCC/site. S4 tìm master theo MST, không lưu ID join gói thầu vào `supplier.id`; cả hai đều lưu master trước OGL, nên lỗi OGL không có nghĩa chưa lưu NCC S6.

### Đối chiếu S2 và bản cuối theo yêu cầu người dùng ngày 29/10

Log 10:01 xác nhận `getVendorSiteInfo::httpStatus: 401`, response null; NCC S6 vẫn là `0000000016` và amount `20000`. Trigger sinh bút toán báo thiếu site là hệ quả. Log 09:56 có HTTP 200 nhưng body `success:false`, NCC `1302225`, không trùng MST của món `0101899104`; cần đối soát request/môi trường API, không tự coi dữ liệu này là kết quả thành công hoặc NCC chưa tồn tại.

Người dùng yêu cầu giữ nguyên base và làm đồng bộ S4 như S2. Bản retry/force-refresh trước đó đã gỡ; không dùng bản retry. Giữ nguyên các log debug người dùng bổ sung vào API OGL dùng chung.

- REST GET đối chiếu `DC.00559` (S2): HĐ `HDMS_26_GT01_01098`, NCC S6 `0000000002`, MST/mã `NCC_101234544`, site `0000000079`, đã đồng bộ. S4 `DC.00557`: NCC S6 `0000000016`, chưa gán site và chưa đồng bộ. Bảng site chưa mở REST nên GET không xác nhận được thời điểm tạo site. Log S2 lúc 10:16:54 có site `0000000079`, mã `126150610`, không có log vấn tin/tạo OGL trong lần Lưu đó; phù hợp nhánh dùng site local của S2.
- Hai khác biệt đã đối chiếu bằng hàm S2/S4 thật với cùng mock: S2 có site local active thì không gọi OGL; S4 chỉ tái dùng site đúng XDCB. Khi chưa có site và vấn tin `success=false`, S2 tiếp tục gọi tạo còn S4 trước đây dừng sớm. Cả hai dùng cùng API/helper base và cùng payload vấn tin MST/chi nhánh, nên chưa có bằng chứng xác thực phụ thuộc nguồn HĐ.
- Bản chốt dừng khi GET lỗi trước đó đã được thay theo yêu cầu mới nhất: S4 tiếp tục gọi tạo từ master S6 giống S2 khi GET `success=false`/null. Chỉ thay `ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.syncExpenseXdcbVendorToOgl`; không đổi helper S2, phân quyền, phase hoặc FD. Đã bỏ MST hardcode đang dùng thử, lấy lại `vendor["vendor.number"]` của NCC thực tế.
- Cấu hình XDCB đã có tại `ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo`: site/Nợ `126150640`, Có `224421300`. Nhánh XDCB truyền cấu hình này vào cùng builder S2; không dùng site HHDV `126150610` thay cho XDCB.
- Log mới 10:30:46–47 cho thấy cả vấn tin và tạo đều trả 401 ở bản trước. Điều này xác nhận đã đi tới API tạo, không xác nhận tạo site thành công. REST GET lại vẫn có master S6 `0000000016`/MST `0101899104`, món `DC.00557` chưa có site và chưa đồng bộ. Chưa xác định được token hết hạn, sai cấu hình môi trường hay gateway từ response rỗng; không tự coi 401 là chưa có NCC/site.
- Tạo thành công thì lưu/đọc lại `esdHTKTvendorSite`, gán site vào món và đánh dấu đồng bộ. Tạo lỗi/null thì trả lỗi tạo, giữ NCC S6 để thử lại; không lấy tên/MST/site trong body GET thất bại để ghi về NCC đang xử lý.
- Chỉ cần nạp lại SL `ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER` cho bản sửa này. Không đổi DO Lưu, base, API OGL dùng chung hoặc helper S2.
- Bộ NCC/site hiện có 113 ca: Save/nút Đồng bộ tiếp tục tạo sau GET null/success=false/401 và data null/không có; payload dùng NCC S6 đúng MST, chi nhánh và tài khoản XDCB; POST lỗi/null không ghi site hoặc báo đồng bộ; giữ master để thử lại; site local khác hạng mục/khác hoặc trống entity không được tái sử dụng. `tmp/compare-duchi-s2-s4-ogl.cjs` đối chiếu 8 ca cùng input cho S2/S4. Tất cả là mock local, chưa gọi tạo site live trong lượt sửa này.
- PDF bảng vấn tin đánh dấu `vendorName` bắt buộc, còn sơ đồ và code S2 hiện dùng MST + entity. Đây là điểm cần xác nhận với API đang triển khai; chưa tự thay payload S2 hoặc kết luận thiếu tên gây HTTP 401.
- Probe thật 14:07 và 14:12: 5 NCC × entity 100/106 đều HTTP 200, cùng body `success:false` / `HOANG223 / 1302225`. URL đang gọi là `https://fake-api.smartsolutionvn.com.vn/api/v1/vendors/site-info`; query MST/entity thay đổi đúng. Không coi dữ liệu mock đó là site của NCC được chọn. Kết quả POST tạo vẫn cần kiểm tra trên SM sau khi nạp SL mới.
- REST `esdHTKTvendorSite` vẫn trả 404 / `Restful config not found`. Đã thêm `ESD_HTKT_VENDOR_SITE_PROBE.inspectLocalVendorSites()` để DO chẩn đoán đọc hai bảng local bằng read-only và nối `vendorSite.vendor.id = vendor.id` mà không gọi OGL.

## Import và trình phiếu

- Các cột hiện có được giữ nguyên, gồm ba thông tin bắt buộc HĐ/MST/số tiền và nội dung đề nghị tùy chọn. Không cần thêm cột nguồn Squad.
- XDCB tra cột Mã HĐ/KMS bằng `esdXDCBrepairProjectCtr.id` trong phạm vi người dùng, đòi đúng một HĐ khớp ID. Không fallback sang `contract.code` hoặc S2.
- Kiểm tra MST thuộc gói thầu trước khi ghi. Tạo/tái sử dụng NCC S6 bằng cùng resolver của Save; dùng loại tiền trên HĐ. Mỗi dòng hợp lệ tạo một món mới, giữ món cũ và cơ chế thành công một phần/thu hồi hiện có.
- Import vẫn gọi API nút Đồng bộ OGL ở phía điều phối UI sau khi có món import thành công và đủ quyền. API xử lý toàn phiếu, gồm cả món cũ chưa đồng bộ.
- Trước đồng bộ/trình, XDCB kiểm tra lại HĐ đủ điều kiện, MST thuộc gói và currency đúng HĐ. KTTC trình chỉ kiểm tra; ĐMMS trình tự đồng bộ theo luồng hiện có. Món chỉ có site HHDV không qua kiểm tra XDCB.
- HHDV giữ validator S2 và helper OGL cũ. Các entrypoint TT/TU, thư viện shared OGL, quy tắc bút toán và writer S4 chưa thay đổi.

## Các điểm cần nạp/gắn trên SM

1. Nạp ScriptLibrary mới `ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.js` với tên SL `ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER`, bản cập nhật `ESD_HTKT_EXPENSE_CONTRACT.js`, `ESD_HTKT_EXPENSE_VENDOR.js` cùng dispatcher/context/create đã làm ở bước trước. Các hàm mới/sửa có comment ngắn giải thích nhiệm vụ.
2. Cập nhật Display Screen bằng `esdHTKTpaymentVendor.new.js` và `esdHTKTpaymentVendor.view.js`. Nhánh mới chỉ chạy cho phiếu Dự chi đã xác minh ở DB; TT giữ loader cũ.
3. Cập nhật script lưu Dự chi bằng `esdHTKTpaymentVendor.view_save_for_expense.js`. Đây là code trước khi SM lưu record món; các bước lưu/trigger hiện có vẫn phải được kiểm tra trên SM.
4. Dùng hai DO đã có trong ảnh người dùng cung cấp, thay nội dung **Pre JavaScript** theo bảng dưới. Giữ GUI option `4200`, Action `do nothing`, Modifies Record và Condition hiện tại; không tạo thêm DO/Display Screen. File callback chung cũ đã được thay bằng hai file đúng tên DO, không cần nạp riêng hoặc xóa DO/DS đang dùng.
5. Deploy UI có picker mở Tiếp tục, hiển thị mã HĐ theo `id`/`contract_id` đã lưu. Nạp backend trước UI để tránh UI mới gọi thư viện chưa có. Alias API `contract_code` của XDCB cũng trả cùng ID.

| Screen ID | Unique ID của DO | Condition giữ nguyên | File Pre JavaScript |
| --- | --- | --- | --- |
| `esdHTKTpaymentVendor.new` | `esdHTKTpaymentVendor.new_fill_data` | `true` | `esdHTKTpaymentVendor.new_fill_data.js` |
| `esdHTKTpaymentVendor.view` | `esdHTKTpaymentVendor.view_fill_data` | `$isExpense` | `esdHTKTpaymentVendor.view_fill_data.js` |

Chỉ nhánh Dự chi XDCB gọi `selectExpenseSupplier`: xác minh phiếu/HĐ/NCC, điền tên/MST/địa chỉ, giữ loại tiền HĐ và nội dung đang nhập. Không nạp lại toàn form làm mất số tiền chưa lưu; không tạo NCC/site khi chỉ đổi lựa chọn. Lựa chọn không hợp lệ xóa các biến NCC đang chọn và báo lỗi, giữ dữ liệu record đã lưu. Cả loader và callback S4 đều từ chối HHDV. DO `.new`/`.view` của HHDV giữ nguyên callback người dùng cung cấp, gồm mặc định VND và cách điền nội dung cũ; không bổ sung địa chỉ/type vào SQL loader HHDV hoặc đổi cách Save HHDV. Nhận diện nguồn khi Save không áp thêm chốt quyền/phase cho HHDV; nhánh Save XDCB tự kiểm tra quyền trước khi ghi.

### DO chọn NCC và DS hiển thị lại

Đã tái hiện lỗi khi chạy đủ chuỗi DS -> DO 4200 -> DS: loader XDCB luôn đặt `$supplierId=""` rồi phân giải NCC theo `record.vendor.id` đã lưu. Vì chọn dropdown chưa Save nên món mới mất lựa chọn, món cũ quay về NCC trước đó. Riêng DS `.new` còn đặt `$amount=0` trước khi gọi loader. Test DO riêng lẻ trước đó không bao phủ vòng hiển thị lại này.

- `selectExpenseSupplier` chỉ giữ ID NCC vừa chọn trong biến local `$L.expense.xdcb.supplier.draft`; không ghi NCC/món/site khi chỉ chọn dropdown. Khóa gồm phiếu, món, HĐ, NCC đã lưu, người dùng, role và phase. Loader chỉ dùng bản nháp của đúng form còn quyền sửa, và luôn lấy lại tên/MST/địa chỉ từ danh sách S4 hiện tại.
- Theo yêu cầu mới nhất của người dùng, đã bỏ `xdcbEnteredAmount`, tham số `enteredAmount` và số tiền trong bản nháp. Số tiền giữ cách khởi tạo/nạp từ record trước đây; bản sửa redisplay chỉ giữ NCC.
- Chọn NCC lỗi, nguồn NCC không còn hợp lệ, đổi ngữ cảnh form hoặc Save hoàn tất thì xóa bản nháp. Không có bản nháp thì loader đọc NCC/số tiền từ record như trước. Biến `$L.` được SM dọn khi thoát RAD application theo [tài liệu OpenText](https://docs.microfocus.com/doc/Service_Manager/9.80/LocalVariables).
- Cần cập nhật cùng bản SL `ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER`, DS `.new` và hai DO `.new_fill_data`/`.view_fill_data`. DS `.view` hiện đã gọi loader qua `ESD_HTKT_EXPENSE_VENDOR`, không cần đổi logic chọn FD: `$isExpense` vẫn dùng `esdHTKTexpenseVendor`, Thanh toán vẫn dùng `esdHTKTpaymentVendor`. Không tạo DO/FD mới hoặc đổi quyền/phase để xử lý lỗi refresh.

### Lỗi `.find` ở DO và kiểm tra số tiền khi Save

Người dùng đã đối chiếu trên SM: gọi loader như code cũ thì chọn NCC/điền MST được; dùng đoạn DS mới có phép gán `arrVendors = lib...loadPaymentVendorInfo(...)` thì lỗi. Đối chiếu HEAD xác nhận loader HHDV cũ tự gán global `arrVendors`/các biến form và không trả về mảng. DS mới đã thay đổi cách gọi hàm này: phép gán có thể ghi đè danh sách vừa nạp bằng giá trị trả về không phù hợp. Bản vá trước thêm `return arrVendors` vào SL local vẫn phụ thuộc việc nạp đồng bộ SL và DS; test Node dùng cùng một scope không bao phủ được bản loader cũ trên SM. Các test mô phỏng Datum/collection chỉ tái hiện lỗi thiếu `.find`, không chứng minh kiểu dữ liệu runtime là nguyên nhân duy nhất.

- DS `.view` khôi phục `lib.ESD_HTKT_EXPENSE_VENDOR.loadPaymentVendorInfo(vars.$L_file);`, không gán giá trị trả về vào `arrVendors` và không đọc ngược qua `$arrVendors`. Đã bỏ `return arrVendors` mới thêm ở cuối nhánh HHDV, giữ cách điền global/vars cũ. SQL, option, quyền và phase không đổi.
- HHDV gọi trực tiếp `ESD_HTKT_PAYMENT_VENDOR.getContractInfo(contractId)` và gán `$contractId = contractInfo.id` như trước. Chỉ XDCB dùng `getExpenseContractInfo` để đọc S4; cả hai nhánh hiển thị ID HĐ đã lưu trên món.
- Hai DO `.new_fill_data`/`.view_fill_data` chuyển collection có `toArray()` rồi duyệt theo index. Chọn dòng khớp đầu tiên bằng cùng điều kiện `supplier.id`; không tải lại form hoặc truy vấn thêm NCC. [OpenText mô tả `SCDatum.toArray()`](https://docs.microfocus.com/SM/9.51/Hybrid/Content/programming/javascript/reference/javascript_method_scdatum_toarray.htm) là phương thức chuyển Datum thành mảng JS. Các phép gán MST, tên, currency, type và nội dung giữ nguyên; không ghi đè `$amount`.
- Bản sửa loader cần cập nhật DS `.view` trên SM; cách gọi này tương thích loader HHDV cũ không có return. Hai DO giữ bản duyệt theo index đã sửa ở lượt trước, không đổi thêm. Không tạo DO mới hoặc đổi cấu hình FD. Ba ca hồi quy kiểm tra loader trả `undefined`, Datum hoặc mảng rỗng vẫn không ghi đè danh sách; xác nhận biểu thức `.find` cũ vẫn lấy đúng MST sau DS, HHDV dùng getter S2 và Save ghi đúng số tiền 123.
- Người dùng đã xác nhận input số tiền ghi trực tiếp `record["amount"]`. Validate chung trong file local cũng đã được đổi sang đọc record; giữ nguyên thay đổi này. Lỗi `Số tiền dự chi phải lớn hơn 0 hợp lệ.` của món XDCB `DC.00557` xuất phát từ lần kiểm tra tiếp theo trong `saveExpenseXdcbDetails`: hàm này vẫn đọc `vars.$amount`, có thể còn 0 dù record đang có 2000. Đã sửa riêng hàm Save XDCB đọc/chuẩn hóa `record["amount"]`; giữ điều kiện số dương hữu hạn/giới hạn tiền hiện có, không thêm cache hoặc fallback sang `$amount`.
- Cần nạp lại SL `ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER` cho bản sửa số tiền. Ba ca kiểm tra đi trọn DO Save với record 2000 trong khi `$amount` là 0/rỗng/giá trị cũ khác; tám ca kiểm tra record không hợp lệ vẫn bị chặn trước ghi NCC/gọi OGL dù `$amount` dương. Test FD được cập nhật để mô phỏng người dùng nhập vào record. Nhánh Save HHDV, hai DO chọn NCC, quyền và phase không sửa thêm trong lượt này.

### Rà lại lỗi Add món HHDV

Ảnh lỗi HĐ `HDMS_26_GT_2026_001_00185` dừng tại `relationFile.doAction("add")` trong `createPaymentVendor`, trả `-1`, `getMessages()` là null. REST GET xác nhận HĐ S2 tồn tại và món `DC.00547` đã có trên phiếu `DC.100.26.0000278`; chưa đủ thông tin để kết luận món đó thuộc lần Add đang lỗi hay một lần trước. Chưa có log runtime để xác định nguyên nhân DE/trigger, chưa chạy lại Add trên SM thật. Theo [tài liệu SCFile.doAction](https://docs.microfocus.com/doc/425/9.71/javascriptmethodscfiledoaction), `-1` là `RC_ERROR` và cần Messages/sm.log để xem nguyên nhân chi tiết.

Đối chiếu với code trước tích hợp S4 cho thấy bản cập nhật đã mở SCFile phiếu cha để ghi trước Add món, trong khi luồng cũ chỉ mở sau Add thành công. Đã khôi phục thứ tự cũ: chỉ dùng cursor readonly để phân nguồn rồi đóng ngay; Add món xong mới mở phiếu cha để cập nhật tổng. Thu hồi XDCB tự mở cursor tổng khi cần. Giữ nguyên cách sinh số, trường của món HHDV, lỗi Add và số lần gọi Add; không thêm retry, bỏ validation hoặc đổi trigger. Đây là khôi phục phần thay đổi ở đường chung, chưa phải bằng chứng đã xử lý nguyên nhân runtime của `-1`.

## Kiểm thử và giới hạn

- Bộ test: `node --test SM/tests/duchi-s4-suppliers.test.cjs`, 108 ca qua. Bao phủ nguồn, quyền, NCC mới/cũ/trùng, nhiều món/gói cùng MST, Display Screen/DO 4200 TT/DC, hồi quy loader/callback/Save HHDV cũ, tiền tệ XDCB, site đúng/sai, lỗi OGL/DB, thử lại, import thêm mới/thu hồi và kiểm tra trình. Trong đó có đối chiếu 72 tổ hợp vai trò/phase/người thao tác/trạng thái đồng bộ giữa loader HHDV hiện có và XDCB, cùng kiểm tra truyền ngữ cảnh phiếu xuyên suốt; phase không bị ghi lại. Thêm kiểm tra HHDV không đi vào loader/callback S4 và response danh sách HHDV không bị thêm field mới. 11 ca mới kiểm tra DO -> DS `.new`/`.view` hiển thị lại vẫn giữ NCC và số tiền khởi tạo như cũ, bản nháp sai ngữ cảnh, NCC nguồn thay đổi/xóa, Save và form không có bản nháp. Hai ca bổ sung kiểm tra đóng cursor phân nguồn trước Add/mở cursor ghi phiếu sau Add, và giữ nguyên xử lý lỗi Add của HHDV.
- Hồi quy local: `node SM/tests/duchi-s4-contracts.test.cjs`, 67 ca HĐ S4/scope/router và kiểm tra actor phía server. Bộ này gọi khai báo `listPurchaseContracts` S2 đang có hiệu lực để đối chiếu kết quả với S4, gồm ĐMMS, KTTC tiếp nhận phiếu ĐMMS và hội sở có/không có mapping; đồng thời kiểm tra trạng thái, phân trang, tham số giả và lỗi truy vấn. Các hồi quy khác đã qua: 15 ca lưu/mở lại hạng mục/HHDV; picker; 12 ca import HHDV/nội dung; 20 ca auto OGL toàn phiếu; bộ OGL cũ; ESLint và cú pháp JS. Tất cả dùng mock/source local, không thay thế UAT SM.
- TypeScript targeted vẫn có lỗi có sẵn ở `convertFiltersToQuery.ts` (`NOT_EQUALS_OR_NULL`, hai vị trí) và `historyUtils.ts` (`description` khác kiểu). Chưa có kết quả full build xanh.
- Chưa có DBdict Keys/unique constraint của `esdHTKTvendor.vendor.number` hoặc bộ khóa liên phiên được xác nhận trong repo. Đã đọc lại trước Add và phát hiện kết quả trùng sau ghi, nhưng chưa thể bảo đảm chống trùng nguyên tử khi hai phiên đồng thời tạo cùng MST. Cần kiểm tra Keys/lock trên SM và chạy UAT đồng thời; không tự thêm constraint có thể ảnh hưởng NCC S2 đang có MST trùng.
- Cần UAT với quyền/Rule Set/trigger thật, callback, dữ liệu S4 thiếu gói/NCC/địa chỉ, OGL thật và trường hợp ghi OGL thành công nhưng lưu món/site thất bại. Một số HĐ S4 đang thiếu gói thầu sẽ bị báo lỗi rõ, không tạo món bằng nguồn khác.
- Tổng tiền và cơ chế nhiều loại tiền giữ cách tính hiện có của Dự chi; đợt này không bổ sung quy đổi tỷ giá. Cần đối soát nghiệp vụ nhiều loại tiền trước khi dùng rộng.
- Chưa ghi tiến độ về `esdXDCBrepairProjectCtrPayment`: mã loại Dự chi, thời điểm ghi, đơn vị một dòng và cơ chế xóa vẫn là phần tích hợp tiếp theo cần chốt.
