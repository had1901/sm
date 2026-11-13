function renderDanhSachHoaDon() {
    var file = vars['$L.file'];
    
    // Đổi sang system.functions.operator() để đảm bảo không bao giờ bị null 
    // kể cả khi hàm này vô tình bị trigger qua luồng API/Background
    var currentUser = system.functions.operator();
    if (!currentUser) {
        currentUser = vars['$lo.contact.name'];
    }
    
    var moduleCode = "004004"; // Mã phân hệ Danh mục hóa đơn

    // ==========================================
    // 1. TÍNH TOÁN QUYỀN HÀNH ĐỘNG (HIỂN THỊ NÚT UI)
    // ==========================================
    var canView = lib.ESD_HTKT_PERMS_UTILS.checkActionRight("0040040001000001");   // Xem chi tiết
    var canUpload = lib.ESD_HTKT_PERMS_UTILS.checkActionRight("0040040001000002"); // Upload
    var canDelete = lib.ESD_HTKT_PERMS_UTILS.checkActionRight("0040040001000003"); // Xóa

    if (!canView) {
        // [QUAN TRỌNG] Đã loại bỏ dấu backtick (`), dùng nháy kép ES5
        return "<div style='color:red;'>Bạn không có quyền xem Danh mục Hóa đơn.</div>";
    }

    // ==========================================
    // 2. TÍNH TOÁN PHẠM VI DỮ LIỆU (DATA SCOPE)
    // ==========================================
    // Hàm này sẽ tự nhận diện user là Cá nhân (CB DMMS) hay Phòng ban (CB KTTC) để gen chuỗi Query
    var scopeQuery = lib.ESD_HTKT_PERMS_UTILS.buildDataScopeQuery(currentUser, moduleCode);

    // [QUAN TRỌNG] Nối chuỗi bằng toán tử + (ES5) thay vì literal template
    var defaultFilter = 'category="HOADON" and (' + scopeQuery + ')';

    // ==========================================
    // 3. TRẢ VỀ CẤU HÌNH CHO NEXTJS
    // ==========================================
    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HopDong/DanhSachHoaDon', '', {
        defaultFilter: defaultFilter,
        btnConfig: [
            {
                id: 'import',       // Tương đương Upload
                visible: canUpload
            },
            {
                id: 'delete',
                visible: canDelete
            }
        ],
        user: currentUser,
        parentId: file ? file.id : ""
    });
}