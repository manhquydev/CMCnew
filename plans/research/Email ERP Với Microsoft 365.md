# **Nghiên cứu toàn diện: Tận dụng Microsoft 365 A1 Education làm hạ tầng email cho hệ thống ERP nội bộ**

## **A. Kết luận ngắn**

Giải pháp tận dụng gói dịch vụ Microsoft 365 A1 Education sẵn có của tổ chức để làm hạ tầng gửi email cho hệ thống ERP nội bộ hoàn toàn khả thi về mặt kỹ thuật. Exchange Online đi kèm trong gói A1 cung cấp hộp thư đầy đủ tính năng với dung lượng tiêu chuẩn 50 GB cho mỗi người dùng, hỗ trợ các giao thức kết nối từ SMTP truyền thống đến các giao diện lập trình ứng dụng hiện đại như Microsoft Graph API. Đối với các nhu cầu gửi email giao dịch thông thường—chẳng hạn như gửi thông báo hệ thống, phiếu lương, quyết định phê duyệt hoặc thông tin tài khoản cho nhân sự mới—tổ chức hoàn toàn không cần đầu tư thêm chi phí để mua các dịch vụ email chuyên dụng từ bên thứ ba (như SendGrid, Mailgun).  
Tuy nhiên, có hai rào cản lớn về mặt tuân thủ pháp lý và quản trị hệ thống mà tổ chức cần lưu ý trước khi triển khai:

* **Điều khoản cấp phép thương mại (Commercial Licensing Compliance):** Gói Microsoft 365 A1 Education được thiết kế và trợ giá đặc biệt (thậm chí miễn phí) dành riêng cho các tổ chức giáo dục hợp lệ phục vụ công tác giảng dạy, học tập. Việc một doanh nghiệp kinh doanh thương mại thông thường cố tình sử dụng gói tài nguyên giáo dục này để vận hành hệ thống ERP thương mại là vi phạm nghiêm trọng chính sách sử dụng dịch vụ của Microsoft. Nếu tổ chức thực sự là một đơn vị giáo dục, việc tận dụng này là hoàn toàn hợp pháp. Trong trường hợp ngược lại, doanh nghiệp bắt buộc phải chuyển dịch sang các gói thương mại như Microsoft 365 Business hoặc Enterprise để tránh rủi ro pháp lý và nguy cơ bị khóa tenant đột ngột.  
* **Chính sách giới hạn lưu trữ và gửi thư của Microsoft:** Kể từ tháng 2 năm 2024, Microsoft đã áp dụng chính sách giới hạn dung lượng lưu trữ gộp (pooled storage) tối đa 100 TB cho toàn bộ tenant giáo dục, đồng thời các hộp thư miễn phí gói A1 không còn làm tăng tổng dung lượng gộp của hệ thống. Thêm vào đó, Exchange Online áp đặt các giới hạn gửi thư nghiêm ngặt ở cấp độ hộp thư (10.000 người nhận/ngày và tần suất tối đa 30 thư/phút). Nếu quy mô gửi thư giao dịch của hệ thống ERP vượt quá các ngưỡng này, việc định tuyến qua hạ tầng Exchange Online thông thường sẽ bị nghẽn, đòi hỏi phải tích hợp các giải pháp chuyên dụng có tính phí.

## **B. So sánh chi tiết các phương án tích hợp email cho ERP**

Để xây dựng cầu nối gửi email từ hệ thống ERP qua hạ tầng Microsoft 365, quản trị viên có thể lựa chọn một trong bốn phương án kỹ thuật. Mỗi phương án có cơ chế hoạt động, yêu cầu hạ tầng và mức độ an ninh rất khác nhau.

### **1\. Phân tích chi tiết các phương án kỹ thuật**

* **SMTP Client Submission (SMTP AUTH):** Phương thức này yêu cầu ứng dụng ERP thiết lập kết nối trực tiếp đến máy chủ smtp.office365.com qua cổng 587 bằng giao thức bảo mật STARTTLS, sử dụng thông tin đăng nhập (Username và Password) của một hộp thư thật đã được gán bản quyền trong hệ thống. Đây là giao thức truyền thống, dễ cấu hình và được hầu hết các module ERP hỗ trợ sẵn. Tuy nhiên, do Microsoft đã vô hiệu hóa phương thức xác thực cơ bản (Basic Authentication) theo mặc định và bắt buộc bật chính sách bảo mật hệ thống (Security Defaults), việc sử dụng SMTP AUTH đòi hỏi ứng dụng phải hỗ trợ cơ chế xác thực hiện đại OAuth 2.0 (XOAUTH2), một yêu cầu mà nhiều hệ thống ERP legacy không đáp ứng được. Đồng thời, phương án này bị giới hạn cứng ở mức 30 thư/phút và 10.000 người nhận/ngày.  
* **SMTP Relay (qua Connector):** Phương thức này cho phép máy chủ ERP gửi email ẩn danh thông qua một cổng kết nối bảo mật (Inbound Connector) được thiết lập riêng trên Exchange Admin Center. Điều kiện tiên quyết là máy chủ ERP phải sở hữu một địa chỉ IP Public tĩnh cố định để Exchange Online xác thực nguồn gửi. Điểm vượt trội của SMTP Relay là không yêu cầu tài khoản gửi phải có bản quyền, đồng thời cho phép gửi email dưới danh nghĩa nhiều địa chỉ khác nhau thuộc các tên miền đã xác thực trong hệ thống. Phương thức này giúp vượt qua giới hạn tần suất gửi 30 thư/phút của SMTP Client Submission, khiến nó trở thành giải pháp lý tưởng cho các ERP on-premises có lưu lượng gửi lớn.  
* **Direct Send:** Đây là phương thức gửi email trực tiếp từ máy chủ ERP đến bản ghi MX của tên miền tổ chức (company-mail.protection.outlook.com) qua cổng 25 mà không cần bất kỳ bước xác thực thông tin đăng nhập nào. Direct Send cực kỳ đơn giản vì không đòi hỏi tài khoản mailbox thật hay cấu hình phức tạp trên Exchange Online. Tuy nhiên, rủi ro lớn nhất của phương thức này là **chỉ hỗ trợ gửi thư nội bộ** (gửi cho người nhận có tên miền nằm trong cùng một tenant Microsoft 365). Mọi nỗ lực gửi email ra các hệ thống bên ngoài như Gmail hay Yahoo đều sẽ bị chặn đứng. Hơn nữa, do thiếu cơ chế xác thực, Direct Send thường xuyên bị tin tặc lạm dụng để thực hiện các cuộc tấn công giả mạo nội bộ, buộc Microsoft phải cung cấp tính năng \-RejectDirectSend để các tổ chức chủ động chặn đứng phương thức này nhằm bảo vệ hệ thống.  
* **Microsoft Graph API:** Đây là phương thức gửi thư hiện đại nhất, hoàn toàn không phụ thuộc vào giao thức SMTP. ERP sẽ thực hiện các truy vấn HTTPS POST trực tiếp đến điểm cuối /users/{id}/sendMail của Microsoft Graph. Quá trình xác thực được thực hiện an toàn thông qua mô hình ứng dụng Entra ID (App Registration) sử dụng chứng chỉ số (Certificate-Based Authentication), loại bỏ hoàn toàn rủi ro lộ lọt mật khẩu. Giao thức này cho phép tận dụng các hộp thư dùng chung miễn phí (Shared Mailbox) để gửi thư ra cả bên trong lẫn ngoài tổ chức. Điểm cộng lớn nhất của Graph API là khả năng lưu trữ thư đã gửi trực tiếp vào thư mục Sent Items của Shared Mailbox và tích hợp sâu vào hệ sinh thái ứng dụng của Microsoft.

### **2\. Bảng so sánh tổng hợp các phương án tích hợp**

Dưới đây là bảng so sánh trực quan bốn phương thức gửi email từ ERP thông qua hạ tầng Microsoft 365:

| Tiêu chí so sánh | SMTP Client Submission | SMTP Relay (Connector) | Direct Send | Microsoft Graph API |
| :---- | :---- | :---- | :---- | :---- |
| **Yêu cầu Mailbox thật** | Có (Yêu cầu tài khoản có bản quyền) | Không (Chỉ cần email thuộc domain đã verify) | Không (Gửi ẩn danh không cần tài khoản) | Không cần license (Tận dụng Shared Mailbox) |
| **Yêu cầu IP Public tĩnh** | Không yêu cầu | Bắt buộc phải có IP tĩnh của ERP | Khuyến nghị (Để cấu hình SPF chính xác) | Không yêu cầu |
| **Gửi email nội bộ** | Có hỗ trợ | Có hỗ trợ | Có hỗ trợ | Có hỗ trợ |
| **Gửi email ra ngoài** | Có hỗ trợ | Có hỗ trợ | **Không hỗ trợ** | Có hỗ trợ |
| **Độ phức tạp triển khai** | Thấp đến trung bình (Tùy thuộc hỗ trợ OAuth2) | Trung bình (Cấu hình Exchange Connector) | Rất thấp (Trỏ trực tiếp về MX Record) | Cao (Đòi hỏi phát triển ứng dụng và cấu hình API) |
| **Mức độ an ninh bảo mật** | Trung bình (Rủi ro lộ lọt thông tin tài khoản) | Trung bình (Nếu IP bị chiếm dụng hoặc SPF cấu hình lỏng lẻo) | Rất thấp (Dễ bị tấn công spoofing nội bộ) | **Rất cao** (Xác thực bằng chứng chỉ số và phân quyền RBAC) |
| **Giới hạn số lượng gửi** | 10.000 người nhận/ngày và tối đa 30 thư/phút | 10.000 người nhận/ngày trên mỗi hộp thư đại diện | Không giới hạn gửi (Phụ thuộc hạn ngạch nhận của tenant) | 10.000 người nhận/ngày cho mỗi Shared Mailbox gửi |
| **Sự phù hợp cho ERP nội bộ** | Thấp (Bị hạn chế bởi xu hướng khai tử Basic Auth của Microsoft) | Trung bình (Thích hợp cho các phần mềm ERP đóng gói cũ) | Không phù hợp (Không đáp ứng được các kịch bản gửi email ra ngoài) | **Tối ưu nhất** (Đáp ứng đầy đủ các tiêu chuẩn bảo mật hiện đại) |

## **C. Đánh giá khả năng đáp ứng theo Use Case nghiệp vụ**

Việc lựa chọn phương án kỹ thuật phù hợp phụ thuộc rất lớn vào đối tượng nhận thư và tính chất bảo mật của từng kịch bản nghiệp vụ trong ERP.

### **1\. Gửi email onboarding đến hòm thư cá nhân của nhân sự mới**

Nghiệp vụ này yêu cầu hệ thống phải gửi thư ra ngoài phạm vi tên miền của tổ chức (đến các địa chỉ cá nhân như Gmail, Yahoo, Outlook.com). Do đó, **Direct Send hoàn toàn bị loại** ngay từ bước đánh giá ban đầu. Đối với ba phương án còn lại, Microsoft Graph API thể hiện ưu thế vượt trội nhờ khả năng tích hợp linh hoạt với quy trình tự động hóa. Email gửi qua Graph API từ một Shared Mailbox chuyên dụng (ví dụ: hr-onboarding@company.edu.vn) có đầy đủ chữ ký số DKIM và SPF, giúp thư vượt qua các bộ lọc khắt khe của các nhà cung cấp dịch vụ email cá nhân lớn, đảm bảo thư thông báo không bị rơi vào thư mục Junk hay Spam.

### **2\. Gửi phiếu lương, thông báo nội bộ và email phê duyệt quy trình (Workflow Alerts)**

Đây là các email giao dịch có tần suất gửi tập trung cực kỳ cao, đặc biệt là vào các kỳ chốt công, tính lương hàng tháng.

* Nếu tổ chức sử dụng phương án **SMTP Client Submission**, hệ thống sẽ nhanh chóng chạm ngưỡng giới hạn 30 thư/phút, dẫn đến hiện tượng nghẽn hàng đợi hoặc lỗi từ chối dịch vụ từ phía Exchange Online.  
* Để giải quyết bài toán này, **SMTP Relay** và **Microsoft Graph API** là hai sự lựa chọn khả thi.  
* Xét về khía cạnh an toàn thông tin, phiếu lương và thông tin nhân sự là những dữ liệu cực kỳ nhạy cảm. Do đó, việc sử dụng Graph API kết hợp với cơ chế phân quyền hạt nhân chi tiết giúp bảo vệ dữ liệu luân chuyển tốt hơn rất nhiều so với SMTP Relay thông thường.

### **3\. Gửi email reset mật khẩu và thông báo bảo mật**

Đối với các email liên quan đến an ninh tài khoản, tốc độ truyền tải gần như tức thời là yếu tố quyết định.

* Gửi qua **Graph API** hoặc **SMTP Client Submission** sử dụng kết nối bảo mật mã hóa TLS 1.2/1.3 là bắt buộc để ngăn chặn các cuộc tấn công nghe lén trên đường truyền.  
* Việc sử dụng **Direct Send** cho kịch bản này là một sai lầm nghiêm trọng về mặt an ninh. Do Direct Send không yêu cầu xác thực, tin tặc có thể dễ dàng dựng các máy chủ giả mạo để gửi các email reset mật khẩu giả, dẫn dụ người dùng khai báo thông tin trên các trang web lừa đảo (phishing).

## **D. Phân tích bảo mật, xác thực và tuân thủ**

Bảo mật hạ tầng email cho ứng dụng tự phát triển luôn là thách thức lớn đối với các quản trị viên hệ thống. Microsoft đã và đang thực hiện những thay đổi mang tính lịch sử đối với các giao thức xác thực trên Exchange Online.

### **1\. Hiện trạng của SMTP AUTH và xu hướng chuyển dịch**

Xác thực cơ bản (Basic Authentication \- sử dụng tên đăng nhập và mật khẩu thô) đã bị Microsoft khai tử trên toàn cầu đối với hầu hết các giao thức như POP3, IMAP4 và Outlook nhằm ngăn chặn các cuộc tấn công dò quét mật khẩu.

* Mặc dù SMTP AUTH hiện vẫn được hỗ trợ nếu quản trị viên chủ động kích hoạt và cấu hình chính sách ngoại lệ, giao thức này vẫn tiềm ẩn rủi ro rất lớn.  
* Khi một ứng dụng ERP lưu trữ mật khẩu tĩnh của tài khoản hệ thống trong mã nguồn hoặc tệp cấu hình, bất kỳ sự cố lộ lọt dữ liệu nào cũng sẽ trao cho tin tặc quyền kiểm soát hộp thư đó.  
* Hơn nữa, nếu tài khoản này được bật xác thực đa yếu tố (MFA)—một tiêu chuẩn bắt buộc trong các tổ chức hiện đại—việc gửi thư qua SMTP AUTH truyền thống sẽ bị gián đoạn hoàn toàn trừ khi doanh nghiệp sử dụng mật khẩu ứng dụng (App Password), vốn cũng đang bị Microsoft hạn chế và loại bỏ.  
* Do đó, việc chuyển dịch sang **Microsoft Graph API** sử dụng xác thực OAuth 2.0 là lộ trình tất yếu. Luồng cấp phép ứng dụng (Client Credentials Flow) hoạt động hoàn toàn không cần sự tương tác của con người, bỏ qua các rào cản của MFA và chính sách truy cập có điều kiện (Conditional Access) một cách an toàn.

### **2\. So sánh cơ chế kiểm soát quyền lực: Application Access Policies vs. RBAC cho Ứng dụng**

Khi cấp quyền gửi email Mail.Send ở cấp độ ứng dụng (Application Permission) trên Microsoft Entra ID cho ERP, mặc định ứng dụng đó sẽ có quyền lực tuyệt đối để gửi thư dưới danh nghĩa **mọi hộp thư** trong tổ chức, từ tài khoản của nhân viên bình thường cho đến Ban Giám đốc. Điều này vi phạm nguyên tắc đặc quyền tối thiểu (Least Privilege). Để giới hạn phạm vi truy cập của ứng dụng, Microsoft cung cấp hai giải pháp:  
`[ Toàn bộ Hộp thư trong Tenant (User Mailboxes, Executive Mailboxes, v.v.) ]`  
                             `│`  
                             `▼  (Bị chặn bởi bộ lọc bảo mật)`  
       `┌────────────────────────────────────────────────────────┐`  
       `│             HÀNG RÀO KIỂM SOÁT TRUY CẬP                │`  
       `│    (Application Access Policy hoặc Exchange RBAC)      │[span_175](start_span)[span_175](end_span)[span_176](start_span)[span_176](end_span)`  
       `└──────────────────────────┬─────────────────────────────┘`  
                                  `│`  
                                  `▼ (Chỉ cho phép đi qua)`  
                 `[ Nhóm Hộp thư được ủy quyền ]`  
                 `- erp-notify@company.edu.vn`  
                 `- hr-onboarding@company.edu.vn[span_177](start_span)[span_177](end_span)[span_178](start_span)[span_178](end_span)`

* **Application Access Policies (Cơ chế cũ):** Cơ chế này liên kết một Đăng ký Ứng dụng (App Registration) với một nhóm bảo mật nhận thư (Mail-enabled Security Group) chứa các hộp thư hệ thống thông qua lệnh PowerShell New-ApplicationAccessPolicy. Ứng dụng sẽ chỉ có thể gửi thư từ các địa chỉ nằm trong nhóm này. Tuy nhiên, giải pháp này đang được Microsoft định vị là công cụ kế thừa (legacy) và đang dần được thay thế hoàn toàn bằng hệ thống mới.  
* **Exchange Online RBAC cho Ứng dụng (Cơ chế mới):** Đây là mô hình quản trị an ninh hiện đại, cho phép quản trị viên tạo các thực thể dịch vụ trực tiếp trong Exchange Online (New-ServicePrincipal), thiết lập các phạm vi quản lý tùy biến (New-ManagementScope) dựa trên các thuộc tính động của hộp thư (ví dụ: chỉ những hộp thư có thuộc tính CustomAttribute15 là 'ERPMailbox'). Sau đó, quyền gửi thư (Application Mail.Send) sẽ được gán trực tiếp cho ứng dụng chỉ trong phạm vi bộ lọc động này. Phương án này linh hoạt hơn, dễ quản lý hơn và không phụ thuộc vào việc duy trì các nhóm bảo mật mail tĩnh.

## **E. Kiến trúc đề xuất tối ưu**

Báo cáo đề xuất một kiến trúc gửi email tối ưu nhất, được thiết kế chuyên biệt cho bối cảnh tổ chức đang vận hành gói Microsoft 365 A1 Education, tự xây dựng hệ thống ERP nội bộ và mong muốn tối ưu hóa chi phí đến mức tối đa.  
`+-----------------------------------------------------------------------------------+`  
`|                              MÁY CHỦ ERP NỘI BỘ                                   |`  
`|                                                                                   |`  
`|  +--------------------+      (Xác thực mTLS)       +---------------------------+  |`  
`|  | Module Nghiệp vụ   | -------------------------> |  Chứng chỉ số nội bộ      |  |`  
`|  | (Tạo tài khoản...) |                            |  (erp-mail.key/crt)       |  |`  
`|  +--------------------+                            +---------------------------+  |`  
`|           |                                                      |                |`  
`+-----------|------------------------------------------------------|----------------+`  
            `|                                                      |`  
            `| (Đóng gói dữ liệu thư thành JSON)                    | (Yêu cầu Token)`  
            `▼                                                      ▼[span_201](start_span)[span_201](end_span)[span_202](start_span)[span_202](end_span)`  
`+-----------------------------------------------------------------------------------+`  
`|                            HẠ TẦNG MICROSOFT CLOUD                                |`  
`|                                                                                   |`  
`|  +-----------------------------------------------------------------------------+  |`  
`|  | Microsoft Entra ID (Xác thực Ứng dụng & Cấp Access Token)                   |  |`  
`|  +-----------------------------------------------------------------------------+  |`  
`|                                         |                                         |`  
`|                                         | (Gửi Access Token kèm yêu cầu gửi thư)  |`  
`|                                         ▼                                         |`  
`|  +-----------------------------------------------------------------------------+  |`  
`|  | Exchange Online (Kiểm tra chính sách RBAC cho Ứng dụng)                      |  |`  
`|  |                                                                             |  |`  
`|  |  +-----------------------------------------------------------------------+  |  |`  
`|  |  | Specific Mailbox Scope (Chỉ cho phép gửi qua các địa chỉ sau)         |  |  |`  
`|  |  |                                                                       |  |  |`  
`|  |  |  - erp-notify@company.edu.vn (Shared Mailbox)                         |  |  |`  
`|  |  |  - hr-onboarding@company.edu.vn (Shared Mailbox)                      |  |  |`  
`|  |  +-----------------------------------------------------------------------+  |  |`  
`|  +-----------------------------------------------------------------------------+  |`  
`|                                         |                                         |`  
`|                                         | (Ký số SPF / DKIM / DMARC tên miền)     |`  
`|                                         ▼                                         |`  
`|  +-----------------------------------------------------------------------------+  |`  
`|  | Microsoft Edge Protection / Outbound Gateway                                |  |`  
`|  +-----------------------------------------------------------------------------+  |`  
`+-------------------------------------------------------------------------|---------+`  
                                                                          `|`  
                                                                          `▼`  
                                                                  `[ NGƯỜI NHẬN THƯ ]`  
                                                                  `- Nhân viên mới (Gmail)`  
                                                                  `- Nhân sự nội bộ`

### **1\. Phân tách chức năng bằng các Shared Mailbox miễn phí**

Hạ tầng sẽ sử dụng ba Shared Mailbox (Hộp thư dùng chung) riêng biệt, hoàn toàn không tốn chi phí mua License:

* erp-notify@company.edu.vn: Phục vụ các thông báo tự động từ hệ thống như phê duyệt yêu cầu, thông báo chấm công.  
* hr-\[span\_148\](start\_span)\[span\_148\](end\_span)\[span\_150\](start\_span)\[span\_150\](end\_span)onboarding@company.edu.vn: Chuyên trách gửi thông tin hướng dẫn, thư chào mừng và liên kết kích hoạt tài khoản cho nhân viên mới.  
* payroll@company.edu.vn: Chỉ sử dụng cho tác vụ gửi phiếu lương bảo mật hàng tháng.

### **2\. Cơ chế tích hợp và bảo mật lõi**

* **Giao tiếp qua Graph API:** Máy chủ ERP sẽ loại bỏ hoàn toàn các thư viện SMTP truyền thống để chuyển sang sử dụng thư viện SDK Microsoft Graph. ERP sử dụng luồng xác thực Client Credentials Flow, ký số các yêu cầu bằng cặp khóa riêng tư (Private Key) được lưu trữ an toàn trong phân vùng mã hóa của máy chủ ERP.  
* **Áp dụng Exchange Online RBAC:** Thiết lập một chính sách phân quyền vai trò ứng dụng để giới hạn Đăng ký Ứng dụng trên Entra ID chỉ có quyền can thiệp và gửi email thông qua danh sách ba Shared Mailbox nêu trên. Mọi hành vi tấn công chiếm quyền điều khiển ứng dụng nhằm gửi email mạo danh Ban Giám đốc sẽ bị chặn đứng ngay lập tức tại cổng kiểm soát của Exchange Online.

## **F. Quy trình cấu hình hạ tầng và Deliverability**

Để đảm bảo toàn bộ email gửi đi từ ERP vượt qua các rào cản bảo mật của Microsoft và các tổ chức nhận tin bên ngoài, việc cấu hình chuẩn xác các tiêu chuẩn xác thực thư điện tử tại máy chủ DNS là bắt buộc.

### **1\. Sender Policy Framework (SPF)**

Bản ghi SPF giúp máy chủ nhận thư xác minh rằng địa chỉ IP gửi thư được sự ủy quyền của chủ sở hữu tên miền. Khi định tuyến toàn bộ email ERP qua hạ tầng Microsoft 365, quản trị viên cần thiết lập một bản ghi cấu hình dạng TXT tại DNS tên miền:

* *Nội dung bản ghi:* v=spf1 include:spf.protection.outlook.com \-all.  
* *Phân tích kỹ thuật:* Việc sử dụng ký tự kết thúc \-all (Hard Fail) là cực kỳ quan trọng. Nó ra chỉ thị cho máy chủ nhận thư từ chối thẳng thừng bất kỳ email nào mạo danh tên miền của tổ chức nhưng không xuất phát từ dải IP của Microsoft. Nếu ERP sử dụng thêm các dịch vụ gửi thư khác, IP của các dịch vụ đó phải được bổ sung vào trước phần include để tránh bị đánh dấu spam.

### **2\. DomainKeys Identified Mail (DKIM)**

DKIM bổ sung một chữ ký số mật mã học vào phần đầu (header) của mỗi email gửi đi. Khi email đến nơi, máy chủ nhận sẽ truy vấn khóa công khai được công bố trên DNS của tổ chức để giải mã chữ ký, đảm bảo nội dung email không bị thay đổi hoặc giả mạo trong suốt quá trình truyền tải trên môi trường mạng.

* Microsoft 365 tự động sinh ra hai bản ghi CNAME cho mỗi tên miền tùy chỉnh khi thiết lập DKIM.  
* Quản trị viên cần công bố các bản ghi này trên trình quản lý DNS của nhà cung cấp tên miền để kích hoạt chữ ký số bảo mật.

### **3\. Domain-based Message Authentication, Reporting, and Conformance (DMARC)**

DMARC là lớp bảo vệ tối cao hoạt động dựa trên sự đồng bộ giữa SPF và DKIM. Nó hướng dẫn cho máy chủ nhận thư biết phải xử lý thế nào khi một email gửi từ tên miền của tổ chức bị trượt cả hai bài kiểm tra SPF và DKIM.

* *Lộ trình triển khai khuyến nghị:* Ban đầu, cấu hình DMARC ở chế độ giám sát (p=none) để thu thập các báo cáo XML về hành vi gửi thư: v=DMARC1; p=none; rua=mailto:dmarc-reports@company.edu.\[span\_229\](start\_span)\[span\_229\](end\_span)vn;  
* Sau khoảng từ 30 đến 90 ngày phân tích dữ liệu, khi xác nhận toàn bộ luồng gửi thư hợp lệ của ERP đều đã vượt qua kiểm tra, quản trị viên cần nâng mức chính sách lên nghiêm ngặt (p=quarantine hoặc tốt nhất là p=reject) để triệt tiêu hoàn toàn các hành vi giả mạo tên miền.

### **4\. Hệ thống kiểm soát Outbound Spam của Microsoft 365**

Mọi email đi ra từ hệ thống Exchange Online đều phải đi qua bộ lọc Outbound Spam Filter của Microsoft. Nếu ứng dụng ERP bị lỗi vòng lặp gửi thư liên tục, hoặc gửi thư có nội dung chứa các liên kết lừa đảo bị báo cáo bởi người nhận, tài khoản gửi thư sẽ ngay lập tức bị đưa vào danh sách hạn chế (Restricted Entities).

* Khi bị rơi vào danh sách này, hộp thư hệ thống sẽ nhận được mã lỗi trả về là 5.1.8 và bị chặn hoàn toàn khả năng gửi thư ra ngoài.  
* Quản trị viên bắt buộc phải truy cập vào cổng Security & Compliance Center để gỡ bỏ lệnh chặn một cách thủ công sau khi đã xử lý triệt để nguyên nhân phát tán thư rác.

## **G. Checklist triển khai thực tế**

Quy trình thiết lập hệ thống từ cấu hình hạ tầng đến lập trình kết nối được tóm tắt qua bảng chỉ dẫn từng bước dưới đây:

| Thứ tự | Bước công việc | Hành động chi tiết | Lệnh cấu hình mẫu / Ghi chú |
| :---- | :---- | :---- | :---- |
| **1** | Khởi tạo hộp thư hệ thống | Tạo các Shared Mailbox miễn phí trên M365 Admin Center. | Tên miền: erp-notify@company.edu.vn. Không gán license. |
| **2** | Đăng ký ứng dụng xác thực | Đăng ký một App Registration trên Entra ID ở chế độ Single-tenant. | Ghi lại: Client ID, Tenant ID, Enterprise Application Object ID. |
| **3** | Cấu hình chứng chỉ bảo mật | Sinh cặp khóa RSA 4096-bit trên ERP và tải tệp .crt lên Entra ID. | Không dùng Client Secret để loại bỏ nguy cơ lộ mật khẩu. |
| **4** | Kết nối Exchange PowerShell | Khởi chạy PowerShell với tư cách quản trị viên và kết nối tenant. | Lệnh: Connect-ExchangeOnline. |
| **5** | Khai báo thực thể dịch vụ | Đăng ký con trỏ Service Principal trong Exchange Online. | New-ServicePrincipal \-AppId "\<Client\_ID\>" \-ObjectId "\<Enterprise\_App\_Object\_ID\>" |
| **6** | Thiết lập phạm vi gửi thư | Tạo vùng quản lý chỉ bao gồm các Shared Mailbox của ERP. | New-ManagementScope \-Name "ERP\_Scope" \-RecipientRestrictionFilter "PrimarySmtpAddress \-eq 'erp-notify@company.edu.vn'" |
| **7** | Gán vai trò ứng dụng | Liên kết Service Principal với vai trò gửi thư trong phạm vi đã tạo. | New-ManagementRoleAssignment \-Role "Application Mail.Send" \-App "ERP\_Service" \-CustomResourceScope\[span\_187\](start\_span)\[span\_187\](end\_span)\[span\_190\](start\_span)\[span\_190\](end\_span) "ERP\_Scope" |
| **8** | Cấu hình bản ghi DNS | Khai báo các bản ghi SPF, DKIM (CNAME) và DMARC tại trình quản lý tên miền. | Đợi tối đa 24 giờ để DNS đồng bộ và kích hoạt DKIM trên Defender Portal. |
| **9** | Kiểm tra phân quyền | Chạy thử nghiệm giả lập quyền lực gửi thư trên môi trường PowerShell. | Test-ServicePrincipalAuthorization \-Identity "ERP\_Service" \-Resource "erp-notify@company.edu.vn" |
| **10** | Lập trình tích hợp | Viết mã nguồn trên ERP để gọi dịch vụ Microsoft Graph API gửi thư. | Sử dụng tệp khóa tư nhân để ký yêu cầu sinh mã thông báo (Bearer Token). |

## **H. Best Practices vận hành thực tế**

Để hệ thống hoạt động ổn định lâu dài và bảo mật tối đa, quy trình phát triển và vận hành cần tuân thủ nghiêm ngặt các chỉ dẫn thiết kế sau.

### **1\. Quy trình quản lý thông tin kích hoạt tài khoản nhân sự mới**

Chia sẻ mật khẩu mặc định hoặc mật khẩu tạm thời bằng văn bản thuần túy (plaintext) qua email cá nhân là một trong những sai lầm an ninh phổ biến nhất, tạo cơ hội cho kẻ tấn công đánh cắp tài khoản ngay từ ngày đầu tiên làm việc. Để giải quyết rủi ro này, quy trình Onboarding không mật khẩu (Passwordless Onboarding) cần được áp dụng:

* **Sử dụng Liên kết Kích hoạt Độc bản (One-Time Activation Link):** Khi phòng Nhân sự tạo tài khoản mới trên ERP, hệ thống tự động đồng bộ sang Entra ID ở trạng thái tạm khóa. ERP sẽ sinh ra một chuỗi mã xác thực ngẫu nhiên (Token) có thời gian tồn tại rất ngắn (ví dụ: 15 phút) và gửi email chứa liên kết kích hoạt duy nhất đến địa chỉ email cá nhân của nhân viên.  
* **Xác thực bắc cầu bằng OTP di động:** Khi nhân viên truy cập liên kết, hệ thống sẽ yêu cầu nhập mã OTP được gửi qua SMS đến số điện thoại cá nhân đã khai báo trong hồ sơ nhân sự. Sau khi xác minh danh tính thành công, nhân viên mới tự thiết lập mật khẩu của mình ngay trong phiên làm việc đầu tiên theo đúng độ phức tạp chính sách của tổ chức. Phương pháp này triệt tiêu hoàn toàn việc truyền tải mật khẩu qua môi trường email không an toàn.

### **2\. Thiết lập cơ chế hàng đợi Staging Queue và kiểm soát tần suất gửi thư**

Để ngăn chặn việc ERP gửi thư dồn dập vượt quá ngưỡng giới hạn 30 thư/phút của Exchange Online dẫn đến việc bị đánh dấu spam, kiến trúc ứng dụng ERP bắt buộc phải xây dựng mô hình lưu trữ hàng đợi thay vì gửi trực tiếp đồng thì:

* **Thiết kế bảng đệm trong cơ sở dữ liệu (Database-based Outbox Pattern):** Mọi tác vụ gửi email từ các module nghiệp vụ của ERP không được phép gọi trực tiếp đến Graph API. Thay vào đó, dữ liệu email (người nhận, tiêu đề, nội dung HTML, tệp đính kèm) phải được lưu trữ vào một bảng đệm có cấu trúc (ví dụ: Email\_Outbox).  
* **Lập trình Worker điều phối luồng (Rate Limiter Worker):** Một tiến trình chạy ngầm (Cronjob hoặc Background Service) trên máy chủ ERP sẽ quét bảng đệm này theo chu kỳ. Tiến trình này sẽ bốc lần lượt từng email để gửi qua Graph API với tốc độ được kiểm soát chủ động không vượt quá 20 email mỗi phút. Nếu kết nối gặp lỗi quá tải (HTTP Error 429), Worker sẽ tự động áp dụng thuật toán lùi lịch gửi lũy tiến (Exponential Backoff) để thử lại sau đó một cách an toàn.

### **3\. Giám sát hạn ngạch bộ nhớ và tự động hóa công tác dọn dẹp**

Mặc dù các Shared Mailbox được sử dụng miễn phí, chúng vẫn bị giới hạn dung lượng lưu trữ tối đa ở mức 50 GB. Nếu ERP cấu hình thuộc tính saveToSentItems thành true để lưu lại bản sao của mọi email đã gửi trong hòm thư, dung lượng của hòm thư hệ thống sẽ nhanh chóng bị lấp đầy.

* **Sử dụng PowerShell để lập báo cáo định kỳ:** Quản trị viên cần viết các đoạn mã PowerShell chạy tự động hàng tuần để kiểm tra dung lượng hiện tại của các hộp thư hệ thống:  
  `$MailboxStats = Get-EXOMailboxStatistics -Identity "erp-notify@company.edu.vn"`  
  `$CurrentSizeGB = [Math]::Round(($MailboxStats.TotalItemSize.Value.ToBytes() / 1GB), 2)`  
  `if ($CurrentSizeGB -ge 40) {`  
      `# Gửi cảnh báo đến hệ thống giám sát của quản trị viên`  
  `}[span_300](start_span)[span_300](end_span)[span_301](start_span)[span_301](end_span)`

* **Thiết lập chính sách tự động xóa (Retention Policy):** Cấu hình một chính sách lưu trữ chuyên biệt (Retention Tags & Policies) trên Exchange Admin Center, áp dụng riêng cho các Shared Mailbox hệ thống của ERP. Chính sách này sẽ tự động xóa vĩnh viễn mọi email nằm trong thư mục Sent Items và Inbox có tuổi thọ vượt quá 90 ngày. Việc dọn dẹp tự động này đảm bảo dung lượng hòm thư ERP luôn ở trạng thái an toàn tuyệt đối mà không cần bất kỳ sự can thiệp thủ công nào của đội ngũ vận hành.

#### **Nguồn trích dẫn**

1\. Baseline \- Applications, products, and features available with A1 license \- M365 Education, https://learn.microsoft.com/en-us/microsoft-365/education/guide/0-start-baseline/start-baseline-all 2\. How To Configure Email In D365 \- Dynamics 365 Musings, https://dynamics365musings.com/configure-email-in-d365/ 3\. Understanding Microsoft Exchange Online Limits \- services.pitt.edu, https://services.pitt.edu/TDClient/33/Portal/KB/PrintArticle?ID=1072 4\. Sending ERPAG emails using Office365, https://www.erpag.com/news/sending-erpag-emails-using-office365 5\. How to Connect Emails through the Accountiug ERP system, to be able to email from ERP web site \- Microsoft Learn, https://learn.microsoft.com/en-us/answers/questions/5618177/how-to-connect-emails-through-the-accountiug-erp-s 6\. Set up Microsoft Graph as Email Provider \- Entropy Data Documentation, https://docs.entropy-data.com/howto/mail-ms-graph 7\. Exchange Online Introduce External Recipient Rate Limit – Effective Oct. 1, 2026 | EASI, https://easi.its.utoronto.ca/exchange-online-introduce-external-recipient-rate-limit-effective-oct-1-2026/ 8\. No bulk email sending limit for Exchange Online \- 4sysops, https://4sysops.com/archives/no-bulk-email-sending-limit-for-exchange-online/ 9\. Troubleshoot outbound sending limits in Exchange Online \- Microsoft Defender for Office 365, https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-sending-limits-troubleshoot 10\. Microsoft365 Education (Home Use) \- ITS Service Catalog \- University of San Diego, https://www.sandiego.edu/its/services/detail/68 11\. Free Office 365 for Students and Educators \- Microsoft, https://www.microsoft.com/en/education/products/office 12\. Microsoft 365 Education Licensing Guide: A1, A3, A5 \- The Negotiation Experts, https://thenegotiationexperts.com/blog/microsoft-365-education-licensing/ 13\. Using Office 355 Education plans for freelancing \- Microsoft Q\&A, https://learn.microsoft.com/en-us/answers/questions/4398159/using-office-355-education-plans-for-freelancing 14\. Change Log | M365 Maps, https://m365maps.com/changes.htm 15\. How to Deploy Microsoft 365 Copilot: IT Admin Guide 2026 \- ITECS, https://itecsonline.com/post/how-to-deploy-microsoft-365-copilot-it-admin-guide-2026 16\. Microsoft 365 for education is changing in 2024 | Primary Technology, https://primaryt.co.uk/microsoft-365-for-education-is-changing/ 17\. Implications of Microsoft Exchange Online limits on Learn365 email notifications, https://helpcenter.zensai.com/hc/en-us/articles/360015355257-Implications-of-Microsoft-Exchange-Online-limits-on-Learn365-email-notifications 18\. Microsoft Exchange Online Tenant Outbound Email Limits \- KnowBe4 Knowledge Base, https://support.knowbe4.com/hc/en-us/articles/40027061481363-Microsoft-Exchange-Online-Tenant-Outbound-Email-Limits 19\. Configure and send email \- Finance & Operations | Dynamics 365 \- Microsoft Learn, https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/organization-administration/configure-email 20\. Sending Email (SMTP OAuth2) — FAQ for Application Teams & Developers \- ser, https://services.dartmouth.edu/TDClient/1806/Portal/KB/Article/168187/Sending-Email-SMTP-OAuth2-FAQ-for-Application-Teams-Developers 21\. Sending Email via Office 365 in Sage 500 ERP \- RKL eSolutions, https://www.rklesolutions.com/blog/sending-email-via-office-365-in-sage-500-erp 22\. SMTP Relay for Office 365 on Windows Server: Setup Guide \- Warmforge, https://www.warmforge.ai/blog/smtp-relay-office-365-windows-server-setup-guide 23\. About Exchange Online SMTP relay limits \- Microsoft Q\&A, https://learn.microsoft.com/en-ca/answers/questions/5025782/about-exchange-online-smtp-relay-limits 24\. Administration \- Configuring Direct Send in Microsoft 365 \- Mimecast, https://mimecastsupport.zendesk.com/hc/en-us/articles/43158893089555-Administration-Configuring-Direct-Send-in-Microsoft-365 25\. Microsoft 365 Direct Send Exploit: How Attackers Bypass Email | Alchemy Tech Group, https://alchemytechgroup.com/blog/microsoft-365-direct-send-exploit 26\. Securing Direct Send in Exchange Online: closing the gaps in EOP-based MX setups, https://cloudnotes.blog/blog/post-2025-10-exo-direct-send-eop-mx-direct/ 27\. Microsoft 365 Direct Send Attacks \- Barracuda Trust Center, https://trust.barracuda.com/security/information/microsoft-365-direct-send-attacks 28\. Is M365 Direct Send just the normal internet SMTP port? : r/sysadmin \- Reddit, https://www.reddit.com/r/sysadmin/comments/1ssbjdu/is\_m365\_direct\_send\_just\_the\_normal\_internet\_smtp/ 29\. Send e-mails using Microsoft Graph \- GitHub, https://github.com/SAP-samples/btp-cap-multitenant-saas/blob/main/docu/4-expert/send-emails-graph-api/README.md 30\. How to send Email from Azure PowerShell Function App Using Microsoft Graph API – Shared Mailbox (Certificate-Based Authentication), https://learn.microsoft.com/en-us/answers/questions/5854511/how-to-send-email-from-azure-powershell-function-a 31\. Permissions to access shared mailbox to read and send emails \- Microsoft Learn, https://learn.microsoft.com/en-us/answers/questions/2149155/permissions-to-access-shared-mailbox-to-read-and-s 32\. Send Email via Microsoft Graph Authorization \- eLegere Documentation, https://docs.elegere.com/documentation/2.13/whats-new/versions/2-13-prerelease.5/send-email-auth-ms-graph/ 33\. How to Set Up an Exchange Online Mailbox for OpenClaw | Ned In The Cloud, https://nedinthecloud.com/2026/05/01/how-to-set-up-an-exchange-online-mailbox-for-openclaw/ 34\. How to Send email using Micorsoft Graph API & OAuth2 in C\# \- Microsoft Q\&A, https://learn.microsoft.com/en-za/answers/questions/5746341/how-to-send-email-using-micorsoft-graph-api-oauth2 35\. Sending Email from a Microsoft 365 Shared Mailbox Using C\# and Microsoft Graph, https://blog.bartvanduinkerken.com/send-email-dotnet-and-exhange 36\. Office365-SPF & DKIM Setup \- MxToolbox, https://mxtoolbox.com/c/outboundemailsources?public=Office365 37\. How to setup DKIM email authentication in Microsoft 365 \- YouTube, https://www.youtube.com/watch?v=IXbI0EXjImg 38\. Control Graph Mail.Send Permission with RBAC for Applications \- Office 365 for IT Pros, https://office365itpros.com/2026/02/17/mail-send-rbac-for-applications/ 39\. How to Configure RBAC for Applications in Exchange Online \- ALI TAJRAN, https://www.alitajran.com/rbac-applications-exchange-online/ 40\. Outlook to ERP: Microsoft Dynamics 365 integration \- Virtualworkforce.ai, https://virtualworkforce.ai/outlook-to-erp-data-entry/ 41\. New Employee CyberSecurity Checklist for smbs \- TriTech Corporation of America, https://www.tritechcoa.com/post/new-employee-cybersecurity-checklist-for-smbs 42\. Microsoft Graph \- Remembered to restict Mail.Send Application Permission? (App Access Policies) \- Mindcore Techblog, https://blog.mindcore.dk/2026/02/microsoft-graph-remembered-to-restict-mail-send-application-permission-app-access-policies/ 43\. how to restrict Microsoft Graph API permission to one accounts only, https://learn.microsoft.com/en-us/answers/questions/214142/how-to-restrict-microsoft-graph-api-permission-to 44\. Limited application permissions for EWS and Graph \- the IRIS Help Hub, https://help-iris.co.uk/IRIS/ODL/IRIS\_Docs/limiting\_app\_permissions\_ews\_and\_graph.htm 45\. Application Access Policies (legacy) \- Microsoft Learn, https://learn.microsoft.com/en-us/exchange/permissions-exo/application-access-policies 46\. New-ApplicationAccessPolicy (ExchangePowerShell) | Microsoft Learn, https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-applicationaccesspolicy?view=exchange-ps 47\. Role Based Access Control for Applications in Exchange Online | Microsoft Learn, https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac 48\. Limiting Mailbox and User Access with Application Permissions using RBAC, https://support.rivasync.com/hc/en-us/articles/37061236888852-Limiting-Mailbox-and-User-Access-with-Application-Permissions-using-RBAC 49\. How can I fetch emails from shared email address through Graph API? \- Microsoft Learn, https://learn.microsoft.com/en-us/answers/questions/5704312/how-can-i-fetch-emails-from-shared-email-address-t 50\. Shared Mailboxes (Microsoft 365\) \- EmailEngine \- Self-Hosted Email API, https://learn.emailengine.app/docs/accounts/microsoft-365/shared-mailboxes 51\. Office 365 Email authentication: Setting Up SPF, DKIM, DMARC \- MailsDaddy, https://www.mailsdaddy.com/blogs/office-365-email-authentication-setting-up-spf-dkim-dmarc/ 52\. Enable and add DKIM to my domain for Microsoft 365 \- GoDaddy, https://www.godaddy.com/help/enable-and-add-dkim-to-my-domain-for-microsoft-365-41748 53\. Set Up DKIM for Office 365 Your 2026 Deliverability Guide \- MailGenius, https://www.mailgenius.com/set-up-dkim-for-office-365/ 54\. Office 365 DKIM Setup \- Sendmarc, https://sendmarc.com/dkim/dkim-office365/ 55\. Exchange Online Sending Limits vs. Anti-Spam Outbound Policy : r/sysadmin \- Reddit, https://www.reddit.com/r/sysadmin/comments/1rovusp/exchange\_online\_sending\_limits\_vs\_antispam/ 56\. Passwordless onboarding: what happens to the first credential?, https://nhimg.org/community/nhi-best-practices/passwordless-onboarding-what-happens-to-the-first-credential/ 57\. The Onboarding Password Mistake That Creates Unnecessary Risk \- The Hacker News, https://thehackernews.com/2026/06/the-onboarding-password-mistake-that.html 58\. The Hidden Security Risks in Employee Onboarding: How to Deliver a Password Securely, https://www.fastpasscorp.com/blog/hidden-security-risks-employee-onboarding-deliver-password-securely/ 59\. Find Mailbox Size and Statistics in Exchange Online \- EasyEntra, https://easyentra.com/how-to-get-mailbox-size-and-statistics-in-exchange-online/ 60\. Identify Exchange Online Quota Exceeded Mailboxes \- ManageEngine, https://www.manageengine.com/microsoft-365-management-reporting/kb/idenitify-mailbox-quota-exceeded-mailboxes.html 61\. How to Find Mailboxes Over the Warning Quota in Exchange Online \- AdminDroid, https://admindroid.com/how-to-find-mailboxes-over-warning-quota-in-exchange-online 62\. Exchange Mailbox Usage Report \- Microsoft 365 admin, https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/mailbox-usage?view=o365-worldwide